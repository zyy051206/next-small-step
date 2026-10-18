'use strict';
const { Notification } = require('electron');
function createReminders(showWindow) {
  let alarm=null, pending=null, fired='';
  const schedule = raw => {
    const value=JSON.parse(raw);
    if(value!==null && (!value || typeof value.id!=='string' || value.id.length>80 || !Number.isSafeInteger(value.endsAt)
      || value.endsAt>Date.now()+181*60000 || value.endsAt<Date.now()-60000 || !['专注结束了','休息结束了'].includes(value.title) || typeof value.sound!=='boolean')) throw Error('Invalid reminder');
    clearTimeout(alarm);pending=value;
    if(!value || value.id===fired || value.endsAt<=Date.now())return;
    alarm=setTimeout(()=>{
      fired=value.id;pending=null;
      if(!Notification.isSupported())return;
      const notification=new Notification({title:'下一小步',body:value.title,silent:!value.sound});
      notification.on('click',showWindow); notification.show();
    },Math.max(0,value.endsAt-Date.now()));
  };
  return { schedule, getStatus:()=>({platform:'windows',permission:Notification.isSupported()?'granted':'unsupported'}), cancel:()=>{clearTimeout(alarm);pending=null;} };
}
module.exports={createReminders};
