package com.sierra.omniagent;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.util.Log;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@CapacitorPlugin(name = "BackupFile")
public class BackupFilePlugin extends Plugin {
    private static final String TAG = "BackupFilePlugin";
    private static final int MAX_BACKUP_BYTES = 25 * 1024 * 1024;

    private String pendingExportContent = null;
    private String pendingExportFileName = null;

    private static String sanitizeFileName(String raw, String fallback) {
        String name = (raw != null ? raw.trim() : "");
        if (name.isEmpty()) name = fallback;
        name = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (!name.toLowerCase(Locale.ROOT).endsWith(".json")) {
            name = name + ".json";
        }
        return name;
    }

    private String queryDisplayName(Uri uri) {
        if (uri == null) return null;
        try (Cursor cursor = getContext().getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    return cursor.getString(idx);
                }
            }
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }

    @PluginMethod
    public void exportBackupFile(PluginCall call) {
        String content = call.getString("content", "");
        if (content == null || content.trim().isEmpty()) {
            call.reject("Backup content is empty");
            return;
        }
        String fileName = sanitizeFileName(call.getString("fileName"), "omni-backup.json");

        File appBackupDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (appBackupDir == null) {
            appBackupDir = getContext().getFilesDir();
        }
        if (appBackupDir != null && !appBackupDir.exists()) {
            appBackupDir.mkdirs();
        }
        File localCopy = new File(appBackupDir, fileName);
        try (FileOutputStream fos = new FileOutputStream(localCopy)) {
            fos.write(content.getBytes(StandardCharsets.UTF_8));
            fos.flush();
        } catch (Exception e) {
            Log.w(TAG, "Local backup copy write failed, trying cacheDir", e);
            localCopy = new File(getContext().getCacheDir(), fileName);
            try (FileOutputStream fos = new FileOutputStream(localCopy)) {
                fos.write(content.getBytes(StandardCharsets.UTF_8));
                fos.flush();
            } catch (Exception inner) {
                call.reject("Failed to write backup file: " + inner.getMessage());
                return;
            }
        }

        pendingExportContent = content;
        pendingExportFileName = fileName;

        try {
            Intent createIntent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            createIntent.addCategory(Intent.CATEGORY_OPENABLE);
            createIntent.setType("application/json");
            createIntent.putExtra(Intent.EXTRA_TITLE, fileName);
            startActivityForResult(call, createIntent, "handleCreateDocumentResult");
        } catch (ActivityNotFoundException e) {
            launchShareSheetFallback(call, localCopy, fileName);
        } catch (Exception e) {
            launchShareSheetFallback(call, localCopy, fileName);
        }
    }

    private void launchShareSheetFallback(PluginCall call, File localFile, String fileName) {
        pendingExportContent = null;
        pendingExportFileName = null;
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    localFile
            );
            Intent sendIntent = new Intent(Intent.ACTION_SEND);
            sendIntent.setType("application/json");
            sendIntent.putExtra(Intent.EXTRA_STREAM, uri);
            sendIntent.putExtra(Intent.EXTRA_SUBJECT, fileName);
            sendIntent.setClipData(ClipData.newRawUri(fileName, uri));
            sendIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            Intent chooser = Intent.createChooser(sendIntent, "Save or Share Backup");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(call, chooser, "handleShareFallbackResult");
        } catch (Exception ex) {
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("mode", "saved");
            res.put("fileName", fileName);
            res.put("savedPath", localFile.getAbsolutePath());
            call.resolve(res);
        }
    }

    @ActivityCallback
    private void handleShareFallbackResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject res = new JSObject();
        res.put("ok", true);
        res.put("mode", "shared");
        res.put("savedPath", "shared");
        call.resolve(res);
    }

    @ActivityCallback
    private void handleCreateDocumentResult(PluginCall call, ActivityResult result) {
        String content = pendingExportContent;
        String fileName = pendingExportFileName != null ? pendingExportFileName : "omni-backup.json";
        pendingExportContent = null;
        pendingExportFileName = null;

        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("ok", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        try {
            if (content == null) {
                call.reject("Missing backup content to write");
                return;
            }
            ContentResolver resolver = getContext().getContentResolver();
            try (OutputStream out = resolver.openOutputStream(uri, "wt")) {
                if (out == null) {
                    throw new Exception("Unable to open destination file for writing");
                }
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            String displayName = queryDisplayName(uri);
            String savedPath = uri.toString();
            if (displayName != null && !displayName.isEmpty()) {
                fileName = displayName;
            }
            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("mode", "saved");
            res.put("fileName", fileName);
            res.put("savedPath", savedPath);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Failed to save backup file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pickBackupFile(PluginCall call) {
        try {
            Intent openIntent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            openIntent.addCategory(Intent.CATEGORY_OPENABLE);
            openIntent.setType("*/*");
            openIntent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                    "application/json",
                    "application/zip",
                    "application/x-zip-compressed",
                    "text/plain",
                    "application/octet-stream"
            });
            startActivityForResult(call, openIntent, "handlePickBackupFileResult");
        } catch (Exception e) {
            call.reject("Could not open file picker: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handlePickBackupFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("ok", false);
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }

        Uri uri = result.getData().getData();
        String fileName = queryDisplayName(uri);
        if (fileName == null || fileName.isEmpty()) {
            fileName = "backup.json";
        }

        try {
            byte[] rawBytes;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    throw new Exception("Unable to read selected file");
                }
                rawBytes = readLimitedBytes(in, MAX_BACKUP_BYTES);
            }

            boolean isZip = fileName.toLowerCase(Locale.ROOT).endsWith(".zip")
                    || (rawBytes.length >= 4
                    && rawBytes[0] == 0x50
                    && rawBytes[1] == 0x4B
                    && (rawBytes[2] == 0x03 || rawBytes[2] == 0x05 || rawBytes[2] == 0x07));

            String jsonText;
            if (isZip) {
                jsonText = extractBackupJsonFromZip(rawBytes);
            } else {
                jsonText = new String(rawBytes, StandardCharsets.UTF_8);
            }

            JSObject res = new JSObject();
            res.put("ok", true);
            res.put("fileName", fileName);
            res.put("jsonText", jsonText);
            call.resolve(res);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Failed to read selected backup file");
        }
    }

    private static byte[] readLimitedBytes(InputStream in, int maxBytes) throws Exception {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int total = 0;
        int n;
        while ((n = in.read(buf)) != -1) {
            total += n;
            if (total > maxBytes) {
                throw new Exception("Backup file exceeds maximum supported size (25 MB).");
            }
            baos.write(buf, 0, n);
        }
        return baos.toByteArray();
    }

    private static String extractBackupJsonFromZip(byte[] zipBytes) throws Exception {
        String firstJsonCandidate = null;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String name = entry.getName() != null ? entry.getName() : "";
                if (name.startsWith("__MACOSX/") || !name.toLowerCase(Locale.ROOT).endsWith(".json")) {
                    continue;
                }
                byte[] entryBytes = readLimitedBytes(zis, MAX_BACKUP_BYTES);
                String text = new String(entryBytes, StandardCharsets.UTF_8).trim();
                if (text.isEmpty()) continue;
                String lowerName = name.toLowerCase(Locale.ROOT);
                if (lowerName.contains("backup") || (text.startsWith("{") && (text.contains("\"settingsV3\"") || text.contains("\"summaries\"") || text.contains("\"sessions\"")))) {
                    return text;
                }
                if (firstJsonCandidate == null) {
                    firstJsonCandidate = text;
                }
            }
        }
        if (firstJsonCandidate != null) {
            return firstJsonCandidate;
        }
        throw new Exception("ZIP file does not contain a valid backup JSON file.");
    }
}
