package io.github.zyy051206.nextstep;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Read-only native snapshots; widget actions always use the application's existing data writer. */
public class HomeWidgets extends AppWidgetProvider {
    static final String STORE = "home-widgets";
    static final int MAX_SNAPSHOT = 4 * 1024 * 1024;
    public static final class Focus extends HomeWidgets { }
    public static final class Todos extends HomeWidgets { }
    public static final class Dates extends HomeWidgets { }
    public static final class Refresh extends BroadcastReceiver {
        @Override public void onReceive(Context context, Intent intent) { refreshAll(context); }
    }
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(STORE, Context.MODE_PRIVATE); }
    private static Class<?>[] providers() { return new Class<?>[]{Focus.class, Todos.class, Dates.class}; }
    static Class<?> provider(String kind) {
        switch (kind) { case "focus": return Focus.class; case "todos": return Todos.class; case "dates": return Dates.class; default: return null; }
    }
    private static synchronized String secret(Context context) {
        SharedPreferences p = prefs(context);
        String value = p.getString("token", null);
        if (value == null) { value = UUID.randomUUID().toString(); if (!p.edit().putString("token", value).commit()) throw new IllegalStateException("Widget storage unavailable"); }
        return value;
    }
    static JSONObject validate(String raw) throws JSONException {
        if (raw == null || raw.length() > MAX_SNAPSHOT) throw new JSONException("Snapshot too large");
        JSONObject data = new JSONObject(raw);
        if (data.getInt("version") != 1 || !java.util.Arrays.asList("light", "dark").contains(data.getString("theme"))
                || !java.util.Arrays.asList("focus", "shortBreak", "longBreak").contains(data.getString("mode"))
                || data.getInt("minutes") < 1 || data.getInt("minutes") > 180) throw new JSONException("Invalid snapshot");
        JSONArray tasks = data.getJSONArray("tasks"), dates = data.getJSONArray("dates");
        if (tasks.length() > 10000 || dates.length() > 200) throw new JSONException("Too many items");
        JSONObject selected = data.getJSONObject("selected");
        string(selected, "goalId", 120, true); string(selected, "stepId", 120, true); string(selected, "title", 160, true);
        for (int i=0;i<tasks.length();i++) {
            JSONObject t=tasks.getJSONObject(i); string(t,"goalId",120,false); string(t,"id",120,false); string(t,"text",160,false);
            date(t.getString("dueDate"));
            if(!java.util.Arrays.asList("high","normal","low").contains(t.getString("priority"))) throw new JSONException("Invalid priority");
        }
        for(int i=0;i<dates.length();i++) {
            JSONObject d=dates.getJSONObject(i); string(d,"title",100,false); date(d.getString("date"));
            if(!java.util.Arrays.asList("none","yearly").contains(d.getString("repeat"))) throw new JSONException("Invalid recurrence");
            d.getBoolean("pinned");
        }
        if(!data.isNull("timer")) {
            JSONObject t=data.getJSONObject("timer");
            if(!java.util.Arrays.asList("running","paused").contains(t.getString("status")) || !java.util.Arrays.asList("focus","shortBreak","longBreak").contains(t.getString("kind"))) throw new JSONException("Invalid timer");
            long duration=t.getLong("duration"), remaining=t.getLong("remaining"), end=t.getLong("endsAt");
            if(duration<60_000 || duration>10_800_000 || remaining<0 || remaining>duration || end<0 || end>System.currentTimeMillis()+10_860_000) throw new JSONException("Invalid duration");
            if(!t.isNull("stepId")) string(t,"stepId",120,false);
        }
        return data;
    }
    private static void string(JSONObject data,String key,int max,boolean empty) throws JSONException {
        Object value=data.get(key);
        if(!(value instanceof String) || ((String)value).length()>max || (!empty && ((String)value).isEmpty())) throw new JSONException("Invalid text");
    }
    private static LocalDate date(String raw) throws JSONException {
        try { if(!raw.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") || raw.startsWith("0000")) throw new IllegalArgumentException(); return LocalDate.parse(raw); }
        catch(RuntimeException error) {throw new JSONException("Invalid date");}
    }
    static JSONObject snapshot(Context context) {
        try { return validate(prefs(context).getString("snapshot", "")); } catch(JSONException error) {return null;}
    }
    static boolean publish(Context context,String raw) {
        try {
            String data=validate(raw).toString();
            if(data.equals(prefs(context).getString("snapshot",null))) return true;
            if(!prefs(context).edit().putString("snapshot",data).commit()) return false;
            refreshAll(context); return true;
        } catch(JSONException | RuntimeException error) {return false;}
    }
    public static final class Bridge {
        private final MainActivity activity;
        Bridge(MainActivity activity) { this.activity=activity; }
        @JavascriptInterface public boolean publish(String raw) {return HomeWidgets.publish(activity,raw);}
        @JavascriptInterface public String takeCommand() {return activity.takeWidgetCommand();}
        @JavascriptInterface public boolean requestPin(String kind) {
            Class<?> component=provider(kind);
            if(component==null) return false;
            AppWidgetManager manager=AppWidgetManager.getInstance(activity);
            if(!manager.isRequestPinAppWidgetSupported()) return false;
            activity.runOnUiThread(() -> {
                try {manager.requestPinAppWidget(new ComponentName(activity,component),null,null);}
                catch(RuntimeException error) {android.widget.Toast.makeText(activity,"请从桌面的组件列表添加下一小步。",android.widget.Toast.LENGTH_LONG).show();}
            });
            return true;
        }
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids) { for(int id:ids) update(context,manager,id,getClass()); schedule(context); }
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,Bundle options) {update(context,manager,id,getClass());}
    @Override public void onDisabled(Context context) {schedule(context);}
    static void refreshAll(Context context) {
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        for(Class<?> type:providers()) for(int id:manager.getAppWidgetIds(new ComponentName(context,type))) update(context,manager,id,type);
        schedule(context);
    }
    private static PendingIntent refreshIntent(Context context) {
        return PendingIntent.getBroadcast(context,2402,new Intent(context,Refresh.class).setAction("io.github.zyy051206.nextstep.WIDGET_REFRESH"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    private static void schedule(Context context) {
        AppWidgetManager manager=AppWidgetManager.getInstance(context); int count=0;
        for(Class<?> type:providers()) count+=manager.getAppWidgetIds(new ComponentName(context,type)).length;
        AlarmManager alarm=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
        if(alarm==null) return;
        PendingIntent intent=refreshIntent(context); alarm.cancel(intent); if(count==0) return;
        long when=LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()+1000;
        JSONObject data=snapshot(context), timer=data==null?null:data.optJSONObject("timer");
        if(timer!=null && "running".equals(timer.optString("status")) && timer.optLong("endsAt")>System.currentTimeMillis()) when=Math.min(when,timer.optLong("endsAt"));
        try {
            if(android.os.Build.VERSION.SDK_INT<31 || alarm.canScheduleExactAlarms()) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,intent);
            else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,intent);
        } catch(SecurityException error) {alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,when,intent);}
    }
    static List<JSONObject> todayTasks(JSONObject data,LocalDate today) throws JSONException {
        List<JSONObject> list=new ArrayList<>(); JSONArray tasks=data.getJSONArray("tasks");
        for(int i=0;i<tasks.length();i++) if(today.toString().equals(tasks.getJSONObject(i).getString("dueDate"))) list.add(tasks.getJSONObject(i));
        list.sort(Comparator.comparingInt(t -> "high".equals(t.optString("priority"))?0:"low".equals(t.optString("priority"))?2:1)); return list;
    }
    static long dateDelta(JSONObject event,LocalDate today) throws JSONException {
        LocalDate value=date(event.getString("date"));
        if("yearly".equals(event.getString("repeat"))) {
            value=value.withYear(Math.max(today.getYear(),value.getYear()));
            if(value.isBefore(today)) value=date(event.getString("date")).withYear(value.getYear()+1);
        }
        return ChronoUnit.DAYS.between(today,value);
    }
    private static JSONObject command(String action,String page) throws JSONException {return new JSONObject().put("action",action).put("page",page);}
    static Intent actionIntent(Context context,int widget,int slot,JSONObject command) {
        return new Intent(context,MainActivity.class).setAction("io.github.zyy051206.nextstep.WIDGET_OPEN")
                .setData(new Uri.Builder().scheme("nextstepwidget").authority("home").appendPath(String.valueOf(widget)).appendPath(String.valueOf(slot)).build())
                .putExtra("widget_token",secret(context)).putExtra("widget_command",command.toString())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
    static String trustedCommand(Context context,Intent intent) {
        if(intent==null || !"io.github.zyy051206.nextstep.WIDGET_OPEN".equals(intent.getAction()) || !secret(context).equals(intent.getStringExtra("widget_token"))) return null;
        String raw=intent.getStringExtra("widget_command"); if(raw==null || raw.length()>2048) return null;
        try {
            JSONObject command=new JSONObject(raw);
            if(!java.util.Arrays.asList("open","start","pause","resume","complete").contains(command.getString("action")) || !java.util.Arrays.asList("workspace","calendar","important-dates").contains(command.getString("page"))) return null;
            return command.toString();
        } catch(JSONException error) {return null;}
    }
    private static void click(Context context,RemoteViews views,int view,int widget,int slot,JSONObject command) {
        views.setOnClickPendingIntent(view,PendingIntent.getActivity(context,0,actionIntent(context,widget,slot,command),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
    }
    static RemoteViews views(Context context,int id,Class<?> type) throws JSONException {
        JSONObject data=snapshot(context); boolean dark=data!=null && "dark".equals(data.optString("theme"));
        RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.widget_card);
        view.setInt(R.id.widget_card,"setBackgroundResource",dark?R.drawable.widget_dark:R.drawable.widget_light);
        for(int text:new int[]{R.id.widget_title,R.id.widget_clock,R.id.widget_time,R.id.widget_line_1,R.id.widget_line_2,R.id.widget_line_3}) view.setTextColor(text,Color.parseColor(dark?"#edf3ed":"#243f30"));
        for(int text:new int[]{R.id.widget_brand,R.id.widget_hint,R.id.widget_button}) view.setTextColor(text,Color.parseColor(dark?"#b7d4bd":"#45654f"));
        view.setViewVisibility(R.id.widget_clock,View.GONE); view.setViewVisibility(R.id.widget_time,View.GONE);
        for(int row:new int[]{R.id.widget_line_1,R.id.widget_line_2,R.id.widget_line_3}) view.setViewVisibility(row,View.GONE);
        String page=type==Todos.class?"calendar":type==Dates.class?"important-dates":"workspace";
        click(context,view,R.id.widget_card,id,0,command("open",page));
        click(context,view,R.id.widget_button,id,4,command("open",page));
        view.setTextViewText(R.id.widget_button,"打开应用  ↗");
        view.setTextViewText(R.id.widget_hint,"点击操作时进入应用");
        if(data==null) {view.setTextViewText(R.id.widget_title,"打开应用，同步你的进度"); return view;}
        if(type==Focus.class) {
            JSONObject timer=data.optJSONObject("timer"), selected=data.getJSONObject("selected");
            boolean running=timer!=null && "running".equals(timer.getString("status"));
            long remaining=timer==null?data.getInt("minutes")*60_000L:running?Math.max(0,timer.getLong("endsAt")-System.currentTimeMillis()):timer.getLong("remaining");
            String kind=timer==null?data.getString("mode"):timer.getString("kind");
            boolean ended=timer!=null && running && remaining==0;
            view.setTextViewText(R.id.widget_title,ended?"这一段已结束":running?("focus".equals(kind)?"正在专注":"正在休息"):timer!=null?"已暂停":"准备好，就开始");
            if(running && !ended) {
                view.setViewVisibility(R.id.widget_clock,View.VISIBLE);
                view.setChronometerCountDown(R.id.widget_clock,true);
                view.setChronometer(R.id.widget_clock,SystemClock.elapsedRealtime()+remaining,null,true);
            } else {view.setViewVisibility(R.id.widget_time,View.VISIBLE); long seconds=(remaining+999)/1000; view.setTextViewText(R.id.widget_time,String.format(Locale.ROOT,"%02d:%02d",seconds/60,seconds%60));}
            view.setViewVisibility(R.id.widget_line_1,View.VISIBLE);
            view.setTextViewText(R.id.widget_line_1,"focus".equals(kind)?selected.optString("title","").isEmpty()?"先在应用里选择一项待办":selected.getString("title"):"休息一下，慢慢来");
            boolean missing=timer==null && "focus".equals(kind) && selected.getString("stepId").isEmpty();
            String action=ended || missing?"open":timer==null?"start":running?"pause":"resume";
            JSONObject cmd=command(action,page).put("kind",kind).put("goalId",selected.getString("goalId")).put("stepId",timer==null?selected.getString("stepId"):timer.optString("stepId", "")).put("endsAt",timer==null?0:timer.getLong("endsAt"));
            view.setTextViewText(R.id.widget_button,ended?"打开查看记录  ↗":missing?"选择待办  ↗":timer==null?"进入并开始  →":running?"进入并暂停  Ⅱ":"进入并继续  →");
            click(context,view,R.id.widget_button,id,4,cmd);
        } else if(type==Todos.class) {
            List<JSONObject> tasks=todayTasks(data,LocalDate.now());
            view.setTextViewText(R.id.widget_title,"今日待办 · "+tasks.size()+" 项");
            int[] rows={R.id.widget_line_1,R.id.widget_line_2,R.id.widget_line_3};
            for(int i=0;i<Math.min(3,tasks.size());i++) {JSONObject task=tasks.get(i);view.setViewVisibility(rows[i],View.VISIBLE);view.setTextViewText(rows[i],"○  "+task.getString("text"));click(context,view,rows[i],id,i+1,command("complete",page).put("goalId",task.getString("goalId")).put("stepId",task.getString("id")));}
            if(tasks.isEmpty()) {view.setViewVisibility(rows[0],View.VISIBLE);view.setTextViewText(rows[0],"今天没有未完成的安排");}
            view.setTextViewText(R.id.widget_button,tasks.size()>3?"查看全部待办  ↗":"安排今天  ↗");
        } else {
            List<JSONObject> dates=new ArrayList<>();JSONArray items=data.getJSONArray("dates");for(int i=0;i<items.length();i++) dates.add(items.getJSONObject(i));
            LocalDate today=LocalDate.now();
            dates.sort(Comparator.comparingInt((JSONObject d)->d.optBoolean("pinned")?0:1).thenComparingLong(d->{try {long delta=dateDelta(d,today);return delta>=0?delta:1_000_000-delta;}catch(JSONException error){return Long.MAX_VALUE;}}));
            view.setTextViewText(R.id.widget_title,"重要日期");int[] rows={R.id.widget_line_1,R.id.widget_line_2,R.id.widget_line_3};
            for(int i=0;i<Math.min(3,dates.size());i++) {JSONObject d=dates.get(i);long delta=dateDelta(d,today);view.setViewVisibility(rows[i],View.VISIBLE);view.setTextViewText(rows[i],d.getString("title")+" · "+(delta==0?"就是今天":delta>0?"还有 "+delta+" 天":"已过 "+(-delta)+" 天"));}
            if(dates.isEmpty()){view.setViewVisibility(rows[0],View.VISIBLE);view.setTextViewText(rows[0],"为值得记住的日子留个位置");}
        }
        return view;
    }
    private static void update(Context context,AppWidgetManager manager,int id,Class<?> type) {
        try {manager.updateAppWidget(id,views(context,id,type));} catch(JSONException | RuntimeException error) { /* Keep the existing widget if launcher or storage is unavailable. */ }
    }
}
