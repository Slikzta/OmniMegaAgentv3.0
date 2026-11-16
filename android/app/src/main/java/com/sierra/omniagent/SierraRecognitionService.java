package com.sierra.omniagent;

import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionService;
import android.speech.SpeechRecognizer;
import android.util.Log;

/**
 * Stub RecognitionService required by Android's VoiceInteractionService specification
 * so Sierra can be chosen as the system's Default Digital Assistant app.
 */
public class SierraRecognitionService extends RecognitionService {
    private static final String TAG = "SierraRecognitionSvc";

    @Override
    protected void onStartListening(Intent recognizerIntent, Callback listener) {
        Log.d(TAG, "onStartListening called on stub SierraRecognitionService");
        try {
            if (listener != null) {
                listener.readyForSpeech(new Bundle());
            }
        } catch (Exception e) {
            Log.w(TAG, "Stub onStartListening callback error", e);
        }
    }

    @Override
    protected void onCancel(Callback listener) {
        Log.d(TAG, "onCancel called on stub SierraRecognitionService");
    }

    @Override
    protected void onStopListening(Callback listener) {
        Log.d(TAG, "onStopListening called on stub SierraRecognitionService");
        try {
            if (listener != null) {
                listener.error(SpeechRecognizer.ERROR_NO_MATCH);
            }
        } catch (Exception e) {
            Log.w(TAG, "Stub onStopListening callback error", e);
        }
    }
}
