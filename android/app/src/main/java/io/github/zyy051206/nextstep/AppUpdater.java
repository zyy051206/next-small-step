package io.github.zyy051206.nextstep;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/** Native update transport. JavaScript supplies only operation IDs, never URLs or paths. */
public final class AppUpdater implements AutoCloseable {
    static final String API_URL = "https://api.github.com/repos/zyy051206/next-small-step/releases/latest";
    private static final String DOWNLOAD_ROOT = "https://github.com/zyy051206/next-small-step/releases/download/";
    private static final int MAX_RESPONSE_BYTES = 512 * 1024;
    private static final Pattern VERSION = Pattern.compile("(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})");
    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9_-]{1,80}");
    interface Listener { void onResult(JSONObject detail); }

    static final class Release {
        final String version, notes, url, sha256;
        final long size;
        final boolean available;
        Release(String version, String notes, String url, long size, String sha256, boolean available) {
            this.version = version; this.notes = notes; this.url = url;
            this.size = size; this.sha256 = sha256; this.available = available;
        }
    }

    private final Activity activity;
    private final Listener listener;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final File directory, apk, metadata, part;
    private volatile boolean closed, cancelled, restored;
    private volatile HttpURLConnection connection;
    private volatile Release latest;
    private volatile String status = "idle", message = "", pendingInstallId;
    private volatile long received;

    AppUpdater(Activity activity, Listener listener) {
        this.activity = activity; this.listener = listener;
        directory = new File(activity.getCacheDir(), "updates");
        apk = new File(directory, "install/next-small-step.apk");
        metadata = new File(directory, "ready.json");
        // An Activity being destroyed must not delete a new Activity's partial download.
        part = new File(directory, "download-" + UUID.randomUUID() + ".part");
    }

    @JavascriptInterface public String getVersion() { return BuildConfig.VERSION_NAME; }
    @JavascriptInterface public String getPlatform() { return "android"; }
    private static boolean validRequest(String id) { return id != null && REQUEST_ID.matcher(id).matches(); }
    private boolean stopped() { return closed || cancelled || Thread.currentThread().isInterrupted(); }

    private boolean begin(String id, String action) {
        if (!validRequest(id) || closed) return false;
        if (!busy.compareAndSet(false, true)) {
            report(id, action, "error", "请等待当前更新操作完成，或先取消下载。");
            return false;
        }
        cancelled = false;
        return true;
    }
    private void submit(Runnable task) {
        try { worker.execute(() -> { try { task.run(); } finally { busy.set(false); } }); }
        catch (RejectedExecutionException error) { busy.set(false); }
    }

    @JavascriptInterface public void getUpdateState(String id) {
        if (!validRequest(id) || closed) return;
        if (!restored && busy.compareAndSet(false, true)) {
            cancelled = false;
            submit(() -> {
                Release cached = restoreReady();
                if (!stopped()) {
                    latest = cached;
                    received = cached == null ? 0 : cached.size;
                    status = cached == null ? "idle" : "ready";
                    message = cached == null ? "" : "更新已下载，可以安装。";
                    restored = true;
                    report(id, "state", status, message);
                }
            });
            return;
        }
        report(id, "state", !restored ? "progress" : status,
                !restored ? "正在检查已下载的安装包…" : message);
    }

    @JavascriptInterface public void checkUpdates(String id) {
        if (!begin(id, "check")) return;
        submit(() -> {
            Release cached = restoreReady();
            latest = cached;
            received = cached == null ? 0 : cached.size;
            restored = true;
            try {
                Release release = fetchRelease();
                if (stopped()) throw new IOException("Cancelled");
                if (release.available && cached != null && release.sha256.equals(cached.sha256)
                        && release.version.equals(cached.version) && release.size == cached.size) {
                    latest = release; status = "ready"; message = "更新已下载，可以安装。";
                } else {
                    clearReady(); latest = release.available ? release : null; received = 0;
                    status = release.available ? "available" : "current";
                    message = release.available ? "发现新版本，可以在应用内下载。" : "当前已是最新版本。";
                }
                report(id, "check", status, message);
            } catch (IOException | JSONException | SecurityException error) {
                status = cached == null ? (stopped() ? "idle" : "error") : "ready";
                message = stopped() ? "已取消检查。" : "暂时无法检查更新，请确认网络连接后重试。";
                report(id, "check", stopped() ? "cancelled" : "error", message);
            }
        });
    }

    @JavascriptInterface public void downloadUpdate(String id) {
        if (!validRequest(id) || closed) return;
        Release release = latest;
        if (release == null || !release.available || release.url == null) {
            report(id, "download", "error", "请先检查更新，找到可下载的新版本。");
            return;
        }
        if (!begin(id, "download")) return;
        submit(() -> {
            HttpURLConnection request = null;
            try {
                if ("ready".equals(status) && apk.isFile()) {
                    verifyReady(release);
                    report(id, "download", "ready", "更新已下载，可以安装。");
                    return;
                }
                clearReady();
                if (!apk.getParentFile().isDirectory() && !apk.getParentFile().mkdirs()) throw new IOException("Cache unavailable");
                received = 0; status = "progress"; message = "正在下载更新…";
                report(id, "download", status, message);
                long deadline = SystemClock.elapsedRealtime() + 10 * 60_000;
                request = openDownload(release.url);
                long length = request.getContentLengthLong();
                if (length != -1 && length != release.size) throw new IOException("Unexpected content length");
                final long[] lastReport = {0};
                try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                    UpdateFiles.copyVerified(input, output, release.size, release.sha256,
                            () -> stopped() || SystemClock.elapsedRealtime() > deadline,
                            count -> {
                                received = count;
                                long now = SystemClock.elapsedRealtime();
                                if (now - lastReport[0] >= 250 || count == release.size) {
                                    lastReport[0] = now;
                                    report(id, "download", "progress", count == release.size ? "正在校验安装包…" : message);
                                }
                            });
                    output.getFD().sync();
                }
                if (stopped()) throw new IOException("Cancelled");
                UpdateFiles.verifyPackage(activity, part, release);
                if (stopped()) throw new IOException("Cancelled");
                if (!part.renameTo(apk)) throw new IOException("Cannot prepare APK");
                writeReady(release);
                status = "ready"; message = "下载与签名校验完成，可以安装更新。";
                report(id, "download", status, message);
            } catch (IOException | JSONException | SecurityException error) {
                status = "available";
                message = stopped() ? "已取消下载。" : "下载或安装包校验失败，请重试下载。";
                report(id, "download", stopped() ? "cancelled" : "error", message);
            } finally {
                if (request != null) request.disconnect();
                connection = null;
                if (part.exists()) part.delete();
            }
        });
    }

    @JavascriptInterface public void installUpdate(String id) {
        if (!begin(id, "install")) return;
        submit(() -> {
            try {
                if (!restored) { latest = restoreReady(); restored = true; }
                Release release = latest;
                if (release == null || !apk.isFile() || !metadata.isFile()) throw new IOException("No verified APK");
                // Recheck bytes, package identity, version, and certificates on every install.
                verifyReady(release);
                if (stopped()) throw new IOException("Cancelled");
                activity.runOnUiThread(() -> requestInstall(id));
            } catch (IOException | SecurityException error) {
                if (!stopped()) clearReady();
                status = stopped() && metadata.isFile() && apk.isFile() ? "ready" : latest == null ? "idle" : "available";
                message = stopped() ? "已取消安装，已下载的更新仍保留。" : "安装包不存在或校验失败，请重新下载更新。";
                report(id, "install", stopped() ? "cancelled" : "error", message);
            }
        });
    }

    private void requestInstall(String id) {
        if (stopped() || activity.isDestroyed()) return;
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                pendingInstallId = id; status = "permission";
                message = "请允许“下一小步”安装此来源的应用，返回后继续安装。";
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())));
                report(id, "install", status, message);
            } else {
                pendingInstallId = null;
                activity.startActivity(UpdateFiles.installIntent(activity, apk));
                status = "installing"; message = "请在 Android 安装窗口确认更新。";
                report(id, "install", status, message);
            }
        } catch (ActivityNotFoundException | SecurityException | IllegalArgumentException error) {
            pendingInstallId = null; status = "ready";
            message = "无法打开系统安装窗口，请检查设备安装权限后重试。";
            report(id, "install", "error", message);
        }
    }

    void onResume() {
        String pending = pendingInstallId;
        if (pending != null) {
            pendingInstallId = null;
            if (activity.getPackageManager().canRequestPackageInstalls()) installUpdate(pending);
            else {
                status = "ready";
                message = "尚未允许安装，更新文件已保留，可再次点击安装。";
                report(pending, "install", "permission", message);
            }
        } else if ("installing".equals(status)) {
            status = "ready"; message = "更新文件已保留；如取消了安装，可以再次安装。";
        }
    }
    String pendingInstallRequest() { return pendingInstallId; }
    void restoreInstallRequest(String id) { if (validRequest(id)) pendingInstallId = id; }

    @JavascriptInterface public void cancelUpdate(String id) {
        if (!validRequest(id) || closed) return;
        cancelled = true; pendingInstallId = null;
        HttpURLConnection request = connection;
        if (request != null) request.disconnect();
        report(id, "cancel", "cancelled", "已取消当前更新操作。");
    }

    private void verifyReady(Release release) throws IOException {
        UpdateFiles.verifyFile(apk, release, this::stopped);
        UpdateFiles.verifyPackage(activity, apk, release);
    }
    private Release restoreReady() {
        if (!metadata.isFile() || !apk.isFile()) return null;
        try (FileInputStream input = new FileInputStream(metadata)) {
            JSONObject json = new JSONObject(readBounded(input, 64 * 1024));
            Release release = parseRelease(json, BuildConfig.VERSION_NAME);
            if (!release.available) { clearReady(); return null; }
            verifyReady(release);
            return release;
        } catch (IOException | JSONException | SecurityException error) {
            if (!stopped()) clearReady();
            return null;
        }
    }
    private void writeReady(Release release) throws IOException, JSONException {
        JSONObject asset = new JSONObject().put("name", "next-small-step-" + release.version + ".apk")
                .put("state", "uploaded").put("size", release.size).put("digest", "sha256:" + release.sha256)
                .put("browser_download_url", release.url);
        JSONObject json = new JSONObject().put("draft", false).put("prerelease", false)
                .put("tag_name", "v" + release.version).put("body", release.notes)
                .put("assets", new JSONArray().put(asset));
        try (FileOutputStream output = new FileOutputStream(metadata)) {
            output.write(json.toString().getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }
    private void clearReady() {
        // Fixed app-owned files only: no recursive deletion or user-selected paths.
        if (metadata.exists()) metadata.delete();
        if (apk.exists()) apk.delete();
    }

    private HttpURLConnection configure(URL url) throws IOException {
        HttpURLConnection request = (HttpURLConnection) url.openConnection();
        connection = request;
        request.setInstanceFollowRedirects(false);
        request.setConnectTimeout(12_000); request.setReadTimeout(20_000); request.setUseCaches(false);
        request.setRequestProperty("User-Agent", "NextSmallStep-Android/" + BuildConfig.VERSION_NAME);
        request.setRequestProperty("Accept-Encoding", "identity");
        return request;
    }
    private HttpURLConnection openDownload(String address) throws IOException {
        URL url = new URL(address);
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (stopped() || !UpdateFiles.allowedDownloadUrl(url)) throw new IOException("Blocked download URL");
            HttpURLConnection request = configure(url);
            int code;
            try { code = request.getResponseCode(); }
            catch (IOException error) { request.disconnect(); throw error; }
            if (code == HttpURLConnection.HTTP_OK) return request;
            String location = request.getHeaderField("Location");
            request.disconnect();
            if ((code != 301 && code != 302 && code != 303 && code != 307 && code != 308) || location == null) throw new IOException("Download unavailable");
            url = new URL(url, location);
        }
        throw new IOException("Too many redirects");
    }
    private Release fetchRelease() throws IOException, JSONException {
        HttpURLConnection request = configure(new URL(API_URL));
        try {
            if (stopped()) throw new IOException("Cancelled");
            request.setRequestProperty("Accept", "application/vnd.github+json");
            request.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            if (request.getResponseCode() != HttpURLConnection.HTTP_OK || request.getContentLengthLong() > MAX_RESPONSE_BYTES) throw new IOException("Release unavailable");
            try (InputStream input = request.getInputStream()) {
                return parseRelease(new JSONObject(readBounded(input, MAX_RESPONSE_BYTES)), BuildConfig.VERSION_NAME);
            }
        } finally { connection = null; request.disconnect(); }
    }
    private String readBounded(InputStream input, int limit) throws IOException {
        long deadline = SystemClock.elapsedRealtime() + 30_000;
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = input.read(buffer)) != -1) {
                if (stopped() || SystemClock.elapsedRealtime() > deadline || output.size() + count > limit) throw new IOException("Cancelled or oversized response");
                output.write(buffer, 0, count);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    static int compareVersions(String left, String right) throws IOException {
        if (left == null || right == null || !VERSION.matcher(left).matches() || !VERSION.matcher(right).matches()) throw new IOException("Unsupported version");
        String[] a = left.split("\\."); String[] b = right.split("\\.");
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
        if (!available) return new Release(version, notes, null, 0, null, false);
        String filename = "next-small-step-" + version + ".apk";
        String expectedUrl = DOWNLOAD_ROOT + tag + "/" + filename;
        JSONArray assets = json.getJSONArray("assets"); Release found = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!filename.equals(asset.optString("name"))) continue;
            if (found != null || !expectedUrl.equals(asset.getString("browser_download_url")) || !"uploaded".equals(asset.getString("state"))) throw new IOException("Invalid asset");
            long size = asset.getLong("size"); String digest = asset.optString("digest", "");
            if (size <= 0 || size > UpdateFiles.MAX_APK_BYTES || !digest.matches("sha256:[0-9a-f]{64}")) throw new IOException("Missing integrity metadata");
            found = new Release(version, notes, expectedUrl, size, digest.substring(7), true);
        }
        if (found == null) throw new IOException("No Android release asset");
        return found;
    }

    private void report(String id, String action, String resultStatus, String resultMessage) {
        if (closed) return;
        JSONObject detail = new JSONObject(); Release release = latest;
        try {
            detail.put("requestId", id).put("action", action).put("status", resultStatus).put("currentVersion", BuildConfig.VERSION_NAME);
            if (release != null) {
                detail.put("version", release.version).put("notes", release.notes).put("size", release.size)
                        .put("received", received).put("total", release.size)
                        .put("percent", release.size == 0 ? 0 : Math.min(100, received * 100 / release.size));
            }
            if (resultMessage != null && !resultMessage.isEmpty()) detail.put("message", resultMessage);
        } catch (JSONException error) { return; }
        activity.runOnUiThread(() -> { if (!closed && !activity.isDestroyed()) listener.onResult(detail); });
    }
    @Override public void close() {
        closed = true; cancelled = true;
        HttpURLConnection request = connection;
        if (request != null) request.disconnect();
        worker.shutdownNow();
    }
}
