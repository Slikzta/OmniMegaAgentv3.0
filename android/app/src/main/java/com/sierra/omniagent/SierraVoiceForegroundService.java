package com.sierra.omniagent;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Foreground Service (foregroundServiceType="microphone") for:
 * 1. Keeping Sierra Live active in the background with an ongoing notification ("Sierra Live is active") and Stop button.
 * 2. Running the lightweight on-device wake word listener notification ("Listening for wake word").
 * 3. Streaming 16kHz PCM microphone capture and 24kHz PCM playback natively when WebView audio is throttled in the background.
 */
public class SierraVoiceForegroundService extends Service {
    private static final String TAG = "SierraVoiceFgService";

    public static final String ACTION_START_LIVE = "com.sierra.omniagent.action.START_BACKGROUND_LIVE";
    public static final String ACTION_START_WAKE_WORD = "com.sierra.omniagent.action.START_WAKE_WORD";
    public static final String ACTION_STOP_LIVE = "com.sierra.omniagent.action.STOP_BACKGROUND_LIVE";
    public static final String ACTION_STOP_WAKE_WORD = "com.sierra.omniagent.action.STOP_WAKE_WORD";
    public static final String ACTION_STOP_ALL = "com.sierra.omniagent.action.STOP_ALL_VOICE";
    public static final String ACTION_START_NATIVE_AUDIO = "com.sierra.omniagent.action.START_NATIVE_AUDIO";
    public static final String ACTION_STOP_NATIVE_AUDIO = "com.sierra.omniagent.action.STOP_NATIVE_AUDIO";

    private static final String CHANNEL_ID = "sierra_live_voice_channel";
    private static final int NOTIFICATION_ID = 4100;

    private static final int CAPTURE_SAMPLE_RATE = 16000;
    private static final int CAPTURE_CHUNK_SAMPLES = 1600; // 100ms at 16kHz mono
    private static final int PLAYBACK_SAMPLE_RATE = 24000;

    private static volatile SierraVoiceForegroundService instance;
    private static final AtomicBoolean isLiveBackgroundActive = new AtomicBoolean(false);
    private static final AtomicBoolean isWakeWordActive = new AtomicBoolean(false);
    private static final AtomicBoolean isNativeAudioCaptureActive = new AtomicBoolean(false);

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private AudioRecord audioRecord;
    private Thread captureThread;
    private AudioTrack audioTrack;
    private final Object playbackLock = new Object();
    private ExecutorService playbackExecutor;

    public static boolean isRunning() {
        return isLiveBackgroundActive.get() || isWakeWordActive.get();
    }

    public static boolean isLiveActive() {
        return isLiveBackgroundActive.get();
    }

    public static boolean isWakeWordListening() {
        return isWakeWordActive.get();
    }

    public static boolean isNativeAudioStreaming() {
        return isNativeAudioCaptureActive.get();
    }

    public static SierraVoiceForegroundService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        playbackExecutor = Executors.newSingleThreadExecutor();
        createNotificationChannel();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START_LIVE;
        if (action == null) {
            action = ACTION_START_LIVE;
        }

        if (ACTION_STOP_ALL.equals(action)) {
            boolean wasFromNotification = intent != null && intent.getBooleanExtra("from_notification", false);
            Log.i(TAG, "Stopping all background voice services (fromNotification=" + wasFromNotification + ")");
            isLiveBackgroundActive.set(false);
            isWakeWordActive.set(false);
            stopNativeAudioInternal();
            releaseLocks();
            if (wasFromNotification) {
                SierraBackgroundVoicePlugin.notifyStoppedFromNotification();
            }
            stopForegroundCompat();
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_STOP_LIVE.equals(action)) {
            isLiveBackgroundActive.set(false);
            stopNativeAudioInternal();
            if (!isWakeWordActive.get()) {
                releaseLocks();
                stopForegroundCompat();
                stopSelf();
                return START_NOT_STICKY;
            } else {
                updateForegroundNotification();
                return START_STICKY;
            }
        }

        if (ACTION_STOP_WAKE_WORD.equals(action)) {
            isWakeWordActive.set(false);
            if (!isLiveBackgroundActive.get()) {
                stopNativeAudioInternal();
                releaseLocks();
                stopForegroundCompat();
                stopSelf();
                return START_NOT_STICKY;
            } else {
                updateForegroundNotification();
                return START_STICKY;
            }
        }

        if (ACTION_START_LIVE.equals(action)) {
            isLiveBackgroundActive.set(true);
            acquireLocks();
            startOrUpdateForeground();
            boolean startNativeAudio = intent != null && intent.getBooleanExtra("start_native_audio", false);
            if (startNativeAudio) {
                startNativeAudioInternal();
            }
            return START_STICKY;
        }

        if (ACTION_START_WAKE_WORD.equals(action)) {
            isWakeWordActive.set(true);
            acquireLocks();
            startOrUpdateForeground();
            return START_STICKY;
        }

        if (ACTION_START_NATIVE_AUDIO.equals(action)) {
            isLiveBackgroundActive.set(true);
            acquireLocks();
            startOrUpdateForeground();
            startNativeAudioInternal();
            return START_STICKY;
        }

        if (ACTION_STOP_NATIVE_AUDIO.equals(action)) {
            stopNativeAudioInternal();
            return START_STICKY;
        }

        return START_STICKY;
    }

    private void startOrUpdateForeground() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed starting foreground service with MICROPHONE type, trying fallback", e);
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception inner) {
                Log.e(TAG, "Fallback startForeground failed", inner);
            }
        }
    }

    private void updateForegroundNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private Notification buildNotification() {
        boolean live = isLiveBackgroundActive.get();
        boolean wake = isWakeWordActive.get();

        String title;
        String text;
        if (live && wake) {
            title = "Sierra Live is active";
            text = "Background voice session active • Listening for wake word";
        } else if (live) {
            title = "Sierra Live is active";
            text = "Background microphone & live voice session active";
        } else {
            title = "Listening for wake word";
            text = "On-device wake word detector active (no audio leaves device)";
        }

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int pendingFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, 0, openIntent, pendingFlags);

        Intent stopIntent = new Intent(this, SierraVoiceForegroundService.class);
        stopIntent.setAction(ACTION_STOP_ALL);
        stopIntent.putExtra("from_notification", true);
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 1, stopIntent, pendingFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(contentPendingIntent)
                .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Sierra Live Background Voice",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Ongoing notification when Sierra Live or Wake Word is active in the background");
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private synchronized void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Sierra::LiveVoiceWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(4 * 60 * 60 * 1000L); // Bounded 4-hour max safety timeout
                Log.i(TAG, "Acquired PARTIAL_WAKE_LOCK for background voice");
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not acquire WakeLock", e);
        }

        try {
            if (wifiLock == null) {
                WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wm != null) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Sierra::LiveVoiceWifiLock");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) {
                wifiLock.acquire();
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not acquire WifiLock", e);
        }
    }

    private synchronized void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                Log.i(TAG, "Released PARTIAL_WAKE_LOCK");
            }
        } catch (Exception e) {
            Log.w(TAG, "Error releasing WakeLock", e);
        }
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception e) {
            Log.w(TAG, "Error releasing WifiLock", e);
        }
    }

    public synchronized void startNativeAudioInternal() {
        if (isNativeAudioCaptureActive.get()) {
            return;
        }
        try {
            int minBufSize = AudioRecord.getMinBufferSize(
                    CAPTURE_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
            );
            int bufferSizeBytes = Math.max(minBufSize * 2, CAPTURE_CHUNK_SAMPLES * 4);

            audioRecord = new AudioRecord(
                    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                    CAPTURE_SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSizeBytes
            );

            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize");
                audioRecord.release();
                audioRecord = null;
                return;
            }

            audioRecord.startRecording();
            isNativeAudioCaptureActive.set(true);

            captureThread = new Thread(() -> {
                short[] pcmShortBuf = new short[CAPTURE_CHUNK_SAMPLES];
                byte[] pcmByteBuf = new byte[CAPTURE_CHUNK_SAMPLES * 2];

                while (isNativeAudioCaptureActive.get() && audioRecord != null) {
                    int readSamples = 0;
                    while (readSamples < CAPTURE_CHUNK_SAMPLES && isNativeAudioCaptureActive.get()) {
                        int r = audioRecord.read(pcmShortBuf, readSamples, CAPTURE_CHUNK_SAMPLES - readSamples);
                        if (r > 0) {
                            readSamples += r;
                        } else {
                            break;
                        }
                    }

                    if (readSamples > 0 && isNativeAudioCaptureActive.get()) {
                        double sumSq = 0;
                        for (int i = 0; i < readSamples; i++) {
                            short s = pcmShortBuf[i];
                            pcmByteBuf[i * 2] = (byte) (s & 0xFF);
                            pcmByteBuf[i * 2 + 1] = (byte) ((s >> 8) & 0xFF);
                            double norm = s / 32768.0;
                            sumSq += norm * norm;
                        }
                        double rms = Math.sqrt(sumSq / readSamples);
                        int validBytes = readSamples * 2;
                        String base64Pcm = Base64.encodeToString(pcmByteBuf, 0, validBytes, Base64.NO_WRAP);
                        SierraBackgroundVoicePlugin.emitNativePcmChunk(base64Pcm, rms);
                    }
                }
            }, "SierraNativeMicThread");
            captureThread.setPriority(Thread.MAX_PRIORITY);
            captureThread.start();
            Log.i(TAG, "Started native 16kHz PCM AudioRecord capture thread");
        } catch (SecurityException se) {
            Log.e(TAG, "RECORD_AUDIO permission missing for native AudioRecord", se);
            isNativeAudioCaptureActive.set(false);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start native AudioRecord capture", e);
            isNativeAudioCaptureActive.set(false);
        }
    }

    public synchronized void stopNativeAudioInternal() {
        isNativeAudioCaptureActive.set(false);
        if (captureThread != null) {
            try {
                captureThread.interrupt();
                captureThread.join(300);
            } catch (Exception ignored) {}
            captureThread = null;
        }
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
            } catch (Exception ignored) {}
            try {
                audioRecord.release();
            } catch (Exception ignored) {}
            audioRecord = null;
        }
        flushNativePlaybackInternal();
        synchronized (playbackLock) {
            if (audioTrack != null) {
                try {
                    audioTrack.stop();
                } catch (Exception ignored) {}
                try {
                    audioTrack.release();
                } catch (Exception ignored) {}
                audioTrack = null;
            }
        }
    }

    public void playPcm24kBase64(final String base64Audio) {
        if (base64Audio == null || base64Audio.isEmpty() || playbackExecutor == null) {
            return;
        }
        playbackExecutor.execute(() -> {
            try {
                byte[] pcmBytes = Base64.decode(base64Audio, Base64.DEFAULT);
                if (pcmBytes == null || pcmBytes.length == 0) return;

                synchronized (playbackLock) {
                    if (audioTrack == null) {
                        int minBuffer = AudioTrack.getMinBufferSize(
                                PLAYBACK_SAMPLE_RATE,
                                AudioFormat.CHANNEL_OUT_MONO,
                                AudioFormat.ENCODING_PCM_16BIT
                        );
                        int trackBufSize = Math.max(minBuffer * 2, PLAYBACK_SAMPLE_RATE * 2);
                        audioTrack = new AudioTrack.Builder()
                                .setAudioAttributes(new AudioAttributes.Builder()
                                        .setUsage(AudioAttributes.USAGE_MEDIA)
                                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                        .build())
                                .setAudioFormat(new AudioFormat.Builder()
                                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                                        .setSampleRate(PLAYBACK_SAMPLE_RATE)
                                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                                        .build())
                                .setBufferSizeInBytes(trackBufSize)
                                .setTransferMode(AudioTrack.MODE_STREAM)
                                .build();
                        audioTrack.play();
                    } else if (audioTrack.getPlayState() != AudioTrack.PLAYSTATE_PLAYING) {
                        audioTrack.play();
                    }
                    audioTrack.write(pcmBytes, 0, pcmBytes.length);
                }
            } catch (Exception e) {
                Log.w(TAG, "Error playing 24kHz PCM chunk via native AudioTrack", e);
            }
        });
    }

    public void flushNativePlaybackInternal() {
        synchronized (playbackLock) {
            if (audioTrack != null) {
                try {
                    audioTrack.pause();
                    audioTrack.flush();
                    audioTrack.play();
                } catch (Exception ignored) {}
            }
        }
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        isLiveBackgroundActive.set(false);
        isWakeWordActive.set(false);
        stopNativeAudioInternal();
        releaseLocks();
        if (playbackExecutor != null) {
            playbackExecutor.shutdownNow();
            playbackExecutor = null;
        }
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }
}
