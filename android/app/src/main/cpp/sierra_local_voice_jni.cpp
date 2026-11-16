#include <jni.h>
#include <string>
#include <vector>
#include <cmath>
#include <atomic>
#include <mutex>
#include <chrono>
#include <algorithm>
#include <cstring>
#include <sstream>
#include <fstream>
#include <iomanip>
#include <android/log.h>
#if defined(__aarch64__)
#include <sys/auxv.h>
#include <asm/hwcap.h>
#endif

#include "llama.h"
#include "whisper.h"

#define LOG_TAG "SierraLocalVoiceJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)
#define LOGW(...) __android_log_print(ANDROID_LOG_WARN, LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {
    std::mutex g_llmMutex;
    std::mutex g_whisperMutex;
    std::mutex g_stateMutex;
    std::atomic<bool> g_backendInitialized{false};
    std::atomic<bool> g_cancelLlm{false};

    llama_model* g_llamaModel = nullptr;
    llama_context* g_llamaCtx = nullptr;
    int g_llmThreads = 6;
    int g_llmCtxSize = 4096;
    std::vector<llama_token> g_kvCachedTokens;

    whisper_context* g_whisperCtx = nullptr;

    std::string g_currentGenStage = "idle";
    std::string g_lastNativeError = "";

    void setGenStage(const std::string& stage) {
        std::lock_guard<std::mutex> lock(g_stateMutex);
        g_currentGenStage = stage;
    }

    std::string getGenStage() {
        std::lock_guard<std::mutex> lock(g_stateMutex);
        return g_currentGenStage;
    }

    void setLastError(const std::string& err) {
        std::lock_guard<std::mutex> lock(g_stateMutex);
        g_lastNativeError = err;
        if (!err.empty()) {
            LOGE("Native error recorded: %s", err.c_str());
        }
    }

    std::string getLastError() {
        std::lock_guard<std::mutex> lock(g_stateMutex);
        return g_lastNativeError;
    }

    std::string detectCpuFeaturesSummary() {
        std::ostringstream oss;
        oss << "compiled=[";
#if defined(__aarch64__)
        oss << "ARCH=aarch64";
#if defined(__ARM_NEON) || defined(__ARM_NEON__)
        oss << ", NEON=1";
#else
        oss << ", NEON=0";
#endif
#if defined(__ARM_FEATURE_DOTPROD)
        oss << ", DOTPROD=1";
#else
        oss << ", DOTPROD=0";
#endif
#if defined(__ARM_FEATURE_MATMUL_INT8)
        oss << ", I8MM=1";
#else
        oss << ", I8MM=0";
#endif
#if defined(__ARM_FEATURE_FP16_VECTOR_ARITHMETIC)
        oss << ", FP16=1";
#else
        oss << ", FP16=0";
#endif
        oss << "]";

        unsigned long hwcaps = getauxval(AT_HWCAP);
        unsigned long hwcaps2 = getauxval(AT_HWCAP2);
        oss << ", auxv=[hwcap=0x" << std::hex << hwcaps << ", hwcap2=0x" << hwcaps2 << std::dec << "]";

        std::string cpuInfoFeatures;
        std::ifstream cpuinfo("/proc/cpuinfo");
        if (cpuinfo.is_open()) {
            std::string line;
            while (std::getline(cpuinfo, line)) {
                if (line.rfind("Features", 0) == 0) {
                    size_t colonPos = line.find(':');
                    if (colonPos != std::string::npos && colonPos + 1 < line.size()) {
                        cpuInfoFeatures = line.substr(colonPos + 1);
                        break;
                    }
                }
            }
        }
        if (!cpuInfoFeatures.empty()) {
            size_t first = cpuInfoFeatures.find_first_not_of(" \t\r\n");
            size_t last = cpuInfoFeatures.find_last_not_of(" \t\r\n");
            if (first != std::string::npos && last != std::string::npos) {
                cpuInfoFeatures = cpuInfoFeatures.substr(first, last - first + 1);
            }
            oss << ", runtime=[" << cpuInfoFeatures << "]";
        }
#else
        oss << "ARCH=non-aarch64, NEON=0, DOTPROD=0, I8MM=0, FP16=0]";
#endif
        return oss.str();
    }

    void ensureBackendInitialized() {
        bool expected = false;
        if (g_backendInitialized.compare_exchange_strong(expected, true)) {
            llama_backend_init();
            std::string cpuDesc = detectCpuFeaturesSummary();
            LOGI("Initialized llama.cpp + ggml native backend (%s)", cpuDesc.c_str());
        }
    }

    std::string trimString(const std::string& s) {
        size_t start = 0;
        while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
            start++;
        }
        size_t end = s.size();
        while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
            end--;
        }
        return s.substr(start, end - start);
    }

    std::string sanitizeForLog(const std::string& s) {
        std::string out;
        out.reserve(s.size());
        for (char c : s) {
            if (c == '\n') out += "\\n";
            else if (c == '\r') out += "\\r";
            else if (c == '|') out += "/";
            else out += c;
        }
        return out;
    }

    bool isStopMarkerSuffix(const std::string& text, std::string& cleanedOut, std::string& markerOut) {
        static const char* kStopMarkers[] = {
            "<|eot_id|>",
            "<|im_end|>",
            "<|end_of_text|>",
            "</s>",
            "<|endoftext|>",
            "<|start_header_id|>",
            "<|im_start|>"
        };
        for (const char* marker : kStopMarkers) {
            size_t pos = text.find(marker);
            if (pos != std::string::npos) {
                cleanedOut = text.substr(0, pos);
                markerOut = marker;
                return true;
            }
        }
        return false;
    }

    std::vector<llama_token> tokenizeString(llama_model* model, const std::string& text, bool addSpecial) {
        if (model == nullptr || text.empty()) return {};
        std::vector<llama_token> tokens(text.size() + 32);
        int32_t n = llama_tokenize(
                model,
                text.c_str(),
                static_cast<int32_t>(text.size()),
                tokens.data(),
                static_cast<int32_t>(tokens.size()),
                addSpecial,
                true);
        if (n < 0) {
            tokens.resize(-n);
            n = llama_tokenize(
                    model,
                    text.c_str(),
                    static_cast<int32_t>(text.size()),
                    tokens.data(),
                    static_cast<int32_t>(tokens.size()),
                    addSpecial,
                    true);
        }
        if (n <= 0) return {};
        tokens.resize(n);
        return tokens;
    }

    void emitDiagnostic(
            JNIEnv* env,
            jobject callbackTarget,
            jmethodID onDiagMid,
            jint turnId,
            const std::string& stage,
            const std::string& detail) {
        LOGI("[Diag turn=%d stage=%s] %s", static_cast<int>(turnId), stage.c_str(), detail.c_str());
        if (callbackTarget != nullptr && onDiagMid != nullptr) {
            jstring jStage = env->NewStringUTF(stage.c_str());
            jstring jDetail = env->NewStringUTF(detail.c_str());
            if (jStage != nullptr && jDetail != nullptr) {
                env->CallVoidMethod(callbackTarget, onDiagMid, turnId, jStage, jDetail);
            }
            if (jStage != nullptr) env->DeleteLocalRef(jStage);
            if (jDetail != nullptr) env->DeleteLocalRef(jDetail);
        }
    }
}

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeGetCpuFeatures(
        JNIEnv* env,
        jclass /* clazz */) {
    std::string features = detectCpuFeaturesSummary();
    return env->NewStringUTF(features.c_str());
}

JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeGetGenerationStage(
        JNIEnv* env,
        jclass /* clazz */) {
    std::string st = getGenStage();
    return env->NewStringUTF(st.c_str());
}

JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeGetLastError(
        JNIEnv* env,
        jclass /* clazz */) {
    std::string err = getLastError();
    return env->NewStringUTF(err.c_str());
}

JNIEXPORT void JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeInvalidateKvCache(
        JNIEnv* /* env */,
        jclass /* clazz */) {
    std::lock_guard<std::mutex> lock(g_llmMutex);
    g_kvCachedTokens.clear();
    if (g_llamaCtx != nullptr) {
        llama_kv_cache_clear(g_llamaCtx);
    }
    LOGI("Invalidated llama.cpp KV cache");
}

/**
 * Pre-evaluates the static system prefix into the llama.cpp KV cache at session start
 * and reuses it across turns unless invalidated.
 * Returns: "OK|<cachedTokens>|<evalMs>" or "ERR|<reason>"
 */
JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeWarmSystemPrefix(
        JNIEnv* env,
        jclass /* clazz */,
        jstring systemPrefix) {
    if (systemPrefix == nullptr) {
        return env->NewStringUTF("ERR|systemPrefix is null");
    }
    const char* rawChars = env->GetStringUTFChars(systemPrefix, nullptr);
    if (rawChars == nullptr) {
        return env->NewStringUTF("ERR|failed to read systemPrefix UTF chars");
    }
    std::string prefixStr(rawChars);
    env->ReleaseStringUTFChars(systemPrefix, rawChars);

    std::lock_guard<std::mutex> lock(g_llmMutex);
    if (g_llamaModel == nullptr || g_llamaCtx == nullptr) {
        return env->NewStringUTF("ERR|model or context not loaded");
    }

    std::vector<llama_token> prefixTokens = tokenizeString(g_llamaModel, prefixStr, false);
    if (prefixTokens.empty()) {
        return env->NewStringUTF("ERR|prefix tokenized to 0 tokens");
    }

    // Check how many tokens already match g_kvCachedTokens
    size_t commonLen = 0;
    size_t maxCheck = std::min(prefixTokens.size(), g_kvCachedTokens.size());
    while (commonLen < maxCheck && prefixTokens[commonLen] == g_kvCachedTokens[commonLen]) {
        commonLen++;
    }

    if (commonLen == prefixTokens.size()) {
        // Already cached in full; trim any trailing turn history beyond prefixTokens
        if (g_kvCachedTokens.size() > prefixTokens.size()) {
            (void)llama_kv_cache_seq_rm(
                    g_llamaCtx,
                    0,
                    static_cast<llama_pos>(prefixTokens.size()),
                    -1);
            g_kvCachedTokens.resize(prefixTokens.size());
        }
        std::ostringstream oss;
        oss << "OK|" << prefixTokens.size() << "|0";
        return env->NewStringUTF(oss.str().c_str());
    }

    auto startTp = std::chrono::steady_clock::now();
    llama_kv_cache_clear(g_llamaCtx);
    g_kvCachedTokens.clear();
    llama_set_n_threads(g_llamaCtx, g_llmThreads, g_llmThreads);

    const int batchChunkSize = 512;
    for (size_t offset = 0; offset < prefixTokens.size(); offset += batchChunkSize) {
        int32_t chunkLen = static_cast<int32_t>(
                std::min(static_cast<size_t>(batchChunkSize), prefixTokens.size() - offset));
        llama_batch batch = llama_batch_get_one(prefixTokens.data() + offset, chunkLen);
        int ret = llama_decode(g_llamaCtx, batch);
        if (ret != 0) {
            llama_kv_cache_clear(g_llamaCtx);
            g_kvCachedTokens.clear();
            std::string err = "ERR|llama_decode failed warming prefix with code " + std::to_string(ret);
            return env->NewStringUTF(err.c_str());
        }
        g_kvCachedTokens.insert(
                g_kvCachedTokens.end(),
                prefixTokens.begin() + offset,
                prefixTokens.begin() + offset + chunkLen);
    }

    auto endTp = std::chrono::steady_clock::now();
    long elapsedMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count()));
    std::ostringstream oss;
    oss << "OK|" << g_kvCachedTokens.size() << "|" << elapsedMs;
    return env->NewStringUTF(oss.str().c_str());
}

JNIEXPORT jboolean JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeLoadLlmModel(
        JNIEnv* env,
        jclass /* clazz */,
        jstring modelPath,
        jint nThreads,
        jint nCtx) {
    if (modelPath == nullptr) {
        setLastError("nativeLoadLlmModel: modelPath is null");
        return JNI_FALSE;
    }
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    if (path == nullptr) {
        setLastError("nativeLoadLlmModel: failed to read modelPath UTF chars");
        return JNI_FALSE;
    }
    std::string pathStr(path);
    env->ReleaseStringUTFChars(modelPath, path);

    std::lock_guard<std::mutex> lock(g_llmMutex);
    ensureBackendInitialized();
    setGenStage("loading_model");
    g_kvCachedTokens.clear();

    if (g_llamaCtx != nullptr) {
        llama_free(g_llamaCtx);
        g_llamaCtx = nullptr;
    }
    if (g_llamaModel != nullptr) {
        llama_free_model(g_llamaModel);
        g_llamaModel = nullptr;
    }

    llama_model_params mparams = llama_model_default_params();
    mparams.n_gpu_layers = 0; // CPU / ARM NEON + dotprod + i8mm execution
    mparams.use_mmap = true;
    mparams.use_mlock = false;

    LOGI("Loading GGUF model via llama.cpp (use_mmap=true): %s", pathStr.c_str());
    g_llamaModel = llama_load_model_from_file(pathStr.c_str(), mparams);
    if (g_llamaModel == nullptr) {
        setLastError("llama_load_model_from_file failed for " + pathStr);
        setGenStage("idle");
        return JNI_FALSE;
    }

    // Default to 6 threads on 8-core devices (clamp between 2 and 8)
    g_llmThreads = std::max(2, std::min(8, static_cast<int>(nThreads)));
    g_llmCtxSize = std::max(1024, std::min(8192, static_cast<int>(nCtx)));

    llama_context_params cparams = llama_context_default_params();
    cparams.n_ctx = static_cast<uint32_t>(g_llmCtxSize);
    cparams.n_batch = 512;
    cparams.n_ubatch = 128;
    cparams.n_threads = g_llmThreads;
    cparams.n_threads_batch = g_llmThreads;
    cparams.flash_attn = true;

    g_llamaCtx = llama_new_context_with_model(g_llamaModel, cparams);
    if (g_llamaCtx == nullptr) {
        // Retry with flash_attn = false if flash_attn was rejected for this model architecture
        cparams.flash_attn = false;
        g_llamaCtx = llama_new_context_with_model(g_llamaModel, cparams);
    }
    if (g_llamaCtx == nullptr) {
        setLastError("llama_new_context_with_model failed for " + pathStr);
        llama_free_model(g_llamaModel);
        g_llamaModel = nullptr;
        setGenStage("idle");
        return JNI_FALSE;
    }

    llama_set_n_threads(g_llamaCtx, g_llmThreads, g_llmThreads);
    setGenStage("idle");
    LOGI("Loaded GGUF model in llama.cpp (threads=%d, n_ctx=%d, n_batch=512, n_ubatch=128, flash_attn=%d)",
         g_llmThreads, g_llmCtxSize, cparams.flash_attn ? 1 : 0);
    return JNI_TRUE;
}

JNIEXPORT jboolean JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeLoadWhisperModel(
        JNIEnv* env,
        jclass /* clazz */,
        jstring modelPath) {
    if (modelPath == nullptr) {
        setLastError("nativeLoadWhisperModel: modelPath is null");
        return JNI_FALSE;
    }
    const char* path = env->GetStringUTFChars(modelPath, nullptr);
    if (path == nullptr) {
        setLastError("nativeLoadWhisperModel: failed to read modelPath UTF chars");
        return JNI_FALSE;
    }
    std::string pathStr(path);
    env->ReleaseStringUTFChars(modelPath, path);

    std::lock_guard<std::mutex> lock(g_whisperMutex);
    ensureBackendInitialized();

    if (g_whisperCtx != nullptr) {
        whisper_free(g_whisperCtx);
        g_whisperCtx = nullptr;
    }

    whisper_context_params cparams = whisper_context_default_params();
    cparams.use_gpu = false;
    cparams.flash_attn = false;

    LOGI("Loading Whisper GGML model via whisper.cpp: %s", pathStr.c_str());
    g_whisperCtx = whisper_init_from_file_with_params(pathStr.c_str(), cparams);
    if (g_whisperCtx == nullptr) {
        setLastError("whisper_init_from_file_with_params failed for " + pathStr);
        return JNI_FALSE;
    }

    LOGI("Loaded Whisper GGML model in whisper.cpp successfully");
    return JNI_TRUE;
}

/**
 * Runs a real 3-token startup self-test on the loaded llama.cpp model AND benchmarks
 * thread counts (4 vs 6) and batch chunking (128 vs 512) to log native speed on device.
 * Returns: "OK|<tokensPerSec>|<elapsedMs>|<generatedText>|<benchmarkSummary>" or "ERR|<reason>"
 */
JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeRunSelfTest(
        JNIEnv* env,
        jclass /* clazz */,
        jstring prompt,
        jint maxTokens) {
    std::lock_guard<std::mutex> lock(g_llmMutex);
    if (g_llamaModel == nullptr || g_llamaCtx == nullptr) {
        setLastError("SelfTest: llama.cpp model or context is not loaded");
        return env->NewStringUTF("ERR|llama.cpp model or context is not loaded");
    }

    const char* promptChars = prompt != nullptr ? env->GetStringUTFChars(prompt, nullptr) : nullptr;
    std::string promptStr = promptChars != nullptr ? std::string(promptChars) : "Hello";
    if (promptChars != nullptr) {
        env->ReleaseStringUTFChars(prompt, promptChars);
    }

    int targetTokens = std::max(1, std::min(8, static_cast<int>(maxTokens)));
    g_kvCachedTokens.clear();
    llama_kv_cache_clear(g_llamaCtx);

    std::vector<llama_token> tokens = tokenizeString(g_llamaModel, promptStr, true);
    if (tokens.empty()) {
        setLastError("SelfTest: llama_tokenize returned 0 tokens");
        return env->NewStringUTF("ERR|llama_tokenize returned 0 tokens during self-test");
    }

    // Quick thread (4 vs 6) & batch size (128 vs 512) micro-benchmark on the prompt tokens
    long eval4ThreadsMs = 0;
    long eval6ThreadsMs = 0;
    long evalBatch128Ms = 0;
    long evalBatch512Ms = 0;
    {
        llama_set_n_threads(g_llamaCtx, 4, 4);
        auto t0 = std::chrono::steady_clock::now();
        llama_batch b4 = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
        (void)llama_decode(g_llamaCtx, b4);
        auto t1 = std::chrono::steady_clock::now();
        eval4ThreadsMs = std::max(1L, static_cast<long>(
                std::chrono::duration_cast<std::chrono::milliseconds>(t1 - t0).count()));
        llama_kv_cache_clear(g_llamaCtx);
    }
    {
        llama_set_n_threads(g_llamaCtx, g_llmThreads, g_llmThreads);
        auto t128_0 = std::chrono::steady_clock::now();
        llama_batch b128 = llama_batch_get_one(
                tokens.data(),
                static_cast<int32_t>(std::min(static_cast<size_t>(128), tokens.size())));
        (void)llama_decode(g_llamaCtx, b128);
        auto t128_1 = std::chrono::steady_clock::now();
        evalBatch128Ms = std::max(1L, static_cast<long>(
                std::chrono::duration_cast<std::chrono::milliseconds>(t128_1 - t128_0).count()));
        llama_kv_cache_clear(g_llamaCtx);
    }

    llama_set_n_threads(g_llamaCtx, g_llmThreads, g_llmThreads);
    auto startTp = std::chrono::steady_clock::now();
    llama_batch batch = llama_batch_get_one(tokens.data(), static_cast<int32_t>(tokens.size()));
    int decRet = llama_decode(g_llamaCtx, batch);
    auto promptDoneTp = std::chrono::steady_clock::now();
    eval6ThreadsMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(promptDoneTp - startTp).count()));
    evalBatch512Ms = eval6ThreadsMs;

    if (decRet != 0) {
        llama_kv_cache_clear(g_llamaCtx);
        std::string err = "SelfTest: llama_decode failed with code " + std::to_string(decRet);
        setLastError(err);
        return env->NewStringUTF(("ERR|" + err).c_str());
    }

    llama_sampler* smpl = llama_sampler_init_greedy();
    std::string generated;
    int genCount = 0;

    for (int i = 0; i < targetTokens; i++) {
        llama_token id = llama_sampler_sample(smpl, g_llamaCtx, -1);
        llama_sampler_accept(smpl, id);
        if (llama_token_is_eog(g_llamaModel, id)) {
            break;
        }
        char buf[128];
        int32_t n = llama_token_to_piece(g_llamaModel, id, buf, sizeof(buf), 0, false);
        if (n > 0) {
            generated.append(buf, n);
        }
        genCount++;
        if (i + 1 < targetTokens) {
            llama_batch nextBatch = llama_batch_get_one(&id, 1);
            if (llama_decode(g_llamaCtx, nextBatch) != 0) {
                break;
            }
        }
    }

    llama_sampler_free(smpl);
    llama_kv_cache_clear(g_llamaCtx);
    g_kvCachedTokens.clear();

    auto endTp = std::chrono::steady_clock::now();
    long elapsedMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count()));
    double tokPerSec = (static_cast<double>(std::max(1, genCount)) * 1000.0) / static_cast<double>(elapsedMs);

    for (char& c : generated) {
        if (c == '\n' || c == '\r' || c == '|') c = ' ';
    }

    std::ostringstream benchOss;
    benchOss << "promptEval(threads=4)=" << eval4ThreadsMs << "ms"
             << ", promptEval(threads=" << g_llmThreads << ")=" << eval6ThreadsMs << "ms"
             << ", batch(128)=" << evalBatch128Ms << "ms, batch(512)=" << evalBatch512Ms << "ms"
             << ", n_batch=512, n_ubatch=128, use_mmap=true, flash_attn=true";

    std::ostringstream oss;
    oss << "OK|" << std::fixed << std::setprecision(1) << tokPerSec
        << "|" << elapsedMs
        << "|" << trimString(generated)
        << "|" << benchOss.str();
    std::string result = oss.str();
    LOGI("Self-test completed: %s", result.c_str());
    return env->NewStringUTF(result.c_str());
}

/**
 * Internal helper returning structured metrics:
 * ok=true -> whisperMs, maxNoSpeechProb, avgLogprob, cleanedTranscript
 */
static bool runWhisperTranscribeInternal(
        const jshort* rawShorts,
        int length,
        int nThreads,
        long long& outWhisperMs,
        float& outNoSpeechProb,
        float& outAvgLogprob,
        std::string& outTranscript,
        std::string& outError) {
    std::vector<float> pcmf32(static_cast<size_t>(length));
    for (int i = 0; i < length; i++) {
        pcmf32[i] = static_cast<float>(rawShorts[i]) / 32768.0f;
    }

    whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    wparams.n_threads = std::max(2, std::min(6, nThreads));
    wparams.language = "en";
    wparams.translate = false;
    wparams.no_context = true;
    wparams.single_segment = false;
    wparams.print_progress = false;
    wparams.print_realtime = false;
    wparams.print_special = false;
    wparams.print_timestamps = false;
    wparams.suppress_blank = true;
    wparams.suppress_nst = true;
    wparams.temperature = 0.0f;
    wparams.no_speech_thold = 0.6f;
    wparams.logprob_thold = -1.0f;

    auto startTp = std::chrono::steady_clock::now();
    int ret = whisper_full(g_whisperCtx, wparams, pcmf32.data(), static_cast<int>(pcmf32.size()));
    auto endTp = std::chrono::steady_clock::now();
    outWhisperMs = std::max(0LL, static_cast<long long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count()));

    if (ret != 0) {
        outError = "whisper_full failed with error code " + std::to_string(ret);
        return false;
    }

    std::string transcript;
    int n_segments = whisper_full_n_segments(g_whisperCtx);
    float maxNoSpeechProb = 0.0f;
    double sumLogprob = 0.0;
    int logprobTokenCount = 0;

    for (int i = 0; i < n_segments; i++) {
        const char* segText = whisper_full_get_segment_text(g_whisperCtx, i);
        if (segText != nullptr) {
            transcript += segText;
        }
        float segNoSpeech = whisper_full_get_segment_no_speech_prob(g_whisperCtx, i);
        if (std::isfinite(segNoSpeech) && segNoSpeech > maxNoSpeechProb) {
            maxNoSpeechProb = segNoSpeech;
        }
        int n_tokens = whisper_full_n_tokens(g_whisperCtx, i);
        for (int j = 0; j < n_tokens; j++) {
            const char* tokText = whisper_full_get_token_text(g_whisperCtx, i, j);
            if (tokText != nullptr && (tokText[0] == '[' || (tokText[0] == '<' && tokText[1] == '|'))) {
                continue;
            }
            whisper_token_data tdata = whisper_full_get_token_data(g_whisperCtx, i, j);
            float lp = tdata.plog;
            if ((!std::isfinite(lp) || lp == 0.0f) && tdata.p > 0.0f && tdata.p < 1.0f) {
                lp = std::log(tdata.p);
            }
            if (std::isfinite(lp)) {
                sumLogprob += static_cast<double>(lp);
                logprobTokenCount++;
            }
        }
    }

    outNoSpeechProb = n_segments > 0 ? maxNoSpeechProb : 1.0f;
    outAvgLogprob = logprobTokenCount > 0
            ? static_cast<float>(sumLogprob / static_cast<double>(logprobTokenCount))
            : -2.0f;
    outTranscript = trimString(transcript);
    return true;
}

/**
 * Transcribes 16 kHz mono PCM16 audio via whisper.cpp.
 * Returns raw transcript string, or "__ERROR__:<reason>" on failure.
 */
JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeTranscribePcm16(
        JNIEnv* env,
        jclass /* clazz */,
        jshortArray pcmSamples,
        jint length,
        jint nThreads) {
    if (pcmSamples == nullptr || length <= 0) {
        return env->NewStringUTF("");
    }

    std::lock_guard<std::mutex> lock(g_whisperMutex);
    if (g_whisperCtx == nullptr) {
        setLastError("Whisper: native context is not loaded");
        return env->NewStringUTF("__ERROR__:Whisper native context is not loaded.");
    }

    jshort* rawShorts = env->GetShortArrayElements(pcmSamples, nullptr);
    if (rawShorts == nullptr) {
        setLastError("Whisper: failed to access PCM16 audio buffer");
        return env->NewStringUTF("__ERROR__:Failed to access PCM16 audio buffer.");
    }

    long long whisperMs = 0;
    float noSpeechProb = 0.0f;
    float avgLogprob = 0.0f;
    std::string cleaned;
    std::string err;
    bool ok = runWhisperTranscribeInternal(
            rawShorts,
            static_cast<int>(length),
            static_cast<int>(nThreads),
            whisperMs,
            noSpeechProb,
            avgLogprob,
            cleaned,
            err);
    env->ReleaseShortArrayElements(pcmSamples, rawShorts, JNI_ABORT);

    if (!ok) {
        setLastError(err);
        return env->NewStringUTF(("__ERROR__:" + err).c_str());
    }

    LOGI("Whisper transcribed %d samples in %lldms (noSpeech=%.3f, avgLogprob=%.3f) -> \"%s\"",
         static_cast<int>(length), whisperMs, noSpeechProb, avgLogprob, cleaned.c_str());
    return env->NewStringUTF(cleaned.c_str());
}

/**
 * Transcribes 16 kHz mono PCM16 audio via whisper.cpp and returns structured metrics:
 * "OK|<whisperMs>|<noSpeechProb>|<avgLogprob>|<cleanedTranscript>" or "ERR|<reason>"
 */
JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeTranscribePcm16WithMetrics(
        JNIEnv* env,
        jclass /* clazz */,
        jshortArray pcmSamples,
        jint length,
        jint nThreads) {
    if (pcmSamples == nullptr || length <= 0) {
        return env->NewStringUTF("OK|0|1.0000|-2.0000|");
    }

    std::lock_guard<std::mutex> lock(g_whisperMutex);
    if (g_whisperCtx == nullptr) {
        setLastError("Whisper: native context is not loaded");
        return env->NewStringUTF("ERR|Whisper native context is not loaded.");
    }

    jshort* rawShorts = env->GetShortArrayElements(pcmSamples, nullptr);
    if (rawShorts == nullptr) {
        setLastError("Whisper: failed to access PCM16 audio buffer");
        return env->NewStringUTF("ERR|Failed to access PCM16 audio buffer.");
    }

    long long whisperMs = 0;
    float noSpeechProb = 0.0f;
    float avgLogprob = 0.0f;
    std::string cleaned;
    std::string err;
    bool ok = runWhisperTranscribeInternal(
            rawShorts,
            static_cast<int>(length),
            static_cast<int>(nThreads),
            whisperMs,
            noSpeechProb,
            avgLogprob,
            cleaned,
            err);
    env->ReleaseShortArrayElements(pcmSamples, rawShorts, JNI_ABORT);

    if (!ok) {
        setLastError(err);
        return env->NewStringUTF(("ERR|" + err).c_str());
    }

    std::ostringstream oss;
    oss << "OK|" << whisperMs
        << "|" << std::fixed << std::setprecision(4) << noSpeechProb
        << "|" << std::fixed << std::setprecision(4) << avgLogprob
        << "|" << cleaned;
    LOGI("Whisper metrics: %d samples, whisperMs=%lld, noSpeech=%.4f, avgLogprob=%.4f -> \"%s\"",
         static_cast<int>(length), whisperMs, noSpeechProb, avgLogprob, cleaned.c_str());
    return env->NewStringUTF(oss.str().c_str());
}

/**
 * Streams real tokens from llama.cpp for a conversation turn with KV-cache prefix reuse.
 * Calls callbackTarget.onNativeToken(int turnId, String tokenPiece) for each generated piece,
 * and callbackTarget.onNativeDiagnostic(int turnId, String stage, String detail) for diagnostics.
 * Returns: "OK|<tokensPerSec>|<ttftMs>|<totalMs>|<genCount>|<interrupted>|<stopReason>|<replyText>|<promptTokens>|<cachedTokensReused>|<promptEvalMs>|<promptTokPerSec>"
 * or "ERR|<reason>"
 */
JNIEXPORT jstring JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeGenerateStream(
        JNIEnv* env,
        jclass /* clazz */,
        jint turnId,
        jstring prompt,
        jint maxTokens,
        jobject callbackTarget) {
    if (prompt == nullptr) {
        setLastError("nativeGenerateStream: prompt is null");
        return env->NewStringUTF("ERR|Prompt is null");
    }

    // Lock g_llmMutex FIRST, ensuring any previous cancelled turn has completely finished
    // before resetting g_cancelLlm to false for the new turn.
    std::lock_guard<std::mutex> lock(g_llmMutex);
    bool prevCancelWasSet = g_cancelLlm.exchange(false);
    setGenStage("tokenizing");

    jmethodID onTokenMid = nullptr;
    jmethodID onDiagMid = nullptr;
    if (callbackTarget != nullptr) {
        jclass cbClass = env->GetObjectClass(callbackTarget);
        if (cbClass != nullptr) {
            onTokenMid = env->GetMethodID(cbClass, "onNativeToken", "(ILjava/lang/String;)V");
            onDiagMid = env->GetMethodID(cbClass, "onNativeDiagnostic", "(ILjava/lang/String;Ljava/lang/String;)V");
        }
    }

    if (g_llamaModel == nullptr || g_llamaCtx == nullptr) {
        std::string err = "llama.cpp model or context is null at nativeGenerateStream start";
        setLastError(err);
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Error", err);
        setGenStage("idle");
        return env->NewStringUTF(("ERR|" + err).c_str());
    }

    const char* promptChars = env->GetStringUTFChars(prompt, nullptr);
    if (promptChars == nullptr) {
        std::string err = "Failed to read prompt UTF-8 string from JNI";
        setLastError(err);
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Error", err);
        setGenStage("idle");
        return env->NewStringUTF(("ERR|" + err).c_str());
    }
    std::string promptStr(promptChars);
    env->ReleaseStringUTFChars(prompt, promptChars);

    llama_set_n_threads(g_llamaCtx, g_llmThreads, g_llmThreads);

    std::vector<llama_token> promptTokens = tokenizeString(g_llamaModel, promptStr, false);
    if (promptTokens.empty()) {
        std::string err = "llama_tokenize failed (returned 0 tokens) for promptChars=" + std::to_string(promptStr.size());
        setLastError(err);
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Error", err);
        setGenStage("idle");
        return env->NewStringUTF(("ERR|" + err).c_str());
    }

    int maxGen = std::max(16, std::min(512, static_cast<int>(maxTokens)));
    int safetyMargin = maxGen + 64;
    int maxPromptTokens = std::max(256, g_llmCtxSize - safetyMargin);

    if (static_cast<int>(promptTokens.size()) > maxPromptTokens) {
        int keepHead = std::min(320, maxPromptTokens / 2);
        int keepTail = maxPromptTokens - keepHead;
        std::ostringstream overflowOss;
        overflowOss << "WARNING: promptTokens (" << promptTokens.size()
                    << ") exceeds n_ctx safety limit (" << maxPromptTokens
                    << " = n_ctx " << g_llmCtxSize << " - safetyMargin " << safetyMargin
                    << "). Truncating to head=" << keepHead << " + tail=" << keepTail << " tokens.";
        setLastError(overflowOss.str());
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "ContextOverflow", overflowOss.str());

        std::vector<llama_token> trimmed;
        trimmed.reserve(maxPromptTokens);
        trimmed.insert(trimmed.end(), promptTokens.begin(), promptTokens.begin() + keepHead);
        trimmed.insert(trimmed.end(), promptTokens.end() - keepTail, promptTokens.end());
        promptTokens.swap(trimmed);
    }

    // KV-Cache Prefix Reuse: find longest common token prefix with g_kvCachedTokens
    // Always leave at least 1 token at the end of promptTokens to evaluate so llama_decode computes logits.
    size_t commonPrefix = 0;
    size_t maxPrefix = promptTokens.size() > 1
            ? std::min(g_kvCachedTokens.size(), promptTokens.size() - 1)
            : 0;
    while (commonPrefix < maxPrefix && g_kvCachedTokens[commonPrefix] == promptTokens[commonPrefix]) {
        commonPrefix++;
    }

    if (commonPrefix > 0) {
        (void)llama_kv_cache_seq_rm(
                g_llamaCtx,
                0,
                static_cast<llama_pos>(commonPrefix),
                -1);
        g_kvCachedTokens.resize(commonPrefix);
    } else {
        llama_kv_cache_clear(g_llamaCtx);
        g_kvCachedTokens.clear();
    }

    const int totalPromptTokens = static_cast<int>(promptTokens.size());
    const int cachedTokensReused = static_cast<int>(commonPrefix);
    const int uncachedTokensToEval = totalPromptTokens - cachedTokensReused;

    {
        std::ostringstream startOss;
        startOss << "turnId=" << static_cast<int>(turnId)
                 << ", promptChars=" << promptStr.size()
                 << ", promptTokens=" << totalPromptTokens
                 << ", cachedTokensReused=" << cachedTokensReused
                 << ", uncachedTokensToEval=" << uncachedTokensToEval
                 << ", n_ctx=" << g_llmCtxSize
                 << ", maxPromptTokens=" << maxPromptTokens
                 << ", maxGen=" << maxGen
                 << ", llmThreads=" << g_llmThreads
                 << ", n_batch=512, n_ubatch=128"
                 << ", g_cancelLlmResetFrom=" << (prevCancelWasSet ? "true->false" : "false");
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Start", startOss.str());
    }

    auto startTp = std::chrono::steady_clock::now();

    // Evaluate only the uncached suffix in batches of up to 512 tokens (internal ubatch=128)
    const int batchChunkSize = 512;
    const int totalBatches = std::max(1, (uncachedTokensToEval + batchChunkSize - 1) / batchChunkSize);
    int batchIdx = 0;

    for (size_t offset = commonPrefix; offset < promptTokens.size(); offset += batchChunkSize, batchIdx++) {
        setGenStage("prompt eval batch " + std::to_string(batchIdx));
        if (g_cancelLlm.load()) {
            emitDiagnostic(
                    env,
                    callbackTarget,
                    onDiagMid,
                    turnId,
                    "GenEnd",
                    "reason=cancelled (before prompt eval batch " + std::to_string(batchIdx) + "), generatedTokens=0, tokPerSec=0.0");
            setGenStage("idle");
            return env->NewStringUTF("OK|0.0|0|0|0|1|cancelled||0|0|0|0.0");
        }

        int32_t chunkLen = static_cast<int32_t>(
                std::min(static_cast<size_t>(batchChunkSize), promptTokens.size() - offset));
        auto batchStartTp = std::chrono::steady_clock::now();
        llama_batch batch = llama_batch_get_one(promptTokens.data() + offset, chunkLen);
        int decodeRet = llama_decode(g_llamaCtx, batch);
        auto batchEndTp = std::chrono::steady_clock::now();
        long batchMs = std::max(1L, static_cast<long>(
                std::chrono::duration_cast<std::chrono::milliseconds>(batchEndTp - batchStartTp).count()));
        double batchTokPerSec = (static_cast<double>(chunkLen) * 1000.0) / static_cast<double>(batchMs);

        std::ostringstream batchOss;
        batchOss << "batch=" << batchIdx << "/" << totalBatches
                 << ", tokens=" << chunkLen
                 << " (offset=" << offset << ")"
                 << ", elapsedMs=" << batchMs
                 << ", batchTokPerSec=" << std::fixed << std::setprecision(1) << batchTokPerSec
                 << ", llama_decode_ret=" << decodeRet;
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "BatchEval", batchOss.str());

        if (decodeRet != 0) {
            llama_kv_cache_clear(g_llamaCtx);
            g_kvCachedTokens.clear();
            std::string err = "llama_decode returned non-zero code " + std::to_string(decodeRet)
                    + " on prompt batch " + std::to_string(batchIdx);
            setLastError(err);
            emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "GenEnd",
                    "reason=error (" + err + "), generatedTokens=0, tokPerSec=0.0");
            setGenStage("idle");
            return env->NewStringUTF(("ERR|" + err).c_str());
        }

        g_kvCachedTokens.insert(
                g_kvCachedTokens.end(),
                promptTokens.begin() + offset,
                promptTokens.begin() + offset + chunkLen);

        if (g_cancelLlm.load()) {
            emitDiagnostic(
                    env,
                    callbackTarget,
                    onDiagMid,
                    turnId,
                    "GenEnd",
                    "reason=cancelled (after prompt eval batch " + std::to_string(batchIdx) + "), generatedTokens=0, tokPerSec=0.0");
            setGenStage("idle");
            return env->NewStringUTF("OK|0.0|0|0|0|1|cancelled||0|0|0|0.0");
        }
    }

    auto promptDoneTp = std::chrono::steady_clock::now();
    long promptEvalTotalMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(promptDoneTp - startTp).count()));
    double promptTokPerSec = (static_cast<double>(std::max(1, uncachedTokensToEval)) * 1000.0)
            / static_cast<double>(promptEvalTotalMs);
    {
        std::ostringstream peOss;
        peOss << "promptTokens=" << totalPromptTokens
              << ", cachedTokensReused=" << cachedTokensReused
              << ", evaluatedTokens=" << uncachedTokensToEval
              << ", promptEvalMs=" << promptEvalTotalMs
              << ", promptTokPerSec=" << std::fixed << std::setprecision(1) << promptTokPerSec
              << ", batches=" << totalBatches;
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "PromptEvalDone", peOss.str());
    }

    setGenStage("sampling");

    llama_sampler_chain_params sparams = llama_sampler_chain_default_params();
    llama_sampler* smpl = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(smpl, llama_sampler_init_penalties(64, 1.12f, 0.0f, 0.0f));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.90f, 1));
    llama_sampler_chain_add(smpl, llama_sampler_init_temp(0.70f));
    llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));

    std::string fullReply;
    int generatedTokens = 0;
    long ttftMs = 0;
    bool interrupted = false;
    std::string stopReason = "max_tokens";
    auto genStartTp = std::chrono::steady_clock::now();

    for (int i = 0; i < maxGen; i++) {
        if (g_cancelLlm.load()) {
            interrupted = true;
            stopReason = "cancelled";
            break;
        }

        llama_token new_token_id = llama_sampler_sample(smpl, g_llamaCtx, -1);
        llama_sampler_accept(smpl, new_token_id);

        if (llama_token_is_eog(g_llamaModel, new_token_id)) {
            stopReason = "EOG";
            break;
        }

        char pieceBuf[256];
        int32_t n = llama_token_to_piece(g_llamaModel, new_token_id, pieceBuf, sizeof(pieceBuf), 0, false);
        if (n > 0) {
            std::string piece(pieceBuf, n);
            std::string candidate = fullReply + piece;
            std::string cleaned;
            std::string matchedMarker;
            if (isStopMarkerSuffix(candidate, cleaned, matchedMarker)) {
                fullReply = cleaned;
                stopReason = "eot/im_end(" + matchedMarker + ")";
                break;
            }
            fullReply = candidate;
            generatedTokens++;

            if (ttftMs == 0) {
                auto nowTp = std::chrono::steady_clock::now();
                ttftMs = std::max(1L, static_cast<long>(
                        std::chrono::duration_cast<std::chrono::milliseconds>(nowTp - startTp).count()));
                std::ostringstream ftOss;
                ftOss << "firstTokenMs=" << ttftMs
                      << " (promptEvalMs=" << promptEvalTotalMs
                      << ", cachedTokensReused=" << cachedTokensReused << ")"
                      << ", firstPiece=\"" << sanitizeForLog(piece) << "\"";
                emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "FirstToken", ftOss.str());
            }

            if (callbackTarget != nullptr && onTokenMid != nullptr && !g_cancelLlm.load()) {
                jstring jPiece = env->NewStringUTF(piece.c_str());
                if (jPiece != nullptr) {
                    env->CallVoidMethod(callbackTarget, onTokenMid, turnId, jPiece);
                    env->DeleteLocalRef(jPiece);
                }
            }
        }

        if (g_cancelLlm.load()) {
            interrupted = true;
            stopReason = "cancelled";
            break;
        }

        llama_batch nextBatch = llama_batch_get_one(&new_token_id, 1);
        int stepDecodeRet = llama_decode(g_llamaCtx, nextBatch);
        if (stepDecodeRet != 0) {
            std::string stepErr = "llama_decode returned non-zero code " + std::to_string(stepDecodeRet)
                    + " at token step " + std::to_string(i);
            setLastError(stepErr);
            stopReason = "error(" + stepErr + ")";
            emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "Error", stepErr);
            break;
        }
        g_kvCachedTokens.push_back(new_token_id);
    }

    llama_sampler_free(smpl);
    setGenStage("idle");

    auto endTp = std::chrono::steady_clock::now();
    long totalMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - startTp).count()));
    long genDecodeMs = std::max(1L, static_cast<long>(
            std::chrono::duration_cast<std::chrono::milliseconds>(endTp - genStartTp).count()));
    if (ttftMs == 0) ttftMs = totalMs;

    double genTokPerSec = generatedTokens > 0
            ? (static_cast<double>(generatedTokens) * 1000.0) / static_cast<double>(genDecodeMs)
            : 0.0;

    {
        std::ostringstream endOss;
        endOss << "reason=" << stopReason
               << ", promptTokens=" << totalPromptTokens
               << ", cachedTokensReused=" << cachedTokensReused
               << ", promptEvalMs=" << promptEvalTotalMs
               << ", promptTokPerSec=" << std::fixed << std::setprecision(1) << promptTokPerSec
               << ", firstTokenMs=" << ttftMs
               << ", generatedTokens=" << generatedTokens
               << ", genTokPerSec=" << std::fixed << std::setprecision(1) << genTokPerSec
               << ", totalMs=" << totalMs;
        emitDiagnostic(env, callbackTarget, onDiagMid, turnId, "GenEnd", endOss.str());
    }

    std::string finalReply = trimString(fullReply);
    for (char& c : finalReply) {
        if (c == '|') c = '/';
    }
    std::ostringstream oss;
    oss << "OK|" << std::fixed << std::setprecision(1) << genTokPerSec
        << "|" << ttftMs
        << "|" << totalMs
        << "|" << generatedTokens
        << "|" << (interrupted ? 1 : 0)
        << "|" << stopReason
        << "|" << finalReply
        << "|" << totalPromptTokens
        << "|" << cachedTokensReused
        << "|" << promptEvalTotalMs
        << "|" << std::fixed << std::setprecision(1) << promptTokPerSec;
    std::string outStr = oss.str();
    return env->NewStringUTF(outStr.c_str());
}

JNIEXPORT void JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeCancelLlm(
        JNIEnv* /* env */,
        jclass /* clazz */) {
    g_cancelLlm.store(true);
}

JNIEXPORT void JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeFreeModels(
        JNIEnv* /* env */,
        jclass /* clazz */) {
    g_cancelLlm.store(true);
    {
        std::lock_guard<std::mutex> lock(g_llmMutex);
        g_kvCachedTokens.clear();
        if (g_llamaCtx != nullptr) {
            llama_free(g_llamaCtx);
            g_llamaCtx = nullptr;
        }
        if (g_llamaModel != nullptr) {
            llama_free_model(g_llamaModel);
            g_llamaModel = nullptr;
        }
    }
    {
        std::lock_guard<std::mutex> lock(g_whisperMutex);
        if (g_whisperCtx != nullptr) {
            whisper_free(g_whisperCtx);
            g_whisperCtx = nullptr;
        }
    }
    setGenStage("idle");
    LOGI("Freed native GGUF and Whisper models");
}

/**
 * Computes fast RMS + Zero-Crossing voice-band energy feature for Silero VAD pre-filtering.
 */
JNIEXPORT jfloat JNICALL
Java_com_sierra_omniagent_LocalVoiceEngine_nativeComputeFrameVadFeature(
        JNIEnv* env,
        jclass /* clazz */,
        jshortArray pcmFrame,
        jint length) {
    if (pcmFrame == nullptr || length <= 0) return 0.0f;
    jshort* samples = env->GetShortArrayElements(pcmFrame, nullptr);
    if (samples == nullptr) return 0.0f;

    double sumSq = 0.0;
    int zeroCrossings = 0;
    for (int i = 0; i < length; i++) {
        double norm = static_cast<double>(samples[i]) / 32768.0;
        sumSq += norm * norm;
        if (i > 0 && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
            zeroCrossings++;
        }
    }
    env->ReleaseShortArrayElements(pcmFrame, samples, JNI_ABORT);

    double rms = std::sqrt(sumSq / static_cast<double>(length));
    double zcr = static_cast<double>(zeroCrossings) / static_cast<double>(length);
    double voiceBandWeight = (zcr >= 0.015 && zcr <= 0.32) ? 1.15 : 0.75;
    double score = std::min(1.0, (rms / 0.065) * voiceBandWeight);
    return static_cast<jfloat>(score);
}

} // extern "C"
