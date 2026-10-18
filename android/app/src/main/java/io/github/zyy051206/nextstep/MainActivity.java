package io.github.zyy051206.nextstep;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Local UI, system document pickers, and a narrowly scoped native update checker. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ORIGIN + "/assets/index.html";
    private static final int OPEN_DOCUMENT = 10;
    private static final int SAVE_BACKUP = 11;
    private static final int MAX_BACKUP_BYTES = 64 * 1024 * 1024;
    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private volatile boolean exportPending;
    private String pendingResult;
    private boolean pageReady;
    private AppUpdater updater;
    private String pendingUpdateResult;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        exportPending = state != null && state.getBoolean("exportPending", false);
        if (state != null) pendingResult = state.getString("pendingResult");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(245, 244, 237));
        webView = new WebView(this);
        webView.setId(R.id.web_view);
        webView.setBackgroundColor(Color.rgb(245, 244, 237));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
            root.requestApplyInsets();
        } else {
            root.setFitsSystemWindows(true);
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // Content URIs are granted individually by the system document picker.
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new BackupBridge(), "NextStepAndroid");
        webView.addJavascriptInterface(new FocusReminder.Bridge(this), "NextStepReminders");
        updater = new AppUpdater(this, detail -> {
            pendingUpdateResult = detail.toString();
            dispatchUpdateResult();
        });
        if (state != null) updater.restoreInstallRequest(state.getString("pendingInstallRequest"));
        webView.addJavascriptInterface(updater, "NextStepUpdates");

        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isLocalAsset(request.getUrl())) return blocked();
                WebResourceResponse response = loader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : blocked();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // This bridge must never be exposed to a remote page or an iframe.
                return !request.isForMainFrame() || !isLocalPage(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = isLocalPage(Uri.parse(url));
                if (pageReady && pendingResult != null) dispatchBackupResult();
                if (pageReady && pendingUpdateResult != null) dispatchUpdateResult();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                // Only show images for the background picker. JSON imports keep a
                // broad filter because providers can label them as plain text.
                intent.setType(filePickerType(params.getAcceptTypes()));
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, OPEN_DOCUMENT); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "无法打开系统文件选择器。", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        // A fresh page reads the persisted state and settles elapsed timers itself.
        webView.loadUrl(START_URL);
    }


    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(code,permissions,results);
        if(code==2401 && webView!=null) webView.evaluateJavascript("window.dispatchEvent(new Event('nextstep-reminder-permission'))",null);
    }

    static String filePickerType(String[] acceptTypes) {
        if (acceptTypes == null || acceptTypes.length == 0) return "*/*";
        for (String group : acceptTypes) {
            if (group == null || group.trim().isEmpty()) return "*/*";
            for (String type : group.split(",")) {
                if (!type.trim().startsWith("image/")) return "*/*";
            }
        }
        return "image/*";
    }

    private static boolean isLocalAsset(Uri uri) {
        return "https".equals(uri.getScheme()) && ORIGIN.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null && uri.getPath() != null
                && uri.getPath().startsWith("/assets/");
    }

    private static boolean isLocalPage(Uri uri) {
        return isLocalAsset(uri) && "/assets/index.html".equals(uri.getPath());
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null,
                new ByteArrayInputStream(new byte[0]));
    }

    private File pendingBackupFile() { return new File(getCacheDir(), "pending-backup.json"); }

    public final class BackupBridge {
        @JavascriptInterface public synchronized void saveBackup(String json, String filename) {
            if (exportPending) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "请先完成当前备份保存。", Toast.LENGTH_SHORT).show());
                return;
            }
            if (json == null || json.length() > MAX_BACKUP_BYTES) {
                reportBackup("error", "备份文件过大，无法导出。");
                return;
            }
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_BACKUP_BYTES) { reportBackup("error", "备份文件超过 64 MB。"); return; }
            exportPending = true;
            // JavascriptInterface runs off the UI thread. Keep a private pending copy
            // so the picker can survive the activity being recreated by Android.
            try (OutputStream out = new FileOutputStream(pendingBackupFile())) { out.write(bytes); }
            catch (IOException error) { exportPending = false; reportBackup("error", "无法准备备份，请重试。"); return; }
            String safeName = filename == null ? "下一小步-备份.json" : filename.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            if (!safeName.endsWith(".json") || safeName.length() > 150) safeName = "下一小步-备份.json";
            final String name = safeName;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, name);
                try { startActivityForResult(intent, SAVE_BACKUP); }
                catch (ActivityNotFoundException error) {
                    clearPendingBackup();
                    reportBackup("error", "无法打开系统保存窗口。");
                }
            });
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == OPEN_DOCUMENT) {
            if (fileCallback == null) return;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            // Accept only a one-time document URI selected by the user.
            fileCallback.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
            fileCallback = null;
        } else if (requestCode == SAVE_BACKUP) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri == null) { clearPendingBackup(); reportBackup("cancelled", "已取消保存备份。"); return; }
            if (!"content".equals(uri.getScheme()) || !pendingBackupFile().isFile()) {
                clearPendingBackup(); reportBackup("error", "备份准备状态已失效，请重新导出。"); return;
            }
            new Thread(() -> {
                try (FileInputStream input = new FileInputStream(pendingBackupFile());
                     OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                    if (output == null) throw new IOException("No output stream");
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    output.flush();
                } catch (IOException | SecurityException error) {
                    clearPendingBackup(); reportBackup("error", "备份保存失败，请重新选择保存位置。"); return;
                }
                clearPendingBackup();
                reportBackup("success", "备份已保存。");
            }, "save-backup").start();
        }
    }

    private void clearPendingBackup() {
        // Only delete our own temporary export, never the user-selected document.
        if (pendingBackupFile().exists()) pendingBackupFile().delete();
        exportPending = false;
    }

    private void reportBackup(String status, String message) {
        runOnUiThread(() -> {
            pendingResult = "{\"status\":" + JSONObject.quote(status) + ",\"message\":" + JSONObject.quote(message) + "}";
            dispatchBackupResult();
        });
    }

    private void dispatchBackupResult() {
        if (webView == null || isDestroyed() || !pageReady || pendingResult == null) return;
        String detail = pendingResult;
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('nextstep-backup-result',{detail:" + detail + "}));", null);
        pendingResult = null;
    }

    private void dispatchUpdateResult() {
        if (webView == null || isDestroyed() || !pageReady || pendingUpdateResult == null) return;
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('nextstep-update-result',{detail:"
                + pendingUpdateResult + "}));", null);
        pendingUpdateResult = null;
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        out.putBoolean("exportPending", exportPending);
        out.putString("pendingResult", pendingResult);
        if (updater != null) out.putString("pendingInstallRequest", updater.pendingInstallRequest());
        super.onSaveInstanceState(out);
    }

    @Override protected void onResume() {
        super.onResume();
        if (updater != null) updater.onResume();
        if (webView != null) {
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('nextstep-resume'));document.dispatchEvent(new Event('visibilitychange'));", null);
        }
    }

    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    private void handleBack() {
        webView.evaluateJavascript("(function(){var ds=document.querySelectorAll('dialog[open]');if(ds.length){ds[ds.length-1].close();return true;}return false;})()", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    @Override public void onBackPressed() { handleBack(); }

    @Override protected void onDestroy() {
        if (updater != null) updater.close();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (webView != null) {
            webView.removeJavascriptInterface("NextStepAndroid");
            webView.removeJavascriptInterface("NextStepUpdates");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
