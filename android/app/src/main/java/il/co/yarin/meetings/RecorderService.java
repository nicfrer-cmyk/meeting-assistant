package il.co.yarin.meetings;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;

import java.io.File;
import java.io.IOException;

/**
 * Foreground service that owns the MediaRecorder so recording keeps running
 * when the screen is off or the app is in the background.
 */
public class RecorderService extends Service {

    public static final String ACTION_START = "il.co.yarin.meetings.START";
    public static final String ACTION_STOP = "il.co.yarin.meetings.STOP";
    public static final String EXTRA_PATH = "path";

    private static final String CHANNEL_ID = "meeting_recording";
    private static final int NOTIFICATION_ID = 7001;

    private static volatile boolean recording = false;
    private static volatile long startedAt = 0L;
    private static volatile String currentPath = null;
    private static volatile String lastError = null;

    private MediaRecorder recorder;
    private PowerManager.WakeLock wakeLock;

    public static boolean isRecording() { return recording; }
    public static long elapsedMs() { return recording ? SystemClock.elapsedRealtime() - startedAt : 0L; }
    public static String currentPath() { return currentPath; }
    public static String takeLastError() { String e = lastError; lastError = null; return e; }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();
        if (ACTION_START.equals(action)) {
            String path = intent.getStringExtra(EXTRA_PATH);
            startRecording(path);
        } else if (ACTION_STOP.equals(action)) {
            stopRecording();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void startRecording(String path) {
        if (recording) return;
        createChannel();
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        try {
            File out = new File(path);
            File parent = out.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();

            recorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? new MediaRecorder(this)
                    : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(44100);
            recorder.setAudioEncodingBitRate(96000);
            recorder.setOutputFile(out.getAbsolutePath());
            recorder.prepare();
            recorder.start();

            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "meetings:recording");
            wakeLock.acquire(6 * 60 * 60 * 1000L);

            currentPath = out.getAbsolutePath();
            startedAt = SystemClock.elapsedRealtime();
            recording = true;
        } catch (IOException | RuntimeException e) {
            lastError = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            releaseRecorder();
            stopForeground(true);
            stopSelf();
        }
    }

    private void stopRecording() {
        if (recorder != null) {
            try { recorder.stop(); } catch (RuntimeException e) { lastError = "stop: " + e.getMessage(); }
        }
        releaseRecorder();
        recording = false;
        stopForeground(true);
    }

    private void releaseRecorder() {
        if (recorder != null) {
            try { recorder.reset(); } catch (RuntimeException ignored) {}
            try { recorder.release(); } catch (RuntimeException ignored) {}
            recorder = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        if (recording) stopRecording();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "הקלטת פגישה", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("מוצג בזמן שפגישה מוקלטת");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("מקליט פגישה")
                .setContentText("ההקלטה פעילה. לחץ כדי לחזור לאפליקציה.")
                .setSmallIcon(R.drawable.ic_stat_mic)
                .setOngoing(true)
                .setSilent(true)
                .setContentIntent(pi)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }
}
