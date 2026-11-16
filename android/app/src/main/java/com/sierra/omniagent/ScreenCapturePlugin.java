package com.sierra.omniagent;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;

@CapacitorPlugin(name = "ScreenCapture")
public class ScreenCapturePlugin extends Plugin {
    private static final String TAG = "ScreenCapturePlugin";

    private MediaProjectionManager projectionManager;
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread handlerThread;
    private Handler backgroundHandler;
    private long lastFrameTime = 0;
    private boolean isCapturing = false;

    @Override
    public void load() {
        super.load();
        projectionManager = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        handlerThread = new HandlerThread("ScreenCaptureThread");
        handlerThread.start();
        backgroundHandler = new Handler(handlerThread.getLooper());
    }

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        call.resolve(ret);
    }

    @PluginMethod
    public void startScreenCapture(PluginCall call) {
        if (isCapturing) {
            JSObject ret = new JSObject();
            ret.put("status", "already_started");
            call.resolve(ret);
            return;
        }

        if (projectionManager == null) {
            call.reject("MediaProjectionManager not available on this device", "NOT_SUPPORTED");
            return;
        }

        try {
            Intent captureIntent = projectionManager.createScreenCaptureIntent();
            startActivityForResult(call, captureIntent, "handleScreenCaptureResult");
        } catch (Exception e) {
            Log.e(TAG, "Error launching screen capture intent", e);
            call.reject("Failed to request screen capture permission: " + e.getMessage(), "INTENT_ERROR");
        }
    }

    @ActivityCallback
    private void handleScreenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() != Activity.RESULT_OK) {
            call.reject("Screen capture permission was denied or cancelled by user", "PERMISSION_DENIED");
            return;
        }

        Intent data = result.getData();
        if (data == null) {
            call.reject("Screen capture data is missing", "INTENT_NULL");
            return;
        }

        backgroundHandler.post(() -> {
            try {
                // Android 14+ requires foreground service to be started with FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                // before getMediaProjection is called.
                Intent serviceIntent = new Intent(getContext(), ScreenCaptureService.class);
                serviceIntent.setAction(ScreenCaptureService.ACTION_START);
                ContextCompat.startForegroundService(getContext(), serviceIntent);

                // Give the service a brief moment to transition to foreground
                SystemClock.sleep(150);

                mediaProjection = projectionManager.getMediaProjection(result.getResultCode(), data);
                if (mediaProjection == null) {
                    stopCaptureInternal();
                    call.reject("Failed to acquire MediaProjection instance", "SERVICE_FAILED");
                    return;
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    mediaProjection.registerCallback(new MediaProjection.Callback() {
                        @Override
                        public void onStop() {
                            stopCaptureInternal();
                            JSObject stoppedObj = new JSObject();
                            stoppedObj.put("reason", "MediaProjection stopped by system");
                            notifyListeners("onScreenCaptureStopped", stoppedObj);
                        }
                    }, backgroundHandler);
                }

                setupVirtualDisplay();
                isCapturing = true;

                JSObject ret = new JSObject();
                ret.put("status", "started");
                call.resolve(ret);
            } catch (SecurityException se) {
                Log.e(TAG, "SecurityException starting media projection", se);
                stopCaptureInternal();
                call.reject("Foreground service security exception: " + se.getMessage(), "SECURITY_ERROR");
            } catch (Exception e) {
                Log.e(TAG, "Error starting media projection", e);
                stopCaptureInternal();
                call.reject("Error starting screen capture: " + e.getMessage(), "SERVICE_FAILED");
            }
        });
    }

    private void setupVirtualDisplay() {
        WindowManager wm = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        DisplayMetrics metrics = new DisplayMetrics();
        if (wm != null && wm.getDefaultDisplay() != null) {
            wm.getDefaultDisplay().getRealMetrics(metrics);
        } else {
            metrics = getContext().getResources().getDisplayMetrics();
        }

        int origW = metrics.widthPixels > 0 ? metrics.widthPixels : 1080;
        int origH = metrics.heightPixels > 0 ? metrics.heightPixels : 1920;
        int density = metrics.densityDpi > 0 ? metrics.densityDpi : DisplayMetrics.DENSITY_DEFAULT;

        // Downscale long edge to ~768px as requested
        int targetW, targetH;
        if (origW >= origH) {
            targetW = 768;
            targetH = Math.max(2, (int) Math.round((768.0 * origH) / origW));
        } else {
            targetH = 768;
            targetW = Math.max(2, (int) Math.round((768.0 * origW) / origH));
        }
        // Ensure dimensions are even
        if (targetW % 2 != 0) targetW += 1;
        if (targetH % 2 != 0) targetH += 1;

        final int captureWidth = targetW;
        final int captureHeight = targetH;

        imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
        imageReader.setOnImageAvailableListener(reader -> {
            Image image = null;
            try {
                image = reader.acquireLatestImage();
                if (image == null) return;

                long now = SystemClock.elapsedRealtime();
                // Send at approximately 1 frame per second (1000ms interval)
                if (now - lastFrameTime < 950) {
                    return;
                }
                lastFrameTime = now;

                Image.Plane[] planes = image.getPlanes();
                if (planes == null || planes.length == 0) return;

                ByteBuffer buffer = planes[0].getBuffer();
                int pixelStride = planes[0].getPixelStride();
                int rowStride = planes[0].getRowStride();
                int rowPadding = rowStride - pixelStride * captureWidth;

                int bitmapWidth = captureWidth + (pixelStride > 0 ? rowPadding / pixelStride : 0);
                Bitmap rawBitmap = Bitmap.createBitmap(bitmapWidth, captureHeight, Bitmap.Config.ARGB_8888);
                rawBitmap.copyPixelsFromBuffer(buffer);

                Bitmap finalBitmap = rawBitmap;
                if (rawBitmap.getWidth() != captureWidth || rawBitmap.getHeight() != captureHeight) {
                    finalBitmap = Bitmap.createBitmap(rawBitmap, 0, 0, captureWidth, captureHeight);
                    if (finalBitmap != rawBitmap) {
                        rawBitmap.recycle();
                    }
                }

                ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
                // Compress with ~0.6 JPEG quality as requested
                finalBitmap.compress(Bitmap.CompressFormat.JPEG, 60, outputStream);
                byte[] jpegBytes = outputStream.toByteArray();
                finalBitmap.recycle();

                String base64Data = Base64.encodeToString(jpegBytes, Base64.NO_WRAP);

                JSObject frameData = new JSObject();
                frameData.put("data", base64Data);
                frameData.put("base64", base64Data);
                frameData.put("width", captureWidth);
                frameData.put("height", captureHeight);
                frameData.put("timestamp", System.currentTimeMillis());

                notifyListeners("onScreenFrame", frameData);
            } catch (Exception e) {
                Log.w(TAG, "Error acquiring or encoding screen frame", e);
            } finally {
                if (image != null) {
                    try {
                        image.close();
                    } catch (Exception ignored) {}
                }
            }
        }, backgroundHandler);

        virtualDisplay = mediaProjection.createVirtualDisplay(
                "SierraScreenCapture",
                captureWidth,
                captureHeight,
                density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                backgroundHandler
        );
    }

    @PluginMethod
    public void stopScreenCapture(PluginCall call) {
        stopCaptureInternal();
        JSObject ret = new JSObject();
        ret.put("status", "stopped");
        call.resolve(ret);
    }

    private synchronized void stopCaptureInternal() {
        isCapturing = false;
        if (virtualDisplay != null) {
            try {
                virtualDisplay.release();
            } catch (Exception ignored) {}
            virtualDisplay = null;
        }
        if (imageReader != null) {
            try {
                imageReader.close();
            } catch (Exception ignored) {}
            imageReader = null;
        }
        if (mediaProjection != null) {
            try {
                mediaProjection.stop();
            } catch (Exception ignored) {}
            mediaProjection = null;
        }
        try {
            Intent stopIntent = new Intent(getContext(), ScreenCaptureService.class);
            stopIntent.setAction(ScreenCaptureService.ACTION_STOP);
            getContext().startService(stopIntent);
        } catch (Exception ignored) {}
    }

    @Override
    protected void handleOnDestroy() {
        stopCaptureInternal();
        if (handlerThread != null) {
            handlerThread.quitSafely();
        }
        super.handleOnDestroy();
    }
}
