package com.sierra.omniagent;

import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionService;
import android.util.Log;

public class SierraVoiceInteractionService extends VoiceInteractionService {
    private static final String TAG = "SierraVoiceInteraction";

    @Override
    public void onReady() {
        super.onReady();
        Log.i(TAG, "SierraVoiceInteractionService is ready");
    }

    @Override
    public void onLaunchVoiceAssistFromKeyguard() {
        super.onLaunchVoiceAssistFromKeyguard();
        launchAssistantActivity("keyguard_assist");
    }

    private void launchAssistantActivity(String triggerSource) {
        try {
            SierraBackgroundVoicePlugin.markAssistantLaunchPending(triggerSource);
            Intent intent = new Intent(this, MainActivity.class);
            intent.setAction(Intent.ACTION_ASSIST);
            intent.putExtra("sierra_assistant_trigger", true);
            intent.putExtra("sierra_assistant_source", triggerSource);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(intent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch MainActivity from VoiceInteractionService", e);
        }
    }
}
