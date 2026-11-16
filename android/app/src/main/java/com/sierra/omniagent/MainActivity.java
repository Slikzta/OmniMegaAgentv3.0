package com.sierra.omniagent;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ScreenCapturePlugin.class);
        registerPlugin(SierraBackgroundVoicePlugin.class);
        registerPlugin(DeviceControlPlugin.class);
        registerPlugin(EmailPlugin.class);
        registerPlugin(LocalVoicePlugin.class);
        super.onCreate(savedInstanceState);
        configureWebViewForBackgroundAudio();
        checkAssistantIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        checkAssistantIntent(intent);
    }

    private void configureWebViewForBackgroundAudio() {
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                WebView webView = this.bridge.getWebView();
                WebSettings settings = webView.getSettings();
                settings.setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {}
    }

    private void checkAssistantIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        boolean isAssistExtra = intent.getBooleanExtra("sierra_assistant_trigger", false);
        if (Intent.ACTION_ASSIST.equals(action)
                || Intent.ACTION_VOICE_COMMAND.equals(action)
                || Intent.ACTION_SEARCH_LONG_PRESS.equals(action)
                || isAssistExtra) {
            String source = intent.getStringExtra("sierra_assistant_source");
            SierraBackgroundVoicePlugin.markAssistantLaunchPending(source != null ? source : (action != null ? action : "assist_intent"));
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // When background Live voice or wake-word foreground service is running, prevent WebView from freezing JS timers
        if (SierraVoiceForegroundService.isRunning() && this.bridge != null && this.bridge.getWebView() != null) {
            try {
                this.bridge.getWebView().onResume();
                this.bridge.getWebView().resumeTimers();
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (SierraVoiceForegroundService.isRunning() && this.bridge != null && this.bridge.getWebView() != null) {
            try {
                this.bridge.getWebView().onResume();
                this.bridge.getWebView().resumeTimers();
            } catch (Exception ignored) {}
        }
    }
}
