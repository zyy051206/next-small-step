package io.github.zyy051206.nextstep;

import android.os.SystemClock;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/** Runs against the bundled page on a real Android WebView, not a browser mock. */
@RunWith(AndroidJUnit4.class)
public final class AppSmokeTest {
    @Test public void imagePickerFiltersImagesWithoutRestrictingBackupProviders() {
        assertEquals("image/*", MainActivity.filePickerType(new String[]{"image/*"}));
        assertEquals("image/*", MainActivity.filePickerType(new String[]{"image/png,image/jpeg", "image/webp"}));
        assertEquals("*/*", MainActivity.filePickerType(new String[]{"application/json", ".json"}));
        assertEquals("*/*", MainActivity.filePickerType(new String[]{"image/*", "application/json"}));
        assertEquals("*/*", MainActivity.filePickerType(new String[]{""}));
        assertEquals("*/*", MainActivity.filePickerType(null));
    }

    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            WebView webView = activity.findViewById(R.id.web_view);
            webView.evaluateJavascript(script, value -> { result.set(value); done.countDown(); });
        });
        assertTrue("WebView JavaScript did not respond", done.await(8, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitPage(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 20_000;
        while (SystemClock.elapsedRealtime() < deadline) {
            if ("true".equals(evaluate(scenario, "document.readyState==='complete' && typeof StepCore==='object' && typeof StepStats==='object' && typeof StepAppearance==='object' && typeof document.getElementById('new-goal').onclick==='function' && document.querySelectorAll('#monthly-table-body tr').length===12"))) {
                evaluate(scenario, "window.nativeAppearanceReady=false;StepAppearance.ready.then(()=>{window.nativeAppearanceReady=true})");
                while (SystemClock.elapsedRealtime() < deadline) {
                    if ("true".equals(evaluate(scenario, "window.nativeAppearanceReady"))) return;
                    SystemClock.sleep(100);
                }
                throw new AssertionError("Local appearance storage did not finish loading");
            }
            SystemClock.sleep(150);
        }
        throw new AssertionError("Bundled page did not finish loading");
    }

    @Test public void loadsOfflineAndKeepsDataAfterActivityRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitPage(scenario);
            assertEquals("\"https://appassets.androidplatform.net\"", evaluate(scenario, "location.origin"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepAndroid.saveBackup"));
            assertEquals("\"" + BuildConfig.VERSION_NAME + "\"", evaluate(scenario, "NextStepUpdates.getVersion()"));
            assertEquals("\"android\"", evaluate(scenario, "NextStepUpdates.getPlatform()"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepUpdates.checkUpdates"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepUpdates.installUpdate"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepUpdates.cancelUpdate"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepUpdates.getUpdateState"));
            assertEquals("true", evaluate(scenario, "document.body.textContent.includes('下一小步')"));
            evaluate(scenario, "{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'android-background.png',{type:'image/png'}));const input=document.getElementById('appearance-bg-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-icon-color=\"#7054a4\"]').click();});}");
            long backgroundDeadline = SystemClock.elapsedRealtime() + 8_000;
            while (SystemClock.elapsedRealtime() < backgroundDeadline && !"true".equals(evaluate(scenario, "document.body.classList.contains('has-custom-background') && document.getElementById('appearance-bg-preview').naturalWidth===2"))) SystemClock.sleep(100);
            assertEquals("true", evaluate(scenario, "document.body.classList.contains('has-custom-background') && document.getElementById('appearance-bg-preview').naturalWidth===2"));
            // Exercise the actual goal and timer UI, then reconstruct the Activity.
            evaluate(scenario, "document.getElementById('new-goal').click();document.getElementById('goal-name').value='Android smoke goal';document.getElementById('goal-steps').value='Verify a real focus session';document.getElementById('goal-form').requestSubmit();document.querySelector('[data-minutes=\"10\"]').click();document.getElementById('timer-start').click();");
            assertEquals("true", evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.status==='running' && document.getElementById('focus-state').textContent==='正在专注'"));
            String deadline = evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt");
            SystemClock.sleep(1200);
            scenario.recreate();
            awaitPage(scenario);
            long restoredDeadline = SystemClock.elapsedRealtime() + 8_000;
            while (SystemClock.elapsedRealtime() < restoredDeadline && !"true".equals(evaluate(scenario, "document.getElementById('appearance-bg-preview').naturalWidth===2"))) SystemClock.sleep(100);
            assertEquals("true", evaluate(scenario, "document.body.classList.contains('has-custom-background') && document.getElementById('appearance-bg-name').textContent==='android-background.png' && document.getElementById('appearance-bg-preview').naturalWidth===2"));
            assertEquals("\"#7054a4\"", evaluate(scenario, "document.documentElement.style.getPropertyValue('--icon-color')"));
            assertEquals("\"Android smoke goal\"", evaluate(scenario, "document.getElementById('goal-title').textContent"));
            assertEquals("true", evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].text==='Verify a real focus session'"));
            assertEquals(deadline, evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt"));
            assertEquals("true", evaluate(scenario, "document.getElementById('focus-state').textContent==='正在专注' && StepCore.remaining(JSON.parse(localStorage.getItem(StepCore.key)).timer)<599000"));
            assertEquals("12", evaluate(scenario, "document.querySelectorAll('#monthly-table-body tr').length"));
            assertEquals("12", evaluate(scenario, "document.querySelectorAll('#annual-chart .month-column').length"));
            evaluate(scenario, "document.getElementById('appearance-bg-remove').click();localStorage.removeItem('next-small-step.appearance.v1');localStorage.removeItem(StepCore.key)");
            long cleanupDeadline = SystemClock.elapsedRealtime() + 8_000;
            while (SystemClock.elapsedRealtime() < cleanupDeadline && !"false".equals(evaluate(scenario, "document.body.classList.contains('has-custom-background')"))) SystemClock.sleep(100);
            assertEquals("false", evaluate(scenario, "document.body.classList.contains('has-custom-background')"));
        }
    }

    @Test public void backClosesDialogBeforeBackgroundingApp() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitPage(scenario);
            evaluate(scenario, "document.getElementById('guide-dialog').showModal()");
            assertEquals("true", evaluate(scenario, "document.getElementById('guide-dialog').open"));
            scenario.onActivity(MainActivity::onBackPressed);
            long deadline = SystemClock.elapsedRealtime() + 3_000;
            while (SystemClock.elapsedRealtime() < deadline && !"false".equals(evaluate(scenario, "document.getElementById('guide-dialog').open"))) SystemClock.sleep(100);
            assertEquals("false", evaluate(scenario, "document.getElementById('guide-dialog').open"));
        }
    }

    @Test public void updateDownloadRequiresANativelyValidatedNewVersion() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitPage(scenario);
            // Isolate this checker from the real page's automatic check, so the test
            // stays deterministic even when a newer public release exists later.
            AtomicReference<JSONObject> result = new AtomicReference<>();
            AtomicReference<AppUpdater> updater = new AtomicReference<>();
            CountDownLatch done = new CountDownLatch(1);
            scenario.onActivity(activity -> {
                AppUpdater checker = new AppUpdater(activity, detail -> { result.set(detail); done.countDown(); });
                updater.set(checker);
                checker.downloadUpdate("android_smoke_download");
            });
            try {
                assertTrue("Update bridge did not reply", done.await(5, TimeUnit.SECONDS));
                assertEquals("android_smoke_download", result.get().getString("requestId"));
                assertEquals("error", result.get().getString("status"));
                assertEquals("download", result.get().getString("action"));
                assertEquals(BuildConfig.VERSION_NAME, result.get().getString("currentVersion"));
                assertTrue(result.get().getString("message").contains("先检查更新"));
            } finally { updater.get().close(); }
            assertEquals("\"https://appassets.androidplatform.net\"", evaluate(scenario, "location.origin"));
        }
    }

    @Test public void updaterRestoresIdleStateAndBlocksInstallWithoutVerifiedApk() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitPage(scenario);
            java.util.concurrent.BlockingQueue<JSONObject> results = new java.util.concurrent.LinkedBlockingQueue<>();
            AtomicReference<AppUpdater> updater = new AtomicReference<>();
            scenario.onActivity(activity -> updater.set(new AppUpdater(activity, results::offer)));
            try {
                updater.get().getUpdateState("state_smoke");
                JSONObject state = results.poll(8, TimeUnit.SECONDS);
                assertTrue("State did not resolve", state != null);
                assertEquals("state", state.getString("action"));
                assertEquals("idle", state.getString("status"));
                updater.get().cancelUpdate("cancel_smoke");
                JSONObject cancel = results.poll(5, TimeUnit.SECONDS);
                assertTrue(cancel != null);
                assertEquals("cancelled", cancel.getString("status"));
                updater.get().installUpdate("install_smoke");
                JSONObject install = results.poll(8, TimeUnit.SECONDS);
                assertTrue(install != null);
                assertEquals("install", install.getString("action"));
                assertEquals("error", install.getString("status"));
                assertTrue(install.getString("message").contains("重新下载"));
                assertEquals("\"https://appassets.androidplatform.net\"", evaluate(scenario, "location.origin"));
            } finally { updater.get().close(); }
        }
    }
}
