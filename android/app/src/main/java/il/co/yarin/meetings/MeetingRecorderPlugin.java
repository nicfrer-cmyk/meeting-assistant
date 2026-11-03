package il.co.yarin.meetings;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;

@CapacitorPlugin(
        name = "MeetingRecorder",
        permissions = {
                @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class MeetingRecorderPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphoneCallback");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void microphoneCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            doStart(call);
        } else {
            call.reject("PERMISSION_DENIED");
        }
    }

    private void doStart(PluginCall call) {
        if (RecorderService.isRecording()) {
            call.reject("ALREADY_RECORDING");
            return;
        }
        String fileName = call.getString("fileName", "meeting-" + System.currentTimeMillis() + ".m4a");
        Context ctx = getContext();
        File dir = new File(ctx.getFilesDir(), "recordings");
        if (!dir.exists()) dir.mkdirs();
        File out = new File(dir, fileName);

        RecorderService.takeLastError();
        Intent intent = new Intent(ctx, RecorderService.class);
        intent.setAction(RecorderService.ACTION_START);
        intent.putExtra(RecorderService.EXTRA_PATH, out.getAbsolutePath());
        ContextCompat.startForegroundService(ctx, intent);

        // Give the service a moment to spin up the recorder, then report.
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            String err = RecorderService.takeLastError();
            if (err != null) {
                call.reject("START_FAILED: " + err);
                return;
            }
            if (!RecorderService.isRecording()) {
                call.reject("START_FAILED: recorder did not start");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("path", out.getAbsolutePath());
            call.resolve(ret);
        }, 600);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!RecorderService.isRecording()) {
            call.reject("NOT_RECORDING");
            return;
        }
        String path = RecorderService.currentPath();
        long duration = RecorderService.elapsedMs();
        Context ctx = getContext();
        Intent intent = new Intent(ctx, RecorderService.class);
        intent.setAction(RecorderService.ACTION_STOP);
        ctx.startService(intent);

        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
            String err = RecorderService.takeLastError();
            File f = path == null ? null : new File(path);
            JSObject ret = new JSObject();
            ret.put("path", path);
            ret.put("durationMs", duration);
            ret.put("size", f != null && f.exists() ? f.length() : 0);
            if (err != null) ret.put("warning", err);
            call.resolve(ret);
        }, 400);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("recording", RecorderService.isRecording());
        ret.put("elapsedMs", RecorderService.elapsedMs());
        ret.put("path", RecorderService.currentPath());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("granted", true);
        call.resolve(ret);
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    /**
     * Streams the recording straight from disk to ElevenLabs Scribe as multipart/form-data,
     * so large files never pass through the JS bridge as base64.
     */
    @PluginMethod
    public void transcribeWithElevenLabs(PluginCall call) {
        String path = call.getString("path");
        String apiKey = call.getString("apiKey");
        String languageCode = call.getString("languageCode", "heb");
        String modelId = call.getString("modelId", "scribe_v1");
        int numSpeakers = call.getInt("numSpeakers", 0);
        if (path == null || apiKey == null) {
            call.reject("MISSING_ARGS");
            return;
        }
        File file = new File(path);
        if (!file.exists()) {
            call.reject("FILE_NOT_FOUND");
            return;
        }
        new Thread(() -> {
            java.net.HttpURLConnection conn = null;
            try {
                String boundary = "----MeetingsBoundary" + System.currentTimeMillis();
                java.net.URL url = new java.net.URL("https://api.elevenlabs.io/v1/speech-to-text");
                conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(20 * 60 * 1000);
                conn.setDoOutput(true);
                conn.setRequestMethod("POST");
                conn.setRequestProperty("xi-api-key", apiKey);
                conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                conn.setChunkedStreamingMode(64 * 1024);

                java.io.OutputStream os = new java.io.BufferedOutputStream(conn.getOutputStream());
                writeField(os, boundary, "model_id", modelId);
                writeField(os, boundary, "language_code", languageCode);
                writeField(os, boundary, "diarize", "true");
                writeField(os, boundary, "tag_audio_events", "false");
                writeField(os, boundary, "timestamps_granularity", "word");
                if (numSpeakers > 0) writeField(os, boundary, "num_speakers", String.valueOf(numSpeakers));

                String mime = path.endsWith(".m4a") ? "audio/mp4" : "application/octet-stream";
                os.write(("--" + boundary + "\r\n").getBytes("UTF-8"));
                os.write(("Content-Disposition: form-data; name=\"file\"; filename=\"" + file.getName() + "\"\r\n").getBytes("UTF-8"));
                os.write(("Content-Type: " + mime + "\r\n\r\n").getBytes("UTF-8"));
                try (java.io.InputStream in = new java.io.FileInputStream(file)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                os.write("\r\n".getBytes("UTF-8"));
                os.write(("--" + boundary + "--\r\n").getBytes("UTF-8"));
                os.flush();
                os.close();

                int status = conn.getResponseCode();
                java.io.InputStream respStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
                String body = readAll(respStream);
                JSObject ret = new JSObject();
                ret.put("status", status);
                ret.put("body", body);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("UPLOAD_FAILED: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private static void writeField(java.io.OutputStream os, String boundary, String name, String value) throws java.io.IOException {
        os.write(("--" + boundary + "\r\n").getBytes("UTF-8"));
        os.write(("Content-Disposition: form-data; name=\"" + name + "\"\r\n\r\n").getBytes("UTF-8"));
        os.write(value.getBytes("UTF-8"));
        os.write("\r\n".getBytes("UTF-8"));
    }

    private static String readAll(java.io.InputStream in) throws java.io.IOException {
        if (in == null) return "";
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        return bos.toString("UTF-8");
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        String path = call.getString("path");
        boolean ok = false;
        if (path != null) {
            File f = new File(path);
            ok = f.exists() && f.delete();
        }
        JSObject ret = new JSObject();
        ret.put("deleted", ok);
        call.resolve(ret);
    }
}
