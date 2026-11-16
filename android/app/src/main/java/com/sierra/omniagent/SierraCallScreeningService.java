package com.sierra.omniagent;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.telecom.Call;
import android.telecom.CallScreeningService;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;

import java.util.HashSet;
import java.util.Set;

/**
 * Android CallScreeningService implementation for Sierra's block_number capability.
 * Uses the locally stored blocked numbers list in SharedPreferences("sierra_device_control")
 * and rejects incoming calls from numbers that match when ROLE_CALL_SCREENING is granted.
 */
@RequiresApi(api = Build.VERSION_CODES.N)
public class SierraCallScreeningService extends CallScreeningService {
    private static final String TAG = "SierraCallScreening";
    public static final String PREFS_NAME = "sierra_device_control";
    public static final String KEY_BLOCKED_NUMBERS = "blocked_numbers";

    public static String normalizeNumber(String raw) {
        if (raw == null) return "";
        return raw.replaceAll("[^0-9+]", "");
    }

    @Override
    public void onScreenCall(@NonNull Call.Details callDetails) {
        CallResponse.Builder responseBuilder = new CallResponse.Builder();
        try {
            Uri handle = callDetails.getHandle();
            String incomingRaw = handle != null ? handle.getSchemeSpecificPart() : "";
            String incomingNorm = normalizeNumber(incomingRaw);

            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            Set<String> blockedSet = prefs.getStringSet(KEY_BLOCKED_NUMBERS, new HashSet<>());

            boolean isBlocked = false;
            if (!incomingNorm.isEmpty() && blockedSet != null) {
                for (String blocked : blockedSet) {
                    String blockedNorm = normalizeNumber(blocked);
                    if (!blockedNorm.isEmpty()) {
                        if (incomingNorm.equals(blockedNorm)
                                || (incomingNorm.length() >= 7 && blockedNorm.length() >= 7
                                    && (incomingNorm.endsWith(blockedNorm) || blockedNorm.endsWith(incomingNorm)))) {
                            isBlocked = true;
                            break;
                        }
                    }
                }
            }

            if (isBlocked) {
                Log.i(TAG, "Screening & rejecting blocked number: " + incomingRaw);
                responseBuilder
                        .setDisallowCall(true)
                        .setRejectCall(true)
                        .setSkipCallLog(false)
                        .setSkipNotification(true);
            } else {
                responseBuilder
                        .setDisallowCall(false)
                        .setRejectCall(false)
                        .setSkipCallLog(false)
                        .setSkipNotification(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error screening call", e);
        }

        respondToCall(callDetails, responseBuilder.build());
    }
}
