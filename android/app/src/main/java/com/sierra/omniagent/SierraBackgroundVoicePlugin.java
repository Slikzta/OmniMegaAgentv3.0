package com.sierra.omniagent;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "SierraBackgroundVoice",
    permissions = {
        @Permission(
            strings = { Manifest.permission.RECORD_AUDIO },
            alias = "microphone"
        ),
        @Permission(
            strings = { Manifest.permission.POST_NOTIFICATIONS },
            alias = "notifications"
        )
    }
)
public class SierraBackgroundVoicePlugin extends Plugin {
    private static final String TAG = "SierraBgVoicePlugin";
    private static volatile SierraBackgroundVoicePlugin activeInstance;
    private static volatile boolean pendingAssistantLaunch = false;
    private static volatile String pendingAssistantSource = "assist_intent";

    @Override
    public void load() {
        super.load();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static void markAssistantLaunchPending(String source) {
        pendingAssistantLaunch = true;
        pendingAssistantSource = source != null ? source : "assist_intent";
        SierraBackgroundVoicePlugin inst = activeInstance;
        if (inst != null) {
            JSObject payload = new JSObject();
            payload.put("launchedAsAssistant", true);
            payload.put("source", pendingAssistantSource);
            inst.notifyListeners("onAssistantLaunch", payload, true);
        }
    }

    public static void notifyStoppedFromNotification() {
        SierraBackgroundVoicePlugin inst = activeInstance;
        if (inst != null) {
            JSObject payload = new JSObject();
            payload.put("reason", "notification_stop_button");
            inst.notifyListeners("onNotificationStop", payload, true);
        }
    }

    public static void emitNativePcmChunk(String base64Pcm, double rms) {
        SierraBackgroundVoicePlugin inst = activeInstance;
        if (inst != null) {
            JSObject payload = new JSObject();
            payload.put("data", base64Pcm);
            payload.put("rms", rms);
            inst.notifyListeners("onNativePcmChunk", payload);
        }
    }

    @PluginMethod
    public void checkAndRequestPermissions(PluginCall call) {
        boolean hasMic = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        boolean hasNotif = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasNotif = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }

        if (hasMic && hasNotif) {
            JSObject ret = new JSObject();
            ret.put("microphone", "granted");
            ret.put("notifications", "granted");
            call.resolve(ret);
            return;
        }

        requestAllPermissions(call, "permissionsCallback");
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        boolean hasMic = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        boolean hasNotif = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            hasNotif = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        JSObject ret = new JSObject();
        ret.put("microphone", hasMic ? "granted" : "denied");
        ret.put("notifications", hasNotif ? "granted" : "denied");
        call.resolve(ret);
    }

    @PluginMethod
    public void startBackgroundService(PluginCall call) {
        String mode = call.getString("mode", "live");
        boolean startNativeAudio = Boolean.TRUE.equals(call.getBoolean("startNativeAudio", false));
        try {
            Intent serviceIntent = new Intent(getContext(), SierraVoiceForegroundService.class);
            if ("wake_word".equals(mode)) {
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_START_WAKE_WORD);
            } else {
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_START_LIVE);
                serviceIntent.putExtra("start_native_audio", startNativeAudio);
            }
            ContextCompat.startForegroundService(getContext(), serviceIntent);
            JSObject ret = new JSObject();
            ret.put("started", true);
            ret.put("mode", mode);
            ret.put("nativeAudio", startNativeAudio);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start SierraVoiceForegroundService", e);
            call.reject("Failed to start foreground service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopBackgroundService(PluginCall call) {
        String mode = call.getString("mode", "all");
        try {
            Intent serviceIntent = new Intent(getContext(), SierraVoiceForegroundService.class);
            if ("live".equals(mode)) {
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_STOP_LIVE);
            } else if ("wake_word".equals(mode)) {
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_STOP_WAKE_WORD);
            } else {
                serviceIntent.setAction(SierraVoiceForegroundService.ACTION_STOP_ALL);
            }
            getContext().startService(serviceIntent);
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            ret.put("mode", mode);
            call.resolve(ret);
        } catch (Exception e) {
            Log.w(TAG, "Error stopping SierraVoiceForegroundService", e);
            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void startNativeAudioStream(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), SierraVoiceForegroundService.class);
            serviceIntent.setAction(SierraVoiceForegroundService.ACTION_START_NATIVE_AUDIO);
            ContextCompat.startForegroundService(getContext(), serviceIntent);
            JSObject ret = new JSObject();
            ret.put("streaming", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error starting native audio stream", e);
            call.reject("Failed to start native audio stream: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopNativeAudioStream(PluginCall call) {
        try {
            SierraVoiceForegroundService svc = SierraVoiceForegroundService.getInstance();
            if (svc != null) {
                svc.stopNativeAudioInternal();
            }
            JSObject ret = new JSObject();
            ret.put("streaming", false);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("streaming", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void playNativePcm24k(PluginCall call) {
        String data = call.getString("data", "");
        SierraVoiceForegroundService svc = SierraVoiceForegroundService.getInstance();
        if (svc != null && data != null && !data.isEmpty()) {
            svc.playPcm24kBase64(data);
            JSObject ret = new JSObject();
            ret.put("played", true);
            call.resolve(ret);
        } else {
            JSObject ret = new JSObject();
            ret.put("played", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void flushNativePlayback(PluginCall call) {
        SierraVoiceForegroundService svc = SierraVoiceForegroundService.getInstance();
        if (svc != null) {
            svc.flushNativePlaybackInternal();
        }
        JSObject ret = new JSObject();
        ret.put("flushed", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkBatteryOptimization(PluginCall call) {
        boolean isIgnoring = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                isIgnoring = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        } else {
            isIgnoring = true;
        }
        JSObject ret = new JSObject();
        ret.put("isIgnoringBatteryOptimizations", isIgnoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                String pkg = getContext().getPackageName();
                if (pm != null && !pm.isIgnoringBatteryOptimizations(pkg)) {
                    try {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + pkg));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(intent);
                    } catch (Exception inner) {
                        Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        getContext().startActivity(fallback);
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Could not open battery optimization settings: " + e.getMessage());
        }
    }

    @PluginMethod
    public void checkDefaultAssistantStatus(PluginCall call) {
        JSObject ret = new JSObject();
        String pkg = getContext().getPackageName();
        boolean isDefault = false;
        boolean canRead = false;
        String currentAssistant = "";

        try {
            String secureAssistant = Settings.Secure.getString(getContext().getContentResolver(), "assistant");
            String voiceService = Settings.Secure.getString(getContext().getContentResolver(), "voice_interaction_service");
            canRead = (secureAssistant != null || voiceService != null);
            if (secureAssistant != null && secureAssistant.contains(pkg)) {
                isDefault = true;
                currentAssistant = secureAssistant;
            } else if (voiceService != null && voiceService.contains(pkg)) {
                isDefault = true;
                currentAssistant = voiceService;
            } else {
                currentAssistant = secureAssistant != null ? secureAssistant : (voiceService != null ? voiceService : "");
            }
        } catch (Exception e) {
            Log.w(TAG, "Unable to read default assistant setting", e);
            canRead = false;
        }

        ret.put("isDefault", isDefault);
        ret.put("canRead", canRead);
        ret.put("currentAssistant", currentAssistant);
        call.resolve(ret);
    }

    @PluginMethod
    public void openDefaultAssistantSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            ret.put("target", "ACTION_VOICE_INPUT_SETTINGS");
            call.resolve(ret);
        } catch (Exception e1) {
            try {
                Intent fallback1 = new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS);
                fallback1.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback1);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                ret.put("target", "ACTION_MANAGE_DEFAULT_APPS_SETTINGS");
                call.resolve(ret);
            } catch (Exception e2) {
                try {
                    Intent fallback2 = new Intent(Settings.ACTION_SETTINGS);
                    fallback2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback2);
                    JSObject ret = new JSObject();
                    ret.put("opened", true);
                    ret.put("target", "ACTION_SETTINGS");
                    call.resolve(ret);
                } catch (Exception e3) {
                    call.reject("Unable to open Android settings: " + e3.getMessage());
                }
            }
        }
    }

    @PluginMethod
    public void consumePendingAssistantLaunch(PluginCall call) {
        boolean wasPending = pendingAssistantLaunch;
        String source = pendingAssistantSource;
        pendingAssistantLaunch = false;
        JSObject ret = new JSObject();
        ret.put("launchedAsAssistant", wasPending);
        ret.put("source", source);
        call.resolve(ret);
    }

    @PluginMethod
    public void vibrateDevice(PluginCall call) {
        int durationMs = call.getInt("durationMs", 120);
        try {
            Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE));
                } else {
                    vibrator.vibrate(durationMs);
                }
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("vibrated", true);
        call.resolve(ret);
    }
}
