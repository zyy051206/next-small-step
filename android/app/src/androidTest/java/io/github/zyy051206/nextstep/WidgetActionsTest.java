package io.github.zyy051206.nextstep;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import android.content.Context;
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
    private void await(ActivityScenario<MainActivity> scenario,String step,String script) throws Exception {
        long end=SystemClock.elapsedRealtime()+20000;
        while(SystemClock.elapsedRealtime()<end) {if("true".equals(evaluate(scenario,script)))return;SystemClock.sleep(100);}
        fail("Widget test timed out while waiting for: "+step+"; observed="+evaluate(scenario,script));
    }
    private void command(ActivityScenario<MainActivity> scenario,JSONObject command) {
        scenario.onActivity(activity -> activity.onNewIntent(HomeWidgets.actionIntent(activity,77,4,command)));
    }
    @Test public void widgetStartPauseResumeAndCompletePersistThroughRecreation() throws Exception {
        // ActivityScenario tracks the launch Intent's filter fields. Start through the same
        // widget deep link as later taps, so setIntent() remains a real Android lifecycle test.
        Context context=ApplicationProvider.getApplicationContext();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(HomeWidgets.actionIntent(context,77,4,new JSONObject().put("action","open").put("page","workspace")))) {
            await(scenario,"initial app load","typeof StepApp==='object' && typeof StepWidgets==='object' && document.readyState==='complete'");
            String oldTimeOrigin=evaluate(scenario,"performance.timeOrigin");
            evaluate(scenario,"localStorage.setItem(StepCore.key,JSON.stringify(StepCore.initial()));location.reload()");
            await(scenario,"test reset reload","document.readyState==='complete' && performance.timeOrigin!=="+oldTimeOrigin);
            await(scenario,"empty test state","typeof StepApp==='object' && document.readyState==='complete' && StepApp.getState().goals.length===0");
            evaluate(scenario,"{const s=StepApp.getState();s.goals=[{id:'widget-goal',title:'桌面测试',why:'',createdAt:Date.now(),steps:[{id:'widget-step',text:'真实待办',done:false,completedAt:null,dueDate:StepCore.dayKey(Date.now()),priority:'normal',estimate:0,pomodoros:0}]}];s.selectedGoal='widget-goal';s.selectedStep='widget-step';StepApp.saveAndRender();}");
            await(scenario,"fixture saved","StepApp.getState().selectedGoal==='widget-goal' && StepApp.getState().selectedStep==='widget-step'");
            JSONObject start=new JSONObject().put("action","start").put("page","workspace").put("kind","focus").put("goalId","widget-goal").put("stepId","widget-step").put("endsAt",0);
            command(scenario,start);
            await(scenario,"widget start","StepApp.getState().timer?.status==='running'");
            long endsAt=(long)Double.parseDouble(evaluate(scenario,"StepApp.getState().timer.endsAt"));
            JSONObject pause=new JSONObject(start.toString()).put("action","pause").put("endsAt",endsAt);
            command(scenario,pause);await(scenario,"widget pause","StepApp.getState().timer?.status==='paused'");
            // Repeated delivery must never toggle a paused timer back to running.
            command(scenario,pause);SystemClock.sleep(200);assertEquals("\"paused\"",evaluate(scenario,"StepApp.getState().timer.status"));
            scenario.recreate();await(scenario,"paused timer after recreation","typeof StepApp==='object' && StepApp.getState().timer?.status==='paused'");
            command(scenario,new JSONObject(pause.toString()).put("action","resume"));await(scenario,"widget resume","StepApp.getState().timer?.status==='running'");
            command(scenario,new JSONObject().put("action","complete").put("page","calendar").put("goalId","widget-goal").put("stepId","widget-step"));
            await(scenario,"widget complete","StepApp.getState().timer===null && StepApp.getState().goals[0].steps[0].done");
            // Completion is idempotent, even if the same old desktop row is tapped twice.
            command(scenario,new JSONObject().put("action","complete").put("page","calendar").put("goalId","widget-goal").put("stepId","widget-step"));
            SystemClock.sleep(200);assertEquals("true",evaluate(scenario,"JSON.parse(localStorage.getItem(StepCore.key)).goals[0].steps[0].done"));
            scenario.recreate();await(scenario,"completed step after recreation","typeof StepApp==='object' && StepApp.getState().goals[0]?.steps[0]?.done===true");
            scenario.onActivity(activity -> assertEquals(0,HomeWidgets.snapshot(activity).optJSONArray("tasks").length()));
            evaluate(scenario,"localStorage.setItem(StepCore.key,JSON.stringify(StepCore.initial()));location.reload()");
        }
    }
}
