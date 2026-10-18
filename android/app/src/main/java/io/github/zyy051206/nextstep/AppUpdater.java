package io.github.zyy051206.nextstep;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** The page can ask about releases, but can never supply a network or download URL. */
public final class AppUpdater implements AutoCloseable {
    static final String API_URL = "https://api.github.com/repos/zyy051206/next-small-step/releases/latest";
    private static final String DOWNLOAD_ROOT = "https://github.com/zyy051206/next-small-step/releases/download/";
    private static final int MAX_RESPONSE_BYTES = 512 * 1024;
    private static final Pattern VERSION = Pattern.compile("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})");
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9_-]{1,80}");

    interface Listener { void onResult(JSONObject detail); }

    static final class Release {
        final String version;
        final String notes;
        final String url;
        final long size;
        final boolean available;

        Release(String version, String notes, String url, long size, boolean available) {
            this.version = version;
            this.notes = notes;
            this.url = url;
            this.size = size;
            this.available = available;
        }
    }

    private final Activity activity;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean checking = new AtomicBoolean(false);
    private volatile boolean closed;
    private volatile HttpURLConnection connection;
    private volatile Release latest;

    AppUpdater(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    @JavascriptInterface public String getVersion() { return BuildConfig.VERSION_NAME; }

    @JavascriptInterface public String getPlatform() { return "android"; }

    @JavascriptInterface public void checkUpdates(String requestId) {
        if (!validRequest(requestId) || closed) return;
        if (!checking.compareAndSet(false, true)) {
            report(requestId, "check", "error", null, "正在检查更新，请稍后重试。");
            return;
        }
        latest = null;
        try {
            worker.execute(() -> {
                try {
                    Release release = fetchRelease();
                    latest = release.available ? release : null;
                    report(requestId, "check", release.available ? "available" : "current", release, null);
                } catch (IOException | JSONException | SecurityException error) {
                    // Do not expose endpoints, network details, or remote response bodies.
                    report(requestId, "check", "error", null, "暂时无法检查更新，请确认网络连接后重试。");
                } finally {
                    checking.set(false);
                }
            });
        } catch (RejectedExecutionException error) {
            checking.set(false);
        }
    }

    @JavascriptInterface public void downloadUpdate(String requestId) {
        if (!validRequest(requestId) || closed) return;
        Release release = latest;
        if (release == null || !release.available || release.url == null) {
            report(requestId, "download", "error", null, "请先检查更新，找到可下载的新版本。");
            return;
        }
        activity.runOnUiThread(() -> {
            if (closed || activity.isDestroyed()) return;
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(release.url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            try {
                activity.startActivity(intent);
                report(requestId, "download", "opened", release, "已打开浏览器下载，下载完成后打开 APK 确认安装。");
            } catch (ActivityNotFoundException | SecurityException error) {
                report(requestId, "download", "error", null, "无法打开下载，请先安装或启用浏览器。");
            }
        });
    }

    private static boolean validRequest(String requestId) {
        return requestId != null && REQUEST_ID.matcher(requestId).matches();
    }

    private Release fetchRelease() throws IOException, JSONException {
        HttpURLConnection request = (HttpURLConnection) new URL(API_URL).openConnection();
        connection = request;
        try {
            if (closed) throw new IOException("Cancelled");
            // Redirects cannot move this native request outside the fixed API origin.
            request.setInstanceFollowRedirects(false);
            request.setConnectTimeout(12_000);
            request.setReadTimeout(12_000);
            request.setUseCaches(false);
            request.setRequestProperty("Accept", "application/vnd.github+json");
            request.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            request.setRequestProperty("User-Agent", "NextSmallStep-Android/" + BuildConfig.VERSION_NAME);
            if (request.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IOException("Unavailable");
            if (request.getContentLengthLong() > MAX_RESPONSE_BYTES) throw new IOException("Too large");
            long deadline = SystemClock.elapsedRealtime() + 20_000;
            try (InputStream input = request.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (closed || SystemClock.elapsedRealtime() > deadline) throw new IOException("Cancelled");
                    if (output.size() + count > MAX_RESPONSE_BYTES) throw new IOException("Too large");
                    output.write(buffer, 0, count);
                }
                return parseRelease(new JSONObject(output.toString(StandardCharsets.UTF_8.name())), BuildConfig.VERSION_NAME);
            }
        } finally {
            connection = null;
            request.disconnect();
        }
    }

    static int compareVersions(String left, String right) throws IOException {
        if (left == null || right == null || !VERSION.matcher(left).matches() || !VERSION.matcher(right).matches()) {
            throw new IOException("Unsupported version");
        }
        String[] a = left.split("\\.");
        String[] b = right.split("\\.");
        for (int i = 0; i < 3; i++) {
            int comparison = Integer.compare(Integer.parseInt(a[i]), Integer.parseInt(b[i]));
            if (comparison != 0) return comparison;
        }
        return 0;
    }

    static Release parseRelease(JSONObject json, String currentVersion) throws IOException, JSONException {
        if (json.getBoolean("draft") || json.getBoolean("prerelease")) throw new IOException("Not a stable release");
        String tag = json.getString("tag_name");
        if (!tag.startsWith("v")) throw new IOException("Unsupported tag");
        String version = tag.substring(1);
        boolean available = compareVersions(version, currentVersion) > 0;
        String notes = json.optString("body", "");
        if (notes.length() > 6000) notes = notes.substring(0, 6000);
        if (!available) return new Release(version, notes, null, 0, false);

        String filename = "next-small-step-" + version + ".apk";
        String expectedUrl = DOWNLOAD_ROOT + tag + "/" + filename;
        JSONArray assets = json.getJSONArray("assets");
        Release found = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!filename.equals(asset.optString("name"))) continue;
            // Exact comparison rejects credentials, alternate hosts, ports, queries, and path tricks.
            if (found != null || !expectedUrl.equals(asset.getString("browser_download_url"))
                    || !"uploaded".equals(asset.getString("state"))) throw new IOException("Invalid asset");
            long size = asset.getLong("size");
            if (size <= 0 || size > 1024L * 1024 * 1024) throw new IOException("Invalid asset size");
            found = new Release(version, notes, expectedUrl, size, true);
        }
        if (found == null) throw new IOException("No Android release asset");
        return found;
    }

    private void report(String requestId, String action, String status, Release release, String message) {
        if (closed) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("requestId", requestId);
            detail.put("action", action);
            detail.put("status", status);
            detail.put("currentVersion", BuildConfig.VERSION_NAME);
            if (release != null) {
                detail.put("version", release.version);
                detail.put("notes", release.notes);
                detail.put("size", release.size);
            }
            if (message != null) detail.put("message", message);
        } catch (JSONException error) { return; }
        activity.runOnUiThread(() -> {
            if (!closed && !activity.isDestroyed()) listener.onResult(detail);
        });
    }

    @Override public void close() {
        closed = true;
        HttpURLConnection request = connection;
        if (request != null) request.disconnect();
        worker.shutdownNow();
        latest = null;
    }
}
