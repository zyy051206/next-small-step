package io.github.zyy051206.nextstep;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import java.io.File;
import java.io.FileOutputStream;
import android.view.View;
import android.widget.Chronometer;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.time.LocalDate;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class HomeWidgetsTest {
    private final Context context=ApplicationProvider.getApplicationContext();
    private String previous;
    @Before public void keepSnapshot() {previous=context.getSharedPreferences(HomeWidgets.STORE,0).getString("snapshot",null);}
    @After public void restoreSnapshot() {context.getSharedPreferences(HomeWidgets.STORE,0).edit().putString("snapshot",previous).commit();}
    private JSONObject base() throws Exception {
        return new JSONObject().put("version",1).put("theme","light").put("mode","focus").put("minutes",25)
                .put("tasks",new JSONArray()).put("dates",new JSONArray()).put("timer",JSONObject.NULL)
                .put("selected",new JSONObject().put("goalId","goal").put("stepId","step").put("title","真实的待办"));
    }
    private JSONObject task(String text,String day,String priority) throws Exception {return new JSONObject().put("goalId","goal").put("id",text).put("text",text).put("dueDate",day).put("priority",priority);}
    @Test public void invalidSnapshotCannotReplacePreviousData() throws Exception {
        JSONObject data=base(); assertTrue(HomeWidgets.publish(context,data.toString()));
        String good=context.getSharedPreferences(HomeWidgets.STORE,0).getString("snapshot",null);
        assertFalse(HomeWidgets.publish(context,data.put("minutes",10000).toString()));
        assertEquals(good,context.getSharedPreferences(HomeWidgets.STORE,0).getString("snapshot",null));
        assertFalse(HomeWidgets.publish(context,"not json"));
    }
    @Test public void todayFiltersByCalendarDateAndPrioritizesHigh() throws Exception {
        LocalDate day=LocalDate.of(2026,10,18); JSONObject data=base();
        data.getJSONArray("tasks").put(task("普通",day.toString(),"normal")).put(task("昨天",day.minusDays(1).toString(),"high")).put(task("优先",day.toString(),"high"));
        assertEquals(2,HomeWidgets.todayTasks(data,day).size());
        assertEquals("优先",HomeWidgets.todayTasks(data,day).get(0).getString("text"));
        assertEquals(0,HomeWidgets.todayTasks(data,day.plusDays(1)).size());
    }
    @Test public void yearlyDatesHandleLeapDaysAndOriginalFutureYear() throws Exception {
        JSONObject date=new JSONObject().put("date","2024-02-29").put("repeat","yearly");
        assertEquals(0,HomeWidgets.dateDelta(date,LocalDate.of(2025,2,28)));
        assertEquals(364,HomeWidgets.dateDelta(date,LocalDate.of(2025,3,1)));
        date.put("date","2028-02-29");assertEquals(366,HomeWidgets.dateDelta(date,LocalDate.of(2027,2,28)));
    }
    @Test public void widgetsAreRegisteredAsThreeResizableHomeScreenProviders() {
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        for(Class<?> type:new Class<?>[]{HomeWidgets.Focus.class,HomeWidgets.Todos.class,HomeWidgets.Dates.class}) {
            AppWidgetProviderInfo found=null;
            for(AppWidgetProviderInfo info:manager.getInstalledProviders()) if(info.provider.equals(new ComponentName(context,type))) found=info;
            assertNotNull(found);assertTrue(found.minWidth>0);assertEquals(AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN,found.widgetCategory);
        }
    }
    private View inflate(Class<?> type,int id) throws Exception {
        AtomicReference<View> result=new AtomicReference<>(); AtomicReference<Exception> error=new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {try {View view=HomeWidgets.views(context,id,type).apply(context,new FrameLayout(context));
            float density=context.getResources().getDisplayMetrics().density;int width=(int)(320*density),height=(int)((type==HomeWidgets.Focus.class?190:230)*density);
            view.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));view.layout(0,0,width,height);
            Bitmap bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));
            String suffix=HomeWidgets.snapshot(context).optString("theme").equals("dark")?"-dark":"";
            try(FileOutputStream output=new FileOutputStream(new File(context.getFilesDir(),"widget-"+type.getSimpleName().toLowerCase(java.util.Locale.ROOT)+suffix+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,output);}finally{bitmap.recycle();}
            result.set(view);}catch(Exception e){error.set(e);}});
        if(error.get()!=null) throw error.get(); return result.get();
    }
    @Test public void remoteViewsInflateAndFocusClockKeepsRunningWithoutWebview() throws Exception {
        JSONObject data=base(); data.put("timer",new JSONObject().put("kind","focus").put("status","running").put("duration",300000).put("remaining",300000).put("endsAt",System.currentTimeMillis()+300000).put("stepId","step"));
        data.getJSONArray("tasks").put(task("读完今天的两页笔记",LocalDate.now().toString(),"high")).put(task("整理项目的下一步",LocalDate.now().toString(),"normal"));
        data.getJSONArray("dates").put(new JSONObject().put("title","项目提交").put("date",LocalDate.now().plusDays(20).toString()).put("repeat","none").put("pinned",true));
        assertTrue(HomeWidgets.publish(context,data.toString()));
        View focus=inflate(HomeWidgets.Focus.class,1);
        assertEquals(View.VISIBLE,focus.findViewById(R.id.widget_clock).getVisibility());
        assertTrue(((Chronometer)focus.findViewById(R.id.widget_clock)).isCountDown());
        assertEquals("正在专注",((TextView)focus.findViewById(R.id.widget_title)).getText().toString());
        assertNotNull(inflate(HomeWidgets.Todos.class,2));
        assertNotNull(inflate(HomeWidgets.Dates.class,3));
        assertTrue(HomeWidgets.publish(context,data.put("theme","dark").toString()));
        assertNotNull(inflate(HomeWidgets.Focus.class,4));
    }
    @Test public void untrustedExternalIntentCannotPerformWidgetActions() throws Exception {
        JSONObject command=new JSONObject().put("action","pause").put("page","workspace");
        Intent valid=HomeWidgets.actionIntent(context,1,4,command);
        assertEquals(command.toString(),HomeWidgets.trustedCommand(context,valid));
        valid.removeExtra("widget_token"); assertNull(HomeWidgets.trustedCommand(context,valid));
        assertNull(HomeWidgets.trustedCommand(context,new Intent()));
    }
}
