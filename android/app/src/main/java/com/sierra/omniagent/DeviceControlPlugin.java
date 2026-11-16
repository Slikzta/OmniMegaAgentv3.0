package com.sierra.omniagent;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.CallLog;
import android.provider.ContactsContract;
import android.provider.Telephony;
import android.telephony.SmsManager;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

@CapacitorPlugin(
    name = "DeviceControl",
    permissions = {
        @Permission(
            alias = "contacts",
            strings = { Manifest.permission.READ_CONTACTS }
        ),
        @Permission(
            alias = "phone",
            strings = { Manifest.permission.CALL_PHONE }
        ),
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.SEND_SMS }
        ),
        @Permission(
            alias = "read_sms",
            strings = { Manifest.permission.READ_SMS }
        ),
        @Permission(
            alias = "call_log",
            strings = { Manifest.permission.READ_CALL_LOG }
        ),
        @Permission(
            alias = "calendar",
            strings = {
                Manifest.permission.READ_CALENDAR,
                Manifest.permission.WRITE_CALENDAR
            }
        )
    }
)
public class DeviceControlPlugin extends Plugin {
    private static final String TAG = "DeviceControlPlugin";

    private boolean isCallScreeningRoleHeld() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
                return roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING);
            }
        }
        return false;
    }

    private String mapPermState(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    private JSObject buildPermissionsStatusObject() {
        JSObject ret = new JSObject();
        ret.put("contacts", mapPermState(getPermissionState("contacts")));
        ret.put("phone", mapPermState(getPermissionState("phone")));
        ret.put("sms", mapPermState(getPermissionState("sms")));
        ret.put("readSms", mapPermState(getPermissionState("read_sms")));
        ret.put("callLog", mapPermState(getPermissionState("call_log")));
        ret.put("calendar", mapPermState(getPermissionState("calendar")));
        ret.put("callScreeningRole", isCallScreeningRoleHeld());
        ret.put("alarm", "granted");
        return ret;
    }

    @PluginMethod
    public void getPermissionsStatus(PluginCall call) {
        call.resolve(buildPermissionsStatusObject());
    }

    @PluginMethod
    public void requestCapabilityPermission(PluginCall call) {
        String group = call.getString("group", "");
        if ("contacts".equals(group) || "phone".equals(group) || "sms".equals(group) || "read_sms".equals(group) || "call_log".equals(group) || "calendar".equals(group)) {
            requestPermissionForAlias(group, call, "onCapabilityPermissionResult");
            return;
        }
        if ("call_screening".equals(group)) {
            requestCallScreeningRole(call);
            return;
        }
        call.resolve(buildPermissionsStatusObject());
    }

    @PermissionCallback
    private void onCapabilityPermissionResult(PluginCall call) {
        call.resolve(buildPermissionsStatusObject());
    }

    @PluginMethod
    public void requestCallScreeningRole(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = (RoleManager) getContext().getSystemService(Context.ROLE_SERVICE);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
                if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
                    JSObject res = new JSObject();
                    res.put("success", true);
                    res.put("roleGranted", true);
                    res.put("message", "Call screening role is already granted.");
                    call.resolve(res);
                    return;
                }
                Intent roleIntent = roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING);
                startActivityForResult(call, roleIntent, "onCallScreeningRoleResult");
                return;
            }
        }
        JSObject res = new JSObject();
        res.put("success", false);
        res.put("roleGranted", false);
        res.put("message", "ROLE_CALL_SCREENING is not available on this Android version.");
        call.resolve(res);
    }

    @ActivityCallback
    private void onCallScreeningRoleResult(PluginCall call, ActivityResult result) {
        boolean held = isCallScreeningRoleHeld() || (result != null && result.getResultCode() == Activity.RESULT_OK);
        JSObject res = new JSObject();
        res.put("success", held);
        res.put("roleGranted", held);
        res.put("message", held
                ? "Call screening role granted."
                : "Call screening role was not granted. You can enable it in Android Settings > Apps > Default apps > Caller ID & spam app.");
        call.resolve(res);
    }

    private String normalizeForAppMatch(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    /**
     * Task 3.1 & 5: open_app — Launch an installed app by spoken name or package ID.
     * Case-insensitive, ignores punctuation, matches on app label first (exact normalized label),
     * then partial label, then package name. If more than one app matches, returns the matches so Sierra asks which one.
     */
    @PluginMethod
    public void openApp(PluginCall call) {
        String appName = call.getString("appName", "").trim();
        String packageName = call.getString("packageName", "").trim();
        PackageManager pm = getContext().getPackageManager();

        try {
            // 1. Direct package launch if provided and installed
            if (!packageName.isEmpty()) {
                Intent launchIntent = pm.getLaunchIntentForPackage(packageName);
                if (launchIntent != null) {
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(launchIntent);
                    JSObject res = new JSObject();
                    res.put("ok", true);
                    res.put("success", true);
                    res.put("launchedPackage", packageName);
                    res.put("launchedLabel", appName.isEmpty() ? packageName : appName);
                    call.resolve(res);
                    return;
                }
            }

            if (appName.isEmpty()) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("success", false);
                res.put("reason", "Please provide an appName or packageName to open.");
                res.put("error", "Please provide an appName or packageName to open.");
                call.resolve(res);
                return;
            }

            Intent mainIntent = new Intent(Intent.ACTION_MAIN, null);
            mainIntent.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> resolvedApps = pm.queryIntentActivities(mainIntent, 0);

            String normQuery = normalizeForAppMatch(appName);
            String compactQuery = normQuery.replace(" ", "");
            String queryLower = appName.toLowerCase(Locale.ROOT);

            List<JSObject> exactLabelMatches = new ArrayList<>();
            List<JSObject> partialLabelMatches = new ArrayList<>();
            List<JSObject> packageMatches = new ArrayList<>();
            Set<String> seenPackages = new HashSet<>();

            for (ResolveInfo info : resolvedApps) {
                if (info.activityInfo == null || info.activityInfo.packageName == null) continue;
                String pkg = info.activityInfo.packageName;
                if (seenPackages.contains(pkg)) continue;
                seenPackages.add(pkg);

                CharSequence labelCs = info.loadLabel(pm);
                String label = labelCs != null ? labelCs.toString().trim() : pkg;
                String normLabel = normalizeForAppMatch(label);
                String compactLabel = normLabel.replace(" ", "");
                String pkgLower = pkg.toLowerCase(Locale.ROOT);
                String normPkg = normalizeForAppMatch(pkg);
                String compactPkg = normPkg.replace(" ", "");

                JSObject item = new JSObject();
                item.put("label", label);
                item.put("packageName", pkg);

                if (!normLabel.isEmpty() && (normLabel.equals(normQuery) || (!compactQuery.isEmpty() && compactLabel.equals(compactQuery)))) {
                    exactLabelMatches.add(item);
                } else if (!normLabel.isEmpty() && (normLabel.contains(normQuery) || normQuery.contains(normLabel) || (!compactQuery.isEmpty() && (compactLabel.contains(compactQuery) || compactQuery.contains(compactLabel))))) {
                    partialLabelMatches.add(item);
                } else if (pkgLower.equals(queryLower) || pkgLower.contains(queryLower) || normPkg.contains(normQuery) || (!compactQuery.isEmpty() && compactPkg.contains(compactQuery))) {
                    packageMatches.add(item);
                }
            }

            List<JSObject> targetList;
            if (!exactLabelMatches.isEmpty()) {
                targetList = exactLabelMatches;
            } else if (!partialLabelMatches.isEmpty()) {
                targetList = partialLabelMatches;
            } else {
                targetList = packageMatches;
            }

            if (targetList.isEmpty()) {
                String msg = "No installed launchable app found matching \"" + appName + "\".";
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("success", false);
                res.put("reason", msg);
                res.put("error", msg);
                call.resolve(res);
                return;
            }

            if (targetList.size() > 1) {
                JSArray matchesArr = new JSArray();
                for (int i = 0; i < Math.min(targetList.size(), 6); i++) {
                    matchesArr.put(targetList.get(i));
                }
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("success", false);
                res.put("needsClarification", true);
                res.put("matches", matchesArr);
                res.put("reason", "Multiple installed apps match \"" + appName + "\". Ask the user which one they want to open.");
                call.resolve(res);
                return;
            }

            JSObject chosen = targetList.get(0);
            String chosenPkg = chosen.getString("packageName");
            String chosenLabel = chosen.getString("label");
            Intent launch = pm.getLaunchIntentForPackage(chosenPkg);
            if (launch == null) {
                String msg = "Found app \"" + chosenLabel + "\" (" + chosenPkg + "), but it has no launch intent.";
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("success", false);
                res.put("reason", msg);
                res.put("error", msg);
                call.resolve(res);
                return;
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(launch);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("launchedPackage", chosenPkg);
            res.put("launchedLabel", chosenLabel);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "openApp failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", "Failed to open app: " + e.getMessage());
            res.put("error", "Failed to open app: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 3.1: find_contact — Search contacts by name and return matches (name and number).
     * Requests READ_CONTACTS at runtime if not yet granted.
     */
    @PluginMethod
    public void findContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "onFindContactPermissionResult");
            return;
        }
        executeFindContact(call);
    }

    @PermissionCallback
    private void onFindContactPermissionResult(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CONTACTS");
            res.put("error", "needs permission: READ_CONTACTS");
            call.resolve(res);
            return;
        }
        executeFindContact(call);
    }

    private void executeFindContact(PluginCall call) {
        String query = call.getString("query", "").trim();
        if (query.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Contact search query cannot be empty.");
            call.resolve(res);
            return;
        }

        JSArray contactsArr = new JSArray();
        Set<String> seenPairs = new HashSet<>();
        ContentResolver resolver = getContext().getContentResolver();

        String selection = ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " LIKE ?";
        String[] selectionArgs = new String[] { "%" + query + "%" };
        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = resolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY + " ASC"
        )) {
            if (cursor != null) {
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (cursor.moveToNext() && contactsArr.length() < 15) {
                    String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "";
                    String number = numIdx >= 0 ? cursor.getString(numIdx) : "";
                    if (name == null) name = "";
                    if (number == null) number = "";
                    String key = name.trim() + "|" + number.trim();
                    if (!number.trim().isEmpty() && !seenPairs.contains(key)) {
                        seenPairs.add(key);
                        JSObject item = new JSObject();
                        item.put("name", name.trim());
                        item.put("number", number.trim());
                        contactsArr.put(item);
                    }
                }
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("contacts", contactsArr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "findContact failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to query contacts: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 3.1: make_call — Start a call using ACTION_CALL with CALL_PHONE runtime permission,
     * falling back to ACTION_DIAL if permission is denied.
     */
    @PluginMethod
    public void makeCall(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "").trim();
        if (phoneNumber.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Phone number is required to make a call.");
            call.resolve(res);
            return;
        }

        if (getPermissionState("phone") != PermissionState.GRANTED) {
            requestPermissionForAlias("phone", call, "onMakeCallPermissionResult");
            return;
        }
        executeMakeCall(call, true);
    }

    @PermissionCallback
    private void onMakeCallPermissionResult(PluginCall call) {
        boolean granted = getPermissionState("phone") == PermissionState.GRANTED;
        executeMakeCall(call, granted);
    }

    private void executeMakeCall(PluginCall call, boolean hasCallPermission) {
        String phoneNumber = call.getString("phoneNumber", "").trim();
        Uri telUri = Uri.parse("tel:" + Uri.encode(phoneNumber));
        try {
            if (hasCallPermission) {
                Intent callIntent = new Intent(Intent.ACTION_CALL, telUri);
                callIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(callIntent);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("actionUsed", "ACTION_CALL");
                res.put("fallbackToDialer", false);
                res.put("phoneNumber", phoneNumber);
                call.resolve(res);
            } else {
                Intent dialIntent = new Intent(Intent.ACTION_DIAL, telUri);
                dialIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(dialIntent);

                JSObject res = new JSObject();
                res.put("success", true);
                res.put("actionUsed", "ACTION_DIAL");
                res.put("fallbackToDialer", true);
                res.put("phoneNumber", phoneNumber);
                call.resolve(res);
            }
        } catch (Exception e) {
            Log.e(TAG, "makeCall failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to start call or dialer: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 3.1: send_text — Send an SMS to a contact or number.
     * Defaults to opening the default messaging app pre-filled (ACTION_SENDTO).
     * Supports optional direct-send path using SEND_SMS permission behind a setting.
     */
    @PluginMethod
    public void sendText(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "").trim();
        String message = call.getString("message", "");
        boolean directSend = Boolean.TRUE.equals(call.getBoolean("directSend", false));

        if (phoneNumber.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Recipient phone number is required.");
            call.resolve(res);
            return;
        }

        if (directSend) {
            if (getPermissionState("sms") != PermissionState.GRANTED) {
                requestPermissionForAlias("sms", call, "onSendTextPermissionResult");
                return;
            }
            executeDirectSms(call, phoneNumber, message);
            return;
        }

        executeComposeSmsIntent(call, phoneNumber, message);
    }

    @PermissionCallback
    private void onSendTextPermissionResult(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "").trim();
        String message = call.getString("message", "");
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            executeDirectSms(call, phoneNumber, message);
        } else {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: SEND_SMS");
            res.put("error", "needs permission: SEND_SMS");
            call.resolve(res);
        }
    }

    private void executeDirectSms(PluginCall call, String phoneNumber, String message) {
        try {
            SmsManager smsManager = SmsManager.getDefault();
            ArrayList<String> parts = smsManager.divideMessage(message);
            if (parts.size() > 1) {
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null);
            } else {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null);
            }
            JSObject res = new JSObject();
            res.put("success", true);
            res.put("method", "DIRECT_SMS");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "Direct SMS failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to send SMS directly: " + e.getMessage());
            call.resolve(res);
        }
    }

    private void executeComposeSmsIntent(PluginCall call, String phoneNumber, String message) {
        try {
            Uri smsUri = Uri.parse("smsto:" + Uri.encode(phoneNumber));
            Intent intent = new Intent(Intent.ACTION_SENDTO, smsUri);
            intent.putExtra("sms_body", message);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("method", "ACTION_SENDTO");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "ACTION_SENDTO SMS failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Could not open messaging app: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 3.1: block_number — Save number to SharedPreferences blocklist for SierraCallScreeningService
     * and check/request ROLE_CALL_SCREENING.
     */
    @PluginMethod
    public void blockNumber(PluginCall call) {
        String phoneNumber = call.getString("phoneNumber", "").trim();
        if (phoneNumber.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Phone number is required to block.");
            call.resolve(res);
            return;
        }

        try {
            SharedPreferences prefs = getContext().getSharedPreferences(
                    SierraCallScreeningService.PREFS_NAME,
                    Context.MODE_PRIVATE
            );
            Set<String> current = prefs.getStringSet(SierraCallScreeningService.KEY_BLOCKED_NUMBERS, new HashSet<>());
            Set<String> updated = new HashSet<>(current != null ? current : new HashSet<>());
            updated.add(phoneNumber);
            prefs.edit().putStringSet(SierraCallScreeningService.KEY_BLOCKED_NUMBERS, updated).apply();

            boolean roleHeld = isCallScreeningRoleHeld();
            JSArray blockedArr = new JSArray();
            for (String num : updated) {
                blockedArr.put(num);
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("blockedNumber", phoneNumber);
            res.put("roleGranted", roleHeld);
            res.put("blockedList", blockedArr);
            if (!roleHeld) {
                res.put(
                    "roleGuideMessage",
                    "To actively screen and reject calls on Android, please grant Sierra the Call Screening role in Settings > Device Control (or Android Settings > Apps > Default apps > Caller ID & spam app)."
                );
            }
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "blockNumber failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to save blocked number: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4.1: open_maps — Open Google Maps or default maps app for directions or place search.
     */
    @PluginMethod
    public void openMaps(PluginCall call) {
        String destination = call.getString("destination", "").trim();
        String travelMode = call.getString("travelMode", "").trim().toLowerCase(Locale.ROOT);
        if (destination.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Destination is required for open_maps.");
            call.resolve(res);
            return;
        }

        try {
            Uri uri;
            if (!travelMode.isEmpty()) {
                String modeCode = "d";
                if (travelMode.startsWith("w")) modeCode = "w";
                else if (travelMode.startsWith("t") || travelMode.startsWith("r")) modeCode = "r";
                else if (travelMode.startsWith("b")) modeCode = "b";
                uri = Uri.parse("google.navigation:q=" + Uri.encode(destination) + "&mode=" + modeCode);
            } else {
                uri = Uri.parse("geo:0,0?q=" + Uri.encode(destination));
            }

            Intent mapIntent = new Intent(Intent.ACTION_VIEW, uri);
            mapIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            mapIntent.setPackage("com.google.android.apps.maps");

            PackageManager pm = getContext().getPackageManager();
            if (mapIntent.resolveActivity(pm) != null) {
                getContext().startActivity(mapIntent);
            } else {
                // Fallback to any installed maps handler or geo URI
                Intent fallbackIntent = new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(destination)));
                fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallbackIntent);
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("uriUsed", uri.toString());
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "openMaps failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Could not open maps app: " + e.getMessage());
            call.resolve(res);
        }
    }

    private long parseIsoToMillis(String iso, long fallbackMillis) {
        if (iso == null || iso.trim().isEmpty()) return fallbackMillis;
        String clean = iso.trim();
        String[] patterns = new String[] {
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mmX",
            "yyyy-MM-dd'T'HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "yyyy-MM-dd"
        };
        for (String pattern : patterns) {
            try {
                SimpleDateFormat sdf = new SimpleDateFormat(pattern, Locale.US);
                Date d = sdf.parse(clean);
                if (d != null) return d.getTime();
            } catch (ParseException ignored) {
            }
        }
        return fallbackMillis;
    }

    private String formatMillisToIso(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        return sdf.format(new Date(millis));
    }

    private long findPrimaryWritableCalendarId(ContentResolver resolver) {
        String[] projection = new String[] {
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL
        };
        long fallbackId = -1;
        try (Cursor cursor = resolver.query(
                CalendarContract.Calendars.CONTENT_URI,
                projection,
                CalendarContract.Calendars.VISIBLE + " = 1",
                null,
                null
        )) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(0);
                    int isPrimary = cursor.getInt(1);
                    int access = cursor.getInt(2);
                    if (access >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                        if (isPrimary == 1) return id;
                        if (fallbackId == -1) fallbackId = id;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error querying writable calendar", e);
        }
        return fallbackId != -1 ? fallbackId : 1L;
    }

    /**
     * Task 4.2: add_calendar_event — Create an event through Android CalendarContract provider.
     * Requests READ_CALENDAR and WRITE_CALENDAR at runtime.
     */
    @PluginMethod
    public void addCalendarEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "onAddCalendarEventPermissionResult");
            return;
        }
        executeAddCalendarEvent(call);
    }

    @PermissionCallback
    private void onAddCalendarEventPermissionResult(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CALENDAR / WRITE_CALENDAR");
            res.put("error", "needs permission: READ_CALENDAR / WRITE_CALENDAR");
            call.resolve(res);
            return;
        }
        executeAddCalendarEvent(call);
    }

    private void executeAddCalendarEvent(PluginCall call) {
        String title = call.getString("title", "").trim();
        String startIso = call.getString("startTimeIso", "").trim();
        String endIso = call.getString("endTimeIso", "").trim();
        String description = call.getString("description", "");
        String location = call.getString("location", "");

        if (title.isEmpty() || startIso.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Event title and startTimeIso are required.");
            call.resolve(res);
            return;
        }

        long now = System.currentTimeMillis();
        long startMillis = parseIsoToMillis(startIso, now + 3600_000L);
        long endMillis = parseIsoToMillis(endIso, startMillis + 3600_000L);
        if (endMillis <= startMillis) {
            endMillis = startMillis + 3600_000L;
        }

        try {
            ContentResolver resolver = getContext().getContentResolver();
            long calId = findPrimaryWritableCalendarId(resolver);

            ContentValues values = new ContentValues();
            values.put(CalendarContract.Events.DTSTART, startMillis);
            values.put(CalendarContract.Events.DTEND, endMillis);
            values.put(CalendarContract.Events.TITLE, title);
            values.put(CalendarContract.Events.DESCRIPTION, description);
            values.put(CalendarContract.Events.EVENT_LOCATION, location);
            values.put(CalendarContract.Events.CALENDAR_ID, calId);
            values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());

            Uri uri = resolver.insert(CalendarContract.Events.CONTENT_URI, values);
            long eventId = uri != null ? ContentUris.parseId(uri) : -1L;

            JSObject res = new JSObject();
            res.put("success", eventId > 0);
            res.put("eventId", eventId);
            res.put("title", title);
            res.put("startTimeIso", formatMillisToIso(startMillis));
            res.put("endTimeIso", formatMillisToIso(endMillis));
            if (eventId <= 0) {
                res.put("error", "Calendar provider did not return a valid event ID.");
            }
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "addCalendarEvent failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to insert calendar event: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4.2: find_calendar_events — Look up upcoming events through Android CalendarContract.
     */
    @PluginMethod
    public void findCalendarEvents(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "onFindCalendarEventsPermissionResult");
            return;
        }
        executeFindCalendarEvents(call);
    }

    @PermissionCallback
    private void onFindCalendarEventsPermissionResult(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CALENDAR");
            res.put("error", "needs permission: READ_CALENDAR");
            call.resolve(res);
            return;
        }
        executeFindCalendarEvents(call);
    }

    private void executeFindCalendarEvents(PluginCall call) {
        String query = call.getString("query", "").trim().toLowerCase(Locale.ROOT);
        String startIso = call.getString("startTimeIso", "").trim();
        String endIso = call.getString("endTimeIso", "").trim();
        Integer maxResultsObj = call.getInt("maxResults", 10);
        int maxResults = maxResultsObj != null ? Math.max(1, Math.min(maxResultsObj, 50)) : 10;

        long now = System.currentTimeMillis();
        long startMillis = parseIsoToMillis(startIso, now);
        long endMillis = parseIsoToMillis(endIso, startMillis + 7L * 24L * 3600_000L);

        JSArray eventsArr = new JSArray();
        ContentResolver resolver = getContext().getContentResolver();

        String[] projection = new String[] {
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.DESCRIPTION
        };

        String selection = CalendarContract.Events.DTSTART + " >= ? AND " + CalendarContract.Events.DTSTART + " <= ? AND " + CalendarContract.Events.DELETED + " != 1";
        String[] selectionArgs = new String[] {
            String.valueOf(startMillis),
            String.valueOf(endMillis)
        };

        try (Cursor cursor = resolver.query(
                CalendarContract.Events.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                CalendarContract.Events.DTSTART + " ASC"
        )) {
            if (cursor != null) {
                while (cursor.moveToNext() && eventsArr.length() < maxResults) {
                    String id = String.valueOf(cursor.getLong(0));
                    String title = cursor.getString(1) != null ? cursor.getString(1) : "(Untitled)";
                    long dtStart = cursor.getLong(2);
                    long dtEnd = cursor.getLong(3) > 0 ? cursor.getLong(3) : (dtStart + 3600_000L);
                    String location = cursor.getString(4) != null ? cursor.getString(4) : "";
                    String description = cursor.getString(5) != null ? cursor.getString(5) : "";

                    if (!query.isEmpty()) {
                        String combined = (title + " " + description + " " + location).toLowerCase(Locale.ROOT);
                        if (!combined.contains(query)) continue;
                    }

                    JSObject ev = new JSObject();
                    ev.put("id", id);
                    ev.put("title", title);
                    ev.put("startTimeIso", formatMillisToIso(dtStart));
                    ev.put("endTimeIso", formatMillisToIso(dtEnd));
                    ev.put("location", location);
                    ev.put("description", description);
                    eventsArr.put(ev);
                }
            }

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("events", eventsArr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "findCalendarEvents failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Failed to query calendar events: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4.3: set_alarm — Set an alarm using AlarmClock.ACTION_SET_ALARM.
     */
    @PluginMethod
    public void setAlarm(PluginCall call) {
        Integer hourObj = call.getInt("hour", 8);
        Integer minObj = call.getInt("minute", 0);
        String message = call.getString("message", "");

        int hour = hourObj != null ? Math.max(0, Math.min(23, hourObj)) : 8;
        int minute = minObj != null ? Math.max(0, Math.min(59, minObj)) : 0;

        try {
            Intent intent = new Intent(AlarmClock.ACTION_SET_ALARM);
            intent.putExtra(AlarmClock.EXTRA_HOUR, hour);
            intent.putExtra(AlarmClock.EXTRA_MINUTES, minute);
            if (message != null && !message.isEmpty()) {
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
            }
            intent.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("hour", hour);
            res.put("minute", minute);
            res.put("message", message);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "setAlarm failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Could not set alarm in Clock app: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4.3: set_timer — Start a timer using AlarmClock.ACTION_SET_TIMER.
     */
    @PluginMethod
    public void setTimer(PluginCall call) {
        Integer durationObj = call.getInt("durationSeconds", 60);
        String message = call.getString("message", "");
        int durationSeconds = durationObj != null ? Math.max(1, durationObj) : 60;

        try {
            Intent intent = new Intent(AlarmClock.ACTION_SET_TIMER);
            intent.putExtra(AlarmClock.EXTRA_LENGTH, durationSeconds);
            if (message != null && !message.isEmpty()) {
                intent.putExtra(AlarmClock.EXTRA_MESSAGE, message);
            }
            intent.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject res = new JSObject();
            res.put("success", true);
            res.put("durationSeconds", durationSeconds);
            res.put("message", message);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "setTimer failed", e);
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Could not start timer in Clock app: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4.4: create_reminder — Create a calendar event with a CalendarContract.Reminders alert
     * at the requested time, since Android has no universal reminders app.
     */
    @PluginMethod
    public void createReminder(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "onCreateReminderPermissionResult");
            return;
        }
        executeCreateReminder(call);
    }

    @PermissionCallback
    private void onCreateReminderPermissionResult(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CALENDAR / WRITE_CALENDAR");
            res.put("error", "needs permission: READ_CALENDAR / WRITE_CALENDAR");
            call.resolve(res);
            return;
        }
        executeCreateReminder(call);
    }

    private void executeCreateReminder(PluginCall call) {
        String title = call.getString("title", "").trim();
        String remindAtIso = call.getString("remindAtIso", "").trim();
        String notes = call.getString("notes", "");
        Integer minBeforeObj = call.getInt("minutesBeforeAlert", 0);
        int minutesBefore = minBeforeObj != null ? Math.max(0, minBeforeObj) : 0;

        if (title.isEmpty() || remindAtIso.isEmpty()) {
            JSObject res = new JSObject();
            res.put("success", false);
            res.put("error", "Reminder title and remindAtIso are required.");
            call.resolve(res);
            return;
        }

        long now = System.currentTimeMillis();
        long startMillis = parseIsoToMillis(remindAtIso, now + 900_000L);
        long endMillis = startMillis + 15L * 60_000L;

        try {
            ContentResolver resolver = getContext().getContentResolver();
            long calId = findPrimaryWritableCalendarId(resolver);

            ContentValues eventValues = new ContentValues();
            eventValues.put(CalendarContract.Events.DTSTART, startMillis);
            eventValues.put(CalendarContract.Events.DTEND, endMillis);
            eventValues.put(CalendarContract.Events.TITLE, "[Reminder] " + title);
            eventValues.put(CalendarContract.Events.DESCRIPTION, notes != null ? notes : "Created by Sierra Reminder");
            eventValues.put(CalendarContract.Events.CALENDAR_ID, calId);
            eventValues.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            eventValues.put(CalendarContract.Events.HAS_ALARM, 1);

            Uri eventUri = resolver.insert(CalendarContract.Events.CONTENT_URI, eventValues);
            long eventId = eventUri != null ? ContentUris.parseId(eventUri) : -1L;

            if (eventId > 0) {
                ContentValues reminderValues = new ContentValues();
                reminderValues.put(CalendarContract.Reminders.EVENT_ID, eventId);
                reminderValues.put(CalendarContract.Reminders.MINUTES, minutesBefore);
                reminderValues.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                resolver.insert(CalendarContract.Reminders.CONTENT_URI, reminderValues);
            }

            JSObject res = new JSObject();
            res.put("ok", eventId > 0);
            res.put("success", eventId > 0);
            res.put("eventId", eventId);
            res.put("title", title);
            res.put("remindAtIso", formatMillisToIso(startMillis));
            res.put("storedInCalendar", true);
            if (eventId <= 0) {
                res.put("reason", "Failed to insert reminder event into Calendar provider.");
                res.put("error", "Failed to insert reminder event into Calendar provider.");
            }
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "createReminder failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", "Failed to create calendar reminder: " + e.getMessage());
            res.put("error", "Failed to create calendar reminder: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * list_reminders — List reminders stored in Android CalendarContract (events with HAS_ALARM=1 or [Reminder] prefix).
     * Requests READ_CALENDAR at runtime if missing.
     */
    @PluginMethod
    public void listReminders(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "onListRemindersPermissionResult");
            return;
        }
        executeListReminders(call);
    }

    @PermissionCallback
    private void onListRemindersPermissionResult(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CALENDAR");
            res.put("error", "needs permission: READ_CALENDAR");
            call.resolve(res);
            return;
        }
        executeListReminders(call);
    }

    private void executeListReminders(PluginCall call) {
        String query = call.getString("query", "").trim().toLowerCase(Locale.ROOT);
        boolean includePast = Boolean.TRUE.equals(call.getBoolean("includePast", false));
        Integer maxObj = call.getInt("maxResults", 10);
        int maxResults = maxObj != null ? Math.max(1, Math.min(50, maxObj)) : 10;

        long now = System.currentTimeMillis();
        long minStart = includePast ? (now - 30L * 24L * 3600_000L) : (now - 3600_000L);

        ContentResolver resolver = getContext().getContentResolver();
        JSArray remindersArr = new JSArray();

        String[] projection = new String[] {
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DESCRIPTION,
            CalendarContract.Events.HAS_ALARM
        };

        String selection = CalendarContract.Events.DTSTART + " >= ? AND "
                + CalendarContract.Events.DELETED + " != 1 AND ("
                + CalendarContract.Events.HAS_ALARM + " = 1 OR "
                + CalendarContract.Events.TITLE + " LIKE ?)";
        String[] selectionArgs = new String[] {
            String.valueOf(minStart),
            "%[Reminder]%"
        };

        try (Cursor cursor = resolver.query(
                CalendarContract.Events.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                CalendarContract.Events.DTSTART + " ASC"
        )) {
            if (cursor != null) {
                while (cursor.moveToNext() && remindersArr.length() < maxResults) {
                    long eventId = cursor.getLong(0);
                    String rawTitle = cursor.getString(1) != null ? cursor.getString(1) : "(Untitled Reminder)";
                    long dtStart = cursor.getLong(2);
                    String notes = cursor.getString(3) != null ? cursor.getString(3) : "";

                    String cleanTitle = rawTitle.startsWith("[Reminder] ")
                            ? rawTitle.substring("[Reminder] ".length()).trim()
                            : rawTitle;

                    if (!query.isEmpty()) {
                        String combined = (cleanTitle + " " + notes).toLowerCase(Locale.ROOT);
                        if (!combined.contains(query)) continue;
                    }

                    JSObject rem = new JSObject();
                    rem.put("id", String.valueOf(eventId));
                    rem.put("title", cleanTitle);
                    rem.put("remindAtIso", formatMillisToIso(dtStart));
                    rem.put("notes", notes);
                    remindersArr.put(rem);
                }
            }

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("count", remindersArr.length());
            res.put("reminders", remindersArr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "listReminders failed", e);
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", "Failed to list reminders: " + e.getMessage());
            res.put("error", "Failed to list reminders: " + e.getMessage());
            call.resolve(res);
        }
    }

    /**
     * Task 4: open_url — Opens a web page in the default browser via ACTION_VIEW.
     * Accepts a URL or bare domain, adds https:// when no scheme is present, and rejects anything not http: or https:.
     */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        if (rawUrl.isEmpty()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", "URL is required for open_url.");
            res.put("error", "URL is required for open_url.");
            call.resolve(res);
            return;
        }

        String candidate = rawUrl;
        if (!candidate.matches("^[a-zA-Z][a-zA-Z0-9+.-]*:.*")) {
            candidate = "https://" + candidate;
        }

        Uri uri = Uri.parse(candidate);
        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase(Locale.ROOT) : "";
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            String msg = "Rejected URL scheme \"" + scheme + ":\". Only http: and https: URLs are allowed.";
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", msg);
            res.put("error", msg);
            call.resolve(res);
            return;
        }

        try {
            Intent viewIntent = new Intent(Intent.ACTION_VIEW, uri);
            viewIntent.addCategory(Intent.CATEGORY_BROWSABLE);
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(viewIntent);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("url", uri.toString());
            res.put("message", "Opened " + uri.toString() + " in default browser.");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "openUrl failed", e);
            String msg = "Could not open URL in browser: " + e.getMessage();
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", msg);
            res.put("error", msg);
            call.resolve(res);
        }
    }

    /**
     * Task 4: web_search — Takes a query and opens a browser search results page for it.
     */
    @PluginMethod
    public void webSearch(PluginCall call) {
        String query = call.getString("query", "").trim();
        if (query.isEmpty()) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", "Search query is required for web_search.");
            res.put("error", "Search query is required for web_search.");
            call.resolve(res);
            return;
        }

        try {
            String searchUrl = "https://www.google.com/search?q=" + Uri.encode(query);
            Uri uri = Uri.parse(searchUrl);
            Intent viewIntent = new Intent(Intent.ACTION_VIEW, uri);
            viewIntent.addCategory(Intent.CATEGORY_BROWSABLE);
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(viewIntent);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("query", query);
            res.put("url", searchUrl);
            res.put("message", "Opened browser search results for \"" + query + "\".");
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "webSearch failed", e);
            String msg = "Could not open browser for web search: " + e.getMessage();
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", msg);
            res.put("error", msg);
            call.resolve(res);
        }
    }

    private String resolveContactDisplayNameByNumber(ContentResolver resolver, String phoneNumber) {
        if (phoneNumber == null || phoneNumber.trim().isEmpty()) return "";
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            return "";
        }
        Uri lookupUri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(phoneNumber.trim())
        );
        String[] projection = new String[] { ContactsContract.PhoneLookup.DISPLAY_NAME };
        try (Cursor c = resolver.query(lookupUri, projection, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.trim().isEmpty()) {
                    return name.trim();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    /**
     * Task 4: read_messages — Reads the user's SMS inbox via READ_SMS (Telephony.Sms.Inbox.CONTENT_URI).
     * Parameters: optional contact (name or number filter), optional unreadOnly (boolean), optional maxResults (default 5, cap 20).
     */
    @PluginMethod
    public void readMessages(PluginCall call) {
        if (getPermissionState("read_sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("read_sms", call, "onReadMessagesPermissionResult");
            return;
        }
        executeReadMessages(call);
    }

    @PermissionCallback
    private void onReadMessagesPermissionResult(PluginCall call) {
        if (getPermissionState("read_sms") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_SMS");
            res.put("error", "needs permission: READ_SMS");
            call.resolve(res);
            return;
        }
        executeReadMessages(call);
    }

    private void executeReadMessages(PluginCall call) {
        String contactFilter = call.getString("contact", "").trim().toLowerCase(Locale.ROOT);
        boolean unreadOnly = Boolean.TRUE.equals(call.getBoolean("unreadOnly", false));
        Integer maxObj = call.getInt("maxResults", 5);
        int maxResults = maxObj != null ? Math.max(1, Math.min(20, maxObj)) : 5;

        ContentResolver resolver = getContext().getContentResolver();
        JSArray messagesArr = new JSArray();

        String selection = unreadOnly ? (Telephony.Sms.READ + " = 0") : null;
        String[] projection = new String[] {
            Telephony.Sms._ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.DATE,
            Telephony.Sms.READ,
            Telephony.Sms.BODY
        };

        try (Cursor cursor = resolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                selection,
                null,
                Telephony.Sms.DATE + " DESC"
        )) {
            if (cursor != null) {
                int addrIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS);
                int dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE);
                int readIdx = cursor.getColumnIndex(Telephony.Sms.READ);
                int bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY);

                while (cursor.moveToNext() && messagesArr.length() < maxResults) {
                    String address = addrIdx >= 0 && cursor.getString(addrIdx) != null ? cursor.getString(addrIdx).trim() : "";
                    long timestamp = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0L;
                    boolean isRead = readIdx >= 0 && cursor.getInt(readIdx) == 1;
                    String body = bodyIdx >= 0 && cursor.getString(bodyIdx) != null ? cursor.getString(bodyIdx) : "";

                    String resolvedName = resolveContactDisplayNameByNumber(resolver, address);
                    String senderDisplay = !resolvedName.isEmpty() ? resolvedName : (!address.isEmpty() ? address : "Unknown");

                    if (!contactFilter.isEmpty()) {
                        String combined = (senderDisplay + " " + address).toLowerCase(Locale.ROOT);
                        String digitsFilter = contactFilter.replaceAll("[^0-9+]", "");
                        String digitsAddr = address.replaceAll("[^0-9+]", "");
                        boolean nameOrRawMatch = combined.contains(contactFilter);
                        boolean digitMatch = !digitsFilter.isEmpty() && digitsAddr.contains(digitsFilter);
                        if (!nameOrRawMatch && !digitMatch) {
                            continue;
                        }
                    }

                    JSObject msgObj = new JSObject();
                    msgObj.put("sender", senderDisplay);
                    msgObj.put("number", address);
                    msgObj.put("timestamp", timestamp);
                    msgObj.put("dateIso", formatMillisToIso(timestamp));
                    msgObj.put("read", isRead);
                    msgObj.put("body", body);
                    messagesArr.put(msgObj);
                }
            }

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("count", messagesArr.length());
            res.put("messages", messagesArr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "readMessages failed", e);
            String msg = "Failed to read SMS inbox: " + e.getMessage();
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", msg);
            res.put("error", msg);
            call.resolve(res);
        }
    }

    /**
     * Task 4: read_call_log — Reads recent calls via READ_CALL_LOG (CallLog.Calls.CONTENT_URI).
     * Parameters: optional contact filter, optional type (missed, incoming, outgoing), optional maxResults (default 5, cap 20).
     */
    @PluginMethod
    public void readCallLog(PluginCall call) {
        if (getPermissionState("call_log") != PermissionState.GRANTED) {
            requestPermissionForAlias("call_log", call, "onReadCallLogPermissionResult");
            return;
        }
        executeReadCallLog(call);
    }

    @PermissionCallback
    private void onReadCallLogPermissionResult(PluginCall call) {
        if (getPermissionState("call_log") != PermissionState.GRANTED) {
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("status", "needs_permission");
            res.put("permissionDenied", true);
            res.put("reason", "needs permission: READ_CALL_LOG");
            res.put("error", "needs permission: READ_CALL_LOG");
            call.resolve(res);
            return;
        }
        executeReadCallLog(call);
    }

    private String mapCallLogType(int callType) {
        if (callType == CallLog.Calls.INCOMING_TYPE) return "incoming";
        if (callType == CallLog.Calls.OUTGOING_TYPE) return "outgoing";
        if (callType == CallLog.Calls.MISSED_TYPE || callType == CallLog.Calls.REJECTED_TYPE) return "missed";
        return "other";
    }

    private void executeReadCallLog(PluginCall call) {
        String contactFilter = call.getString("contact", "").trim().toLowerCase(Locale.ROOT);
        String typeFilter = call.getString("type", "").trim().toLowerCase(Locale.ROOT);
        Integer maxObj = call.getInt("maxResults", 5);
        int maxResults = maxObj != null ? Math.max(1, Math.min(20, maxObj)) : 5;

        ContentResolver resolver = getContext().getContentResolver();
        JSArray callsArr = new JSArray();

        String[] projection = new String[] {
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION
        };

        try (Cursor cursor = resolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                null,
                null,
                CallLog.Calls.DATE + " DESC"
        )) {
            if (cursor != null) {
                int numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER);
                int nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME);
                int typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE);
                int dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE);
                int durIdx = cursor.getColumnIndex(CallLog.Calls.DURATION);

                while (cursor.moveToNext() && callsArr.length() < maxResults) {
                    String number = numIdx >= 0 && cursor.getString(numIdx) != null ? cursor.getString(numIdx).trim() : "";
                    String cachedName = nameIdx >= 0 && cursor.getString(nameIdx) != null ? cursor.getString(nameIdx).trim() : "";
                    int rawType = typeIdx >= 0 ? cursor.getInt(typeIdx) : 0;
                    long timestamp = dateIdx >= 0 ? cursor.getLong(dateIdx) : 0L;
                    long durationSeconds = durIdx >= 0 ? cursor.getLong(durIdx) : 0L;

                    String mappedType = mapCallLogType(rawType);
                    if (!typeFilter.isEmpty() && ("missed".equals(typeFilter) || "incoming".equals(typeFilter) || "outgoing".equals(typeFilter))) {
                        if (!typeFilter.equals(mappedType)) {
                            continue;
                        }
                    }

                    String displayName = !cachedName.isEmpty() ? cachedName : resolveContactDisplayNameByNumber(resolver, number);
                    String nameOrNumber = !displayName.isEmpty() ? displayName : (!number.isEmpty() ? number : "Unknown");

                    if (!contactFilter.isEmpty()) {
                        String combined = (nameOrNumber + " " + number).toLowerCase(Locale.ROOT);
                        String digitsFilter = contactFilter.replaceAll("[^0-9+]", "");
                        String digitsNum = number.replaceAll("[^0-9+]", "");
                        boolean nameOrRawMatch = combined.contains(contactFilter);
                        boolean digitMatch = !digitsFilter.isEmpty() && digitsNum.contains(digitsFilter);
                        if (!nameOrRawMatch && !digitMatch) {
                            continue;
                        }
                    }

                    JSObject callObj = new JSObject();
                    callObj.put("name", nameOrNumber);
                    callObj.put("number", number);
                    callObj.put("type", mappedType);
                    callObj.put("timestamp", timestamp);
                    callObj.put("dateIso", formatMillisToIso(timestamp));
                    callObj.put("durationSeconds", durationSeconds);
                    callsArr.put(callObj);
                }
            }

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("success", true);
            res.put("count", callsArr.length());
            res.put("calls", callsArr);
            call.resolve(res);
        } catch (Exception e) {
            Log.e(TAG, "readCallLog failed", e);
            String msg = "Failed to read call log: " + e.getMessage();
            JSObject res = new JSObject();
            res.put("ok", false);
            res.put("success", false);
            res.put("reason", msg);
            res.put("error", msg);
            call.resolve(res);
        }
    }

    /**
     * Task 4: get_current_time — Returns the device's current date, time, day of week, and timezone.
     */
    @PluginMethod
    public void getCurrentTime(PluginCall call) {
        long now = System.currentTimeMillis();
        Date d = new Date(now);
        TimeZone tz = TimeZone.getDefault();

        SimpleDateFormat isoFmt = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US);
        isoFmt.setTimeZone(tz);
        SimpleDateFormat dateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        dateFmt.setTimeZone(tz);
        SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm:ss", Locale.US);
        timeFmt.setTimeZone(tz);
        SimpleDateFormat dowFmt = new SimpleDateFormat("EEEE", Locale.US);
        dowFmt.setTimeZone(tz);

        String iso = isoFmt.format(d);
        String dateStr = dateFmt.format(d);
        String timeStr = timeFmt.format(d);
        String dayOfWeek = dowFmt.format(d);
        String tzId = tz.getID();
        int offsetMinutes = tz.getOffset(now) / 60000;

        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("success", true);
        res.put("timestampMs", now);
        res.put("iso", iso);
        res.put("date", dateStr);
        res.put("time", timeStr);
        res.put("dayOfWeek", dayOfWeek);
        res.put("timezone", tzId);
        res.put("timezoneOffsetMinutes", offsetMinutes);
        res.put("message", "Current device time is " + dayOfWeek + ", " + dateStr + " " + timeStr + " (" + tzId + ").");
        call.resolve(res);
    }
}
