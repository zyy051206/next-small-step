package io.github.zyy051206.nextstep;

import android.os.SystemClock;
import android.webkit.WebView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

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
            if ("true".equals(evaluate(scenario, "document.readyState==='complete' && typeof StepCore==='object' && typeof StepStats==='object' && typeof document.getElementById('new-goal').onclick==='function' && document.querySelectorAll('#monthly-table-body tr').length===12"))) return;
            SystemClock.sleep(150);
        }
        throw new AssertionError("Bundled page did not finish loading");
    }

    @Test public void loadsOfflineAndKeepsDataAfterActivityRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitPage(scenario);
            assertEquals("\"https://appassets.androidplatform.net\"", evaluate(scenario, "location.origin"));
            assertEquals("\"function\"", evaluate(scenario, "typeof NextStepAndroid.saveBackup"));
            assertEquals("true", evaluate(scenario, "document.body.textContent.includes('下一小步')"));
            // Exercise the actual goal and timer UI, then reconstruct the Activity.
            evaluate(scenario, "document.getElementById('new-goal').click();document.getElementById('goal-name').value='Android smoke goal';document.getElementById('goal-steps').value='Verify a real focus session';document.getElementById('goal-form').requestSubmit();document.querySelector('[data-minutes=\"10\"]').click();document.getElementById('timer-start').click();");
            assertEquals("true", evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.status==='running' && document.getElementById('focus-state').textContent==='正在专注'"));
            String deadline = evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt");
            SystemClock.sleep(1200);
            scenario.recreate();
            awaitPage(scenario);
            assertEquals("\"Android smoke goal\"", evaluate(scenario, "document.getElementById('goal-title').textContent"));
            assertEquals("true", evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].text==='Verify a real focus session'"));
            assertEquals(deadline, evaluate(scenario, "JSON.parse(localStorage.getItem(StepCore.key)).timer.endsAt"));
            assertEquals("true", evaluate(scenario, "document.getElementById('focus-state').textContent==='正在专注' && StepCore.remaining(JSON.parse(localStorage.getItem(StepCore.key)).timer)<599000"));
            assertEquals("12", evaluate(scenario, "document.querySelectorAll('#monthly-table-body tr').length"));
            assertEquals("12", evaluate(scenario, "document.querySelectorAll('#annual-chart .month-column').length"));
            evaluate(scenario, "localStorage.removeItem(StepCore.key)");
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
}
