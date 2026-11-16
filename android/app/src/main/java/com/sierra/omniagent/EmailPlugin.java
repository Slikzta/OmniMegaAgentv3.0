package com.sierra.omniagent;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

@CapacitorPlugin(name = "SierraEmail")
public class EmailPlugin extends Plugin {
    private static final String TAG = "SierraEmailPlugin";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "sierra_email_keystore_aes_v1";
    private static final String VAULT_PREFS = "sierra_email_keystore_vault";
    private static final String STATE_PREFS = "sierra_persistent_app_state";
    private static final String PENDING_OAUTH_KEY = "pending_oauth_pkce";
    private static final String DEFAULT_GMAIL_CLIENT_ID = "1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl.apps.googleusercontent.com";
    private static final String DEFAULT_GMAIL_REDIRECT_URI = "com.googleusercontent.apps.1081438983961-gtrhb2po2mcdf3mhh0jctm19g2iu9gtl:/oauth2redirect";
    private static final int GCM_TAG_BITS = 128;

    private SecretKey getOrCreateKeystoreSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES,
                ANDROID_KEYSTORE
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private String encryptSecret(String plaintext) throws Exception {
        if (plaintext == null || plaintext.isEmpty()) return "";
        SecretKey secretKey = getOrCreateKeystoreSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        String ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP);
        String ctB64 = Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        return ivB64 + ":" + ctB64;
    }

    private String decryptSecret(String payload) throws Exception {
        if (payload == null || payload.isEmpty() || !payload.contains(":")) return "";
        String[] parts = payload.split(":", 2);
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] ciphertext = Base64.decode(parts[1], Base64.NO_WRAP);
        SecretKey secretKey = getOrCreateKeystoreSecretKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_BITS, iv);
        cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
        byte[] plainBytes = cipher.doFinal(ciphertext);
        return new String(plainBytes, StandardCharsets.UTF_8);
    }

    private SharedPreferences getVaultPrefs() {
        return getContext().getSharedPreferences(VAULT_PREFS, Context.MODE_PRIVATE);
    }

    private SharedPreferences getStatePrefs() {
        return getContext().getSharedPreferences(STATE_PREFS, Context.MODE_PRIVATE);
    }

    private JSONObject readDecryptedAccountVault(String accountId) {
        if (accountId == null || accountId.trim().isEmpty()) return null;
        try {
            String encrypted = getVaultPrefs().getString("acct_" + accountId.trim(), null);
            if (encrypted == null || encrypted.isEmpty()) return null;
            String jsonStr = decryptSecret(encrypted);
            if (jsonStr.isEmpty()) return null;
            return new JSONObject(jsonStr);
        } catch (Exception e) {
            Log.w(TAG, "Unable to read encrypted account vault for id=" + accountId);
            return null;
        }
    }

    private void writeEncryptedAccountVault(String accountId, JSONObject secretObj) throws Exception {
        String encrypted = encryptSecret(secretObj.toString());
        getVaultPrefs().edit().putString("acct_" + accountId.trim(), encrypted).commit();
    }

    private String generatePkceCodeVerifier() {
        byte[] randomBytes = new byte[32];
        new SecureRandom().nextBytes(randomBytes);
        return Base64.encodeToString(randomBytes, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private String generatePkceCodeChallenge(String codeVerifier) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(codeVerifier.getBytes(StandardCharsets.US_ASCII));
        return Base64.encodeToString(hash, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private String deriveGoogleReverseClientRedirectUri(String clientId, String fallback) {
        if (clientId != null && clientId.endsWith(".apps.googleusercontent.com")) {
            String prefix = clientId.substring(0, clientId.length() - ".apps.googleusercontent.com".length());
            if (!prefix.isEmpty()) {
                return "com.googleusercontent.apps." + prefix + ":/oauth2redirect";
            }
        }
        return (fallback != null && !fallback.isEmpty()) ? fallback : DEFAULT_GMAIL_REDIRECT_URI;
    }

    /**
     * Launches an on-device PKCE OAuth 2.0 sign-in flow in the system browser for Gmail or Outlook.
     * When the user completes consent, Android routes the custom-scheme redirect back to MainActivity,
     * where handleOnNewIntent exchanges the code + PKCE verifier directly with Google/Microsoft and
     * vaults the tokens in Android Keystore.
     */
    @PluginMethod
    public void startOAuthSignIn(PluginCall call) {
        String provider = call.getString("provider", "gmail").trim().toLowerCase(Locale.ROOT);
        String rawClientId = call.getString("clientId", "").trim();
        String clientId = !rawClientId.isEmpty()
                ? rawClientId
                : ("gmail".equals(provider) ? DEFAULT_GMAIL_CLIENT_ID : "");
        String rawRedirectUri = call.getString("redirectUri", "").trim();
        String redirectUri = "gmail".equals(provider)
                ? deriveGoogleReverseClientRedirectUri(clientId, rawRedirectUri)
                : (!rawRedirectUri.isEmpty() ? rawRedirectUri : "msauth://com.sierra.omniagent/oauth2redirect");
        String emailHint = call.getString("email", "").trim();
        String displayName = call.getString("displayName", "").trim();

        if (clientId.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "OAuth Client ID is required.");
            call.resolve(err);
            return;
        }

        try {
            String codeVerifier = generatePkceCodeVerifier();
            String codeChallenge = generatePkceCodeChallenge(codeVerifier);

            JSONObject pending = new JSONObject();
            pending.put("provider", provider);
            pending.put("clientId", clientId);
            pending.put("redirectUri", redirectUri);
            pending.put("codeVerifier", codeVerifier);
            pending.put("emailHint", emailHint);
            pending.put("displayName", displayName);
            pending.put("createdAtMs", System.currentTimeMillis());
            getVaultPrefs().edit().putString(PENDING_OAUTH_KEY, encryptSecret(pending.toString())).commit();

            String authUrl;
            if ("gmail".equals(provider)) {
                String scopes = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";
                StringBuilder sb = new StringBuilder("https://accounts.google.com/o/oauth2/v2/auth?");
                sb.append("client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
                sb.append("&redirect_uri=").append(URLEncoder.encode(redirectUri, "UTF-8"));
                sb.append("&response_type=code");
                sb.append("&scope=").append(URLEncoder.encode(scopes, "UTF-8"));
                sb.append("&access_type=offline");
                sb.append("&prompt=consent");
                sb.append("&code_challenge=").append(URLEncoder.encode(codeChallenge, "UTF-8"));
                sb.append("&code_challenge_method=S256");
                if (!emailHint.isEmpty()) {
                    sb.append("&login_hint=").append(URLEncoder.encode(emailHint, "UTF-8"));
                }
                authUrl = sb.toString();
            } else {
                String scopes = "offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read";
                StringBuilder sb = new StringBuilder("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?");
                sb.append("client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
                sb.append("&redirect_uri=").append(URLEncoder.encode(redirectUri, "UTF-8"));
                sb.append("&response_type=code");
                sb.append("&scope=").append(URLEncoder.encode(scopes, "UTF-8"));
                sb.append("&prompt=select_account");
                sb.append("&code_challenge=").append(URLEncoder.encode(codeChallenge, "UTF-8"));
                sb.append("&code_challenge_method=S256");
                if (!emailHint.isEmpty()) {
                    sb.append("&login_hint=").append(URLEncoder.encode(emailHint, "UTF-8"));
                }
                authUrl = sb.toString();
            }

            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(authUrl));
            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getActivity() != null) {
                getActivity().startActivity(browserIntent);
            } else {
                getContext().startActivity(browserIntent);
            }

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("launched", true);
            res.put("provider", provider);
            res.put("clientId", clientId);
            res.put("redirectUri", redirectUri);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "Failed to start OAuth sign-in: " + e.getMessage());
            call.resolve(err);
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null) return;
        final Uri data = intent.getData();
        if (data == null) return;
        final String scheme = data.getScheme() != null ? data.getScheme() : "";
        boolean isOAuthRedirect = scheme.startsWith("com.googleusercontent.apps.")
                || "com.sierra.omniagent".equals(scheme)
                || "msauth".equals(scheme);
        if (!isOAuthRedirect) return;

        final String code = data.getQueryParameter("code");
        final String oauthError = data.getQueryParameter("error");

        new Thread(() -> {
            try {
                if (oauthError != null && !oauthError.isEmpty()) {
                    JSObject errEvt = new JSObject();
                    errEvt.put("ok", false);
                    errEvt.put("reason", "OAuth sign-in cancelled or denied: " + oauthError);
                    notifyListeners("oauthSignInComplete", errEvt, true);
                    return;
                }
                if (code == null || code.trim().isEmpty()) {
                    return;
                }

                String encPending = getVaultPrefs().getString(PENDING_OAUTH_KEY, null);
                JSONObject pending = (encPending != null && !encPending.isEmpty())
                        ? new JSONObject(decryptSecret(encPending))
                        : new JSONObject();

                String provider = pending.optString("provider", scheme.startsWith("com.googleusercontent.apps.") ? "gmail" : "outlook");
                String clientId = pending.optString("clientId", "gmail".equals(provider) ? DEFAULT_GMAIL_CLIENT_ID : "");
                String redirectUri = pending.optString("redirectUri", "gmail".equals(provider) ? DEFAULT_GMAIL_REDIRECT_URI : "");
                String codeVerifier = pending.optString("codeVerifier", "");
                String email = pending.optString("emailHint", "").trim();
                String displayName = pending.optString("displayName", "").trim();

                String tokenEndpoint = "gmail".equals(provider)
                        ? "https://oauth2.googleapis.com/token"
                        : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

                StringBuilder form = new StringBuilder();
                form.append("client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
                form.append("&grant_type=authorization_code");
                form.append("&code=").append(URLEncoder.encode(code.trim(), "UTF-8"));
                if (!redirectUri.isEmpty()) {
                    form.append("&redirect_uri=").append(URLEncoder.encode(redirectUri, "UTF-8"));
                }
                if (!codeVerifier.isEmpty()) {
                    form.append("&code_verifier=").append(URLEncoder.encode(codeVerifier, "UTF-8"));
                }

                JSONObject tokenJson = postFormUrlEncoded(tokenEndpoint, form.toString());
                String accessToken = tokenJson.optString("access_token", "");
                String refreshToken = tokenJson.optString("refresh_token", "");
                long expiresInSec = tokenJson.optLong("expires_in", 3600L);

                if (accessToken.isEmpty()) {
                    String errDesc = tokenJson.optString("error_description", tokenJson.optString("error", "OAuth token exchange failed."));
                    JSObject errEvt = new JSObject();
                    errEvt.put("ok", false);
                    errEvt.put("provider", provider);
                    errEvt.put("reason", errDesc);
                    notifyListeners("oauthSignInComplete", errEvt, true);
                    return;
                }

                // Resolve authenticated email address from Gmail or Microsoft Graph if not provided
                if (email.isEmpty()) {
                    try {
                        if ("gmail".equals(provider)) {
                            JSONObject profile = httpJsonRequest("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken, null);
                            email = profile.optString("emailAddress", "").trim();
                        } else if ("outlook".equals(provider)) {
                            JSONObject me = httpJsonRequest("GET", "https://graph.microsoft.com/v1.0/me", accessToken, null);
                            email = me.optString("mail", me.optString("userPrincipalName", "")).trim();
                        }
                    } catch (Exception ignored) {}
                }
                if (email.isEmpty()) {
                    email = "gmail".equals(provider) ? "me@gmail.com" : "me@outlook.com";
                }
                if (displayName.isEmpty()) {
                    displayName = email;
                }

                String accountId = provider + "-" + email.toLowerCase(Locale.ROOT);
                JSONObject existing = readDecryptedAccountVault(accountId);
                JSONObject vaultObj = existing != null ? existing : new JSONObject();
                vaultObj.put("accountId", accountId);
                vaultObj.put("provider", provider);
                vaultObj.put("email", email);
                vaultObj.put("displayName", displayName);
                vaultObj.put("clientId", clientId);
                vaultObj.put("redirectUri", redirectUri);
                vaultObj.put("accessToken", accessToken);
                if (!refreshToken.isEmpty()) {
                    vaultObj.put("refreshToken", refreshToken);
                }
                vaultObj.put("expiresAtMs", System.currentTimeMillis() + (expiresInSec * 1000L));
                vaultObj.put("updatedAtMs", System.currentTimeMillis());

                writeEncryptedAccountVault(accountId, vaultObj);
                getVaultPrefs().edit().remove(PENDING_OAUTH_KEY).commit();

                // Persist non-secret account metadata into STATE_PREFS so it survives app restarts
                try {
                    SharedPreferences statePrefs = getStatePrefs();
                    String rawMeta = statePrefs.getString("sierra_email_accounts_meta", "[]");
                    JSONArray metaArr = new JSONArray(rawMeta != null && !rawMeta.isEmpty() ? rawMeta : "[]");
                    JSONArray updatedArr = new JSONArray();
                    for (int i = 0; i < metaArr.length(); i++) {
                        JSONObject item = metaArr.optJSONObject(i);
                        if (item != null && !accountId.equalsIgnoreCase(item.optString("id", ""))) {
                            updatedArr.put(item);
                        }
                    }
                    JSONObject newMeta = new JSONObject();
                    newMeta.put("id", accountId);
                    newMeta.put("provider", provider);
                    newMeta.put("email", email);
                    newMeta.put("displayName", displayName);
                    newMeta.put("oauthClientId", clientId);
                    newMeta.put("redirectUri", redirectUri);
                    newMeta.put("connectedAt", System.currentTimeMillis());
                    newMeta.put("enabled", true);
                    updatedArr.put(newMeta);
                    statePrefs.edit().putString("sierra_email_accounts_meta", updatedArr.toString()).commit();
                } catch (Exception ignored) {}

                JSObject evt = new JSObject();
                evt.put("ok", true);
                evt.put("accountId", accountId);
                evt.put("provider", provider);
                evt.put("email", email);
                evt.put("displayName", displayName);
                evt.put("clientId", clientId);
                evt.put("redirectUri", redirectUri);
                evt.put("storedInKeystore", true);
                notifyListeners("oauthSignInComplete", evt, true);
            } catch (Exception e) {
                JSObject errEvt = new JSObject();
                errEvt.put("ok", false);
                errEvt.put("reason", "OAuth callback handling failed: " + e.getMessage());
                notifyListeners("oauthSignInComplete", errEvt, true);
            }
        }).start();
    }

    /**
     * Saves OAuth tokens or Yahoo App Password exclusively in Android Keystore-backed encrypted storage.
     * Never returns or logs secrets.
     */
    @PluginMethod
    public void saveAccountCredentials(PluginCall call) {
        String accountId = call.getString("accountId", "").trim();
        String provider = call.getString("provider", "").trim().toLowerCase(Locale.ROOT);
        String email = call.getString("email", "").trim();
        String displayName = call.getString("displayName", "").trim();
        String accessToken = call.getString("accessToken", "");
        String refreshToken = call.getString("refreshToken", "");
        String appPassword = call.getString("appPassword", "");
        String clientId = call.getString("clientId", "").trim();
        String redirectUri = call.getString("redirectUri", "").trim();
        Long expiresAtMsObj = call.getLong("expiresAtMs", 0L);
        long expiresAtMs = expiresAtMsObj != null ? expiresAtMsObj : 0L;

        if (accountId.isEmpty() || provider.isEmpty() || email.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "accountId, provider, and email are required.");
            call.resolve(err);
            return;
        }

        try {
            JSONObject existing = readDecryptedAccountVault(accountId);
            JSONObject vaultObj = existing != null ? existing : new JSONObject();
            vaultObj.put("accountId", accountId);
            vaultObj.put("provider", provider);
            vaultObj.put("email", email);
            vaultObj.put("displayName", displayName);
            if (accessToken != null && !accessToken.isEmpty()) {
                vaultObj.put("accessToken", accessToken);
            }
            if (refreshToken != null && !refreshToken.isEmpty()) {
                vaultObj.put("refreshToken", refreshToken);
            }
            if (appPassword != null && !appPassword.isEmpty()) {
                vaultObj.put("appPassword", appPassword);
            }
            if (!clientId.isEmpty()) {
                vaultObj.put("clientId", clientId);
            }
            if (!redirectUri.isEmpty()) {
                vaultObj.put("redirectUri", redirectUri);
            }
            if (expiresAtMs > 0) {
                vaultObj.put("expiresAtMs", expiresAtMs);
            }
            vaultObj.put("updatedAtMs", System.currentTimeMillis());

            writeEncryptedAccountVault(accountId, vaultObj);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("accountId", accountId);
            res.put("provider", provider);
            res.put("email", email);
            res.put("storedInKeystore", true);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "Failed to store credentials in Android Keystore: " + e.getMessage());
            call.resolve(err);
        }
    }

    @PluginMethod
    public void removeAccountCredentials(PluginCall call) {
        String accountId = call.getString("accountId", "").trim();
        if (!accountId.isEmpty()) {
            getVaultPrefs().edit().remove("acct_" + accountId).commit();
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("accountId", accountId);
        call.resolve(res);
    }

    @PluginMethod
    public void hasAccountCredentials(PluginCall call) {
        String accountId = call.getString("accountId", "").trim();
        JSONObject vaultObj = readDecryptedAccountVault(accountId);
        boolean hasCreds = false;
        if (vaultObj != null) {
            String provider = vaultObj.optString("provider", "");
            if ("yahoo".equals(provider)) {
                hasCreds = !vaultObj.optString("appPassword", "").isEmpty();
            } else {
                hasCreds = !vaultObj.optString("accessToken", "").isEmpty()
                        || !vaultObj.optString("refreshToken", "").isEmpty();
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("accountId", accountId);
        res.put("hasCredentials", hasCreds);
        call.resolve(res);
    }

    /**
     * Exchanges an OAuth 2.0 authorization code (PKCE) on-device directly with Google or Microsoft
     * and stores the resulting tokens in the Android Keystore vault without exposing them to localStorage.
     */
    @PluginMethod
    public void exchangeOAuthCode(PluginCall call) {
        String accountId = call.getString("accountId", "").trim();
        String provider = call.getString("provider", "").trim().toLowerCase(Locale.ROOT);
        String email = call.getString("email", "").trim();
        String clientId = call.getString("clientId", "").trim();
        String redirectUri = call.getString("redirectUri", "").trim();
        String code = call.getString("code", "").trim();
        String codeVerifier = call.getString("codeVerifier", "").trim();

        if (provider.isEmpty() || clientId.isEmpty() || code.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "provider, clientId, and authorization code are required.");
            call.resolve(err);
            return;
        }

        try {
            if (codeVerifier.isEmpty()) {
                String encPending = getVaultPrefs().getString(PENDING_OAUTH_KEY, null);
                if (encPending != null && !encPending.isEmpty()) {
                    JSONObject pending = new JSONObject(decryptSecret(encPending));
                    codeVerifier = pending.optString("codeVerifier", "");
                }
            }

            String tokenEndpoint = "gmail".equals(provider)
                    ? "https://oauth2.googleapis.com/token"
                    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

            StringBuilder form = new StringBuilder();
            form.append("client_id=").append(URLEncoder.encode(clientId, "UTF-8"));
            form.append("&grant_type=authorization_code");
            form.append("&code=").append(URLEncoder.encode(code, "UTF-8"));
            if (!redirectUri.isEmpty()) {
                form.append("&redirect_uri=").append(URLEncoder.encode(redirectUri, "UTF-8"));
            }
            if (!codeVerifier.isEmpty()) {
                form.append("&code_verifier=").append(URLEncoder.encode(codeVerifier, "UTF-8"));
            }

            JSONObject tokenJson = postFormUrlEncoded(tokenEndpoint, form.toString());
            String accessToken = tokenJson.optString("access_token", "");
            String refreshToken = tokenJson.optString("refresh_token", "");
            long expiresInSec = tokenJson.optLong("expires_in", 3600L);

            if (accessToken.isEmpty()) {
                String errDesc = tokenJson.optString("error_description", tokenJson.optString("error", "OAuth token exchange failed."));
                JSObject err = new JSObject();
                err.put("ok", false);
                err.put("reason", errDesc);
                call.resolve(err);
                return;
            }

            if (email.isEmpty()) {
                try {
                    if ("gmail".equals(provider)) {
                        JSONObject profile = httpJsonRequest("GET", "https://gmail.googleapis.com/gmail/v1/users/me/profile", accessToken, null);
                        email = profile.optString("emailAddress", "").trim();
                    } else if ("outlook".equals(provider)) {
                        JSONObject me = httpJsonRequest("GET", "https://graph.microsoft.com/v1.0/me", accessToken, null);
                        email = me.optString("mail", me.optString("userPrincipalName", "")).trim();
                    }
                } catch (Exception ignored) {}
            }
            if (accountId.isEmpty() && !email.isEmpty()) {
                accountId = provider + "-" + email.toLowerCase(Locale.ROOT);
            }

            JSONObject existing = readDecryptedAccountVault(accountId);
            JSONObject vaultObj = existing != null ? existing : new JSONObject();
            vaultObj.put("accountId", accountId);
            vaultObj.put("provider", provider);
            vaultObj.put("email", email);
            vaultObj.put("clientId", clientId);
            vaultObj.put("redirectUri", redirectUri);
            vaultObj.put("accessToken", accessToken);
            if (!refreshToken.isEmpty()) {
                vaultObj.put("refreshToken", refreshToken);
            }
            vaultObj.put("expiresAtMs", System.currentTimeMillis() + (expiresInSec * 1000L));
            vaultObj.put("updatedAtMs", System.currentTimeMillis());

            writeEncryptedAccountVault(accountId, vaultObj);

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("accountId", accountId);
            res.put("provider", provider);
            res.put("email", email);
            res.put("storedInKeystore", true);
            call.resolve(res);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "OAuth token exchange failed: " + e.getMessage());
            call.resolve(err);
        }
    }

    /**
     * Saves non-secret persistent state (connected account metadata, tool enabled states, selected models)
     * to native Android SharedPreferences so it survives app close and force-stop.
     */
    @PluginMethod
    public void savePersistentState(PluginCall call) {
        String key = call.getString("key", "").trim();
        String value = call.getString("value", "");
        if (key.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "State key is required.");
            call.resolve(err);
            return;
        }
        getStatePrefs().edit().putString(key, value != null ? value : "").commit();
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("key", key);
        call.resolve(res);
    }

    @PluginMethod
    public void loadPersistentState(PluginCall call) {
        SharedPreferences prefs = getStatePrefs();
        JSObject values = new JSObject();
        for (String key : prefs.getAll().keySet()) {
            Object v = prefs.getAll().get(key);
            if (v instanceof String) {
                values.put(key, (String) v);
            }
        }
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("state", values);
        call.resolve(res);
    }

    private String ensureValidOAuthAccessToken(JSONObject vaultObj) throws Exception {
        String accessToken = vaultObj.optString("accessToken", "");
        String refreshToken = vaultObj.optString("refreshToken", "");
        String clientId = vaultObj.optString("clientId", "");
        String provider = vaultObj.optString("provider", "");
        long expiresAtMs = vaultObj.optLong("expiresAtMs", 0L);

        boolean expired = expiresAtMs > 0 && (System.currentTimeMillis() + 60_000L >= expiresAtMs);
        if (!accessToken.isEmpty() && !expired) {
            return accessToken;
        }
        if (refreshToken.isEmpty() || clientId.isEmpty()) {
            if (!accessToken.isEmpty()) return accessToken;
            throw new Exception("No valid OAuth access token in Keystore for " + provider + ". Please reconnect the account in Settings.");
        }

        String tokenEndpoint = "gmail".equals(provider)
                ? "https://oauth2.googleapis.com/token"
                : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

        String form = "client_id=" + URLEncoder.encode(clientId, "UTF-8")
                + "&grant_type=refresh_token"
                + "&refresh_token=" + URLEncoder.encode(refreshToken, "UTF-8");

        JSONObject refreshed = postFormUrlEncoded(tokenEndpoint, form);
        String newAccess = refreshed.optString("access_token", "");
        if (newAccess.isEmpty()) {
            throw new Exception("Failed to refresh OAuth token for " + provider + ". Please re-authenticate in Settings.");
        }
        long expiresIn = refreshed.optLong("expires_in", 3600L);
        vaultObj.put("accessToken", newAccess);
        if (!refreshed.optString("refresh_token", "").isEmpty()) {
            vaultObj.put("refreshToken", refreshed.optString("refresh_token"));
        }
        vaultObj.put("expiresAtMs", System.currentTimeMillis() + (expiresIn * 1000L));
        writeEncryptedAccountVault(vaultObj.optString("accountId", ""), vaultObj);
        return newAccess;
    }

    @PluginMethod
    public void executeEmailAction(PluginCall call) {
        String accountId = call.getString("accountId", "").trim();
        String action = call.getString("action", "").trim().toLowerCase(Locale.ROOT);

        if (accountId.isEmpty() || action.isEmpty()) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "accountId and action are required.");
            call.resolve(err);
            return;
        }

        JSONObject vaultObj = readDecryptedAccountVault(accountId);
        if (vaultObj == null) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", "No Keystore credentials found for account \"" + accountId + "\". Please connect the account in Settings > Email Accounts.");
            call.resolve(err);
            return;
        }

        String provider = vaultObj.optString("provider", "").toLowerCase(Locale.ROOT);
        try {
            JSObject result;
            if ("gmail".equals(provider)) {
                result = executeGmailAction(vaultObj, action, call);
            } else if ("outlook".equals(provider)) {
                result = executeOutlookAction(vaultObj, action, call);
            } else if ("yahoo".equals(provider)) {
                result = executeYahooAction(vaultObj, action, call);
            } else {
                throw new Exception("Unsupported email provider: " + provider);
            }
            call.resolve(result);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("ok", false);
            err.put("reason", e.getMessage() != null ? e.getMessage() : "Email operation failed.");
            err.put("error", e.getMessage() != null ? e.getMessage() : "Email operation failed.");
            call.resolve(err);
        }
    }

    // =========================================================================
    // 1. GMAIL API (On-Device REST with Keystore OAuth Token)
    // =========================================================================
    private JSObject executeGmailAction(JSONObject vaultObj, String action, PluginCall call) throws Exception {
        String token = ensureValidOAuthAccessToken(vaultObj);
        String fromEmail = vaultObj.optString("email", "me");
        int maxResults = Math.max(1, Math.min(20, call.getInt("maxResults", 10)));

        if ("list".equals(action) || "search".equals(action)) {
            String query = call.getString("query", "").trim();
            boolean unreadOnly = Boolean.TRUE.equals(call.getBoolean("unreadOnly", false));
            if ("list".equals(action) && unreadOnly && query.isEmpty()) {
                query = "is:unread";
            }
            String url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=" + maxResults;
            if (!query.isEmpty()) {
                url += "&q=" + URLEncoder.encode(query, "UTF-8");
            }
            JSONObject listJson = httpJsonRequest("GET", url, token, null);
            JSONArray msgRefs = listJson.optJSONArray("messages");
            JSArray messages = new JSArray();
            if (msgRefs != null) {
                for (int i = 0; i < Math.min(msgRefs.length(), maxResults); i++) {
                    JSONObject ref = msgRefs.optJSONObject(i);
                    if (ref == null) continue;
                    String msgId = ref.optString("id", "");
                    if (msgId.isEmpty()) continue;
                    String metaUrl = "https://gmail.googleapis.com/gmail/v1/users/me/messages/"
                            + URLEncoder.encode(msgId, "UTF-8")
                            + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date";
                    JSONObject detail = httpJsonRequest("GET", metaUrl, token, null);
                    messages.put(parseGmailMessageSummary(detail));
                }
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "gmail");
            res.put("account", fromEmail);
            res.put("count", messages.length());
            res.put("messages", messages);
            return res;
        }

        if ("read".equals(action)) {
            String messageId = call.getString("messageId", "").trim();
            if (messageId.isEmpty()) throw new Exception("messageId is required for email_read.");
            String url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/"
                    + URLEncoder.encode(messageId, "UTF-8") + "?format=full";
            JSONObject detail = httpJsonRequest("GET", url, token, null);
            JSObject msgObj = parseGmailMessageFull(detail);
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "gmail");
            res.put("account", fromEmail);
            res.put("emailMessage", msgObj);
            return res;
        }

        if ("draft".equals(action)) {
            String to = call.getString("to", "").trim();
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            String cc = call.getString("cc", "").trim();
            if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_draft.");
            String rawMime = buildRfc2822Base64Url(fromEmail, to, cc, subject, body);
            JSONObject reqBody = new JSONObject();
            JSONObject msgInner = new JSONObject();
            msgInner.put("raw", rawMime);
            reqBody.put("message", msgInner);
            JSONObject draftResp = httpJsonRequest(
                    "POST",
                    "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
                    token,
                    reqBody.toString()
            );
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "gmail");
            res.put("account", fromEmail);
            res.put("draftId", draftResp.optString("id", ""));
            res.put("to", to);
            res.put("subject", subject);
            return res;
        }

        if ("send".equals(action)) {
            String draftId = call.getString("draftId", "").trim();
            String to = call.getString("to", "").trim();
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            String cc = call.getString("cc", "").trim();

            JSONObject sendResp;
            if (!draftId.isEmpty() && to.isEmpty()) {
                JSONObject reqBody = new JSONObject();
                reqBody.put("id", draftId);
                sendResp = httpJsonRequest(
                        "POST",
                        "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
                        token,
                        reqBody.toString()
                );
            } else {
                if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_send.");
                String rawMime = buildRfc2822Base64Url(fromEmail, to, cc, subject, body);
                JSONObject reqBody = new JSONObject();
                reqBody.put("raw", rawMime);
                sendResp = httpJsonRequest(
                        "POST",
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                        token,
                        reqBody.toString()
                );
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "gmail");
            res.put("account", fromEmail);
            res.put("messageId", sendResp.optString("id", ""));
            res.put("to", to);
            res.put("subject", subject);
            return res;
        }

        if ("delete".equals(action)) {
            String messageId = call.getString("messageId", "").trim();
            boolean permanent = Boolean.TRUE.equals(call.getBoolean("permanent", false));
            if (messageId.isEmpty()) throw new Exception("messageId is required for email_delete.");
            if (permanent) {
                httpJsonRequest(
                        "DELETE",
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + URLEncoder.encode(messageId, "UTF-8"),
                        token,
                        null
                );
            } else {
                httpJsonRequest(
                        "POST",
                        "https://gmail.googleapis.com/gmail/v1/users/me/messages/" + URLEncoder.encode(messageId, "UTF-8") + "/trash",
                        token,
                        "{}"
                );
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "gmail");
            res.put("account", fromEmail);
            res.put("messageId", messageId);
            res.put("movedToTrash", !permanent);
            return res;
        }

        throw new Exception("Unsupported Gmail action: " + action);
    }

    private JSObject parseGmailMessageSummary(JSONObject detail) {
        JSObject obj = new JSObject();
        obj.put("id", detail.optString("id", ""));
        obj.put("snippet", detail.optString("snippet", ""));
        JSONObject payload = detail.optJSONObject("payload");
        String subject = "";
        String from = "";
        String to = "";
        String date = "";
        if (payload != null) {
            JSONArray headers = payload.optJSONArray("headers");
            if (headers != null) {
                for (int i = 0; i < headers.length(); i++) {
                    JSONObject h = headers.optJSONObject(i);
                    if (h == null) continue;
                    String name = h.optString("name", "");
                    String val = h.optString("value", "");
                    if ("Subject".equalsIgnoreCase(name)) subject = val;
                    else if ("From".equalsIgnoreCase(name)) from = val;
                    else if ("To".equalsIgnoreCase(name)) to = val;
                    else if ("Date".equalsIgnoreCase(name)) date = val;
                }
            }
        }
        obj.put("subject", subject);
        obj.put("from", from);
        obj.put("to", to);
        obj.put("date", date);
        return obj;
    }

    private JSObject parseGmailMessageFull(JSONObject detail) {
        JSObject obj = parseGmailMessageSummary(detail);
        JSONObject payload = detail.optJSONObject("payload");
        String bodyText = extractGmailPlainText(payload);
        if (bodyText.isEmpty()) {
            bodyText = detail.optString("snippet", "");
        }
        obj.put("body", bodyText);
        return obj;
    }

    private String extractGmailPlainText(JSONObject part) {
        if (part == null) return "";
        String mimeType = part.optString("mimeType", "");
        JSONObject body = part.optJSONObject("body");
        if ("text/plain".equalsIgnoreCase(mimeType) && body != null) {
            String data = body.optString("data", "");
            if (!data.isEmpty()) {
                byte[] decoded = Base64.decode(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
                return new String(decoded, StandardCharsets.UTF_8);
            }
        }
        JSONArray parts = part.optJSONArray("parts");
        if (parts != null) {
            for (int i = 0; i < parts.length(); i++) {
                String sub = extractGmailPlainText(parts.optJSONObject(i));
                if (!sub.isEmpty()) return sub;
            }
        }
        if (body != null && !body.optString("data", "").isEmpty()) {
            byte[] decoded = Base64.decode(body.optString("data", ""), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            return new String(decoded, StandardCharsets.UTF_8);
        }
        return "";
    }

    // =========================================================================
    // 2. MICROSOFT GRAPH API (OUTLOOK) (On-Device REST with Keystore OAuth Token)
    // =========================================================================
    private JSObject executeOutlookAction(JSONObject vaultObj, String action, PluginCall call) throws Exception {
        String token = ensureValidOAuthAccessToken(vaultObj);
        String fromEmail = vaultObj.optString("email", "me");
        int maxResults = Math.max(1, Math.min(20, call.getInt("maxResults", 10)));

        if ("list".equals(action) || "search".equals(action)) {
            String query = call.getString("query", "").trim();
            boolean unreadOnly = Boolean.TRUE.equals(call.getBoolean("unreadOnly", false));
            StringBuilder url = new StringBuilder("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=" + maxResults
                    + "&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead");
            if ("search".equals(action) && !query.isEmpty()) {
                url.append("&$search=").append(URLEncoder.encode("\"" + query.replace("\"", "") + "\"", "UTF-8"));
            } else if (unreadOnly) {
                url.append("&$filter=").append(URLEncoder.encode("isRead eq false", "UTF-8"));
            }
            JSONObject listJson = httpJsonRequest("GET", url.toString(), token, null);
            JSONArray values = listJson.optJSONArray("value");
            JSArray messages = new JSArray();
            if (values != null) {
                for (int i = 0; i < values.length(); i++) {
                    JSONObject item = values.optJSONObject(i);
                    if (item == null) continue;
                    messages.put(parseOutlookMessageSummary(item));
                }
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "outlook");
            res.put("account", fromEmail);
            res.put("count", messages.length());
            res.put("messages", messages);
            return res;
        }

        if ("read".equals(action)) {
            String messageId = call.getString("messageId", "").trim();
            if (messageId.isEmpty()) throw new Exception("messageId is required for email_read.");
            String url = "https://graph.microsoft.com/v1.0/me/messages/" + URLEncoder.encode(messageId, "UTF-8")
                    + "?$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,isRead";
            JSONObject detail = httpJsonRequest("GET", url, token, null);
            JSObject msgObj = parseOutlookMessageSummary(detail);
            JSONObject bodyObj = detail.optJSONObject("body");
            msgObj.put("body", bodyObj != null ? bodyObj.optString("content", detail.optString("bodyPreview", "")) : detail.optString("bodyPreview", ""));
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "outlook");
            res.put("account", fromEmail);
            res.put("emailMessage", msgObj);
            return res;
        }

        if ("draft".equals(action)) {
            String to = call.getString("to", "").trim();
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_draft.");
            JSONObject draftPayload = buildOutlookMessageJson(to, subject, body);
            JSONObject created = httpJsonRequest(
                    "POST",
                    "https://graph.microsoft.com/v1.0/me/messages",
                    token,
                    draftPayload.toString()
            );
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "outlook");
            res.put("account", fromEmail);
            res.put("draftId", created.optString("id", ""));
            res.put("to", to);
            res.put("subject", subject);
            return res;
        }

        if ("send".equals(action)) {
            String draftId = call.getString("draftId", "").trim();
            String to = call.getString("to", "").trim();
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            if (!draftId.isEmpty() && to.isEmpty()) {
                httpJsonRequest(
                        "POST",
                        "https://graph.microsoft.com/v1.0/me/messages/" + URLEncoder.encode(draftId, "UTF-8") + "/send",
                        token,
                        "{}"
                );
            } else {
                if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_send.");
                JSONObject sendRoot = new JSONObject();
                sendRoot.put("message", buildOutlookMessageJson(to, subject, body));
                sendRoot.put("saveToSentItems", true);
                httpJsonRequest(
                        "POST",
                        "https://graph.microsoft.com/v1.0/me/sendMail",
                        token,
                        sendRoot.toString()
                );
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "outlook");
            res.put("account", fromEmail);
            res.put("to", to);
            res.put("subject", subject);
            return res;
        }

        if ("delete".equals(action)) {
            String messageId = call.getString("messageId", "").trim();
            boolean permanent = Boolean.TRUE.equals(call.getBoolean("permanent", false));
            if (messageId.isEmpty()) throw new Exception("messageId is required for email_delete.");
            if (permanent) {
                httpJsonRequest(
                        "DELETE",
                        "https://graph.microsoft.com/v1.0/me/messages/" + URLEncoder.encode(messageId, "UTF-8"),
                        token,
                        null
                );
            } else {
                JSONObject moveBody = new JSONObject();
                moveBody.put("destinationId", "deleteditems");
                httpJsonRequest(
                        "POST",
                        "https://graph.microsoft.com/v1.0/me/messages/" + URLEncoder.encode(messageId, "UTF-8") + "/move",
                        token,
                        moveBody.toString()
                );
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "outlook");
            res.put("account", fromEmail);
            res.put("messageId", messageId);
            res.put("movedToTrash", !permanent);
            return res;
        }

        throw new Exception("Unsupported Outlook action: " + action);
    }

    private JSObject parseOutlookMessageSummary(JSONObject item) {
        JSObject obj = new JSObject();
        obj.put("id", item.optString("id", ""));
        obj.put("subject", item.optString("subject", ""));
        obj.put("snippet", item.optString("bodyPreview", ""));
        obj.put("date", item.optString("receivedDateTime", ""));
        JSONObject fromObj = item.optJSONObject("from");
        String fromStr = "";
        if (fromObj != null && fromObj.optJSONObject("emailAddress") != null) {
            JSONObject ea = fromObj.optJSONObject("emailAddress");
            String name = ea.optString("name", "");
            String address = ea.optString("address", "");
            fromStr = !name.isEmpty() ? (name + " <" + address + ">") : address;
        }
        obj.put("from", fromStr);
        return obj;
    }

    private JSONObject buildOutlookMessageJson(String to, String subject, String body) throws Exception {
        JSONObject msg = new JSONObject();
        msg.put("subject", subject);
        JSONObject bodyObj = new JSONObject();
        bodyObj.put("contentType", "Text");
        bodyObj.put("content", body);
        msg.put("body", bodyObj);
        JSONArray toArr = new JSONArray();
        JSONObject recip = new JSONObject();
        JSONObject emailAddr = new JSONObject();
        emailAddr.put("address", to);
        recip.put("emailAddress", emailAddr);
        toArr.put(recip);
        msg.put("toRecipients", toArr);
        return msg;
    }

    // =========================================================================
    // 3. YAHOO MAIL (100% On-Device SSL IMAP & SMTP with Keystore App Password)
    // =========================================================================
    private JSObject executeYahooAction(JSONObject vaultObj, String action, PluginCall call) throws Exception {
        String email = vaultObj.optString("email", "").trim();
        String appPassword = vaultObj.optString("appPassword", "").replace(" ", "").trim();
        if (email.isEmpty() || appPassword.isEmpty()) {
            throw new Exception("Yahoo email and App Password are required in Keystore. Please configure them in Settings > Email Accounts.");
        }
        int maxResults = Math.max(1, Math.min(20, call.getInt("maxResults", 10)));

        if ("send".equals(action)) {
            String to = call.getString("to", "").trim();
            String subject = call.getString("subject", "");
            String body = call.getString("body", "");
            String cc = call.getString("cc", "").trim();
            if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_send.");
            sendYahooSmtp(email, appPassword, to, cc, subject, body);
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("provider", "yahoo");
            res.put("account", email);
            res.put("to", to);
            res.put("subject", subject);
            return res;
        }

        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        try (SSLSocket socket = (SSLSocket) factory.createSocket("imap.mail.yahoo.com", 993)) {
            socket.setSoTimeout(15000);
            socket.startHandshake();
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);

            // Read greeting
            reader.readLine();

            // Login
            sendImapCommand(writer, reader, "A01", "LOGIN \"" + escapeImapQuoted(email) + "\" \"" + escapeImapQuoted(appPassword) + "\"");

            if ("draft".equals(action)) {
                String to = call.getString("to", "").trim();
                String subject = call.getString("subject", "");
                String body = call.getString("body", "");
                String cc = call.getString("cc", "").trim();
                if (to.isEmpty()) throw new Exception("Recipient 'to' address is required for email_draft.");
                String rfcMsg = buildRfc2822Message(email, to, cc, subject, body);
                byte[] msgBytes = rfcMsg.getBytes(StandardCharsets.UTF_8);
                writer.print("A02 APPEND \"Draft\" (\\Draft \\Seen) {" + msgBytes.length + "}\r\n");
                writer.flush();
                String contLine = reader.readLine();
                if (contLine != null && contLine.startsWith("+")) {
                    OutputStream rawOut = socket.getOutputStream();
                    rawOut.write(msgBytes);
                    rawOut.write("\r\n".getBytes(StandardCharsets.UTF_8));
                    rawOut.flush();
                    readUntilTagged(reader, "A02");
                }
                sendImapCommand(writer, reader, "A99", "LOGOUT");
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("provider", "yahoo");
                res.put("account", email);
                res.put("to", to);
                res.put("subject", subject);
                return res;
            }

            sendImapCommand(writer, reader, "A02", "SELECT \"INBOX\"");

            if ("list".equals(action) || "search".equals(action)) {
                String query = call.getString("query", "").trim();
                boolean unreadOnly = Boolean.TRUE.equals(call.getBoolean("unreadOnly", false));
                String searchCriteria = "ALL";
                if ("search".equals(action) && !query.isEmpty()) {
                    searchCriteria = "TEXT \"" + escapeImapQuoted(query) + "\"";
                } else if (unreadOnly) {
                    searchCriteria = "UNSEEN";
                }
                List<String> searchLines = sendImapCommand(writer, reader, "A03", "UID SEARCH " + searchCriteria);
                List<String> uids = parseImapSearchUids(searchLines);
                Collections.reverse(uids);

                JSArray messages = new JSArray();
                int count = Math.min(uids.size(), maxResults);
                for (int i = 0; i < count; i++) {
                    String uid = uids.get(i);
                    List<String> fetchLines = sendImapCommand(
                            writer,
                            reader,
                            "F" + i,
                            "UID FETCH " + uid + " (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)] BODY.PEEK[TEXT]<0.240>)"
                    );
                    messages.put(parseYahooFetchedSummary(uid, fetchLines));
                }
                sendImapCommand(writer, reader, "A99", "LOGOUT");
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("provider", "yahoo");
                res.put("account", email);
                res.put("count", messages.length());
                res.put("messages", messages);
                return res;
            }

            if ("read".equals(action)) {
                String messageId = call.getString("messageId", "").trim();
                if (messageId.isEmpty()) throw new Exception("messageId is required for email_read.");
                List<String> fetchLines = sendImapCommand(
                        writer,
                        reader,
                        "A04",
                        "UID FETCH " + messageId + " (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)] BODY.PEEK[TEXT])"
                );
                JSObject msgObj = parseYahooFetchedSummary(messageId, fetchLines);
                msgObj.put("body", msgObj.optString("snippet", ""));
                sendImapCommand(writer, reader, "A99", "LOGOUT");
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("provider", "yahoo");
                res.put("account", email);
                res.put("emailMessage", msgObj);
                return res;
            }

            if ("delete".equals(action)) {
                String messageId = call.getString("messageId", "").trim();
                boolean permanent = Boolean.TRUE.equals(call.getBoolean("permanent", false));
                if (messageId.isEmpty()) throw new Exception("messageId is required for email_delete.");
                if (!permanent) {
                    sendImapCommand(writer, reader, "A05", "UID COPY " + messageId + " \"Trash\"");
                }
                sendImapCommand(writer, reader, "A06", "UID STORE " + messageId + " +FLAGS (\\Deleted)");
                sendImapCommand(writer, reader, "A07", "EXPUNGE");
                sendImapCommand(writer, reader, "A99", "LOGOUT");
                JSObject res = new JSObject();
                res.put("ok", true);
                res.put("provider", "yahoo");
                res.put("account", email);
                res.put("messageId", messageId);
                res.put("movedToTrash", !permanent);
                return res;
            }

            sendImapCommand(writer, reader, "A99", "LOGOUT");
            throw new Exception("Unsupported Yahoo action: " + action);
        }
    }

    private void sendYahooSmtp(String fromEmail, String appPassword, String to, String cc, String subject, String body) throws Exception {
        SSLSocketFactory factory = (SSLSocketFactory) SSLSocketFactory.getDefault();
        try (SSLSocket socket = (SSLSocket) factory.createSocket("smtp.mail.yahoo.com", 465)) {
            socket.setSoTimeout(15000);
            socket.startHandshake();
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            PrintWriter writer = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);

            readSmtpResponse(reader, 220);
            sendSmtpLine(writer, reader, "EHLO sierra.local", 250);
            sendSmtpLine(writer, reader, "AUTH LOGIN", 334);
            sendSmtpLine(writer, reader, Base64.encodeToString(fromEmail.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP), 334);
            sendSmtpLine(writer, reader, Base64.encodeToString(appPassword.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP), 235);
            sendSmtpLine(writer, reader, "MAIL FROM:<" + fromEmail + ">", 250);
            sendSmtpLine(writer, reader, "RCPT TO:<" + to + ">", 250);
            sendSmtpLine(writer, reader, "DATA", 354);

            String rfcMessage = buildRfc2822Message(fromEmail, to, cc, subject, body);
            writer.print(rfcMessage + "\r\n.\r\n");
            writer.flush();
            readSmtpResponse(reader, 250);
            writer.print("QUIT\r\n");
            writer.flush();
        }
    }

    private void sendSmtpLine(PrintWriter writer, BufferedReader reader, String cmd, int expectedCode) throws Exception {
        writer.print(cmd + "\r\n");
        writer.flush();
        readSmtpResponse(reader, expectedCode);
    }

    private void readSmtpResponse(BufferedReader reader, int expectedCode) throws Exception {
        String line;
        String lastLine = "";
        while ((line = reader.readLine()) != null) {
            lastLine = line;
            if (line.length() >= 4 && line.charAt(3) == ' ') {
                break;
            }
        }
        if (!lastLine.startsWith(String.valueOf(expectedCode))) {
            throw new Exception("SMTP server returned error: " + lastLine);
        }
    }

    private List<String> sendImapCommand(PrintWriter writer, BufferedReader reader, String tag, String cmd) throws Exception {
        writer.print(tag + " " + cmd + "\r\n");
        writer.flush();
        return readUntilTagged(reader, tag);
    }

    private List<String> readUntilTagged(BufferedReader reader, String tag) throws Exception {
        List<String> lines = new ArrayList<>();
        String line;
        while ((line = reader.readLine()) != null) {
            lines.add(line);
            if (line.startsWith(tag + " ")) {
                if (!line.startsWith(tag + " OK")) {
                    throw new Exception("IMAP command failed: " + line);
                }
                break;
            }
        }
        return lines;
    }

    private List<String> parseImapSearchUids(List<String> lines) {
        List<String> uids = new ArrayList<>();
        for (String line : lines) {
            if (line.startsWith("* SEARCH")) {
                String rest = line.substring("* SEARCH".length()).trim();
                if (!rest.isEmpty()) {
                    for (String part : rest.split("\\s+")) {
                        if (part.matches("\\d+")) uids.add(part);
                    }
                }
            }
        }
        return uids;
    }

    private JSObject parseYahooFetchedSummary(String uid, List<String> lines) {
        String subject = "";
        String from = "";
        String to = "";
        String date = "";
        StringBuilder bodyBuilder = new StringBuilder();
        boolean inBody = false;

        for (String line : lines) {
            if (line.startsWith("* ") || line.matches("^[A-Z0-9]+ OK.*")) continue;
            String lower = line.toLowerCase(Locale.ROOT);
            if (!inBody) {
                if (lower.startsWith("subject:")) subject = line.substring(8).trim();
                else if (lower.startsWith("from:")) from = line.substring(5).trim();
                else if (lower.startsWith("to:")) to = line.substring(3).trim();
                else if (lower.startsWith("date:")) date = line.substring(5).trim();
                else if (line.trim().isEmpty()) inBody = true;
            } else {
                if (!line.equals(")")) {
                    bodyBuilder.append(line).append("\n");
                }
            }
        }

        JSObject obj = new JSObject();
        obj.put("id", uid);
        obj.put("subject", subject);
        obj.put("from", from);
        obj.put("to", to);
        obj.put("date", date);
        obj.put("snippet", bodyBuilder.toString().trim());
        return obj;
    }

    private String escapeImapQuoted(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private String buildRfc2822Message(String from, String to, String cc, String subject, String body) {
        SimpleDateFormat rfcDate = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US);
        StringBuilder sb = new StringBuilder();
        sb.append("From: ").append(from).append("\r\n");
        sb.append("To: ").append(to).append("\r\n");
        if (cc != null && !cc.isEmpty()) {
            sb.append("Cc: ").append(cc).append("\r\n");
        }
        sb.append("Date: ").append(rfcDate.format(new Date())).append("\r\n");
        sb.append("Subject: ").append(subject != null ? subject : "").append("\r\n");
        sb.append("MIME-Version: 1.0\r\n");
        sb.append("Content-Type: text/plain; charset=UTF-8\r\n\r\n");
        sb.append(body != null ? body : "");
        return sb.toString();
    }

    private String buildRfc2822Base64Url(String from, String to, String cc, String subject, String body) {
        String msg = buildRfc2822Message(from, to, cc, subject, body);
        return Base64.encodeToString(
                msg.getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
        );
    }

    private JSONObject postFormUrlEncoded(String urlStr, String formBody) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestMethod("POST");
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        try (OutputStream os = conn.getOutputStream()) {
            os.write(formBody.getBytes(StandardCharsets.UTF_8));
        }
        int status = conn.getResponseCode();
        InputStream is = status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream();
        String respText = readStreamToString(is);
        return respText.isEmpty() ? new JSONObject() : new JSONObject(respText);
    }

    private JSONObject httpJsonRequest(String method, String urlStr, String bearerToken, String jsonBody) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + bearerToken);
        conn.setRequestProperty("Accept", "application/json");
        if (jsonBody != null) {
            conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = conn.getResponseCode();
        InputStream is = status >= 200 && status < 300 ? conn.getInputStream() : conn.getErrorStream();
        String respText = readStreamToString(is);
        if (status < 200 || status >= 300) {
            throw new Exception("HTTP " + status + ": " + (respText.length() > 220 ? respText.substring(0, 220) : respText));
        }
        if (respText == null || respText.trim().isEmpty()) {
            return new JSONObject();
        }
        return new JSONObject(respText);
    }

    private String readStreamToString(InputStream is) throws Exception {
        if (is == null) return "";
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = is.read(buf)) != -1) {
            baos.write(buf, 0, n);
        }
        return new String(baos.toByteArray(), StandardCharsets.UTF_8);
    }
}
