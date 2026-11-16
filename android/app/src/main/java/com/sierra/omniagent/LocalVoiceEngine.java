package com.sierra.omniagent;

import android.app.ActivityManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.PowerManager;
import android.os.Process;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Base64;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;

/**
 * Native Android on-device voice engine (AudioRecord 16kHz + AEC/NS -> Silero VAD ONNX ->
 * Whisper GGML STT -> GGUF LLM -> Piper ONNX / Android TTS with gapless playback & barge-in).
 * Never blocks the main/UI thread.
 */
public class LocalVoiceEngine {
    private static final String TAG = "SierraLocalVoiceEngine";
    private static final int SAMPLE_RATE_HZ = 16000;
    private static final int FRAME_SAMPLES = 512; // 32ms @ 16kHz (standard Silero VAD window)
    private static final int FRAME_DURATION_MS = 32;
    private static final long PROMPT_EVAL_STALL_TIMEOUT_MS = 45000L; // 45s with no batch progress during prompt eval
    private static final long TOKEN_GEN_STALL_TIMEOUT_MS = 20000L; // 20s with no token progress during generation

    private static boolean sNativeJniLoaded = false;
    private static String sNativeLoadError = "";

    static {
        try {
            System.loadLibrary("sierra_local_voice_jni");
            sNativeJniLoaded = true;
            Log.i(TAG, "Loaded libsierra_local_voice_jni.so successfully");
        } catch (Throwable t) {
            sNativeJniLoaded = false;
            sNativeLoadError = t.getMessage() != null ? t.getMessage() : t.toString();
            Log.e(TAG, "Failed to load libsierra_local_voice_jni.so: " + sNativeLoadError);
        }
    }

    public static native boolean nativeLoadLlmModel(String modelPath, int nThreads, int nCtx);
    public static native boolean nativeLoadWhisperModel(String modelPath);
    public static native String nativeRunSelfTest(String prompt, int maxTokens);
    public static native String nativeTranscribePcm16(short[] pcmSamples, int length, int nThreads);
    public static native String nativeTranscribePcm16WithMetrics(short[] pcmSamples, int length, int nThreads);
    public static native String nativeGenerateStream(int turnId, String prompt, int maxTokens, Object callbackTarget);
    public static native void nativeCancelLlm();
    public static native void nativeFreeModels();
    public static native float nativeComputeFrameVadFeature(short[] pcmFrame, int length);
    public static native String nativeGetGenerationStage();
    public static native String nativeGetLastError();
    public static native String nativeGetCpuFeatures();
    public static native void nativeInvalidateKvCache();
    public static native String nativeWarmSystemPrefix(String systemPrefix);

    public static final double STT_MIN_RMS_ENERGY = 0.015;
    public static final double STT_PHANTOM_MAX_RMS = 0.03;
    public static final int STT_PHANTOM_MAX_DURATION_MS = 1200;
    public static final int STT_MIN_DURATION_MS = 400;
    public static final double WHISPER_MAX_NO_SPEECH_PROB = 0.6;
    public static final double WHISPER_MIN_AVG_LOGPROB = -1.0;
    public static final double AUTO_GAIN_TARGET_PEAK = 0.5;
    public static final double AUTO_GAIN_MAX_FACTOR = 12.0;
    public static final int VAD_MERGE_GAP_MS = 700;
    private static final int MAX_DEBUG_UTTERANCE_FILES = 10;
    private static final Set<String> STT_PHANTOM_BLOCKLIST = new HashSet<>(Arrays.asList(
            "thank you",
            "thanks for watching",
            "you",
            "bye",
            "okay",
            "here"
    ));

    public static class LlmGenerationResult {
        public final String replyText;
        public final double tokensPerSec;
        public final long timeToFirstAudioMs;
        public final long totalLatencyMs;
        public final int generatedTokens;
        public final boolean interrupted;
        public final String stopReason;
        public final int promptTokens;
        public final int cachedTokensReused;
        public final long promptEvalMs;
        public final double promptTokPerSec;

        public LlmGenerationResult(
                String replyText,
                double tokensPerSec,
                long timeToFirstAudioMs,
                long totalLatencyMs,
                int generatedTokens,
                boolean interrupted,
                String stopReason,
                int promptTokens,
                int cachedTokensReused,
                long promptEvalMs,
                double promptTokPerSec
        ) {
            this.replyText = replyText;
            this.tokensPerSec = tokensPerSec;
            this.timeToFirstAudioMs = timeToFirstAudioMs;
            this.totalLatencyMs = totalLatencyMs;
            this.generatedTokens = generatedTokens;
            this.interrupted = interrupted;
            this.stopReason = stopReason;
            this.promptTokens = promptTokens;
            this.cachedTokensReused = cachedTokensReused;
            this.promptEvalMs = promptEvalMs;
            this.promptTokPerSec = promptTokPerSec;
        }
    }

    public interface EngineEventListener {
        void onStatusChanged(String status, String detail);
        void onVadFrame(float probability, boolean isSpeech, String phase);
        void onTranscriptCommitted(String transcript, int utteranceDurationMs, boolean fromBargeIn);
        default void onTranscriptCommitted(
                String transcript,
                int utteranceDurationMs,
                boolean fromBargeIn,
                String rawTranscript,
                int audioMs,
                long whisperMs,
                double rms,
                double gainApplied,
                double noSpeechProb,
                double avgLogprob,
                String debugUtteranceId
        ) {
            onTranscriptCommitted(transcript, utteranceDurationMs, fromBargeIn);
        }
        void onTokenStream(int turnId, String token);
        void onDiagnosticLog(int turnId, String category, String detail);
        void onSentenceStarted(int turnId, int sentenceIndex, String sentence);
        void onSentenceCompleted(int turnId, int sentenceIndex, String sentence);
        void onBargeInTriggered(int interruptedTurnId, int sustainedMs, float threshold);
        void onTurnMetrics(int turnId, double tokensPerSec, long ttfaMs, long totalLatencyMs);
        void onThermalWarning(String thermalStatus, String message);
        void onError(String stage, String message, boolean isOom);
    }

    private final Context context;
    private final EngineEventListener listener;

    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "SierraLocalInferenceThread");
        t.setPriority(Thread.NORM_PRIORITY + 1);
        return t;
    });

    private final ScheduledExecutorService watchdogExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "SierraLocalWatchdogThread");
        t.setDaemon(true);
        return t;
    });

    private volatile Thread audioCaptureThread;
    private final AtomicBoolean sessionActive = new AtomicBoolean(false);
    private final AtomicBoolean llmCancelRequested = new AtomicBoolean(false);
    private final AtomicBoolean isSpeaking = new AtomicBoolean(false);
    private final AtomicBoolean isThinking = new AtomicBoolean(false);
    private final AtomicInteger activeTurnId = new AtomicInteger(0);
    private final AtomicBoolean firstTokenReceivedForTurn = new AtomicBoolean(false);
    private final AtomicBoolean inTokenGenPhaseForTurn = new AtomicBoolean(false);
    private final AtomicBoolean stallTriggeredForTurn = new AtomicBoolean(false);
    private final AtomicInteger currentTurnTokenCount = new AtomicInteger(0);
    private final java.util.concurrent.atomic.AtomicLong lastProgressTimestampMs = new java.util.concurrent.atomic.AtomicLong(0L);
    private final java.util.concurrent.locks.ReentrantLock activeTurnLock = new java.util.concurrent.locks.ReentrantLock();

    // Model state
    private volatile boolean modelsLoaded = false;
    private volatile boolean whisperLoaded = false;
    private volatile File loadedLlmFile;
    private volatile File loadedWhisperFile;
    private volatile File loadedVadFile;
    private volatile File loadedPiperFile;
    private volatile int inferenceThreads = 6;
    private volatile String lastNativeError = "";
    private volatile String lastSystemCacheKey = "";

    // Self-test telemetry
    private volatile String lastSelfTestText = "";
    private volatile double lastSelfTestTokensPerSec = 0.0;
    private volatile long lastSelfTestElapsedMs = 0L;

    // ONNX Runtime sessions (Silero VAD)
    private OrtEnvironment ortEnv;
    private OrtSession vadSession;
    private OrtSession piperSession;
    private float[][][] vadState = new float[2][1][128];

    // Audio hardware & TTS
    private final AudioManager audioManager;
    private AudioRecord audioRecord;
    private AcousticEchoCanceler echoCanceler;
    private NoiseSuppressor noiseSuppressor;
    private AudioTrack playbackTrack;
    private final Object playbackLock = new Object();
    private final AtomicBoolean playbackCancelled = new AtomicBoolean(false);
    private volatile int previousAudioMode = AudioManager.MODE_NORMAL;
    private volatile boolean audioModeModified = false;
    private AudioFocusRequest voiceFocusRequest = null;
    private TextToSpeech androidTts;
    private volatile boolean androidTtsReady = false;
    private final BlockingQueue<QueuedTtsSentence> ttsQueue = new LinkedBlockingQueue<>();

    // Configurable VAD & Barge-In parameters
    private volatile int silenceTimeoutMs = 600;
    private volatile int minUtteranceMs = 400;
    private volatile int preRollMs = 400;
    private volatile int bargeInSustainedMs = 800;
    private volatile float idleVadThreshold = 0.42f;
    private volatile float bargeInThreshold = 0.85f;
    private volatile float bargeInSpeakerBoost = 0.0f;
    private volatile String bargeInMode = "headphones_only";
    private volatile String micSourceMode = "auto";
    private volatile boolean saveLast10Utterances = false;
    private volatile double adaptivePlaybackRms = 0.0;
    private volatile long lastPlaybackAudioUpdateMs = 0L;
    private volatile long lastPlaybackEndTimestampMs = 0L;
    private volatile long lastBargeInIgnoredLogMs = 0L;
    private volatile String ttsEngineType = "android_tts";
    private volatile String activeTtsEngine = "android_tts";
    private volatile String chatTemplate = "llama3";
    private volatile boolean vadOnnxFallbackLogged = false;
    private volatile boolean vadSrIsScalar = false;
    private volatile CountDownLatch pendingAudioInitLatch;
    private volatile AtomicReference<String> pendingAudioInitError;

    // Live telemetry
    private volatile double lastTokensPerSec = 0.0;
    private volatile long lastTimeToFirstAudioMs = 0L;
    private volatile long lastTurnLatencyMs = 0L;
    private volatile long lastSpeechEndTimestampMs = 0L;

    private static class QueuedTtsSentence {
        final int turnId;
        final int sentenceIndex;
        final String sentence;

        QueuedTtsSentence(int turnId, int sentenceIndex, String sentence) {
            this.turnId = turnId;
            this.sentenceIndex = sentenceIndex;
            this.sentence = sentence;
        }
    }

    public LocalVoiceEngine(Context context, EngineEventListener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.audioManager = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
        if (!sNativeLoadError.isEmpty()) {
            this.lastNativeError = "JNI Load Error: " + sNativeLoadError;
        }
        initAndroidTtsFallback();
    }

    private void recordNativeError(String stage, String message, boolean isOom) {
        String cleanMsg = message != null ? message.trim() : "Unknown error";
        String prefix = "[" + stage + "]";
        if (cleanMsg.startsWith(prefix)) {
            cleanMsg = cleanMsg.substring(prefix.length()).trim();
        }
        this.lastNativeError = cleanMsg;
        Log.e(TAG, prefix + " " + cleanMsg);
        listener.onError(stage, cleanMsg, isOom);
    }

    private void initAndroidTtsFallback() {
        try {
            androidTts = new TextToSpeech(context, status -> {
                if (status == TextToSpeech.SUCCESS && androidTts != null) {
                    androidTts.setLanguage(Locale.US);
                    try {
                        androidTts.setAudioAttributes(
                                new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                        .build()
                        );
                    } catch (Throwable ignored) {}
                    try {
                        androidTts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                            @Override
                            public void onStart(String utteranceId) {
                                lastPlaybackAudioUpdateMs = System.currentTimeMillis();
                                if (adaptivePlaybackRms < 0.05) {
                                    adaptivePlaybackRms = 0.05;
                                }
                            }

                            @Override
                            public void onDone(String utteranceId) {
                                lastPlaybackEndTimestampMs = System.currentTimeMillis();
                            }

                            @Override
                            public void onError(String utteranceId) {
                                lastPlaybackEndTimestampMs = System.currentTimeMillis();
                            }
                        });
                    } catch (Throwable ignored) {}
                    androidTtsReady = true;
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "Android TextToSpeech init warning: " + t.getMessage());
        }
    }

    public synchronized boolean loadModels(
            File llmFile,
            File whisperFile,
            File vadFile,
            File piperFile,
            String ttsEngine,
            String template
    ) throws OutOfMemoryError, Exception {
        return loadModels(llmFile, whisperFile, vadFile, piperFile, ttsEngine, template, false);
    }

    public synchronized boolean loadModels(
            File llmFile,
            File whisperFile,
            File vadFile,
            File piperFile,
            String ttsEngine,
            String template,
            boolean sttOnly
    ) throws OutOfMemoryError, Exception {
        this.ttsEngineType = ttsEngine != null ? ttsEngine : "android_tts";
        this.activeTtsEngine = "android_tts";
        this.chatTemplate = template != null ? template : "llama3";

        if (!sNativeJniLoaded) {
            String msg = "Native JNI library libsierra_local_voice_jni.so failed to load (" + sNativeLoadError + "). Cannot run on-device inference.";
            recordNativeError("JNI", msg, false);
            throw new IllegalStateException(msg);
        }

        try {
            String cpuFeatures = nativeGetCpuFeatures();
            listener.onDiagnosticLog(0, "LocalVoice:CpuFeatures", cpuFeatures);
        } catch (Throwable ignored) {}

        if (!sttOnly && (llmFile == null || !llmFile.exists() || llmFile.length() < 24 || llmFile.getName().endsWith(".bad") || llmFile.getName().endsWith(".part"))) {
            String msg = "LLM GGUF file is missing, incomplete, or quarantined (.bad): " + (llmFile != null ? llmFile.getName() : "null");
            recordNativeError("LLM", msg, false);
            throw new IllegalArgumentException(msg);
        }
        if (whisperFile == null || !whisperFile.exists() || whisperFile.length() < 32 || whisperFile.getName().endsWith(".bad") || whisperFile.getName().endsWith(".part")) {
            String msg = "Whisper GGML file is missing, incomplete, or quarantined (.bad): " + (whisperFile != null ? whisperFile.getName() : "null");
            recordNativeError("Whisper", msg, false);
            throw new IllegalArgumentException(msg);
        }
        if (vadFile == null || !vadFile.exists() || vadFile.length() < 128 || vadFile.getName().endsWith(".bad") || vadFile.getName().endsWith(".part")) {
            String msg = "Silero VAD ONNX file is missing, incomplete, or quarantined (.bad): " + (vadFile != null ? vadFile.getName() : "null");
            recordNativeError("VAD", msg, false);
            throw new IllegalArgumentException(msg);
        }
        if (piperFile != null && (piperFile.getName().endsWith(".bad") || piperFile.getName().endsWith(".part"))) {
            String msg = "Piper TTS ONNX file is quarantined (.bad): " + piperFile.getName();
            recordNativeError("TTS", msg, false);
            throw new IllegalArgumentException(msg);
        }

        // Check available device memory before mapping multi-GB GGUF weights
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (am != null) {
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            long llmBytes = (!sttOnly && llmFile != null) ? (long) (llmFile.length() * 1.15) : 0L;
            long neededBytes = llmBytes + whisperFile.length();
            if (mi.lowMemory || (mi.availMem > 0 && mi.availMem < neededBytes)) {
                String oomMsg = "Insufficient free RAM (" + (mi.availMem / (1024 * 1024)) + " MB available) to load "
                        + (llmFile != null ? llmFile.getName() : whisperFile.getName())
                        + ". Please switch to the Small (1.5B Q4) model in Settings.";
                recordNativeError("LLM", oomMsg, true);
                throw new OutOfMemoryError(oomMsg);
            }
        }

        int cpuCores = Runtime.getRuntime().availableProcessors();
        // Default to 6 threads on 8-core devices (Snapdragon 8 Elite has 2 prime + 6 perf cores)
        this.inferenceThreads = cpuCores >= 8 ? 6 : 4;
        listener.onDiagnosticLog(
                0,
                "LocalVoice:Threads",
                "Configured native threads: LLM=" + this.inferenceThreads
                        + ", Whisper=" + Math.min(4, this.inferenceThreads)
                        + ", SileroVAD=2 (deviceCpuCores=" + cpuCores + ", n_batch=512, n_ubatch=128)"
        );

        // Reuse already-loaded models if identical
        if (sttOnly && whisperLoaded && loadedWhisperFile != null
                && loadedWhisperFile.getAbsolutePath().equals(whisperFile.getAbsolutePath())) {
            if (vadSession == null && vadFile != null && vadFile.exists()) {
                initSileroVadSession(vadFile);
            }
            Log.i(TAG, "Reusing already-loaded Whisper & VAD models for STT-only session");
            listener.onDiagnosticLog(
                    0,
                    "STT:Model",
                    "name=" + whisperFile.getName() + ", loadMs=0ms (reused)"
            );
            listener.onDiagnosticLog(
                    0,
                    "LocalVoice:ModelsReady",
                    "Reused Whisper=" + whisperFile.getName() + ", vadOnnxReady=" + (vadSession != null)
            );
            return true;
        }
        if (!sttOnly && modelsLoaded
                && loadedLlmFile != null
                && llmFile != null
                && loadedLlmFile.getAbsolutePath().equals(llmFile.getAbsolutePath())
                && loadedWhisperFile != null
                && loadedWhisperFile.getAbsolutePath().equals(whisperFile.getAbsolutePath())) {
            Log.i(TAG, "Reusing already-loaded GGUF & Whisper models in memory");
            listener.onDiagnosticLog(
                    0,
                    "STT:Model",
                    "name=" + whisperFile.getName() + ", loadMs=0ms (reused)"
            );
            return true;
        }

        unloadModels();

        if (!sttOnly && llmFile != null) {
            boolean llmOk = nativeLoadLlmModel(llmFile.getAbsolutePath(), this.inferenceThreads, 4096);
            if (!llmOk) {
                String jniErr = nativeGetLastError();
                String msg = "Failed to initialize GGUF model in llama.cpp: " + llmFile.getName()
                        + (jniErr != null && !jniErr.isEmpty() ? " (" + jniErr + ")" : "");
                recordNativeError("LLM", msg, false);
                throw new IllegalStateException(msg);
            }
        }

        long whisperLoadStartMs = System.currentTimeMillis();
        boolean whisperOk = nativeLoadWhisperModel(whisperFile.getAbsolutePath());
        long whisperLoadMs = Math.max(0L, System.currentTimeMillis() - whisperLoadStartMs);
        if (!whisperOk) {
            String jniErr = nativeGetLastError();
            nativeFreeModels();
            String msg = "Failed to initialize Whisper model in whisper.cpp: " + whisperFile.getName()
                    + (jniErr != null && !jniErr.isEmpty() ? " (" + jniErr + ")" : "");
            recordNativeError("Whisper", msg, false);
            throw new IllegalStateException(msg);
        }
        whisperLoaded = true;
        listener.onDiagnosticLog(
                0,
                "STT:Model",
                "name=" + whisperFile.getName() + ", loadMs=" + whisperLoadMs + "ms"
        );

        if (!sttOnly && llmFile != null) {
            // Run a real 3-token startup self-test in llama.cpp to verify inference & benchmark threads/batch
            String selfTestPrompt = "chatml".equalsIgnoreCase(this.chatTemplate)
                    ? "<|im_start|>user\nSay hi.<|im_end|>\n<|im_start|>assistant\n"
                    : "<|begin_of_text|><|start_header_id|>user<|end_header_id|>\n\nSay hi.<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n";
            String selfTestRaw = nativeRunSelfTest(selfTestPrompt, 3);
            if (selfTestRaw == null || !selfTestRaw.startsWith("OK|")) {
                nativeFreeModels();
                String reason = (selfTestRaw != null && selfTestRaw.startsWith("ERR|"))
                        ? selfTestRaw.substring(4)
                        : "llama.cpp 3-token startup self-test failed.";
                recordNativeError("SelfTest", reason, false);
                throw new IllegalStateException(reason);
            }
            String[] stParts = selfTestRaw.split("\\|", 5);
            if (stParts.length >= 4) {
                try {
                    this.lastSelfTestTokensPerSec = Double.parseDouble(stParts[1]);
                } catch (NumberFormatException ignored) {
                    this.lastSelfTestTokensPerSec = 0.0;
                }
                try {
                    this.lastSelfTestElapsedMs = Long.parseLong(stParts[2]);
                } catch (NumberFormatException ignored) {
                    this.lastSelfTestElapsedMs = 0L;
                }
                this.lastSelfTestText = stParts[3];
            }
            if (stParts.length >= 5 && !stParts[4].isEmpty()) {
                listener.onDiagnosticLog(0, "LocalVoice:Benchmark", stParts[4]);
            }
        }

        // Initialize ONNX Runtime session for Silero VAD
        initSileroVadSession(vadFile);

        loadedLlmFile = sttOnly ? null : llmFile;
        loadedWhisperFile = whisperFile;
        loadedVadFile = vadFile;
        loadedPiperFile = piperFile;
        modelsLoaded = !sttOnly;
        listener.onDiagnosticLog(
                0,
                "LocalVoice:ModelsReady",
                "Loaded sttOnly=" + sttOnly
                        + ", whisper=" + whisperFile.getName()
                        + ", vadOnnxReady=" + (vadSession != null)
                        + ", vadSrIsScalar=" + vadSrIsScalar
        );
        return true;
    }

    private void initSileroVadSession(File vadFile) {
        vadOnnxFallbackLogged = false;
        vadSrIsScalar = false;
        try {
            if (ortEnv == null) {
                ortEnv = OrtEnvironment.getEnvironment();
            }
            if (vadSession != null) {
                try {
                    vadSession.close();
                } catch (Throwable ignored) {}
                vadSession = null;
            }
            OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
            opts.setIntraOpNumThreads(2);
            vadSession = ortEnv.createSession(vadFile.getAbsolutePath(), opts);
            vadState = new float[2][1][128];
            try {
                Map<String, NodeInfo> inputInfo = vadSession.getInputInfo();
                NodeInfo srNode = inputInfo.get("sr");
                if (srNode != null && srNode.getInfo() instanceof TensorInfo) {
                    long[] srShape = ((TensorInfo) srNode.getInfo()).getShape();
                    if (srShape != null && srShape.length == 0) {
                        vadSrIsScalar = true;
                    }
                }
                listener.onDiagnosticLog(
                        0,
                        "LocalVAD:Init",
                        "Silero VAD ONNX ready (inputs=" + inputInfo.keySet() + ", srScalar=" + vadSrIsScalar + ")"
                );
            } catch (Throwable infoErr) {
                listener.onDiagnosticLog(0, "LocalVAD:Init", "Silero VAD ONNX ready");
            }
        } catch (Throwable ortErr) {
            vadSession = null;
            String errMsg = ortErr.getMessage() != null ? ortErr.getMessage() : ortErr.toString();
            Log.w(TAG, "Silero VAD ONNX session notice: " + errMsg);
            listener.onDiagnosticLog(
                    0,
                    "LocalVAD:InitError",
                    "Silero VAD ONNX init failed (" + errMsg + "); using DSP VAD fallback"
            );
        }
    }

    public synchronized void unloadModels() {
        llmCancelRequested.set(true);
        ttsQueue.clear();
        lastSystemCacheKey = "";
        if (sNativeJniLoaded) {
            try {
                nativeFreeModels();
            } catch (Throwable ignored) {}
        }
        if (vadSession != null) {
            try {
                vadSession.close();
            } catch (Throwable ignored) {}
            vadSession = null;
        }
        if (piperSession != null) {
            try {
                piperSession.close();
            } catch (Throwable ignored) {}
            piperSession = null;
        }
        loadedLlmFile = null;
        loadedWhisperFile = null;
        loadedVadFile = null;
        loadedPiperFile = null;
        modelsLoaded = false;
        whisperLoaded = false;
    }

    public void invalidateKvCache(String reason) {
        lastSystemCacheKey = "";
        if (sNativeJniLoaded) {
            try {
                nativeInvalidateKvCache();
                listener.onDiagnosticLog(
                        0,
                        "LocalLLM:KvCacheInvalidate",
                        "Invalidated llama.cpp KV cache (" + (reason != null ? reason : "manual") + ")"
                );
            } catch (Throwable ignored) {}
        }
    }

    public void warmSystemPrefixIfNeeded(String systemPrefix, String cacheKey) {
        if (!sNativeJniLoaded || !modelsLoaded || systemPrefix == null || systemPrefix.isEmpty()) {
            return;
        }
        String cleanKey = cacheKey != null ? cacheKey : "";
        if (!cleanKey.isEmpty() && !this.lastSystemCacheKey.isEmpty() && !cleanKey.equals(this.lastSystemCacheKey)) {
            invalidateKvCache("persona_or_memory_changed");
        }
        this.lastSystemCacheKey = cleanKey;
        inferenceExecutor.submit(() -> {
            try {
                String res = nativeWarmSystemPrefix(systemPrefix);
                if (res != null && res.startsWith("OK|")) {
                    String[] parts = res.split("\\|", 3);
                    String cachedCount = parts.length > 1 ? parts[1] : "?";
                    String evalMs = parts.length > 2 ? parts[2] : "0";
                    listener.onDiagnosticLog(
                            0,
                            "LocalLLM:KvCacheWarm",
                            "System prefix KV cache ready: cachedTokens=" + cachedCount + ", evalMs=" + evalMs + "ms"
                    );
                }
            } catch (Throwable t) {
                Log.w(TAG, "KV cache warm warning: " + t.getMessage());
            }
        });
    }

    public void updateRuntimeConfig(
            int silenceTimeoutMs,
            int minUtteranceMs,
            int preRollMs,
            int bargeInSustainedMs,
            float bargeInThreshold,
            float bargeInSpeakerBoost,
            String ttsEngine,
            String chatTemplate
    ) {
        updateRuntimeConfig(
                silenceTimeoutMs,
                minUtteranceMs,
                preRollMs,
                bargeInSustainedMs,
                bargeInThreshold,
                bargeInSpeakerBoost,
                ttsEngine,
                chatTemplate,
                this.bargeInMode
        );
    }

    public void updateRuntimeConfig(
            int silenceTimeoutMs,
            int minUtteranceMs,
            int preRollMs,
            int bargeInSustainedMs,
            float bargeInThreshold,
            float bargeInSpeakerBoost,
            String ttsEngine,
            String chatTemplate,
            String bargeInMode
    ) {
        updateRuntimeConfig(
                silenceTimeoutMs,
                minUtteranceMs,
                preRollMs,
                bargeInSustainedMs,
                bargeInThreshold,
                bargeInSpeakerBoost,
                ttsEngine,
                chatTemplate,
                bargeInMode,
                this.micSourceMode,
                this.saveLast10Utterances
        );
    }

    public void updateRuntimeConfig(
            int silenceTimeoutMs,
            int minUtteranceMs,
            int preRollMs,
            int bargeInSustainedMs,
            float bargeInThreshold,
            float bargeInSpeakerBoost,
            String ttsEngine,
            String chatTemplate,
            String bargeInMode,
            String micSourceMode,
            boolean saveLast10Utterances
    ) {
        this.silenceTimeoutMs = Math.max(250, Math.min(2000, silenceTimeoutMs));
        this.minUtteranceMs = Math.max(150, Math.min(1000, minUtteranceMs));
        this.preRollMs = Math.max(100, Math.min(800, preRollMs));
        this.bargeInSustainedMs = Math.max(400, Math.min(2000, bargeInSustainedMs));
        this.bargeInThreshold = Math.max(0.20f, Math.min(0.95f, bargeInThreshold));
        this.idleVadThreshold = Math.max(0.25f, Math.min(0.45f, this.bargeInThreshold));
        // Unified barge-in threshold: eliminate silent +speakerBoost mismatch
        this.bargeInSpeakerBoost = 0.0f;
        if (bargeInMode != null) {
            String cleanMode = bargeInMode.trim().toLowerCase(Locale.ROOT);
            if ("off".equals(cleanMode) || "headphones_only".equals(cleanMode) || "on".equals(cleanMode) || "adaptive".equals(cleanMode)) {
                this.bargeInMode = cleanMode;
            }
        }
        if (micSourceMode != null) {
            String cleanMic = micSourceMode.trim().toLowerCase(Locale.ROOT);
            if ("auto".equals(cleanMic) || "communication".equals(cleanMic) || "recognition".equals(cleanMic)) {
                this.micSourceMode = cleanMic;
            }
        }
        this.saveLast10Utterances = saveLast10Utterances;
        if (ttsEngine != null && !ttsEngine.isEmpty()) {
            this.ttsEngineType = ttsEngine;
        }
        if (chatTemplate != null && !chatTemplate.isEmpty()) {
            this.chatTemplate = chatTemplate;
        }
    }

    public void setMicSourceMode(String mode) {
        if (mode == null) return;
        String clean = mode.trim().toLowerCase(Locale.ROOT);
        if ("auto".equals(clean) || "communication".equals(clean) || "recognition".equals(clean)) {
            this.micSourceMode = clean;
        }
    }

    public void setSaveLast10Utterances(boolean enabled) {
        this.saveLast10Utterances = enabled;
    }

    public boolean isHeadsetConnected() {
        if (audioManager == null) return false;
        try {
            AudioDeviceInfo[] outputs = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            if (outputs != null) {
                for (AudioDeviceInfo dev : outputs) {
                    int type = dev.getType();
                    if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                            || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                            || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                            || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                            || type == AudioDeviceInfo.TYPE_USB_HEADSET
                            || (Build.VERSION.SDK_INT >= 31 && type == 26)) {
                        return true;
                    }
                }
            }
        } catch (Throwable ignored) {}
        return false;
    }

    private void configureVoiceCommunicationAudioMode() {
        if (audioManager == null) return;
        try {
            if (!audioModeModified) {
                previousAudioMode = audioManager.getMode();
            }
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioModeModified = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                voiceFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(false)
                        .build();
                audioManager.requestAudioFocus(voiceFocusRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
            listener.onDiagnosticLog(
                    0,
                    "LocalAudio:AudioMode",
                    "AudioManager mode=MODE_IN_COMMUNICATION (prevMode=" + previousAudioMode
                            + ", headsetConnected=" + isHeadsetConnected()
                            + ", bargeInMode=" + bargeInMode + ")"
            );
        } catch (Throwable t) {
            Log.w(TAG, "Failed to configure MODE_IN_COMMUNICATION: " + t.getMessage());
        }
    }

    private void restoreAudioMode() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && voiceFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(voiceFocusRequest);
                voiceFocusRequest = null;
            } else {
                audioManager.abandonAudioFocus(null);
            }
        } catch (Throwable ignored) {}
        try {
            if (audioModeModified) {
                audioManager.setMode(previousAudioMode);
                audioModeModified = false;
                listener.onDiagnosticLog(0, "LocalAudio:AudioMode", "Restored AudioManager mode=" + previousAudioMode);
            }
        } catch (Throwable ignored) {}
    }

    public synchronized void startSession() throws Exception {
        if (sessionActive.get()) return;
        sessionActive.set(true);
        llmCancelRequested.set(false);
        playbackCancelled.set(false);
        isSpeaking.set(false);
        isThinking.set(false);
        adaptivePlaybackRms = 0.0;
        lastPlaybackAudioUpdateMs = 0L;
        lastPlaybackEndTimestampMs = 0L;
        vadOnnxFallbackLogged = false;
        vadState = new float[2][1][128];

        configureVoiceCommunicationAudioMode();

        CountDownLatch initLatch = new CountDownLatch(1);
        AtomicReference<String> initError = new AtomicReference<>(null);
        this.pendingAudioInitLatch = initLatch;
        this.pendingAudioInitError = initError;

        audioCaptureThread = new Thread(this::runAudioCaptureAndVadLoop, "SierraLocalAudioVadThread");
        audioCaptureThread.start();

        boolean initializedInTime = initLatch.await(3000L, TimeUnit.MILLISECONDS);
        String err = initError.get();
        if (!initializedInTime || err != null) {
            sessionActive.set(false);
            if (audioCaptureThread != null) {
                audioCaptureThread.interrupt();
                audioCaptureThread = null;
            }
            restoreAudioMode();
            String failureMsg = err != null
                    ? err
                    : "Timed out initializing 16kHz AudioRecord microphone capture.";
            throw new IllegalStateException(failureMsg);
        }
    }

    public synchronized void stopSession() {
        sessionActive.set(false);
        interruptCurrentTurn();
        if (audioCaptureThread != null) {
            try {
                audioCaptureThread.interrupt();
                audioCaptureThread.join(600);
            } catch (InterruptedException ignored) {}
            audioCaptureThread = null;
        }
        releaseAudioHardware();
        listener.onStatusChanged("idle", "session_stopped");
    }

    public void stopNativeAudioPlayback() {
        playbackCancelled.set(true);
        boolean wasSpeaking = isSpeaking.getAndSet(false);
        if (wasSpeaking) {
            lastPlaybackEndTimestampMs = System.currentTimeMillis();
        }
        AudioTrack trackToStop;
        synchronized (playbackLock) {
            trackToStop = playbackTrack;
            playbackTrack = null;
        }
        if (trackToStop != null) {
            try {
                trackToStop.pause();
                trackToStop.flush();
                trackToStop.stop();
            } catch (Throwable ignored) {}
            try {
                trackToStop.release();
            } catch (Throwable ignored) {}
        }
    }

    public boolean playPcmOrWavAudio(byte[] audioBytes, int defaultSampleRateHz, int turnId) {
        if (audioBytes == null || audioBytes.length < 2) {
            return true;
        }
        if (turnId > 0 && turnId != activeTurnId.get()) {
            return false;
        }

        int sampleRate = defaultSampleRateHz > 0 ? defaultSampleRateHz : 44100;
        int channels = 1;
        int dataOffset = 0;
        int dataLength = audioBytes.length & ~1;

        // Parse optional RIFF/WAV header
        if (audioBytes.length > 44
                && audioBytes[0] == 'R' && audioBytes[1] == 'I' && audioBytes[2] == 'F' && audioBytes[3] == 'F'
                && audioBytes[8] == 'W' && audioBytes[9] == 'A' && audioBytes[10] == 'V' && audioBytes[11] == 'E') {
            ByteBuffer hdr = ByteBuffer.wrap(audioBytes).order(ByteOrder.LITTLE_ENDIAN);
            channels = Math.max(1, Math.min(2, hdr.getShort(22) & 0xFFFF));
            int parsedRate = hdr.getInt(24);
            if (parsedRate >= 8000 && parsedRate <= 96000) {
                sampleRate = parsedRate;
            }
            int pos = 12;
            while (pos + 8 <= audioBytes.length) {
                int chunkSize = hdr.getInt(pos + 4);
                boolean isData = audioBytes[pos] == 'd' && audioBytes[pos + 1] == 'a'
                        && audioBytes[pos + 2] == 't' && audioBytes[pos + 3] == 'a';
                if (isData) {
                    dataOffset = pos + 8;
                    int avail = audioBytes.length - dataOffset;
                    dataLength = (chunkSize > 0 && chunkSize <= avail ? chunkSize : avail) & ~1;
                    break;
                }
                if (chunkSize < 0) break;
                pos += 8 + chunkSize + (chunkSize % 2);
            }
            if (dataOffset == 0) {
                dataOffset = 44;
                dataLength = (audioBytes.length - 44) & ~1;
            }
        }

        if (dataLength < 2) {
            return true;
        }

        int channelConfig = channels == 2 ? AudioFormat.CHANNEL_OUT_STEREO : AudioFormat.CHANNEL_OUT_MONO;
        int minBuf = AudioTrack.getMinBufferSize(sampleRate, channelConfig, AudioFormat.ENCODING_PCM_16BIT);
        int trackBufSize = Math.max(minBuf > 0 ? minBuf : sampleRate / 5, 8192);

        playbackCancelled.set(false);
        AudioTrack track = null;
        boolean completedCleanly = false;
        try {
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            AudioFormat format = new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelConfig)
                    .build();
            track = new AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(trackBufSize)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();

            synchronized (playbackLock) {
                if (playbackTrack != null) {
                    try {
                        playbackTrack.pause();
                        playbackTrack.flush();
                        playbackTrack.stop();
                        playbackTrack.release();
                    } catch (Throwable ignored) {}
                }
                playbackTrack = track;
            }

            if (playbackCancelled.get() || (turnId > 0 && turnId != activeTurnId.get())) {
                return false;
            }

            if (sessionActive.get()) {
                isSpeaking.set(true);
            }
            track.play();

            int bytesWrittenTotal = 0;
            int endOffset = dataOffset + dataLength;
            int chunkStep = 4096;
            for (int pos = dataOffset; pos < endOffset; pos += chunkStep) {
                if (playbackCancelled.get() || Thread.currentThread().isInterrupted()
                        || (turnId > 0 && turnId != activeTurnId.get())) {
                    return false;
                }
                int len = Math.min(chunkStep, endOffset - pos) & ~1;
                if (len <= 0) break;

                // Track adaptive playback RMS for speaker echo gating
                double sumSq = 0.0;
                int sampleCount = len / 2;
                for (int i = 0; i < len; i += 2) {
                    short s = (short) ((audioBytes[pos + i] & 0xFF) | (audioBytes[pos + i + 1] << 8));
                    double norm = s / 32768.0;
                    sumSq += norm * norm;
                }
                double chunkRms = sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0.0;
                adaptivePlaybackRms = (adaptivePlaybackRms * 0.6) + (chunkRms * 0.4);
                lastPlaybackAudioUpdateMs = System.currentTimeMillis();

                int written = track.write(audioBytes, pos, len);
                if (written < 0) {
                    return false;
                }
                bytesWrittenTotal += written;
            }

            int totalFrames = bytesWrittenTotal / (channels * 2);
            long totalDurationMs = (bytesWrittenTotal * 1000L) / Math.max(1, sampleRate * channels * 2L);
            long drainDeadline = System.currentTimeMillis() + totalDurationMs + 500L;
            while (!playbackCancelled.get() && !Thread.currentThread().isInterrupted()
                    && (turnId <= 0 || turnId == activeTurnId.get())) {
                if (track.getPlaybackHeadPosition() >= totalFrames) {
                    completedCleanly = true;
                    break;
                }
                if (System.currentTimeMillis() >= drainDeadline) {
                    completedCleanly = true;
                    break;
                }
                try {
                    Thread.sleep(20);
                } catch (InterruptedException ie) {
                    return false;
                }
            }
            return completedCleanly && !playbackCancelled.get() && (turnId <= 0 || turnId == activeTurnId.get());
        } catch (Throwable t) {
            Log.w(TAG, "AudioTrack PCM playback warning: " + t.getMessage());
            return false;
        } finally {
            lastPlaybackEndTimestampMs = System.currentTimeMillis();
            synchronized (playbackLock) {
                if (playbackTrack == track) {
                    playbackTrack = null;
                }
            }
            if (track != null) {
                try {
                    track.pause();
                    track.flush();
                    track.stop();
                } catch (Throwable ignored) {}
                try {
                    track.release();
                } catch (Throwable ignored) {}
            }
        }
    }

    /**
     * Strict barge-in interruption sequence:
     * 1. Stop and flush audio playback
     * 2. Cancel LLM generation
     * 3. Cancel TTS and empty its queue
     */
    public void interruptCurrentTurn() {
        activeTurnId.incrementAndGet();
        // 1. Stop and flush audio playback
        stopNativeAudioPlayback();
        if (androidTts != null) {
            try {
                androidTts.stop();
            } catch (Throwable ignored) {}
        }
        // 2. Cancel LLM generation
        llmCancelRequested.set(true);
        isThinking.set(false);
        if (sNativeJniLoaded) {
            try {
                nativeCancelLlm();
            } catch (Throwable ignored) {}
        }
        // 3. Cancel TTS and empty its queue
        ttsQueue.clear();
    }

    private void signalAudioInitDone(String errorMessage) {
        AtomicReference<String> errRef = this.pendingAudioInitError;
        CountDownLatch latch = this.pendingAudioInitLatch;
        if (errRef != null && errorMessage != null) {
            errRef.compareAndSet(null, errorMessage);
        }
        if (latch != null) {
            latch.countDown();
        }
    }

    private void runAudioCaptureAndVadLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        int minBufSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE_HZ,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
        );
        int safeMinBuf = minBufSize > 0 ? minBufSize : FRAME_SAMPLES * 2 * 4;
        int bufferSizeInBytes = Math.max(safeMinBuf * 2, FRAME_SAMPLES * 2 * 8);
        boolean initSignaled = false;

        try {
            boolean headsetAtInit = isHeadsetConnected();
            int preferredSource;
            int secondarySource;
            if ("recognition".equals(micSourceMode)) {
                preferredSource = MediaRecorder.AudioSource.VOICE_RECOGNITION;
                secondarySource = MediaRecorder.AudioSource.VOICE_COMMUNICATION;
            } else if ("communication".equals(micSourceMode)) {
                preferredSource = MediaRecorder.AudioSource.VOICE_COMMUNICATION;
                secondarySource = MediaRecorder.AudioSource.VOICE_RECOGNITION;
            } else {
                // Auto: VOICE_RECOGNITION (6) on speaker, VOICE_COMMUNICATION (7) with headset; keep AEC on
                preferredSource = headsetAtInit
                        ? MediaRecorder.AudioSource.VOICE_COMMUNICATION
                        : MediaRecorder.AudioSource.VOICE_RECOGNITION;
                secondarySource = headsetAtInit
                        ? MediaRecorder.AudioSource.VOICE_RECOGNITION
                        : MediaRecorder.AudioSource.VOICE_COMMUNICATION;
            }

            int chosenSource = preferredSource;
            audioRecord = new AudioRecord(
                    chosenSource,
                    SAMPLE_RATE_HZ,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSizeInBytes
            );
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                chosenSource = secondarySource;
                audioRecord = new AudioRecord(
                        chosenSource,
                        SAMPLE_RATE_HZ,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufferSizeInBytes
                );
            }
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                audioRecord.release();
                chosenSource = MediaRecorder.AudioSource.MIC;
                audioRecord = new AudioRecord(
                        chosenSource,
                        SAMPLE_RATE_HZ,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufferSizeInBytes
                );
            }
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                String msg = "Failed to initialize 16 kHz PCM16 AudioRecord (state=" + audioRecord.getState()
                        + ", minBuf=" + minBufSize + ").";
                recordNativeError("AudioRecord", msg, false);
                signalAudioInitDone(msg);
                initSignaled = true;
                sessionActive.set(false);
                return;
            }

            int sessionId = audioRecord.getAudioSessionId();
            boolean aecAvailable = AcousticEchoCanceler.isAvailable();
            boolean nsAvailable = NoiseSuppressor.isAvailable();
            boolean aecEnabled = false;
            boolean nsEnabled = false;
            if (aecAvailable) {
                try {
                    echoCanceler = AcousticEchoCanceler.create(sessionId);
                    if (echoCanceler != null) {
                        echoCanceler.setEnabled(true);
                        aecEnabled = echoCanceler.getEnabled();
                    }
                } catch (Throwable ignored) {}
            }
            if (nsAvailable) {
                try {
                    noiseSuppressor = NoiseSuppressor.create(sessionId);
                    if (noiseSuppressor != null) {
                        noiseSuppressor.setEnabled(true);
                        nsEnabled = noiseSuppressor.getEnabled();
                    }
                } catch (Throwable ignored) {}
            }

            audioRecord.startRecording();
            if (audioRecord.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                String msg = "AudioRecord failed to enter RECORDSTATE_RECORDING (recordingState="
                        + audioRecord.getRecordingState() + ").";
                recordNativeError("AudioRecord", msg, false);
                signalAudioInitDone(msg);
                initSignaled = true;
                sessionActive.set(false);
                return;
            }

            signalAudioInitDone(null);
            initSignaled = true;
            listener.onStatusChanged("listening", "audio_record_16khz_started");
            listener.onDiagnosticLog(
                    0,
                    "LocalAudio:CaptureStart",
                    "AudioRecord 16kHz PCM16 active (source=" + chosenSource
                            + ", micSourceMode=" + micSourceMode
                            + ", sessionId=" + sessionId
                            + ", bufBytes=" + bufferSizeInBytes
                            + ", aecAvailable=" + aecAvailable
                            + ", aecEnabled=" + aecEnabled
                            + ", nsAvailable=" + nsAvailable
                            + ", nsEnabled=" + nsEnabled
                            + ", vadOnnx=" + (vadSession != null)
                            + ", bargeInMode=" + bargeInMode
                            + ", preRollMs=" + preRollMs
                            + ", hangoverMs=" + silenceTimeoutMs
                            + ", headsetConnected=" + isHeadsetConnected()
                            + ", idleVadThreshold=" + String.format(Locale.US, "%.2f", idleVadThreshold)
                            + ", bargeInThreshold=" + String.format(Locale.US, "%.2f", bargeInThreshold) + ")"
            );

            int maxPreRollFrames = Math.max(4, preRollMs / FRAME_DURATION_MS);
            List<short[]> preRollBuffer = new ArrayList<>();
            List<short[]> utteranceFrames = new ArrayList<>();
            List<short[]> pendingUtteranceFrames = new ArrayList<>();
            List<short[]> pendingGapFrames = new ArrayList<>();
            boolean pendingUtteranceFromBargeIn = false;
            long pendingSpeechEndMs = 0L;
            boolean capturingUtterance = false;
            boolean utteranceFromBargeIn = false;
            boolean wasSpeaking = false;
            int consecutiveSpeechMs = 0;
            int consecutiveSilenceMs = 0;
            int bargeInSpeechMs = 0;
            int consecutiveReadErrors = 0;
            int consecutiveZeroReads = 0;
            int framesSinceHeartbeat = 0;
            double heartbeatMaxRms = 0.0;
            float heartbeatMaxVadProb = 0.0f;

            short[] frameBuf = new short[FRAME_SAMPLES];

            while (sessionActive.get() && !Thread.currentThread().isInterrupted()) {
                int read = audioRecord.read(frameBuf, 0, FRAME_SAMPLES);
                if (read < 0) {
                    consecutiveReadErrors++;
                    if (consecutiveReadErrors == 1 || consecutiveReadErrors % 10 == 0) {
                        listener.onDiagnosticLog(
                                0,
                                "LocalAudio:ReadError",
                                "AudioRecord.read returned error code " + read + " (count=" + consecutiveReadErrors + ")"
                        );
                    }
                    if (consecutiveReadErrors >= 5) {
                        recordNativeError("AudioRecord", "AudioRecord.read failed repeatedly with code " + read, false);
                        sessionActive.set(false);
                        break;
                    }
                    continue;
                }
                if (read == 0) {
                    consecutiveZeroReads++;
                    if (consecutiveZeroReads % 64 == 0) {
                        listener.onDiagnosticLog(
                                0,
                                "LocalAudio:ZeroReadWarning",
                                "AudioRecord.read returned 0 samples for " + consecutiveZeroReads + " consecutive reads"
                        );
                    }
                    continue;
                }
                consecutiveReadErrors = 0;
                consecutiveZeroReads = 0;

                short[] frameCopy = new short[read];
                System.arraycopy(frameBuf, 0, frameCopy, 0, read);

                double frameSumSq = 0.0;
                for (int i = 0; i < read; i++) {
                    double norm = frameCopy[i] / 32768.0;
                    frameSumSq += norm * norm;
                }
                double frameRms = Math.sqrt(frameSumSq / read);
                if (frameRms > heartbeatMaxRms) {
                    heartbeatMaxRms = frameRms;
                }

                float vadProb = evaluateSileroVadOnFrame(frameCopy, read);
                if (vadProb > heartbeatMaxVadProb) {
                    heartbeatMaxVadProb = vadProb;
                }

                long now = System.currentTimeMillis();
                boolean speakingNow = isSpeaking.get();
                if (wasSpeaking && !speakingNow) {
                    lastPlaybackEndTimestampMs = now;
                }
                wasSpeaking = speakingNow;
                if (!speakingNow && lastPlaybackAudioUpdateMs > 0 && (now - lastPlaybackAudioUpdateMs) > 250L) {
                    adaptivePlaybackRms = (now - lastPlaybackEndTimestampMs) > 600L ? 0.0 : (adaptivePlaybackRms * 0.85);
                }

                framesSinceHeartbeat++;
                if (framesSinceHeartbeat >= 96) {
                    String vadMode = (vadSession != null && !vadOnnxFallbackLogged) ? "ONNX" : "DSP";
                    listener.onDiagnosticLog(
                            0,
                            "LocalAudio:Heartbeat",
                            String.format(
                                    Locale.US,
                                    "3s mic capture stats: vadMode=%s, peakRms=%.4f, maxVadProb=%.3f, idleThresh=%.2f, bargeThresh=%.2f, playbackRms=%.4f, headset=%s, bargeInMode=%s, capturing=%s, thinking=%s, speaking=%s",
                                    vadMode,
                                    heartbeatMaxRms,
                                    heartbeatMaxVadProb,
                                    idleVadThreshold,
                                    bargeInThreshold,
                                    adaptivePlaybackRms,
                                    isHeadsetConnected(),
                                    bargeInMode,
                                    capturingUtterance,
                                    isThinking.get(),
                                    speakingNow
                            )
                    );
                    framesSinceHeartbeat = 0;
                    heartbeatMaxRms = 0.0;
                    heartbeatMaxVadProb = 0.0f;
                }

                // Maintain pre-roll buffer when not capturing
                if (!capturingUtterance) {
                    preRollBuffer.add(frameCopy);
                    while (preRollBuffer.size() > maxPreRollFrames) {
                        preRollBuffer.remove(0);
                    }
                }

                boolean headsetNow = isHeadsetConnected();
                boolean isAdaptiveMode = "adaptive".equals(bargeInMode);
                boolean bargeInPermitted = isAdaptiveMode || "on".equals(bargeInMode)
                        || ("headphones_only".equals(bargeInMode) && headsetNow);

                // In Off or headphones_only (without headset), ignore VAD while speaking and for 400ms after playback ends
                boolean inSpeakerCooldown = !bargeInPermitted
                        && (speakingNow || (lastPlaybackEndTimestampMs > 0 && (now - lastPlaybackEndTimestampMs) < 400L));
                if (inSpeakerCooldown) {
                    if (speakingNow && (vadProb >= 0.50f || frameRms >= 0.08)
                            && (now - lastBargeInIgnoredLogMs) >= 600L) {
                        lastBargeInIgnoredLogMs = now;
                        listener.onDiagnosticLog(
                                activeTurnId.get(),
                                "BargeIn:Ignored",
                                String.format(
                                        Locale.US,
                                        "reason=%s vad=%.3f micRms=%.4f playbackRms=%.4f sustainedMs=0 mode=%s headset=%s",
                                        "off".equals(bargeInMode) ? "mode_off" : "headphones_only_no_headset",
                                        vadProb,
                                        frameRms,
                                        adaptivePlaybackRms,
                                        bargeInMode,
                                        headsetNow
                                )
                        );
                    }
                    bargeInSpeechMs = 0;
                    consecutiveSpeechMs = 0;
                    if (capturingUtterance) {
                        capturingUtterance = false;
                        utteranceFromBargeIn = false;
                        utteranceFrames.clear();
                    }
                    continue;
                }

                // Check Barge-In ONLY while Sierra is actually speaking TTS audio and barge-in is permitted
                if (speakingNow) {
                    float effectiveThreshold = isAdaptiveMode
                            ? Math.max(0.85f, bargeInThreshold)
                            : bargeInThreshold;
                    double requiredMicRms = headsetNow
                            ? 0.015
                            : (isAdaptiveMode
                                ? Math.max(0.2, adaptivePlaybackRms * 2.0)
                                : Math.max(0.04, adaptivePlaybackRms * 1.25));
                    int targetSustainedMs = isAdaptiveMode
                            ? (headsetNow ? 0 : 400)
                            : ("on".equals(bargeInMode) && !headsetNow ? Math.max(400, bargeInSustainedMs) : bargeInSustainedMs);
                    boolean rmsOk = (isAdaptiveMode && !headsetNow)
                            ? (frameRms > requiredMicRms)
                            : (frameRms >= requiredMicRms);

                    if (vadProb >= effectiveThreshold && rmsOk) {
                        bargeInSpeechMs += FRAME_DURATION_MS;
                        if (bargeInSpeechMs >= targetSustainedMs) {
                            int interruptedTurn = activeTurnId.get();
                            int triggeredMs = bargeInSpeechMs;
                            listener.onDiagnosticLog(
                                    interruptedTurn,
                                    "BargeIn:Accepted",
                                    String.format(
                                            Locale.US,
                                            "reason=%s vad=%.3f micRms=%.4f playbackRms=%.4f sustainedMs=%d reqRms=%.4f mode=%s headset=%s",
                                            headsetNow ? (isAdaptiveMode ? "adaptive_headphones_immediate" : "headphones_sustained") : (isAdaptiveMode ? "adaptive_speaker_sustained" : "speaker_sustained"),
                                            vadProb,
                                            frameRms,
                                            adaptivePlaybackRms,
                                            triggeredMs,
                                            requiredMicRms,
                                            bargeInMode,
                                            headsetNow
                                    )
                            );
                            interruptCurrentTurn();
                            listener.onStatusChanged("interrupted", "barge_in_detected");
                            listener.onBargeInTriggered(interruptedTurn, triggeredMs, effectiveThreshold);

                            // Immediately transition to capturing the new utterance including pre-roll frames
                            capturingUtterance = true;
                            utteranceFromBargeIn = true;
                            utteranceFrames.clear();
                            utteranceFrames.addAll(preRollBuffer);
                            consecutiveSilenceMs = 0;
                            consecutiveSpeechMs = triggeredMs;
                            bargeInSpeechMs = 0;
                        } else if ((vadProb >= 0.45f || frameRms >= 0.08)
                                && (now - lastBargeInIgnoredLogMs) >= 500L) {
                            lastBargeInIgnoredLogMs = now;
                            listener.onDiagnosticLog(
                                    activeTurnId.get(),
                                    "BargeIn:Ignored",
                                    String.format(
                                            Locale.US,
                                            "reason=accumulating(<%dms) vad=%.3f micRms=%.4f playbackRms=%.4f sustainedMs=%d reqRms=%.4f mode=%s headset=%s",
                                            targetSustainedMs,
                                            vadProb,
                                            frameRms,
                                            adaptivePlaybackRms,
                                            bargeInSpeechMs,
                                            requiredMicRms,
                                            bargeInMode,
                                            headsetNow
                                    )
                            );
                        }
                    } else {
                        if (bargeInSpeechMs > 0 || ((vadProb >= 0.45f || frameRms >= 0.08) && (now - lastBargeInIgnoredLogMs) >= 500L)) {
                            lastBargeInIgnoredLogMs = now;
                            String ignoreReason = bargeInSpeechMs > 0
                                    ? "short_burst_reset"
                                    : (vadProb < effectiveThreshold ? "vad_below_threshold" : "mic_rms_below_required");
                            listener.onDiagnosticLog(
                                    activeTurnId.get(),
                                    "BargeIn:Ignored",
                                    String.format(
                                            Locale.US,
                                            "reason=%s vad=%.3f micRms=%.4f playbackRms=%.4f sustainedMs=%d reqRms=%.4f mode=%s headset=%s",
                                            ignoreReason,
                                            vadProb,
                                            frameRms,
                                            adaptivePlaybackRms,
                                            bargeInSpeechMs,
                                            requiredMicRms,
                                            bargeInMode,
                                            headsetNow
                                    )
                            );
                        }
                        bargeInSpeechMs = 0;
                    }
                    continue;
                }

                if (isThinking.get()) {
                    bargeInSpeechMs = 0;
                    continue;
                }

                boolean isSpeech = vadProb >= idleVadThreshold;

                // Flush or merge pending utterance held for <700ms gap merge window
                if (!capturingUtterance && !pendingUtteranceFrames.isEmpty()) {
                    if (isSpeech) {
                        consecutiveSpeechMs += FRAME_DURATION_MS;
                        pendingGapFrames.add(frameCopy);
                        if (consecutiveSpeechMs >= 64) {
                            int mergedGapMs = pendingGapFrames.size() * FRAME_DURATION_MS;
                            utteranceFrames.clear();
                            utteranceFrames.addAll(pendingUtteranceFrames);
                            utteranceFrames.addAll(pendingGapFrames);
                            pendingUtteranceFrames.clear();
                            pendingGapFrames.clear();
                            capturingUtterance = true;
                            utteranceFromBargeIn = pendingUtteranceFromBargeIn;
                            pendingUtteranceFromBargeIn = false;
                            consecutiveSilenceMs = 0;
                            listener.onDiagnosticLog(
                                    0,
                                    "LocalVAD:MergedUtterance",
                                    "Merged utterance across " + mergedGapMs + "ms pause (< " + VAD_MERGE_GAP_MS + "ms)"
                            );
                        }
                        continue;
                    } else {
                        consecutiveSpeechMs = 0;
                        pendingGapFrames.add(frameCopy);
                        long silenceElapsedSinceLastSpeechMs = silenceTimeoutMs + (long) pendingGapFrames.size() * FRAME_DURATION_MS;
                        if (silenceElapsedSinceLastSpeechMs >= VAD_MERGE_GAP_MS) {
                            final List<short[]> completedFrames = new ArrayList<>(pendingUtteranceFrames);
                            final boolean wasBargeIn = pendingUtteranceFromBargeIn;
                            pendingUtteranceFrames.clear();
                            pendingGapFrames.clear();
                            pendingUtteranceFromBargeIn = false;

                            int totalSamples = 0;
                            for (short[] f : completedFrames) totalSamples += f.length;
                            int totalDurationMs = (totalSamples * 1000) / SAMPLE_RATE_HZ;
                            lastSpeechEndTimestampMs = pendingSpeechEndMs > 0 ? pendingSpeechEndMs : now;
                            isThinking.set(true);
                            listener.onStatusChanged("thinking", "running_whisper_stt");
                            listener.onDiagnosticLog(
                                    0,
                                    "LocalSTT:WhisperStart",
                                    "Submitting " + totalDurationMs + "ms audio (" + totalSamples + " samples) to Whisper STT"
                            );
                            inferenceExecutor.submit(() -> runWhisperSttOnUtterance(completedFrames, totalDurationMs, wasBargeIn));
                        }
                        continue;
                    }
                }

                if (!capturingUtterance) {
                    if (isSpeech) {
                        consecutiveSpeechMs += FRAME_DURATION_MS;
                        if (consecutiveSpeechMs >= 64) {
                            capturingUtterance = true;
                            utteranceFromBargeIn = false;
                            consecutiveSilenceMs = 0;
                            utteranceFrames.clear();
                            utteranceFrames.addAll(preRollBuffer);
                            listener.onVadFrame(vadProb, true, "utterance_started");
                            listener.onDiagnosticLog(
                                    0,
                                    "LocalVAD:SpeechStart",
                                    String.format(
                                            Locale.US,
                                            "Speech detected (vadProb=%.3f >= %.2f, source=%s, preRollFrames=%d)",
                                            vadProb,
                                            idleVadThreshold,
                                            (vadSession != null && !vadOnnxFallbackLogged) ? "ONNX" : "DSP",
                                            preRollBuffer.size()
                                    )
                            );
                        }
                    } else {
                        consecutiveSpeechMs = 0;
                    }
                } else {
                    utteranceFrames.add(frameCopy);
                    if (isSpeech) {
                        consecutiveSilenceMs = 0;
                    } else {
                        consecutiveSilenceMs += FRAME_DURATION_MS;
                        if (consecutiveSilenceMs >= silenceTimeoutMs) {
                            int totalSamples = 0;
                            for (short[] f : utteranceFrames) totalSamples += f.length;
                            int totalDurationMs = (totalSamples * 1000) / SAMPLE_RATE_HZ;
                            int activeSpeechDurationMs = Math.max(0, totalDurationMs - silenceTimeoutMs);

                            final List<short[]> completedFrames = new ArrayList<>(utteranceFrames);
                            final boolean wasBargeIn = utteranceFromBargeIn;
                            utteranceFrames.clear();
                            capturingUtterance = false;
                            utteranceFromBargeIn = false;
                            consecutiveSpeechMs = 0;
                            consecutiveSilenceMs = 0;

                            if (activeSpeechDurationMs < minUtteranceMs || totalDurationMs < STT_MIN_DURATION_MS) {
                                listener.onStatusChanged("listening", "discarded_short_utterance_" + activeSpeechDurationMs + "ms");
                                listener.onDiagnosticLog(
                                        0,
                                        "STT:DroppedShort",
                                        "Discarded short utterance (active=" + activeSpeechDurationMs + "ms, total=" + totalDurationMs + "ms < min)"
                                );
                                listener.onDiagnosticLog(
                                        0,
                                        "LocalVAD:DiscardedShort",
                                        "Discarded short utterance (" + activeSpeechDurationMs + "ms < min " + minUtteranceMs + "ms)"
                                );
                                continue;
                            }

                            if (silenceTimeoutMs < VAD_MERGE_GAP_MS) {
                                pendingUtteranceFrames.clear();
                                pendingUtteranceFrames.addAll(completedFrames);
                                pendingGapFrames.clear();
                                pendingUtteranceFromBargeIn = wasBargeIn;
                                pendingSpeechEndMs = now;
                                continue;
                            }

                            lastSpeechEndTimestampMs = System.currentTimeMillis();
                            isThinking.set(true);
                            listener.onStatusChanged("thinking", "running_whisper_stt");
                            listener.onDiagnosticLog(
                                    0,
                                    "LocalSTT:WhisperStart",
                                    "Submitting " + totalDurationMs + "ms audio (" + totalSamples + " samples) to Whisper STT"
                            );

                            inferenceExecutor.submit(() -> runWhisperSttOnUtterance(completedFrames, totalDurationMs, wasBargeIn));
                        }
                    }
                }
            }
        } catch (Throwable t) {
            String errMsg = t.getMessage() != null ? t.getMessage() : t.toString();
            if (!initSignaled) {
                signalAudioInitDone("Microphone capture failed: " + errMsg);
                initSignaled = true;
            }
            if (sessionActive.get()) {
                recordNativeError("AudioCaptureLoop", "Microphone capture error: " + errMsg, false);
            }
        } finally {
            if (!initSignaled) {
                signalAudioInitDone("Audio capture thread exited before starting.");
            }
            releaseAudioHardware();
        }
    }

    private float evaluateSileroVadOnFrame(short[] pcmFrame, int length) {
        float dspScore = sNativeJniLoaded
                ? nativeComputeFrameVadFeature(pcmFrame, length)
                : computeJavaFrameVadFeature(pcmFrame, length);

        if (vadSession != null && ortEnv != null && length == FRAME_SAMPLES) {
            float[] floatSamples = new float[FRAME_SAMPLES];
            for (int i = 0; i < FRAME_SAMPLES; i++) {
                floatSamples[i] = pcmFrame[i] / 32768.0f;
            }
            for (int attempt = 0; attempt < 2; attempt++) {
                long[] srShape = vadSrIsScalar ? new long[]{} : new long[]{1};
                try (OnnxTensor inputTensor = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(floatSamples), new long[]{1, FRAME_SAMPLES});
                     OnnxTensor srTensor = OnnxTensor.createTensor(ortEnv, LongBuffer.wrap(new long[]{SAMPLE_RATE_HZ}), srShape);
                     OnnxTensor stateTensor = OnnxTensor.createTensor(ortEnv, vadState)) {
                    Map<String, OnnxTensor> inputs = new HashMap<>();
                    inputs.put("input", inputTensor);
                    inputs.put("sr", srTensor);
                    inputs.put("state", stateTensor);
                    try (OrtSession.Result res = vadSession.run(inputs)) {
                        Object outVal = res.get(0).getValue();
                        if (outVal instanceof float[][]) {
                            float onnxProb = ((float[][]) outVal)[0][0];
                            if (res.size() > 1 && res.get(1).getValue() instanceof float[][][]) {
                                vadState = (float[][][]) res.get(1).getValue();
                            }
                            return Math.max(0.0f, Math.min(1.0f, onnxProb));
                        }
                    }
                } catch (Throwable onnxErr) {
                    String errMsg = onnxErr.getMessage() != null ? onnxErr.getMessage() : onnxErr.toString();
                    if (attempt == 0 && !vadSrIsScalar && (errMsg.contains("sr") || errMsg.contains("Rank") || errMsg.contains("rank"))) {
                        vadSrIsScalar = true;
                        continue;
                    }
                    if (!vadOnnxFallbackLogged) {
                        vadOnnxFallbackLogged = true;
                        Log.w(TAG, "Silero VAD ONNX inference failed, falling back to DSP VAD: " + errMsg);
                        listener.onDiagnosticLog(
                                0,
                                "LocalVAD:OnnxFallback",
                                "Silero VAD ONNX run failed (" + errMsg + "); using DSP VAD fallback"
                        );
                    }
                    break;
                }
            }
        }
        return dspScore;
    }

    private float computeJavaFrameVadFeature(short[] samples, int length) {
        if (samples == null || length <= 0) return 0.0f;
        double sumSq = 0.0;
        int zc = 0;
        for (int i = 0; i < length; i++) {
            double norm = samples[i] / 32768.0;
            sumSq += norm * norm;
            if (i > 0 && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
                zc++;
            }
        }
        double rms = Math.sqrt(sumSq / length);
        double zcr = (double) zc / length;
        double weight = (zcr >= 0.015 && zcr <= 0.32) ? 1.15 : 0.75;
        return (float) Math.min(1.0, (rms / 0.065) * weight);
    }

    private boolean isWhisperNoiseOrBlank(String rawText) {
        if (rawText == null) return true;
        String stripped = rawText
                .replaceAll("\\[[^\\]]*\\]", " ")
                .replaceAll("\\([^\\)]*\\)", " ")
                .replaceAll("\\*[^\\*]*\\*", " ")
                .replaceAll("(?i)\\b(blank_audio|silence|inaudible|music|applause|laughter)\\b", " ")
                .trim();
        if (stripped.isEmpty()) return true;
        int alphaNumCount = 0;
        for (int i = 0; i < stripped.length(); i++) {
            if (Character.isLetterOrDigit(stripped.charAt(i))) {
                alphaNumCount++;
            }
        }
        return alphaNumCount < 2;
    }

    private String cleanWhisperTranscript(String rawText) {
        if (rawText == null) return "";
        return rawText
                .replaceAll("\\[[^\\]]*\\]", " ")
                .replaceAll("\\([^\\)]*\\)", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private String normalizePhantomPhrase(String text) {
        if (text == null) return "";
        return text.toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private String saveDebugUtteranceWav(
            short[] pcmSamples,
            int totalSamples,
            String transcript,
            String rawTranscript,
            double rms,
            int durationMs,
            long whisperMs,
            double gainApplied,
            String droppedReason
    ) {
        if (!saveLast10Utterances || pcmSamples == null || totalSamples <= 0) {
            return "";
        }
        try {
            File dir = new File(context.getFilesDir(), "debug_utterances");
            if (!dir.exists()) {
                dir.mkdirs();
            }
            long ts = System.currentTimeMillis();
            String id = "utt_" + ts;
            File wavFile = new File(dir, id + ".wav");
            File metaFile = new File(dir, id + ".json");

            int dataBytes = totalSamples * 2;
            ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
            header.put("RIFF".getBytes(StandardCharsets.US_ASCII));
            header.putInt(36 + dataBytes);
            header.put("WAVE".getBytes(StandardCharsets.US_ASCII));
            header.put("fmt ".getBytes(StandardCharsets.US_ASCII));
            header.putInt(16); // PCM chunk size
            header.putShort((short) 1); // PCM format
            header.putShort((short) 1); // mono
            header.putInt(SAMPLE_RATE_HZ);
            header.putInt(SAMPLE_RATE_HZ * 2); // byte rate
            header.putShort((short) 2); // block align
            header.putShort((short) 16); // bits per sample
            header.put("data".getBytes(StandardCharsets.US_ASCII));
            header.putInt(dataBytes);

            byte[] pcmBytes = new byte[dataBytes];
            ByteBuffer.wrap(pcmBytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(pcmSamples, 0, totalSamples);

            try (FileOutputStream fos = new FileOutputStream(wavFile)) {
                fos.write(header.array());
                fos.write(pcmBytes);
                fos.flush();
            }

            org.json.JSONObject meta = new org.json.JSONObject();
            meta.put("id", id);
            meta.put("timestamp", ts);
            meta.put("transcript", transcript != null ? transcript : "");
            meta.put("rawTranscript", rawTranscript != null ? rawTranscript : "");
            meta.put("rms", rms);
            meta.put("durationMs", durationMs);
            meta.put("whisperMs", whisperMs);
            meta.put("gainApplied", gainApplied);
            meta.put("droppedReason", droppedReason != null ? droppedReason : "");
            try (FileOutputStream mfos = new FileOutputStream(metaFile)) {
                mfos.write(meta.toString().getBytes(StandardCharsets.UTF_8));
                mfos.flush();
            }

            // Keep only the last 10 utterances
            File[] wavFiles = dir.listFiles((d, name) -> name.endsWith(".wav"));
            if (wavFiles != null && wavFiles.length > MAX_DEBUG_UTTERANCE_FILES) {
                Arrays.sort(wavFiles, Comparator.comparingLong(File::lastModified));
                int toDelete = wavFiles.length - MAX_DEBUG_UTTERANCE_FILES;
                for (int i = 0; i < toDelete; i++) {
                    File oldWav = wavFiles[i];
                    String oldBase = oldWav.getName().replaceFirst("\\.wav$", "");
                    File oldMeta = new File(dir, oldBase + ".json");
                    oldWav.delete();
                    if (oldMeta.exists()) oldMeta.delete();
                }
            }
            return id;
        } catch (Throwable t) {
            Log.w(TAG, "Failed saving debug utterance WAV: " + t.getMessage());
            return "";
        }
    }

    private void runWhisperSttOnUtterance(List<short[]> frames, int durationMs, boolean fromBargeIn) {
        try {
            checkThermalState();
            int totalSamples = 0;
            for (short[] f : frames) totalSamples += f.length;
            int audioMs = (totalSamples * 1000) / SAMPLE_RATE_HZ;
            if (audioMs < STT_MIN_DURATION_MS || totalSamples < (SAMPLE_RATE_HZ * minUtteranceMs) / 1000) {
                isThinking.set(false);
                listener.onStatusChanged("listening", "utterance_too_short");
                listener.onDiagnosticLog(
                        0,
                        "STT:DroppedShort",
                        "Dropped utterance under " + STT_MIN_DURATION_MS + "ms (audioMs=" + audioMs + "ms, samples=" + totalSamples + ")"
                );
                listener.onDiagnosticLog(
                        0,
                        "LocalSTT:Skipped",
                        "Utterance too short (" + audioMs + "ms, " + totalSamples + " samples)"
                );
                return;
            }

            short[] pcmSamples = new short[totalSamples];
            int offset = 0;
            double sumSq = 0.0;
            int maxAbs = 0;
            for (short[] f : frames) {
                System.arraycopy(f, 0, pcmSamples, offset, f.length);
                offset += f.length;
                for (short s : f) {
                    double v = s / 32768.0;
                    sumSq += v * v;
                    int absVal = Math.abs((int) s);
                    if (absVal > maxAbs) maxAbs = absVal;
                }
            }

            double rms = Math.sqrt(sumSq / totalSamples);
            double peak = maxAbs / 32768.0;
            if (rms < STT_MIN_RMS_ENERGY) {
                isThinking.set(false);
                listener.onStatusChanged("listening", "skipped_silent_or_noise_utterance");
                listener.onDiagnosticLog(
                        0,
                        "STT:DroppedLowEnergy",
                        String.format(Locale.US, "rms=%.4f (< %.3f), duration=%dms", rms, STT_MIN_RMS_ENERGY, audioMs)
                );
                listener.onDiagnosticLog(
                        0,
                        "LocalSTT:Skipped",
                        String.format(Locale.US, "Skipped low-energy audio before Whisper (rms=%.4f < %.3f, duration=%dms)", rms, STT_MIN_RMS_ENERGY, audioMs)
                );
                return;
            }

            if (!sNativeJniLoaded || (!modelsLoaded && !whisperLoaded)) {
                isThinking.set(false);
                recordNativeError("WhisperSTT", "Native whisper.cpp engine is not loaded; cannot transcribe utterance.", false);
                return;
            }

            // g) Auto-gain: normalize utterance peak to ~0.5 before Whisper, capped at 12x
            double gainApplied = 1.0;
            short[] whisperInputPcm = pcmSamples;
            if (peak > 1e-6 && peak < AUTO_GAIN_TARGET_PEAK) {
                gainApplied = Math.min(AUTO_GAIN_MAX_FACTOR, AUTO_GAIN_TARGET_PEAK / peak);
                if (gainApplied > 1.01) {
                    whisperInputPcm = new short[totalSamples];
                    for (int i = 0; i < totalSamples; i++) {
                        double scaled = pcmSamples[i] * gainApplied;
                        if (scaled > 32767.0) scaled = 32767.0;
                        if (scaled < -32768.0) scaled = -32768.0;
                        whisperInputPcm[i] = (short) Math.round(scaled);
                    }
                } else {
                    gainApplied = 1.0;
                }
            }
            listener.onDiagnosticLog(
                    0,
                    "STT:AutoGain",
                    String.format(Locale.US, "gainApplied=%.2fx (rawPeak=%.4f, rms=%.4f, audioMs=%d)", gainApplied, peak, rms, audioMs)
            );

            String metricsRaw = nativeTranscribePcm16WithMetrics(whisperInputPcm, totalSamples, Math.min(4, this.inferenceThreads));
            if (metricsRaw == null || metricsRaw.startsWith("ERR|") || metricsRaw.startsWith("__ERROR__:")) {
                isThinking.set(false);
                String reason = metricsRaw == null
                        ? "whisper.cpp transcription failed."
                        : (metricsRaw.startsWith("ERR|") ? metricsRaw.substring(4) : metricsRaw.substring(10));
                recordNativeError("WhisperSTT", reason, false);
                return;
            }

            long whisperMs = 0L;
            double noSpeechProb = 0.0;
            double avgLogprob = 0.0;
            String rawTranscript = "";
            if (metricsRaw.startsWith("OK|")) {
                String[] parts = metricsRaw.split("\\|", 5);
                if (parts.length >= 5) {
                    try { whisperMs = Long.parseLong(parts[1]); } catch (NumberFormatException ignored) {}
                    try { noSpeechProb = Double.parseDouble(parts[2]); } catch (NumberFormatException ignored) {}
                    try { avgLogprob = Double.parseDouble(parts[3]); } catch (NumberFormatException ignored) {}
                    rawTranscript = parts[4];
                } else {
                    rawTranscript = metricsRaw;
                }
            } else {
                rawTranscript = metricsRaw;
            }

            listener.onDiagnosticLog(
                    0,
                    "STT:Metrics",
                    String.format(
                            Locale.US,
                            "audioMs=%d, whisperMs=%d, rms=%.4f, gainApplied=%.2fx, noSpeechProb=%.3f, avgLogprob=%.3f",
                            audioMs, whisperMs, rms, gainApplied, noSpeechProb, avgLogprob
                    )
            );

            // f) Drop low-confidence results (high no_speech_prob or very low avg_logprob)
            if (noSpeechProb > WHISPER_MAX_NO_SPEECH_PROB || avgLogprob < WHISPER_MIN_AVG_LOGPROB) {
                isThinking.set(false);
                saveDebugUtteranceWav(pcmSamples, totalSamples, rawTranscript, rawTranscript, rms, audioMs, whisperMs, gainApplied, "low_confidence");
                listener.onStatusChanged("listening", "dropped_low_confidence_stt");
                listener.onDiagnosticLog(
                        0,
                        "STT:DroppedLowConfidence",
                        String.format(
                                Locale.US,
                                "noSpeechProb=%.3f (>%.2f) or avgLogprob=%.3f (<%.2f), rms=%.4f, audioMs=%d, whisperMs=%d, raw=\"%s\"",
                                noSpeechProb, WHISPER_MAX_NO_SPEECH_PROB, avgLogprob, WHISPER_MIN_AVG_LOGPROB,
                                rms, audioMs, whisperMs, sanitizePieceForLog(rawTranscript)
                        )
                );
                return;
            }

            if (isWhisperNoiseOrBlank(rawTranscript)) {
                isThinking.set(false);
                listener.onStatusChanged("listening", "skipped_blank_or_noise_transcript");
                listener.onDiagnosticLog(
                        0,
                        "LocalSTT:Skipped",
                        "Whisper returned blank/noise transcript: \"" + sanitizePieceForLog(rawTranscript) + "\""
                );
                return;
            }

            String cleanedTranscript = cleanWhisperTranscript(rawTranscript);
            if (cleanedTranscript.isEmpty()) {
                isThinking.set(false);
                listener.onStatusChanged("listening", "skipped_empty_transcript");
                listener.onDiagnosticLog(
                        0,
                        "LocalSTT:Skipped",
                        "Cleaned Whisper transcript was empty (raw=\"" + sanitizePieceForLog(rawTranscript) + "\")"
                );
                return;
            }

            // b) Phantom blocklist check (case-insensitive, punctuation-stripped)
            String normalizedPhantom = normalizePhantomPhrase(cleanedTranscript);
            if (STT_PHANTOM_BLOCKLIST.contains(normalizedPhantom)
                    && (rms < STT_PHANTOM_MAX_RMS || audioMs < STT_PHANTOM_MAX_DURATION_MS)) {
                isThinking.set(false);
                saveDebugUtteranceWav(pcmSamples, totalSamples, cleanedTranscript, rawTranscript, rms, audioMs, whisperMs, gainApplied, "phantom");
                listener.onStatusChanged("listening", "dropped_phantom_stt");
                listener.onDiagnosticLog(
                        0,
                        "STT:DroppedPhantom",
                        String.format(
                                Locale.US,
                                "phrase=\"%s\", rms=%.4f, audioMs=%d, whisperMs=%d",
                                normalizedPhantom, rms, audioMs, whisperMs
                        )
                );
                return;
            }

            String debugUttId = saveDebugUtteranceWav(
                    pcmSamples, totalSamples, cleanedTranscript, rawTranscript,
                    rms, audioMs, whisperMs, gainApplied, ""
            );

            listener.onDiagnosticLog(
                    0,
                    "LocalSTT:Committed",
                    String.format(
                            Locale.US,
                            "Whisper transcript ready (audioMs=%dms, whisperMs=%dms, rms=%.4f, gain=%.2fx, noSpeech=%.3f, logprob=%.3f): \"%s\"",
                            audioMs, whisperMs, rms, gainApplied, noSpeechProb, avgLogprob, sanitizePieceForLog(cleanedTranscript)
                    )
            );
            listener.onTranscriptCommitted(
                    cleanedTranscript,
                    audioMs,
                    fromBargeIn,
                    rawTranscript,
                    audioMs,
                    whisperMs,
                    rms,
                    gainApplied,
                    noSpeechProb,
                    avgLogprob,
                    debugUttId
            );
        } catch (OutOfMemoryError oom) {
            isThinking.set(false);
            recordNativeError("WhisperSTT", "Out of memory during Whisper transcription. Switch to tiny.en in Settings.", true);
        } catch (Throwable t) {
            isThinking.set(false);
            recordNativeError("WhisperSTT", "Whisper transcription error: " + t.getMessage(), false);
        }
    }

    private String sanitizePieceForLog(String piece) {
        if (piece == null) return "";
        return piece.replace("\n", "\\n").replace("\r", "\\r");
    }

    /**
     * Called directly from JNI (`nativeGenerateStream`) on each generated token piece.
     * Resets the progress-based stall detector and logs the first 3 calls per turn, then every 20th.
     */
    @SuppressWarnings("unused")
    public void onNativeToken(int turnId, String tokenPiece) {
        lastProgressTimestampMs.set(System.currentTimeMillis());
        inTokenGenPhaseForTurn.set(true);
        firstTokenReceivedForTurn.set(true);
        if (llmCancelRequested.get() || turnId != activeTurnId.get()) {
            return;
        }
        if (tokenPiece != null && !tokenPiece.isEmpty()) {
            int count = currentTurnTokenCount.incrementAndGet();
            if (count <= 3 || count % 20 == 0) {
                listener.onDiagnosticLog(
                        turnId,
                        "LocalLLM:TokenSample",
                        "[Turn #" + turnId + " token #" + count + "] piece=\"" + sanitizePieceForLog(tokenPiece) + "\""
                );
            }
            listener.onTokenStream(turnId, tokenPiece);
        }
    }

    /**
     * Called directly from JNI (`nativeGenerateStream`) to surface stage and batch timing diagnostics
     * into the in-app debug console and reset the progress-based stall detector on every completed batch.
     */
    @SuppressWarnings("unused")
    public void onNativeDiagnostic(int turnId, String stage, String detail) {
        lastProgressTimestampMs.set(System.currentTimeMillis());
        if ("PromptEvalDone".equals(stage) || "FirstToken".equals(stage)) {
            inTokenGenPhaseForTurn.set(true);
        }
        String cat = "LocalLLM:" + (stage != null ? stage : "Diag");
        listener.onDiagnosticLog(turnId, cat, "[Turn #" + turnId + "] " + (detail != null ? detail : ""));
    }

    /**
     * Runs real llama.cpp streaming inference with a progress-based stall detector:
     * - Resets on every completed prompt batch (`BatchEval`) and every generated token (`onNativeToken`).
     * - Stalls ONLY after 45s with no progress during prompt eval, or 20s with no progress during token generation.
     * - Waits on `activeTurnLock` so any prior cancelled turn completely finishes before the next turn starts.
     */
    public LlmGenerationResult generateReplyStream(int turnId, String prompt, int maxTokens) throws Exception {
        if (!sNativeJniLoaded || !modelsLoaded) {
            String msg = "Native llama.cpp model is not loaded. Cannot generate reply.";
            recordNativeError("LLM", msg, false);
            throw new IllegalStateException(msg);
        }
        checkThermalState();

        // Wait for any previously cancelled turn to completely exit JNI before starting the new turn
        activeTurnLock.lock();
        try {
            activeTurnId.set(turnId);
            llmCancelRequested.set(false);
            firstTokenReceivedForTurn.set(false);
            inTokenGenPhaseForTurn.set(false);
            stallTriggeredForTurn.set(false);
            currentTurnTokenCount.set(0);
            lastProgressTimestampMs.set(System.currentTimeMillis());
            this.lastNativeError = "";
            isThinking.set(true);

            // Periodic progress-based stall detector (checks every 1s)
            ScheduledFuture<?> watchdogFuture = watchdogExecutor.scheduleAtFixedRate(() -> {
                if (activeTurnId.get() != turnId || stallTriggeredForTurn.get() || llmCancelRequested.get()) {
                    return;
                }
                long elapsedSinceProgress = System.currentTimeMillis() - lastProgressTimestampMs.get();
                boolean inTokenPhase = inTokenGenPhaseForTurn.get() || firstTokenReceivedForTurn.get();
                long timeoutMs = inTokenPhase ? TOKEN_GEN_STALL_TIMEOUT_MS : PROMPT_EVAL_STALL_TIMEOUT_MS;

                if (elapsedSinceProgress >= timeoutMs) {
                    stallTriggeredForTurn.set(true);
                    String lastStage = "unknown";
                    try {
                        if (sNativeJniLoaded) {
                            lastStage = nativeGetGenerationStage();
                        }
                    } catch (Throwable ignored) {}
                    String phaseDesc = inTokenPhase ? "token generation" : "prompt evaluation";
                    String stallMsg = "No progress for " + (elapsedSinceProgress / 1000)
                            + "s during " + phaseDesc + " on turn #" + turnId
                            + " (limit " + (timeoutMs / 1000) + "s, last stage: \"" + lastStage + "\"). Cancelling turn.";
                    llmCancelRequested.set(true);
                    try {
                        nativeCancelLlm();
                    } catch (Throwable ignored) {}
                    listener.onDiagnosticLog(turnId, "LocalLLM:Stall", stallMsg);
                    recordNativeError("LocalLLM:Stall", stallMsg, false);
                }
            }, 1000L, 1000L, TimeUnit.MILLISECONDS);

            try {
                String raw = nativeGenerateStream(turnId, prompt, maxTokens, this);
                if (stallTriggeredForTurn.get()) {
                    String stallErr = this.lastNativeError != null && !this.lastNativeError.isEmpty()
                            ? this.lastNativeError
                            : "LLM generation stalled due to lack of batch/token progress.";
                    throw new IllegalStateException(stallErr);
                }
                if (raw == null || !raw.startsWith("OK|")) {
                    String errReason = (raw != null && raw.startsWith("ERR|"))
                            ? raw.substring(4)
                            : ("llama.cpp nativeGenerateStream returned unexpected value: " + (raw == null ? "null" : raw));
                    recordNativeError("LLM", errReason, false);
                    throw new IllegalStateException(errReason);
                }

                String[] parts = raw.split("\\|", 12);
                if (parts.length < 8) {
                    String errReason = "Malformed response from nativeGenerateStream: " + raw;
                    recordNativeError("LLM", errReason, false);
                    throw new IllegalStateException(errReason);
                }

                double tokPerSec = Double.parseDouble(parts[1]);
                long ttftMs = Long.parseLong(parts[2]);
                long totalMs = Long.parseLong(parts[3]);
                int genTokens = Integer.parseInt(parts[4]);
                boolean wasInterrupted = "1".equals(parts[5]) || llmCancelRequested.get();
                String stopReason = parts[6];
                String replyText = parts[7];
                int promptTokens = parts.length > 8 ? Integer.parseInt(parts[8]) : 0;
                int cachedTokensReused = parts.length > 9 ? Integer.parseInt(parts[9]) : 0;
                long promptEvalMs = parts.length > 10 ? Long.parseLong(parts[10]) : 0L;
                double promptTokPerSec = parts.length > 11 ? Double.parseDouble(parts[11]) : 0.0;

                if (!wasInterrupted && (replyText == null || replyText.trim().isEmpty())) {
                    String emptyMsg = "LLM generated 0 usable text characters (stopReason=" + stopReason
                            + ", generatedTokens=" + genTokens + ").";
                    recordNativeError("LLM", emptyMsg, false);
                    throw new IllegalStateException(emptyMsg);
                }

                recordTurnTelemetry(tokPerSec, ttftMs, totalMs);
                listener.onTurnMetrics(turnId, tokPerSec, ttftMs, totalMs);

                return new LlmGenerationResult(
                        replyText,
                        tokPerSec,
                        ttftMs,
                        totalMs,
                        genTokens,
                        wasInterrupted,
                        stopReason,
                        promptTokens,
                        cachedTokensReused,
                        promptEvalMs,
                        promptTokPerSec
                );
            } catch (OutOfMemoryError oom) {
                String oomMsg = "Out of memory during LLM generation: " + (oom.getMessage() != null ? oom.getMessage() : "OOM");
                recordNativeError("LLM", oomMsg, true);
                throw oom;
            } catch (Exception e) {
                if (this.lastNativeError == null || this.lastNativeError.isEmpty()) {
                    recordNativeError("LLM", e.getMessage() != null ? e.getMessage() : e.toString(), false);
                }
                throw e;
            } finally {
                watchdogFuture.cancel(false);
                isThinking.set(false);
            }
        } finally {
            activeTurnLock.unlock();
        }
    }

    public void setSpeakingState(boolean speaking, int turnId) {
        setSpeakingState(speaking, turnId, null);
    }

    public void setSpeakingState(boolean speaking, int turnId, Boolean thinking) {
        if (turnId > 0 && speaking) {
            activeTurnId.set(turnId);
        }
        boolean wasSpeaking = this.isSpeaking.getAndSet(speaking);
        if (speaking) {
            this.isThinking.set(false);
        } else {
            if (wasSpeaking) {
                this.lastPlaybackEndTimestampMs = System.currentTimeMillis();
            }
            if (thinking != null && !thinking) {
                this.isThinking.set(false);
                if (sessionActive.get()) {
                    listener.onStatusChanged("listening", "turn_ready");
                }
            }
        }
    }

    private void releaseAudioHardware() {
        if (echoCanceler != null) {
            try {
                echoCanceler.release();
            } catch (Throwable ignored) {}
            echoCanceler = null;
        }
        if (noiseSuppressor != null) {
            try {
                noiseSuppressor.release();
            } catch (Throwable ignored) {}
            noiseSuppressor = null;
        }
        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (Throwable ignored) {}
            try {
                audioRecord.release();
            } catch (Throwable ignored) {}
            audioRecord = null;
        }
        restoreAudioMode();
    }

    public String getThermalStatusString() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                int status = pm.getCurrentThermalStatus();
                switch (status) {
                    case PowerManager.THERMAL_STATUS_NONE:
                        return "none";
                    case PowerManager.THERMAL_STATUS_LIGHT:
                        return "light";
                    case PowerManager.THERMAL_STATUS_MODERATE:
                        return "moderate";
                    case PowerManager.THERMAL_STATUS_SEVERE:
                        return "severe";
                    case PowerManager.THERMAL_STATUS_CRITICAL:
                    case PowerManager.THERMAL_STATUS_EMERGENCY:
                    case PowerManager.THERMAL_STATUS_SHUTDOWN:
                        return "critical";
                }
            }
        }
        return "none";
    }

    private void checkThermalState() {
        String status = getThermalStatusString();
        if ("severe".equals(status) || "critical".equals(status)) {
            listener.onThermalWarning(
                    status,
                    "Device thermal throttling detected (" + status + "). Consider switching to the Small (1.5B Q4) model in Settings to reduce heat."
            );
        }
    }

    public boolean isModelsLoaded() {
        return modelsLoaded;
    }

    public String getLoadedLlmFilename() {
        return loadedLlmFile != null ? loadedLlmFile.getName() : "";
    }

    public String getLoadedWhisperFilename() {
        return loadedWhisperFile != null ? loadedWhisperFile.getName() : "";
    }

    public String getActiveTtsEngine() {
        return activeTtsEngine;
    }

    public int getInferenceThreads() {
        return inferenceThreads;
    }

    public String getLastNativeError() {
        if (sNativeJniLoaded) {
            try {
                String jniErr = nativeGetLastError();
                if (jniErr != null && !jniErr.isEmpty() && (lastNativeError == null || lastNativeError.isEmpty())) {
                    return jniErr;
                }
            } catch (Throwable ignored) {}
        }
        return lastNativeError != null ? lastNativeError : "";
    }

    public String getLastSelfTestText() {
        return lastSelfTestText;
    }

    public double getLastSelfTestTokensPerSec() {
        return lastSelfTestTokensPerSec;
    }

    public long getLastSelfTestElapsedMs() {
        return lastSelfTestElapsedMs;
    }

    public double getLastTokensPerSec() {
        return lastTokensPerSec;
    }

    public long getLastTimeToFirstAudioMs() {
        return lastTimeToFirstAudioMs;
    }

    public long getLastTurnLatencyMs() {
        return lastTurnLatencyMs;
    }

    public void recordTurnTelemetry(double tokensPerSec, long ttfaMs, long totalLatencyMs) {
        this.lastTokensPerSec = tokensPerSec;
        this.lastTimeToFirstAudioMs = ttfaMs;
        this.lastTurnLatencyMs = totalLatencyMs;
    }
}
