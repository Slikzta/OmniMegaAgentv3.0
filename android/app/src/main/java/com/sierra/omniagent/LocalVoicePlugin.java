package com.sierra.omniagent;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
        name = "SierraLocalVoice",
        permissions = {
                @Permission(
                        alias = "microphone",
                        strings = { Manifest.permission.RECORD_AUDIO }
                )
        }
)
public class LocalVoicePlugin extends Plugin implements LocalVoiceEngine.EngineEventListener {
    private static final String TAG = "SierraLocalVoicePlugin";
    private static final String MODELS_DIR_NAME = "local_voice_models";
    private static final long BACKGROUND_UNLOAD_DELAY_MS = 5 * 60 * 1000L; // 5 minutes

    private LocalVoiceEngine engine;
    private final ExecutorService downloadExecutor = Executors.newCachedThreadPool();
    private final ExecutorService playbackExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "SierraAudioTrackPlaybackThread");
        t.setPriority(Thread.NORM_PRIORITY + 1);
        return t;
    });
    private final Map<String, AtomicBoolean> activeDownloadPauseFlags = new ConcurrentHashMap<>();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable backgroundUnloadRunnable;
    private volatile boolean localSessionRunning = false;

    @Override
    public void load() {
        super.load();
        engine = new LocalVoiceEngine(getContext(), this);
    }

    private File getModelsDir() {
        File dir = new File(getContext().getFilesDir(), MODELS_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // If no active local voice session is running, schedule unloading models after extended backgrounding to free RAM
        if (!localSessionRunning && engine != null && engine.isModelsLoaded()) {
            if (backgroundUnloadRunnable != null) {
                mainHandler.removeCallbacks(backgroundUnloadRunnable);
            }
            backgroundUnloadRunnable = () -> {
                if (!localSessionRunning && engine != null && engine.isModelsLoaded()) {
                    Log.i(TAG, "Unloading local voice models after extended app backgrounding to free RAM");
                    engine.unloadModels();
                    JSObject evt = new JSObject();
                    evt.put("status", "idle");
                    evt.put("detail", "models_unloaded_after_background_timeout");
                    notifyListeners("localVoiceStatus", evt, true);
                }
            };
            mainHandler.postDelayed(backgroundUnloadRunnable, BACKGROUND_UNLOAD_DELAY_MS);
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (backgroundUnloadRunnable != null) {
            mainHandler.removeCallbacks(backgroundUnloadRunnable);
            backgroundUnloadRunnable = null;
        }
    }

    @PluginMethod
    public void getStorageAndNetworkStatus(PluginCall call) {
        try {
            File filesDir = getContext().getFilesDir();
            StatFs statFs = new StatFs(filesDir.getAbsolutePath());
            long freeBytes = statFs.getAvailableBytes();
            long totalBytes = statFs.getTotalBytes();

            boolean isWifi = false;
            boolean isConnected = false;
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                Network activeNet = cm.getActiveNetwork();
                if (activeNet != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(activeNet);
                    if (caps != null) {
                        isConnected = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                        isWifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                                || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
                    }
                }
            }

            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            if (am != null) {
                am.getMemoryInfo(mi);
            }
            long availRamMb = mi.availMem / (1024 * 1024);
            long totalRamMb = mi.totalMem / (1024 * 1024);
            long usedRamMb = Math.max(0, totalRamMb - availRamMb);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("isWifi", isWifi);
            res.put("isConnected", isConnected);
            res.put("freeStorageBytes", freeBytes);
            res.put("totalStorageBytes", totalBytes);
            res.put("availableRamMb", availRamMb);
            res.put("totalRamMb", totalRamMb);
            res.put("usedRamMb", usedRamMb);
            res.put("cpuCores", Runtime.getRuntime().availableProcessors());
            res.put("thermalStatus", engine != null ? engine.getThermalStatusString() : "none");
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage());
            call.resolve(err);
        }
    }

    @PluginMethod
    public void getModelsStatus(PluginCall call) {
        JSArray modelsArr = call.getArray("models", new JSArray());
        File dir = getModelsDir();
        JSObject modelsOut = new JSObject();

        try {
            for (int i = 0; i < modelsArr.length(); i++) {
                JSONObject item = modelsArr.getJSONObject(i);
                String id = item.optString("id", "");
                String filename = item.optString("filename", "");
                long expectedSize = item.optLong("sizeBytes", 0L);
                if (id.isEmpty() || filename.isEmpty()) continue;

                File finalFile = new File(dir, filename);
                File partFile = new File(dir, filename + ".part");
                File badFile = new File(dir, filename + ".bad");
                boolean downloaded = !filename.endsWith(".bad") && finalFile.exists() && finalFile.length() > 0;
                long partialBytes = downloaded ? finalFile.length() : (partFile.exists() ? partFile.length() : 0L);

                JSObject st = new JSObject();
                st.put("id", id);
                st.put("filename", filename);
                st.put("downloaded", downloaded);
                st.put("partialBytes", partialBytes);
                st.put("sizeBytes", downloaded ? finalFile.length() : expectedSize);
                st.put("hasBadFile", badFile.exists());
                if (downloaded) {
                    st.put("path", finalFile.getAbsolutePath());
                }
                modelsOut.put(id, st);
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("models", modelsOut);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage());
            call.resolve(err);
        }
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        final String modelId = call.getString("modelId", "").trim();
        final String filename = call.getString("filename", "").trim();
        final String downloadUrl = call.getString("downloadUrl", "").trim();
        final long expectedSizeBytes = call.getLong("expectedSizeBytes", 0L) != null ? call.getLong("expectedSizeBytes", 0L) : 0L;
        final String rawSha = call.getString("expectedSha256", "");
        final String expectedSha256 = rawSha != null ? rawSha.trim().toLowerCase(Locale.ROOT) : "";

        if (modelId.isEmpty() || filename.isEmpty() || downloadUrl.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "modelId, filename, and downloadUrl are required.");
            call.resolve(err);
            return;
        }

        final AtomicBoolean pauseFlag = new AtomicBoolean(false);
        activeDownloadPauseFlags.put(modelId, pauseFlag);

        downloadExecutor.submit(() -> {
            File dir = getModelsDir();
            File finalFile = new File(dir, filename);
            File partFile = new File(dir, filename + ".part");
            File badFile = new File(dir, filename + ".bad");

            try {
                // If already downloaded and checksum/size matches, return immediately
                if (finalFile.exists() && finalFile.length() > 0) {
                    if (expectedSha256.length() == 64) {
                        String existingSha = computeFileSha256(finalFile);
                        if (existingSha.equalsIgnoreCase(expectedSha256)) {
                            JSObject done = new JSObject();
                            done.put("ok", true);
                            done.put("modelId", modelId);
                            done.put("state", "downloaded");
                            done.put("downloadedBytes", finalFile.length());
                            done.put("sha256Verified", true);
                            done.put("checksumUnverified", false);
                            done.put("path", finalFile.getAbsolutePath());
                            call.resolve(done);
                            return;
                        } else {
                            if (badFile.exists()) {
                                badFile.delete();
                            }
                            finalFile.renameTo(badFile);
                        }
                    } else if (expectedSizeBytes <= 0 || finalFile.length() == expectedSizeBytes) {
                        Log.w(TAG, "checksum unverified for existing " + filename + " (verified by byte size: " + finalFile.length() + ")");
                        JSObject done = new JSObject();
                        done.put("ok", true);
                        done.put("modelId", modelId);
                        done.put("state", "downloaded");
                        done.put("downloadedBytes", finalFile.length());
                        done.put("sha256Verified", false);
                        done.put("checksumUnverified", true);
                        done.put("path", finalFile.getAbsolutePath());
                        call.resolve(done);
                        return;
                    } else {
                        if (badFile.exists()) {
                            badFile.delete();
                        }
                        finalFile.renameTo(badFile);
                    }
                }

                long existingBytes = partFile.exists() ? partFile.length() : 0L;
                HttpURLConnection conn = (HttpURLConnection) new URL(downloadUrl).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("User-Agent", "SierraOmniAgent/2.9 (Android)");
                conn.setRequestProperty("Accept-Encoding", "identity");
                if (existingBytes > 0) {
                    conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
                }

                int status = conn.getResponseCode();
                boolean appendMode = (status == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0);
                if (!appendMode) {
                    existingBytes = 0L;
                }

                if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
                    throw new Exception("HTTP " + status + " from " + downloadUrl);
                }

                long contentLength = conn.getContentLengthLong();
                long totalBytes = contentLength > 0 ? (existingBytes + contentLength) : expectedSizeBytes;

                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(partFile, appendMode)) {
                    byte[] buffer = new byte[64 * 1024];
                    long downloaded = existingBytes;
                    long lastEmitMs = 0L;
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (pauseFlag.get()) {
                            out.flush();
                            JSObject paused = new JSObject();
                            paused.put("ok", true);
                            paused.put("modelId", modelId);
                            paused.put("state", "paused");
                            paused.put("downloadedBytes", downloaded);
                            paused.put("sha256Verified", false);
                            call.resolve(paused);
                            return;
                        }
                        out.write(buffer, 0, read);
                        downloaded += read;

                        long now = System.currentTimeMillis();
                        if (now - lastEmitMs >= 150 || downloaded == totalBytes) {
                            lastEmitMs = now;
                            JSObject prog = new JSObject();
                            prog.put("modelId", modelId);
                            prog.put("filename", filename);
                            prog.put("downloadedBytes", downloaded);
                            prog.put("totalBytes", totalBytes > 0 ? totalBytes : expectedSizeBytes);
                            prog.put("state", "downloading");
                            notifyListeners("localDownloadProgress", prog, true);
                        }
                    }
                    out.flush();
                }

                // Verify SHA-256 checksum if expectedSha256 is provided (64 hex chars);
                // otherwise verify by exact byte size only and log "checksum unverified".
                boolean sha256Verified = false;
                boolean checksumUnverified = false;
                if (expectedSha256.length() == 64) {
                    String actualSha256 = computeFileSha256(partFile);
                    if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
                        if (badFile.exists()) {
                            badFile.delete();
                        }
                        partFile.renameTo(badFile);
                        String fullReason = "SHA-256 checksum mismatch for " + filename
                                + ": expected " + expectedSha256
                                + ", got " + actualSha256
                                + " (kept as " + badFile.getName() + ")";
                        Log.e(TAG, fullReason);
                        JSObject mismatch = new JSObject();
                        mismatch.put("ok", false);
                        mismatch.put("modelId", modelId);
                        mismatch.put("state", "error");
                        mismatch.put("downloadedBytes", 0);
                        mismatch.put("sha256Verified", false);
                        mismatch.put("expectedSha256", expectedSha256);
                        mismatch.put("actualSha256", actualSha256);
                        mismatch.put("badFilePath", badFile.getAbsolutePath());
                        mismatch.put("reason", fullReason);
                        call.resolve(mismatch);
                        return;
                    }
                    sha256Verified = true;
                } else {
                    long actualLen = partFile.length();
                    if (expectedSizeBytes > 0 && actualLen != expectedSizeBytes) {
                        if (badFile.exists()) {
                            badFile.delete();
                        }
                        partFile.renameTo(badFile);
                        String sizeReason = "Exact byte size mismatch for " + filename
                                + ": expected " + expectedSizeBytes
                                + " bytes, got " + actualLen
                                + " bytes (kept as " + badFile.getName() + ")";
                        Log.e(TAG, sizeReason);
                        JSObject sizeMismatch = new JSObject();
                        sizeMismatch.put("ok", false);
                        sizeMismatch.put("modelId", modelId);
                        sizeMismatch.put("state", "error");
                        sizeMismatch.put("downloadedBytes", 0);
                        sizeMismatch.put("sha256Verified", false);
                        sizeMismatch.put("checksumUnverified", true);
                        sizeMismatch.put("badFilePath", badFile.getAbsolutePath());
                        sizeMismatch.put("reason", sizeReason);
                        call.resolve(sizeMismatch);
                        return;
                    }
                    checksumUnverified = true;
                    Log.w(TAG, "checksum unverified for " + filename + " (verified by exact byte size: " + actualLen + " bytes)");
                }

                if (finalFile.exists()) {
                    finalFile.delete();
                }
                if (!partFile.renameTo(finalFile)) {
                    throw new Exception("Failed to finalize model file " + finalFile.getName());
                }

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("modelId", modelId);
                res.put("state", "downloaded");
                res.put("downloadedBytes", finalFile.length());
                res.put("sha256Verified", sha256Verified);
                res.put("checksumUnverified", checksumUnverified);
                res.put("path", finalFile.getAbsolutePath());
                call.resolve(res);
            } catch (Exception e) {
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("modelId", modelId);
                err.put("state", "error");
                err.put("downloadedBytes", partFile.exists() ? partFile.length() : 0L);
                err.put("sha256Verified", false);
                err.put("reason", e.getMessage());
                call.resolve(err);
            } finally {
                activeDownloadPauseFlags.remove(modelId);
            }
        });
    }

    @PluginMethod
    public void pauseDownload(PluginCall call) {
        String modelId = call.getString("modelId", "").trim();
        AtomicBoolean flag = activeDownloadPauseFlags.get(modelId);
        if (flag != null) {
            flag.set(true);
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("modelId", modelId);
        call.resolve(res);
    }

    @PluginMethod
    public void deleteModels(PluginCall call) {
        String targetFilename = call.getString("filename", "").trim();
        for (AtomicBoolean flag : activeDownloadPauseFlags.values()) {
            flag.set(true);
        }
        if (engine != null) {
            engine.unloadModels();
        }
        File dir = getModelsDir();
        File[] files = dir.listFiles();
        int deletedCount = 0;
        long freedBytes = 0L;
        if (files != null) {
            for (File f : files) {
                if (targetFilename.isEmpty()
                        || f.getName().equals(targetFilename)
                        || f.getName().equals(targetFilename + ".part")
                        || f.getName().equals(targetFilename + ".bad")) {
                    long len = f.length();
                    if (f.delete()) {
                        deletedCount++;
                        freedBytes += len;
                    }
                }
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("deletedCount", deletedCount);
        res.put("freedBytes", freedBytes);
        call.resolve(res);
    }

    @PluginMethod
    public void loadModels(PluginCall call) {
        final String llmFilename = call.getString("llmFilename", "").trim();
        final String whisperFilename = call.getString("whisperFilename", "").trim();
        final String vadFilename = call.getString("vadFilename", "silero_vad.onnx").trim();
        final String piperFilename = call.getString("piperFilename", "en_US-lessac-medium.onnx").trim();
        final String ttsEngine = call.getString("ttsEngine", "piper").trim();
        final String chatTemplate = call.getString("chatTemplate", "llama3").trim();
        final boolean sttOnly = Boolean.TRUE.equals(call.getBoolean("sttOnly", false));

        downloadExecutor.submit(() -> {
            try {
                if (llmFilename.endsWith(".bad")
                        || whisperFilename.endsWith(".bad")
                        || vadFilename.endsWith(".bad")
                        || piperFilename.endsWith(".bad")) {
                    throw new IllegalArgumentException("Refusing to load quarantined .bad model file.");
                }
                File dir = getModelsDir();
                File llmFile = llmFilename.isEmpty() ? null : new File(dir, llmFilename);
                File whisperFile = new File(dir, whisperFilename);
                File vadFile = new File(dir, vadFilename);
                File piperFile = new File(dir, piperFilename);

                engine.loadModels(llmFile, whisperFile, vadFile, piperFile, ttsEngine, chatTemplate, sttOnly);

                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                if (am != null) am.getMemoryInfo(mi);
                long availMb = mi.availMem / (1024 * 1024);
                long totalMb = mi.totalMem / (1024 * 1024);

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("availableRamMb", availMb);
                res.put("usedRamMb", Math.max(0, totalMb - availMb));
                res.put("activeTtsEngine", engine.getActiveTtsEngine());
                res.put("inferenceThreads", engine.getInferenceThreads());
                res.put("selfTestText", engine.getLastSelfTestText());
                res.put("selfTestTokensPerSec", engine.getLastSelfTestTokensPerSec());
                res.put("selfTestElapsedMs", engine.getLastSelfTestElapsedMs());
                res.put("lastNativeError", engine.getLastNativeError());
                call.resolve(res);
            } catch (OutOfMemoryError oom) {
                String msg = oom.getMessage() != null ? oom.getMessage() : "Out of memory loading model. Switch to the Small (1.5B Q4) model.";
                onError("LoadModels", msg, true);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("oom", true);
                err.put("reason", msg);
                err.put("lastNativeError", engine != null ? engine.getLastNativeError() : msg);
                call.resolve(err);
            } catch (Throwable e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                onError("LoadModels", msg, false);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("oom", false);
                err.put("reason", msg);
                err.put("lastNativeError", engine != null ? engine.getLastNativeError() : msg);
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void unloadModels(PluginCall call) {
        if (engine != null) {
            engine.unloadModels();
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void invalidateKvCache(PluginCall call) {
        String reason = call.getString("reason", "manual");
        String systemPrefix = call.getString("systemPrefix", "");
        String cacheKey = call.getString("cacheKey", "");
        if (engine != null) {
            engine.invalidateKvCache(reason);
            if (systemPrefix != null && !systemPrefix.isEmpty()) {
                engine.warmSystemPrefixIfNeeded(systemPrefix, cacheKey);
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void ensureMicrophonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            onDiagnosticLog(0, "LocalAudio:Permission", "RECORD_AUDIO permission already granted");
            JSObject res = new JSObject();
            res.put("granted", true);
            call.resolve(res);
            return;
        }
        onDiagnosticLog(0, "LocalAudio:Permission", "Requesting Android RECORD_AUDIO runtime permission...");
        requestPermissionForAlias("microphone", call, "handleEnsureMicPermissionResult");
    }

    @PermissionCallback
    private void handleEnsureMicPermissionResult(PluginCall call) {
        boolean granted = getPermissionState("microphone") == PermissionState.GRANTED;
        onDiagnosticLog(0, "LocalAudio:Permission", "RECORD_AUDIO runtime permission result: granted=" + granted);
        JSObject res = new JSObject();
        res.put("granted", granted);
        if (!granted) {
            res.put("reason", "Microphone (RECORD_AUDIO) permission denied by user.");
        }
        call.resolve(res);
    }

    @PluginMethod
    public void startLocalSession(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            onDiagnosticLog(0, "LocalAudio:Permission", "RECORD_AUDIO missing in startLocalSession; requesting permission...");
            requestPermissionForAlias("microphone", call, "handleStartSessionMicPermissionResult");
            return;
        }
        beginLocalSessionInternal(call);
    }

    @PermissionCallback
    private void handleStartSessionMicPermissionResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            String msg = "Microphone (RECORD_AUDIO) permission was denied. Grant microphone access in Android Settings to use voice.";
            onDiagnosticLog(0, "LocalAudio:PermissionDenied", msg);
            onError("AudioRecord", msg, false);
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", msg);
            call.resolve(err);
            return;
        }
        onDiagnosticLog(0, "LocalAudio:Permission", "RECORD_AUDIO granted; starting local audio session");
        beginLocalSessionInternal(call);
    }

    private void beginLocalSessionInternal(PluginCall call) {
        final int silenceTimeoutMs = call.getInt("silenceTimeoutMs", 600);
        final int minUtteranceMs = call.getInt("minUtteranceMs", 400);
        final int preRollMs = call.getInt("preRollMs", 400);
        final int bargeInSustainedMs = call.getInt("bargeInSustainedMs", 800);
        final float bargeInThreshold = call.getFloat("bargeInThreshold", 0.85f);
        final float bargeInSpeakerBoost = call.getFloat("bargeInSpeakerBoost", 0.0f);
        final String bargeInMode = call.getString("bargeInMode", "headphones_only");
        final String micSource = call.getString("micSource", "auto");
        final boolean saveLast10Utterances = Boolean.TRUE.equals(call.getBoolean("saveLast10Utterances", false));
        final String ttsEngine = call.getString("ttsEngine", "android_tts");
        final String chatTemplate = call.getString("chatTemplate", "llama3");
        final String systemPrefix = call.getString("systemPrefix", "");
        final String cacheKey = call.getString("cacheKey", "");

        downloadExecutor.submit(() -> {
            try {
                // Start Foreground Service so local inference & mic capture survive screen-off
                Intent serviceIntent = new Intent(getContext(), SierraVoiceForegroundService.class);
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_START_LIVE);
                serviceIntent.putExtra("start_native_audio", false);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(serviceIntent);
                } else {
                    getContext().startService(serviceIntent);
                }

                engine.updateRuntimeConfig(
                        silenceTimeoutMs,
                        minUtteranceMs,
                        preRollMs,
                        bargeInSustainedMs,
                        bargeInThreshold,
                        bargeInSpeakerBoost,
                        ttsEngine,
                        chatTemplate,
                        bargeInMode,
                        micSource,
                        saveLast10Utterances
                );
                if (systemPrefix != null && !systemPrefix.isEmpty()) {
                    engine.warmSystemPrefixIfNeeded(systemPrefix, cacheKey);
                }
                engine.startSession();
                localSessionRunning = true;

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("activeTtsEngine", engine.getActiveTtsEngine());
                res.put("inferenceThreads", engine.getInferenceThreads());
                res.put("hasHeadset", engine.isHeadsetConnected());
                call.resolve(res);
            } catch (Exception e) {
                localSessionRunning = false;
                String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                onError("StartSession", msg, false);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("reason", msg);
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void stopLocalSession(PluginCall call) {
        localSessionRunning = false;
        if (engine != null) {
            engine.stopSession();
        }
        try {
            Intent stopIntent = new Intent(getContext(), SierraVoiceForegroundService.class);
            stopIntent.setAction(SierraVoiceForegroundService.ACTION_STOP_LIVE);
            getContext().startService(stopIntent);
        } catch (Exception ignored) {}

        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void generateLocalReply(PluginCall call) {
        final int turnId = call.getInt("turnId", 1);
        final String prompt = call.getString("prompt", "").trim();
        final int maxTokens = call.getInt("maxTokens", 160);

        downloadExecutor.submit(() -> {
            try {
                if (engine == null || !engine.isModelsLoaded()) {
                    throw new IllegalStateException("Local LLM is not loaded in llama.cpp.");
                }
                LocalVoiceEngine.LlmGenerationResult result = engine.generateReplyStream(turnId, prompt, maxTokens);
                if (result == null) {
                    throw new IllegalStateException("engine.generateReplyStream returned null.");
                }

                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("turnId", turnId);
                res.put("replyText", result.replyText != null ? result.replyText : "");
                res.put("tokensPerSec", result.tokensPerSec);
                res.put("timeToFirstAudioMs", result.timeToFirstAudioMs);
                res.put("totalLatencyMs", result.totalLatencyMs);
                res.put("generatedTokens", result.generatedTokens);
                res.put("interrupted", result.interrupted);
                res.put("stopReason", result.stopReason != null ? result.stopReason : "");
                res.put("promptTokens", result.promptTokens);
                res.put("cachedTokensReused", result.cachedTokensReused);
                res.put("promptEvalMs", result.promptEvalMs);
                res.put("promptTokPerSec", result.promptTokPerSec);
                res.put("lastNativeError", engine.getLastNativeError());
                call.resolve(res);
            } catch (OutOfMemoryError oom) {
                String msg = "Out of memory during LLM generation: " + (oom.getMessage() != null ? oom.getMessage() : "Switch to the Small (1.5B Q4) model.");
                onError("LLM", msg, true);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("turnId", turnId);
                err.put("oom", true);
                err.put("reason", msg);
                err.put("lastNativeError", engine != null ? engine.getLastNativeError() : msg);
                call.resolve(err);
            } catch (Throwable e) {
                String msg = e.getMessage() != null ? e.getMessage() : e.toString();
                onError("LLM", msg, false);
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("turnId", turnId);
                err.put("reason", msg);
                err.put("lastNativeError", engine != null ? engine.getLastNativeError() : msg);
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void synthesizePiperSentence(PluginCall call) {
        int sentenceIndex = call.getInt("sentenceIndex", 0);
        int turnId = call.getInt("turnId", 0);

        // Standalone Piper VITS ONNX requires espeak-ng phonemization dictionary; report honestly
        // so the caller uses Android System TextToSpeech (android_tts) without claiming Piper.
        JSObject res = new JSObject();
        res.put("ok", false);
        res.put("sentenceIndex", sentenceIndex);
        res.put("turnId", turnId);
        res.put("activeTtsEngine", "android_tts");
        res.put("reason", "Piper ONNX requires espeak-ng phonemizer; using Android System TextToSpeech (android_tts).");
        call.resolve(res);
    }

    @PluginMethod
    public void setSpeakingState(PluginCall call) {
        boolean speaking = Boolean.TRUE.equals(call.getBoolean("speaking", false));
        int turnId = call.getInt("turnId", 0);
        Boolean thinking = call.getBoolean("thinking");
        if (engine != null) {
            engine.setSpeakingState(speaking, turnId, thinking);
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void playPcmAudio(PluginCall call) {
        final String pcmBase64 = call.getString("pcmBase64", "");
        final int sampleRate = call.getInt("sampleRate", 44100);
        final int turnId = call.getInt("turnId", 0);

        if (engine == null || pcmBase64 == null || pcmBase64.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("interrupted", false);
            err.put("reason", "No PCM audio payload provided.");
            call.resolve(err);
            return;
        }

        playbackExecutor.submit(() -> {
            try {
                byte[] decoded = Base64.decode(pcmBase64, Base64.DEFAULT);
                boolean completed = engine.playPcmOrWavAudio(decoded, sampleRate, turnId);
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("interrupted", !completed);
                call.resolve(res);
            } catch (Throwable t) {
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("interrupted", false);
                err.put("reason", t.getMessage() != null ? t.getMessage() : t.toString());
                call.resolve(err);
            }
        });
    }

    @PluginMethod
    public void isHeadsetConnected(PluginCall call) {
        JSObject res = new JSObject();
        res.put("connected", engine != null && engine.isHeadsetConnected());
        call.resolve(res);
    }

    @PluginMethod
    public void stopAudioPlayback(PluginCall call) {
        if (engine != null) {
            engine.stopNativeAudioPlayback();
            engine.setSpeakingState(false, 0);
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void interruptTurn(PluginCall call) {
        if (engine != null) {
            engine.interruptCurrentTurn();
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        call.resolve(res);
    }

    @PluginMethod
    public void getMemoryAndSpeedStats(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        if (am != null) am.getMemoryInfo(mi);
        long availRamMb = mi.availMem / (1024 * 1024);
        long totalRamMb = mi.totalMem / (1024 * 1024);
        long usedRamMb = Math.max(0, totalRamMb - availRamMb);

        JSObject res = new JSObject();
        res.put("usedRamMb", usedRamMb);
        res.put("availableRamMb", availRamMb);
        res.put("totalRamMb", totalRamMb);
        res.put("tokensPerSec", engine != null ? engine.getLastTokensPerSec() : 0.0);
        res.put("timeToFirstAudioMs", engine != null ? engine.getLastTimeToFirstAudioMs() : 0L);
        res.put("lastTurnLatencyMs", engine != null ? engine.getLastTurnLatencyMs() : 0L);
        res.put("thermalStatus", engine != null ? engine.getThermalStatusString() : "none");
        res.put("modelLoaded", engine != null && engine.isModelsLoaded());
        res.put("loadedLlmFilename", engine != null ? engine.getLoadedLlmFilename() : "");
        res.put("loadedWhisperFilename", engine != null ? engine.getLoadedWhisperFilename() : "");
        res.put("activeTtsEngine", engine != null ? engine.getActiveTtsEngine() : "android_tts");
        res.put("inferenceThreads", engine != null ? engine.getInferenceThreads() : 4);
        res.put("lastNativeError", engine != null ? engine.getLastNativeError() : "");
        call.resolve(res);
    }

    private String computeFileSha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream fis = new FileInputStream(file)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = fis.read(buf)) != -1) {
                digest.update(buf, 0, n);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format(Locale.ROOT, "%02x", b));
        }
        return sb.toString();
    }

    // EngineEventListener callbacks -> emit to WebView
    @Override
    public void onStatusChanged(String status, String detail) {
        JSObject evt = new JSObject();
        evt.put("status", status);
        evt.put("detail", detail != null ? detail : "");
        notifyListeners("localVoiceStatus", evt, true);
    }

    @Override
    public void onVadFrame(float probability, boolean isSpeech, String phase) {
        JSObject evt = new JSObject();
        evt.put("probability", probability);
        evt.put("isSpeech", isSpeech);
        evt.put("phase", phase);
        notifyListeners("localVadEvent", evt, true);
    }

    @PluginMethod
    public void listDebugUtterances(PluginCall call) {
        try {
            File dir = new File(getContext().getFilesDir(), "debug_utterances");
            JSArray arr = new JSArray();
            if (dir.exists() && dir.isDirectory()) {
                File[] metaFiles = dir.listFiles((d, name) -> name.endsWith(".json"));
                if (metaFiles != null) {
                    java.util.Arrays.sort(metaFiles, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (File mf : metaFiles) {
                        try (FileInputStream fis = new FileInputStream(mf)) {
                            byte[] data = new byte[(int) mf.length()];
                            int read = fis.read(data);
                            if (read > 0) {
                                JSONObject obj = new JSONObject(new String(data, 0, read, java.nio.charset.StandardCharsets.UTF_8));
                                arr.put(obj);
                            }
                        } catch (Throwable ignored) {}
                    }
                }
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("utterances", arr);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage());
            call.resolve(err);
        }
    }

    @PluginMethod
    public void getDebugUtteranceAudio(PluginCall call) {
        String id = call.getString("id", "").trim().replaceAll("[^a-zA-Z0-9_\\-]", "");
        if (id.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "id is required");
            call.resolve(err);
            return;
        }
        try {
            File dir = new File(getContext().getFilesDir(), "debug_utterances");
            File wav = new File(dir, id + ".wav");
            if (!wav.exists()) {
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("reason", "Audio file not found");
                call.resolve(err);
                return;
            }
            byte[] bytes = new byte[(int) wav.length()];
            try (FileInputStream fis = new FileInputStream(wav)) {
                int totalRead = 0;
                while (totalRead < bytes.length) {
                    int n = fis.read(bytes, totalRead, bytes.length - totalRead);
                    if (n <= 0) break;
                    totalRead += n;
                }
            }
            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("id", id);
            res.put("wavBase64", b64);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage());
            call.resolve(err);
        }
    }

    @PluginMethod
    public void clearDebugUtterances(PluginCall call) {
        try {
            File dir = new File(getContext().getFilesDir(), "debug_utterances");
            int deleted = 0;
            if (dir.exists() && dir.isDirectory()) {
                File[] files = dir.listFiles();
                if (files != null) {
                    for (File f : files) {
                        if (f.delete()) deleted++;
                    }
                }
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("deletedCount", deleted);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage());
            call.resolve(err);
        }
    }

    @Override
    public void onTranscriptCommitted(String transcript, int utteranceDurationMs, boolean fromBargeIn) {
        onTranscriptCommitted(
                transcript,
                utteranceDurationMs,
                fromBargeIn,
                transcript,
                utteranceDurationMs,
                0L,
                0.0,
                1.0,
                0.0,
                0.0,
                ""
        );
    }

    @Override
    public void onTranscriptCommitted(
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
        JSObject evt = new JSObject();
        evt.put("transcript", transcript);
        evt.put("rawTranscript", rawTranscript != null ? rawTranscript : transcript);
        evt.put("utteranceDurationMs", utteranceDurationMs);
        evt.put("audioMs", audioMs);
        evt.put("whisperMs", whisperMs);
        evt.put("rms", rms);
        evt.put("gainApplied", gainApplied);
        evt.put("noSpeechProb", noSpeechProb);
        evt.put("avgLogprob", avgLogprob);
        evt.put("fromBargeIn", fromBargeIn);
        evt.put("debugUtteranceId", debugUtteranceId != null ? debugUtteranceId : "");
        notifyListeners("localTranscriptCommitted", evt, true);
    }

    @Override
    public void onTokenStream(int turnId, String token) {
        JSObject evt = new JSObject();
        evt.put("turnId", turnId);
        evt.put("token", token);
        notifyListeners("localTokenStream", evt, true);
    }

    @Override
    public void onDiagnosticLog(int turnId, String category, String detail) {
        JSObject evt = new JSObject();
        evt.put("turnId", turnId);
        evt.put("category", category != null ? category : "LocalLLM:Diag");
        evt.put("detail", detail != null ? detail : "");
        notifyListeners("localDiagnostic", evt, true);
    }

    @Override
    public void onSentenceStarted(int turnId, int sentenceIndex, String sentence) {
        JSObject evt = new JSObject();
        evt.put("turnId", turnId);
        evt.put("sentenceIndex", sentenceIndex);
        evt.put("sentence", sentence);
        evt.put("phase", "started");
        notifyListeners("localSentenceReady", evt, true);
    }

    @Override
    public void onSentenceCompleted(int turnId, int sentenceIndex, String sentence) {
        JSObject evt = new JSObject();
        evt.put("turnId", turnId);
        evt.put("sentenceIndex", sentenceIndex);
        evt.put("sentence", sentence);
        evt.put("phase", "completed");
        notifyListeners("localSentenceReady", evt, true);
    }

    @Override
    public void onBargeInTriggered(int interruptedTurnId, int sustainedMs, float threshold) {
        JSObject evt = new JSObject();
        evt.put("status", "interrupted");
        evt.put("interruptedTurnId", interruptedTurnId);
        evt.put("sustainedMs", sustainedMs);
        evt.put("threshold", threshold);
        notifyListeners("localVoiceStatus", evt, true);
    }

    @Override
    public void onTurnMetrics(int turnId, double tokensPerSec, long ttfaMs, long totalLatencyMs) {
        JSObject evt = new JSObject();
        evt.put("turnId", turnId);
        evt.put("tokensPerSec", tokensPerSec);
        evt.put("timeToFirstAudioMs", ttfaMs);
        evt.put("totalLatencyMs", totalLatencyMs);
        notifyListeners("localTurnMetrics", evt, true);
    }

    @Override
    public void onThermalWarning(String thermalStatus, String message) {
        JSObject evt = new JSObject();
        evt.put("thermalStatus", thermalStatus);
        evt.put("message", message);
        notifyListeners("localThermalWarning", evt, true);
    }

    @Override
    public void onError(String stage, String message, boolean isOom) {
        JSObject evt = new JSObject();
        evt.put("status", "error");
        evt.put("stage", stage);
        evt.put("detail", message);
        evt.put("oom", isOom);
        evt.put("lastNativeError", engine != null ? engine.getLastNativeError() : message);
        notifyListeners("localVoiceStatus", evt, true);
    }
}
