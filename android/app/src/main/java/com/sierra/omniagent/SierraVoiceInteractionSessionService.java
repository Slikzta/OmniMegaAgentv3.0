package com.sierra.omniagent;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.voice.VoiceInteractionSession;
import android.service.voice.VoiceInteractionSessionService;
import android.util.Log;

public class SierraVoiceInteractionSessionService extends VoiceInteractionSessionService {
    private static final String TAG = "SierraVoiceSessionSvc";

    @Override
    public VoiceInteractionSession onNewSession(Bundle args) {
        return new SierraVoiceSession(this);
    }

    private static class SierraVoiceSession extends VoiceInteractionSession {
        public SierraVoiceSession(Context context) {
            super(context);
        }

        @Override
        public void onShow(Bundle args, int showFlags) {
            super.onShow(args, showFlags);
            Log.i(TAG, "VoiceInteractionSession onShow triggered (flags=" + showFlags + ")");
            try {
                SierraBackgroundVoicePlugin.markAssistantLaunchPending("voice_interaction_session");
                Intent intent = new Intent(getContext(), MainActivity.class);
                intent.setAction(Intent.ACTION_ASSIST);
                intent.putExtra("sierra_assistant_trigger", true);
                intent.putExtra("sierra_assistant_source", "voice_interaction_session");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                getContext().startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "Error launching MainActivity from SierraVoiceSession", e);
            } finally {
                hide();
            }
        }
    }
}
