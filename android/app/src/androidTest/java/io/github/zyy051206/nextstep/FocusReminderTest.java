package io.github.zyy051206.nextstep;

import android.content.Context;
import android.content.Intent;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class FocusReminderTest {
    private final Context context=ApplicationProvider.getApplicationContext();
    @Test public void alarmPersistsAndPauseCancelsIt() throws Exception {
        String json=new JSONObject().put("id","test-alarm").put("title","专注结束了").put("endsAt",System.currentTimeMillis()+60_000).put("sound",false).toString();
        try {
            FocusReminder.schedule(context,json);
            assertEquals(json,context.getSharedPreferences("focus-reminder",0).getString("pending",null));
            FocusReminder.schedule(context,"null");
            assertFalse(context.getSharedPreferences("focus-reminder",0).contains("pending"));
        } finally {FocusReminder.schedule(context,"null");}
    }
    @Test public void invalidAlarmCannotReplaceTheValidOne() throws Exception {
        String json=new JSONObject().put("id","test-valid").put("title","休息结束了").put("endsAt",System.currentTimeMillis()+60_000).put("sound",true).toString();
        try {
            FocusReminder.schedule(context,json);
            try {FocusReminder.schedule(context,new JSONObject(json).put("endsAt",System.currentTimeMillis()+86400000).toString());fail("Unbounded alarm accepted");}catch(IllegalArgumentException expected){}
            assertEquals(json,context.getSharedPreferences("focus-reminder",0).getString("pending",null));
        } finally {FocusReminder.schedule(context,"null");}
    }
    @Test public void deliveredAlarmIsNotRepeatedAfterResume() throws Exception {
        String json=new JSONObject().put("id","test-delivered").put("title","专注结束了").put("endsAt",System.currentTimeMillis()-1000).put("sound",false).toString();
        context.getSharedPreferences("focus-reminder",0).edit().remove("fired").putString("pending",json).commit();
        new FocusReminder().onReceive(context,new Intent());
        assertFalse(context.getSharedPreferences("focus-reminder",0).contains("pending"));
        assertEquals("test-delivered",context.getSharedPreferences("focus-reminder",0).getString("fired",null));
        FocusReminder.schedule(context,new JSONObject(json).put("endsAt",System.currentTimeMillis()+60_000).toString());
        assertFalse(context.getSharedPreferences("focus-reminder",0).contains("pending"));
    }
    @Test public void updateFailuresGiveActionableMessages() {
        assertTrue(AppUpdater.checkErrorMessage(new java.io.IOException("Rate limited")).contains("请求过多"));
        assertTrue(AppUpdater.checkErrorMessage(new java.net.SocketTimeoutException()).contains("超时"));
        assertTrue(AppUpdater.checkErrorMessage(new java.net.UnknownHostException()).contains("服务器"));
    }
}
