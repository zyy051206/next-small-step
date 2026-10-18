(() => {
  'use strict';
  const key='next-small-step.reminders.v1', bridge=window.NextStepReminders;
  let prefs, last='', timer=null, browserAlarm;
  const section=document.createElement('section'); section.className='reminder-settings';
  section.innerHTML='<h3>到时提醒</h3><label><input id="reminder-enabled" type="checkbox">开启专注与休息结束提醒</label><label><input id="reminder-sound" type="checkbox">提示声音</label><button type="button" class="button secondary" id="reminder-permission">允许系统通知</button><button type="button" class="button secondary" id="reminder-exact" hidden>允许准时提醒</button><p class="muted" id="reminder-status" role="status"></p>';
  document.querySelector('#focus-settings-dialog').append(section);
  const $=id=>document.getElementById(id);
  function load(){try{const raw=JSON.parse(localStorage.getItem(key));prefs={enabled:raw?.enabled===true,sound:raw?.sound!==false};}catch{prefs={enabled:false,sound:true};} $('reminder-enabled').checked=prefs.enabled;$('reminder-sound').checked=prefs.sound;last='';}
  async function refresh(){
    try {
      const result=bridge ? await bridge.getStatus() : JSON.stringify({permission:typeof Notification!=='undefined'?Notification.permission:'unsupported',platform:'web'});
      const status=typeof result==='string'?JSON.parse(result):result;
      $('reminder-exact').hidden=status.platform!=='android'||status.exact!==false;
      $('reminder-status').textContent=status.permission==='granted'
        ? status.platform==='android' ? status.exact===false?'通知已允许；未允许准时提醒，锁屏时可能延迟。':'系统通知已允许；锁屏可提醒，强行停止应用后需重新打开。'
          : status.platform==='windows'?'最小化时可提醒；退出应用后停止。请同时允许 Windows 系统通知。':'网页需保持打开；关闭页面或手机锁屏后不保证提醒。'
        : '请点击“允许系统通知”。关闭系统通知或勿扰模式可能阻止提醒。';
    } catch {$('reminder-status').textContent='提醒状态暂时不可用。';}
  }
  function sync(value){
    timer=value ? {...value} : null;
    const next=prefs.enabled && timer?.status==='running' && timer.endsAt>Date.now() ? {id:`timer-${timer.endsAt}`,endsAt:timer.endsAt,title:timer.kind==='focus'?'专注结束了':'休息结束了',sound:prefs.sound}:null;
    const signature=JSON.stringify(next);if(signature===last)return;last=signature;
    clearTimeout(browserAlarm);
    if(bridge){Promise.resolve(bridge.schedule(signature)).catch(()=>{last='';});return;}
    if(next && typeof Notification!=='undefined' && Notification.permission==='granted') browserAlarm=setTimeout(()=>{new Notification('下一小步',{body:next.title,silent:!next.sound,tag:next.id});},Math.max(0,next.endsAt-Date.now()));
  }
  function save(){const next={enabled:$('reminder-enabled').checked,sound:$('reminder-sound').checked};try{localStorage.setItem(key,JSON.stringify(next));prefs=next;last='';sync(window.StepApp?.getState().timer);refresh();}catch{$('reminder-status').textContent='设置未能保存。';load();}}
  $('reminder-enabled').onchange=save;$('reminder-sound').onchange=save;
  $('reminder-permission').onclick=async()=>{try{if(bridge)await bridge.requestPermission();else if(typeof Notification!=='undefined')await Notification.requestPermission();last='';sync(window.StepApp?.getState().timer);await refresh();}catch{await refresh();}};
  $('reminder-exact').onclick=()=>{bridge?.requestExactPermission();};
  function resume(){if(document.hidden)return;last='';sync(window.StepApp?.getState().timer);refresh();}
  addEventListener('nextstep-resume',resume);addEventListener('nextstep-reminder-permission',resume);document.addEventListener('visibilitychange',resume);
  addEventListener('nextstep-settings-restored',()=>{load();sync(window.StepApp?.getState().timer);refresh();});
  load();window.StepReminders=Object.freeze({sync});sync(window.StepApp?.getState().timer);refresh();
})();
