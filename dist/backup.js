(() => {
  'use strict';
  const keys = ['next-small-step.appearance.v1', 'next-small-step.updates.v1', 'next-small-step.reminders.v1'];
  const maxImage = 20 * 1024 * 1024;
  const types = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
  let busy = false;
  function preferences(raw, kind) {
    if (raw == null) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('备份设置格式不正确。');
    if (kind === 'updates') { if (typeof raw.automatic !== 'boolean') throw Error('更新设置格式不正确。'); return { automatic:raw.automatic }; }
    if (typeof raw.enabled !== 'boolean' || typeof raw.sound !== 'boolean') throw Error('提醒设置格式不正确。');
    return { enabled:raw.enabled, sound:raw.sound };
  }
  async function encode(blob, name='') {
    if(!blob.type){const ext=name.split('.').pop().toLowerCase();const mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'}[ext];if(!mime)throw Error('图片格式不可识别');blob=blob.slice(0,blob.size,mime);}
    return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
  }
  async function create(state) {
    const data = structuredClone(state), appearance = await StepAppearance.snapshot();
    const saved = key => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; };
    const image = appearance.image;
    return { format:'next-small-step.full-backup', version:1, createdAt:new Date().toISOString(), data,
      appearance:{ preferences:appearance.preferences, image:image ? { name:image.name, data:await encode(image.blob,image.name) } : null },
      updates:preferences(saved(keys[1]),'updates'), reminders:preferences(saved(keys[2]),'reminders') };
  }
  async function parse(value) {
    if (value?.format !== 'next-small-step.full-backup') return { data:StepCore.validate(value), legacy:true };
    if (value.version !== 1 || !value.appearance) throw Error('不支持这个完整备份版本。');
    const data = StepCore.validate(value.data);
    const prefs = StepAppearance.normalizePreferences(value.appearance.preferences);
    const input = value.appearance.image;
    let image = null;
    if (input !== null) {
      if (!input || typeof input.name !== 'string' || input.name.length > 512 || typeof input.data !== 'string'
        || input.data.length > Math.ceil(maxImage/3)*4+100) throw Error('备份中的背景图片无效或过大。');
      const match = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(input.data);
      if (!match || !types.has(match[1])) throw Error('不支持备份中的图片格式。');
      const bytes = Uint8Array.from(atob(match[2]), c=>c.charCodeAt(0));
      if (!bytes.length || bytes.length > maxImage) throw Error('背景图片大小无效。');
      const blob = new Blob([bytes], { type:match[1] }), url = URL.createObjectURL(blob);
      try { await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>img.naturalWidth?resolve():reject(Error());img.onerror=reject;img.src=url;}); }
      catch { throw Error('备份中的图片已损坏，当前数据未改变。'); }
      finally { URL.revokeObjectURL(url); }
      image = { name:input.name, blob };
    }
    return { data, legacy:false, appearance:{preferences:prefs,image}, updates:preferences(value.updates,'updates'), reminders:preferences(value.reminders,'reminders') };
  }
  async function restore(bundle) {
    if (busy) throw Error('正在恢复备份，请稍候。');
    const allKeys = [StepCore.key,...keys];
    const before = allKeys.map(key => localStorage.getItem(key));
    busy = true;
    const write = () => {
      try {
        localStorage.setItem(StepCore.key, JSON.stringify(bundle.data));
        if (!bundle.legacy) {
          const values = [bundle.appearance.preferences, bundle.updates, bundle.reminders];
          keys.forEach((key,i)=> values[i] == null ? localStorage.removeItem(key) : localStorage.setItem(key,JSON.stringify(values[i])));
        }
      } catch (error) {
        allKeys.forEach((key,i)=> before[i] == null ? localStorage.removeItem(key) : localStorage.setItem(key,before[i]));
        throw Error('存储空间不足或被禁用，无法恢复备份。');
      }
    };
    try { if (bundle.legacy) write(); else await StepAppearance.restore(bundle.appearance,write); }
    finally { busy = false; }
    window.dispatchEvent(new Event('nextstep-settings-restored'));
  }
  window.StepBackup = Object.freeze({ create, parse, restore });
})();
