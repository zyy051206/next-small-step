'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function fixture(){
  const notices=[];let callback=null,now=1000,opened=0;
  class Notification { static isSupported(){return true;} constructor(value){this.value=value;} on(name,handler){this.click=handler;} show(){notices.push(this);} }
  const context={module:{exports:{}},require:name=>{assert.equal(name,'electron');return {Notification};},Date:{now:()=>now},setTimeout:fn=>{callback=fn;return 1;},clearTimeout:()=>{callback=null;}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'reminders.cjs'),'utf8'),context);
  const service=context.module.exports.createReminders(()=>opened++);
  return {service,notices,fire:()=>{now=2000;callback?.();},get opened(){return opened;}};
}
const timer=JSON.stringify({id:'focus-2000',endsAt:2000,title:'专注结束了',sound:false});
test('native reminder fires once with selected sound and opens the app on click',()=>{
  const f=fixture();f.service.schedule(timer);assert.equal(f.notices.length,0);f.fire();assert.equal(f.notices.length,1);assert.equal(f.notices[0].value.silent,true);f.notices[0].click();assert.equal(f.opened,1);
  f.service.schedule(JSON.stringify({id:'focus-2000',endsAt:3000,title:'专注结束了',sound:false}));f.fire();assert.equal(f.notices.length,1);
});
test('pause, reset and application quit cancel a pending notification',()=>{
  for(const cancel of [f=>f.service.schedule('null'),f=>f.service.cancel()]){const f=fixture();f.service.schedule(timer);cancel(f);f.fire();assert.equal(f.notices.length,0);}
});
test('invalid requests do not replace an existing timer',()=>{
  const f=fixture();f.service.schedule(timer);assert.throws(()=>f.service.schedule(JSON.stringify({id:'bad',endsAt:86400000,title:'arbitrary',sound:true})));f.fire();assert.equal(f.notices.length,1);
});
