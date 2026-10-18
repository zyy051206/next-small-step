package io.github.zyy051206.nextstep;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;

/** One local alarm; no target names, network, or user-selected paths cross this bridge. */
public final class FocusReminder extends BroadcastReceiver {
    private static final String STORE="focus-reminder", ALARM="io.github.zyy051206.nextstep.FOCUS_ALARM";
    private static final int ID=2401;
    private static PendingIntent intent(Context context) {
        return PendingIntent.getBroadcast(context,ID,new Intent(context,FocusReminder.class).setAction(ALARM),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static synchronized void schedule(Context context,String raw) throws Exception {
        SharedPreferences preferences=context.getSharedPreferences(STORE,Context.MODE_PRIVATE);
        AlarmManager alarms=context.getSystemService(AlarmManager.class);
        if ("null".equals(raw)) { alarms.cancel(intent(context));preferences.edit().remove("pending").apply();return; }
        if(raw==null||raw.length()>1024)throw new IllegalArgumentException();
        JSONObject value=new JSONObject(raw);long end=value.getLong("endsAt"),now=System.currentTimeMillis();
        String id=value.getString("id"),title=value.getString("title");value.getBoolean("sound");
        if(id.length()>80||!("专注结束了".equals(title)||"休息结束了".equals(title))||end>now+181*60_000L||end<now-60_000L)throw new IllegalArgumentException();
        alarms.cancel(intent(context));
        if(end<=now||id.equals(preferences.getString("fired","")))return;
        if(!preferences.edit().putString("pending",raw).commit())throw new IllegalStateException();
        if(Build.VERSION.SDK_INT<31||alarms.canScheduleExactAlarms()) {
            try{alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,end,intent(context));return;}
            catch(SecurityException ignored){/* Permission may be revoked between the check and scheduling. */}
        }
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,end,intent(context));
    }
    @Override public void onReceive(Context context,Intent trigger) {
        synchronized(FocusReminder.class) {
            SharedPreferences preferences=context.getSharedPreferences(STORE,Context.MODE_PRIVATE);
            String raw=preferences.getString("pending",null);if(raw==null)return;
            try {
                JSONObject value=new JSONObject(raw);long end=value.getLong("endsAt");
                if(end>System.currentTimeMillis()){schedule(context,raw);return;}
                String id=value.getString("id");
                if(id.equals(preferences.getString("fired","")))return;
                preferences.edit().remove("pending").putString("fired",id).commit();
                if(System.currentTimeMillis()-end>60*60_000L)return;
                NotificationManager manager=context.getSystemService(NotificationManager.class);
                if(!manager.areNotificationsEnabled() || (Build.VERSION.SDK_INT>=33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED))return;
                boolean sound=value.getBoolean("sound");String channel=sound?"focus-sound-v1":"focus-silent-v1";
                NotificationChannel settings=new NotificationChannel(channel,sound?"专注到时（有声）":"专注到时（静音）",NotificationManager.IMPORTANCE_DEFAULT);
                if(!sound)settings.setSound(null,null);manager.createNotificationChannel(settings);
                PendingIntent open=PendingIntent.getActivity(context,ID,new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
                Notification notification=new Notification.Builder(context,channel).setSmallIcon(io.github.zyy051206.nextstep.R.drawable.ic_sprout)
                    .setContentTitle("下一小步").setContentText(value.getString("title")).setContentIntent(open).setAutoCancel(true).build();
                manager.notify(ID,notification);
            } catch(Exception ignored){/* Invalid or obsolete local alarm cannot crash a receiver. */}
        }
    }
    public static final class Bridge {
        private final Activity activity;
        Bridge(Activity activity){this.activity=activity;}
        @JavascriptInterface public String getStatus(){
            try{return new JSONObject().put("platform","android").put("permission",activity.getSystemService(NotificationManager.class).areNotificationsEnabled()?"granted":"denied")
                .put("exact",Build.VERSION.SDK_INT<31||activity.getSystemService(AlarmManager.class).canScheduleExactAlarms()).toString();}
            catch(Exception ignored){return "{}";}
        }
        @JavascriptInterface public void schedule(String json){try{FocusReminder.schedule(activity,json);}catch(Exception ignored){}}
        @JavascriptInterface public void requestPermission(){activity.runOnUiThread(()->{
            if(Build.VERSION.SDK_INT>=33&&activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},2401);
            else if(!activity.getSystemService(NotificationManager.class).areNotificationsEnabled()) activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,activity.getPackageName()));
        });}
        @JavascriptInterface public void requestExactPermission(){activity.runOnUiThread(()->{
            if(Build.VERSION.SDK_INT>=31&&!activity.getSystemService(AlarmManager.class).canScheduleExactAlarms()) try{activity.startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+activity.getPackageName())));}catch(ActivityNotFoundException ignored){}
        });}
    }
}
