# Local (On-Phone) Offline Live Voice Provider

This document describes the architecture, verified model catalog, audio/VAD/STT/LLM/TTS pipeline, barge-in state machine, download manager, and engineering assumptions for the fully offline **Local (on-phone)** Live voice provider in **Project Sierra (OmniAgent)**.

---

## Assumptions

1. **Target Hardware & Graceful Scaling**:
   - Optimized for **Samsung Galaxy S25 Ultra** (Snapdragon 8 Elite, 12 GB RAM, Android 15) using 6–8 CPU inference threads, `mmap`-backed GGUF weights, and NNAPI/XNNPACK acceleration via ONNX Runtime.
   - Lower-end Android devices (6–8 GB RAM) are supported via the **Small (1.5B Q4_K_M)** LLM preset, **Whisper `tiny.en`** STT option, and automatic OOM/thermal downgrade prompts.
2. **Verified Uncensored / Abliterated GGUF LLM Catalog**:
   - All three built-in presets were verified against the Hugging Face Model Tree API (`https://huggingface.co/api/models/<repo>/tree/main`) for exact LFS SHA-256 (`lfs.oid`) and byte size (`lfs.size`), and via HTTP `HEAD` on the `resolve/main` URLs:
     - **Small (1.5B Q4_K_M)**:
       - **Repository**: `https://huggingface.co/mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF` (quantized from `huihui-ai/Qwen2.5-1.5B-Instruct-abliterated`)
       - **Filename**: `Qwen2.5-1.5B-Instruct-abliterated.Q4_K_M.gguf`
       - **Download URL**: `https://huggingface.co/mradermacher/Qwen2.5-1.5B-Instruct-abliterated-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-abliterated.Q4_K_M.gguf`
       - **Size**: `986,049,088` bytes (~940.4 MB)
       - **SHA-256**: `59aa9f44bde5349dbe292d7024d197db605f422b8baf65f3246a59abbde4e8e9`
       - **License**: Apache-2.0
       - **Chat Template**: ChatML (`<|im_start|>system\n...\n<|im_end|>`)
     - **Default (3B Q4_K_M)**:
       - **Repository**: `https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF`
       - **Filename**: `Llama-3.2-3B-Instruct-uncensored-Q4_K_M.gguf`
       - **Download URL**: `https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-uncensored-GGUF/resolve/main/Llama-3.2-3B-Instruct-uncensored-Q4_K_M.gguf`
       - **Size**: `2,241,003,904` bytes (~2.09 GiB / 2.24 GB)
       - **SHA-256**: `80f532552e3d56e366226f428395de8285a671f2da1d5fd68563741181b77a95`
       - **License**: Llama 3.2 Community License
       - **Chat Template**: Llama 3 (`<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n...<|eot_id|>`)
     - **Large (8B Q4_K_M — with Speed & Heat Warning)**:
       - **Repository**: `https://huggingface.co/bartowski/Dolphin3.0-Llama3.1-8B-GGUF` (Cognitive Computations Dolphin 3.0 on Llama 3.1 8B)
       - **Filename**: `Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf`
       - **Download URL**: `https://huggingface.co/bartowski/Dolphin3.0-Llama3.1-8B-GGUF/resolve/main/Dolphin3.0-Llama3.1-8B-Q4_K_M.gguf`
       - **Size**: `4,920,749,472` bytes (~4.58 GiB / 4.92 GB)
       - **SHA-256**: `268390e07edd407ad93ea21a868b7ae995b5950e01cad0db9e1802ae5049d405`
       - **License**: Llama 3.1 Community License
       - **Chat Template**: ChatML (`<|im_start|>system\n...\n<|im_end|>`)
     - **Custom GGUF URL**: Users can paste any direct `.gguf` URL and select either `chatml` or `llama3` chat formatting (`sha256: null`, verified by exact byte size with `"checksum unverified"` logged).
3. **Verified Whisper STT Models (`whisper.cpp` GGML format)**:
   - Hosted at `https://huggingface.co/ggerganov/whisper.cpp` (MIT License), verified against `https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main`:
     - **Default (`base.en`)**:
       - **Filename**: `ggml-base.en.bin`
       - **Download URL**: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`
       - **Size**: `147,964,211` bytes (~141.1 MB)
       - **SHA-256**: `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002`
     - **Fast Option (`tiny.en`)**:
       - **Filename**: `ggml-tiny.en.bin`
       - **Download URL**: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin`
       - **Size**: `77,704,715` bytes (~74.1 MB)
       - **SHA-256**: `921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f`
   - Runs once per finished utterance on a background worker thread; never emits fake word-by-word streaming or partial transcripts.
4. **Verified Silero VAD Model (ONNX Runtime)**:
   - **Repository**: `https://huggingface.co/onnx-community/silero-vad` (MIT License), verified against `https://huggingface.co/api/models/onnx-community/silero-vad/tree/main/onnx`
   - **Filename**: `silero_vad.onnx` (from `onnx/model.onnx`)
   - **Download URL**: `https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx`
   - **Size**: `2,243,022` bytes (~2.14 MB)
   - **SHA-256**: `a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808`
   - Executed via `com.microsoft.onnxruntime:onnxruntime-android:1.20.0` on 16 kHz mono PCM frames (512 samples / 32 ms per frame), combined with zero-crossing rate and spectral energy gating for fast acoustic echo resistance.
5. **Verified Piper TTS Voice & Swappable TTS Interface**:
   - **Repository**: `https://huggingface.co/rhasspy/piper-voices` (MIT License), verified against `https://huggingface.co/api/models/rhasspy/piper-voices/tree/main/en/en_US/lessac/medium`
   - **Voice Model Filename**: `en_US-lessac-medium.onnx`
   - **Download URL**: `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx`
   - **Size**: `63,201,294` bytes (~60.3 MB)
   - **SHA-256**: `5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f`
   - **Companion Config**: `en_US-lessac-medium.onnx.json` (`4,885` bytes, SHA-256 `efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0`)
   - **Active TTS Playback & Honest Reporting**: Because standalone Piper VITS `.onnx` synthesis requires `espeak-ng` phonemization dictionary data that is not bundled in the APK, runtime speech synthesis uses Android's built-in offline `TextToSpeech` (`android_tts`), and both `LocalVoicePlugin.loadModels` / `startLocalSession` and the debug log (`LocalVoice:SessionActive`, `LocalTTS:SentenceStart`, `LocalTTS:Speak`) honestly report `TTS=android_tts` (never `TTS=piper` when Android TTS is speaking).
6. **Pinned Native JNI Inference Engines (`arm64-v8a`, `-O3 -DNDEBUG`)**:
   - **LLM Runtime (`llama.cpp`)**: Pinned to tag `b4415` (`https://github.com/ggerganov/llama.cpp.git`) in `android/app/src/main/cpp/CMakeLists.txt`. Compiled with `-O3 -DNDEBUG` across all build types and linked into `libsierra_local_voice_jni.so`. Loads the downloaded `.gguf` via `llama_load_model_from_file`, runs a real 3-token startup self-test (`nativeRunSelfTest`), and streams real generated token pieces via `nativeGenerateStream` -> `LocalVoiceEngine.onNativeToken`.
   - **STT Runtime (`whisper.cpp`)**: Pinned to tag `v1.7.4` (`https://github.com/ggerganov/whisper.cpp.git`) in `android/app/src/main/cpp/CMakeLists.txt` (shares the exact same `ggml` version as `llama.cpp` `b4415`). Loads `ggml-base.en.bin` / `ggml-tiny.en.bin` via `whisper_init_from_file_with_params` and transcribes committed 16 kHz PCM16 utterances via `whisper_full` in `nativeTranscribePcm16`.
   - **No Simulation Policy**: If `libsierra_local_voice_jni.so` fails to load or either native model fails to initialize, `LocalVoiceEngine` transitions to `error` with a clear diagnostic message and never falls back to canned or simulated text.
7. **Checksum Verification & Quarantine Behavior**:
   - Entries with a confirmed 64-character SHA-256 are verified after download. On mismatch, the full expected and actual SHA-256 hashes are displayed in the UI error and recorded in the persistent debug log, and the file is renamed to `<filename>.bad` (never deleted automatically, and never loaded by `LocalVoiceEngine`).
   - Entries with `sha256: null` are verified by exact byte size and log a `"checksum unverified"` warning to the debug log instead of failing the download.
8. **Zero Bundled Models in APK**:
   - No `.gguf`, `.bin`, or `.onnx` weights are bundled in `assets/` or `res/raw/`. All weights download on demand into `context.getFilesDir()/local_voice_models/` with HTTP `Range` resume and SHA-256 verification.

