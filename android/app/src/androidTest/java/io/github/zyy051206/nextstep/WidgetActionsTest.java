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
import static org.junit.Assert.*;

/** Actual widget deep links run against the same WebView state and timer controls as normal taps. */
@RunWith(AndroidJUnit4.class)
public class WidgetActionsTest {
    private String evaluate(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        AtomicReference<String> result=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
        scenario.onActivity(activity -> ((WebView)activity.findViewById(R.id.web_view)).evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue(done.await(8,TimeUnit.SECONDS));return result.get();
    }
    private void await(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        long end=SystemClock.elapsedRealtime()+20000;
        while(SystemClock.elapsedRealtime()<end) {if("true".equals(evaluate(scenario,script)))return;SystemClock.sleep(100);}
        fail("Widget action did not reach the expected application state");
    }
    private void command(ActivityScenario<MainActivity> scenario,JSONObject command) {
        scenario.onActivity(activity -> activity.onNewIntent(HomeWidgets.actionIntent(activity,77,4,command)));
    }
    @Test public void widgetStartPauseResumeAndCompletePersistThroughRecreation() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            await(scenario,"typeof StepApp==='object' && typeof StepWidgets==='object' && document.readyState==='complete'");
            evaluate(scenario,"localStorage.setItem(StepCore.key,JSON.stringify(StepCore.initial()));location.reload()");
            await(scenario,"typeof StepApp==='object' && document.readyState==='complete' && StepApp.getState().goals.length===0");
            evaluate(scenario,"{const s=StepApp.getState();s.goals=[{id:'widget-goal',title:'桌面测试',why:'',createdAt:Date.now(),steps:[{id:'widget-step',text:'真实待办',done:false,completedAt:null,dueDate:StepCore.dayKey(Date.now()),priority:'normal'}]}];s.selectedGoal='widget-goal';s.selectedStep='widget-step';StepApp.saveAndRender();}");
            JSONObject start=new JSONObject().put("action","start").put("page","workspace").put("kind","focus").put("goalId","widget-goal").put("stepId","widget-step").put("endsAt",0);
            command(scenario,start);
            await(scenario,"StepApp.getState().timer?.status==='running'");
            long endsAt=Long.parseLong(evaluate(scenario,"StepApp.getState().timer.endsAt"));
            JSONObject pause=new JSONObject(start.toString()).put("action","pause").put("endsAt",endsAt);
            command(scenario,pause);await(scenario,"StepApp.getState().timer?.status==='paused'");
            // Repeated delivery must never toggle a paused timer back to running.
            command(scenario,pause);SystemClock.sleep(200);assertEquals("\"paused\"",evaluate(scenario,"StepApp.getState().timer.status"));
            scenario.recreate();await(scenario,"typeof StepApp==='object' && StepApp.getState().timer?.status==='paused'");
            command(scenario,new JSONObject(pause.toString()).put("action","resume"));await(scenario,"StepApp.getState().timer?.status==='running'");
            command(scenario,new JSONObject().put("action","complete").put("page","calendar").put("goalId","widget-goal").put("stepId","widget-step"));
            await(scenario,"StepApp.getState().timer===null && StepApp.getState().goals[0].steps[0].done");
            // Completion is idempotent, even if the same old desktop row is tapped twice.
            command(scenario,new JSONObject().put("action","complete").put("page","calendar").put("goalId","widget-goal").put("stepId","widget-step"));
            SystemClock.sleep(200);assertEquals("true",evaluate(scenario,"JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].done"));
            scenario.recreate();await(scenario,"typeof StepApp==='object' && StepApp.getState().goals[0]?.steps[0]?.done===true");
            scenario.onActivity(activity -> assertEquals(0,HomeWidgets.snapshot(activity).optJSONArray("tasks").length()));
            evaluate(scenario,"localStorage.setItem(StepCore.key,JSON.stringify(StepCore.initial()));location.reload()");
        }
    }
}
