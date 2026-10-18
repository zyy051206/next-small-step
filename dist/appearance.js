(() => {
  'use strict';

  const PREFS_KEY = 'next-small-step.appearance.v1';
  const DB_NAME = 'next-small-step.appearance';
  const DEFAULT_COLOR = '#315b46';
  const DEFAULT_SHADE = 72;
  const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  const root = document.documentElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'appearance-dialog';
  dialog.setAttribute('aria-labelledby', 'appearance-title');
  dialog.innerHTML = `
    <div class="dialog-heading"><span class="eyebrow">MAKE IT YOURS</span><button type="button" class="close-button" aria-label="关闭外观设置">×</button></div>
    <h2 id="appearance-title">给日常一点自己的颜色</h2>
    <section class="appearance-section">
      <h3>显示</h3><label for="appearance-theme">主题</label><select id="appearance-theme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select>
      <div class="appearance-range-label"><label for="appearance-font">字号</label><output id="appearance-font-value">100%</output></div><input id="appearance-font" type="range" min="90" max="130" step="10" value="100">
    </section>
    <section class="appearance-section" aria-labelledby="appearance-background-title">
      <div class="appearance-section-heading"><h3 id="appearance-background-title">背景图片</h3><p>选一张喜欢的图片，留在每次开始的地方。</p></div>
      <div class="appearance-preview"><img id="appearance-bg-preview" alt="当前背景预览" hidden><span class="appearance-empty-preview">现在使用默认背景</span></div>
      <p id="appearance-bg-name">默认背景</p>
      <div class="appearance-file-actions"><button type="button" id="appearance-bg-choose" class="button secondary">选择图片</button><button type="button" id="appearance-bg-remove" class="text-button" disabled>恢复默认背景</button></div>
      <input type="file" id="appearance-bg-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden>
      <p class="appearance-note">支持 JPG、PNG、WebP、GIF 和 AVIF，单张不超过 20 MB。</p>
      <div class="appearance-range-label"><label for="appearance-shade">壁纸遮罩</label><output id="appearance-shade-value" for="appearance-shade">72%</output></div>
      <input type="range" id="appearance-shade" min="0" max="100" value="72" step="1">
      <p class="appearance-note">数值越高，遮罩越浓。卡片保留不透明底色，确保文字清晰。</p>
    </section>
    <section class="appearance-section" aria-labelledby="appearance-color-title">
      <div class="appearance-section-heading"><h3 id="appearance-color-title">图标与 Logo 颜色</h3><p>选一个常用色，也可以自由调色。</p></div>
      <div class="appearance-color-row"><label for="appearance-icon-color">自选颜色</label><input type="color" id="appearance-icon-color" value="#315b46"><output id="appearance-color-value" for="appearance-icon-color">#315b46</output></div>
      <div class="appearance-swatches" role="group" aria-label="常用图标颜色"></div>
      <button type="button" id="appearance-color-reset" class="text-button">恢复默认颜色</button>
    </section>
    <p id="appearance-status" role="status" aria-live="polite"></p>
    <p class="appearance-note appearance-storage-note">外观保存在这台设备；完整备份包含背景图片和全部外观设置。</p>`;
  document.body.append(dialog);

  const $ = id => document.getElementById(id);
  const fileInput = $('appearance-bg-file');
  const preview = $('appearance-bg-preview');
  const removeButton = $('appearance-bg-remove');
  let prefs = { iconColor: DEFAULT_COLOR, shade: DEFAULT_SHADE, theme: 'system', fontScale: 100 };
  const systemTheme = matchMedia('(prefers-color-scheme: dark)');
  let preferenceReadError = false;
  let databasePromise;
  let backgroundURL = null;
  let backgroundQueue = Promise.resolve();
  let pendingBackgroundOperations = 0;

  function status(message, tone = 'success') {
    $('appearance-status').textContent = message;
    $('appearance-status').dataset.tone = tone;
  }

  const presets = [
    ['#315b46', '森林绿'], ['#3565a0', '晴空蓝'], ['#7054a4', '鸢尾紫'],
    ['#ab4f6d', '玫瑰粉'], ['#b66c32', '暖橙色'], ['#3a454b', '石墨灰']
  ];
  presets.forEach(([color, name]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'appearance-swatch';
    button.dataset.iconColor = color;
    button.setAttribute('aria-label', name);
    button.style.setProperty('--swatch-color', color);
    button.addEventListener('click', () => updatePreferences({ iconColor: color }));
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    button.append(dot);
    dialog.querySelector('.appearance-swatches').append(button);
  });

  function normalizePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !/^#[0-9a-f]{6}$/i.test(value.iconColor)
      || !Number.isInteger(value.shade) || value.shade < 0 || value.shade > 100
      || !['system', 'light', 'dark'].includes(value.theme ?? 'system')
      || ![90,100,110,120,130].includes(value.fontScale ?? 100)) throw Error('外观设置格式不正确。');
    return { iconColor: value.iconColor.toLowerCase(), shade: value.shade, theme: value.theme ?? 'system', fontScale: value.fontScale ?? 100 };
  }
  function applyPreferences() {
    const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && systemTheme.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.setProperty('--font-scale', String(prefs.fontScale / 100));
    root.style.colorScheme = dark ? 'dark' : 'light';
    $('appearance-theme').value = prefs.theme;
    $('appearance-font').value = prefs.fontScale;
    $('appearance-font-value').textContent = prefs.fontScale + '%';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#17211c' : '#f5f7f4';
    const channels = prefs.iconColor.slice(1).match(/../g).map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    root.style.setProperty('--icon-color', prefs.iconColor);
    root.style.setProperty('--icon-foreground', luminance > 0.179 ? '#000000' : '#ffffff');
    root.style.setProperty('--icon-surface', luminance > 0.3 ? '#34423a' : dark && luminance < 0.12 ? '#c8dccd' : 'transparent');
    root.style.setProperty('--background-shade', (prefs.shade / 100).toFixed(2));
    $('appearance-icon-color').value = prefs.iconColor;
    $('appearance-color-value').textContent = prefs.iconColor;
    $('appearance-shade').value = String(prefs.shade);
    $('appearance-shade-value').textContent = `${prefs.shade}%`;
    dialog.querySelectorAll('[data-icon-color]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.iconColor === prefs.iconColor));
    });
  }

  try {
    const saved = localStorage.getItem(PREFS_KEY);
    if (saved) {
      const value = JSON.parse(saved);
      prefs = normalizePreferences(value);
    }
  } catch {
    preferenceReadError = true;
  }
  applyPreferences();

  function updatePreferences(change) {
    let next;
    try { next = normalizePreferences({ ...prefs, ...change }); } catch { return; }
    next.iconColor = next.iconColor.toLowerCase();
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      prefs = next;
      preferenceReadError = false;
      applyPreferences();
      status('外观设置已保存。');
    } catch {
      applyPreferences();
      status('无法保存外观设置，原设置已保留。请检查浏览器是否允许本地存储。', 'error');
    }
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images');
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) { database.close(); return; }
        settled = true;
        database.onversionchange = () => { database.close(); databasePromise = undefined; };
        resolve(database);
      };
      request.onerror = request.onblocked = () => {
        if (!settled) { settled = true; reject((request.readyState === 'done' && request.error) || new Error('Image storage unavailable')); }
      };
    });
    databasePromise.catch(() => { databasePromise = undefined; });
    return databasePromise;
  }

  async function imageTransaction(mode, action) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      let result;
      const transaction = database.transaction('images', mode);
      const request = action(transaction.objectStore('images'));
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(transaction.error || (request.readyState === 'done' && request.error) || new Error('Image storage failed'));
    });
  }

  // Serialize restore, replace, and remove so a slower upload cannot reappear after removal.
  function enqueueBackground(action) {
    pendingBackgroundOperations++;
    removeButton.disabled = false;
    const operation = backgroundQueue.then(action, action);
    backgroundQueue = operation.catch(() => {});
    return operation.finally(() => {
      pendingBackgroundOperations--;
      removeButton.disabled = !backgroundURL && pendingBackgroundOperations === 0;
    });
  }

  async function decodedURL(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = () => image.naturalWidth && image.naturalHeight ? resolve() : reject(new Error('Empty image'));
        image.onerror = () => reject(new Error('Invalid image'));
        image.src = url;
      });
      return url;
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function applyBackground(url, name = null) {
    const previous = backgroundURL;
    backgroundURL = url;
    document.body.classList.toggle('has-custom-background', Boolean(url));
    if (url) {
      root.style.setProperty('--user-background', `url("${url}")`);
      preview.src = url;
    } else {
      root.style.removeProperty('--user-background');
      preview.removeAttribute('src');
    }
    preview.hidden = !url;
    dialog.querySelector('.appearance-empty-preview').hidden = Boolean(url);
    $('appearance-bg-name').textContent = name || '默认背景';
    removeButton.disabled = !url && pendingBackgroundOperations === 0;
    if (previous && previous !== url) URL.revokeObjectURL(previous);
  }

  const ready = enqueueBackground(async () => {
    try {
      const saved = await imageTransaction('readonly', store => store.get('background'));
      if (saved) {
        if (!(saved.blob instanceof Blob) || typeof saved.name !== 'string') throw new Error('Invalid stored image');
        const url = await decodedURL(saved.blob);
        applyBackground(url, saved.name);
      }
      if (preferenceReadError) status('外观设置无法读取，原数据已保留；当前使用默认颜色和遮罩。', 'error');
    } catch {
      status('已保存的背景暂时无法读取，原记录已保留。请检查浏览器是否允许本地存储。', 'error');
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    enqueueBackground(async () => {
      if (file.size > MAX_IMAGE_BYTES) { status('图片超过 20 MB，请选择更小的图片。原背景已保留。', 'error'); return; }
      if ((!IMAGE_TYPES.has(file.type) && (file.type || !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))) || !file.size) {
        status('请选择有效的 JPG、PNG、WebP、GIF 或 AVIF 图片。原背景已保留。', 'error'); return;
      }
      status('正在读取并保存图片…', 'pending');
      let url;
      try { url = await decodedURL(file); }
      catch { status('图片无法打开，请换一张完整的图片。原背景已保留。', 'error'); return; }
      try {
        await imageTransaction('readwrite', store => store.put({ blob: file, name: file.name }, 'background'));
        applyBackground(url, file.name);
        status('背景已保存，只会保留在这台设备上。');
      } catch {
        URL.revokeObjectURL(url);
        status('背景保存失败，可能是存储空间不足或被禁用。原背景已保留。', 'error');
      }
    });
  });

  removeButton.addEventListener('click', () => {
    enqueueBackground(async () => {
      status('正在恢复默认背景…', 'pending');
      try {
        await imageTransaction('readwrite', store => store.delete('background'));
        applyBackground(null);
        status('已恢复默认背景。');
      } catch {
        status('无法移除已保存的背景，原背景已保留。请检查浏览器是否允许本地存储。', 'error');
      }
    });
  });

  $('appearance-bg-choose').addEventListener('click', () => fileInput.click());
  $('appearance-icon-color').addEventListener('input', event => updatePreferences({ iconColor: event.target.value }));
  $('appearance-shade').addEventListener('input', event => updatePreferences({ shade: Number(event.target.value) }));
  $('appearance-color-reset').addEventListener('click', () => updatePreferences({ iconColor: DEFAULT_COLOR }));
  dialog.querySelector('.close-button').addEventListener('click', () => dialog.close());
  $('appearance-open').addEventListener('click', () => dialog.showModal());
  systemTheme.addEventListener('change', applyPreferences);
  $('appearance-theme').addEventListener('change', e => updatePreferences({ theme: e.target.value }));
  $('appearance-font').addEventListener('input', e => updatePreferences({ fontScale: Number(e.target.value) }));
  async function snapshot() {
    await ready; await backgroundQueue;
    const image = await imageTransaction('readonly', store => store.get('background'));
    return { preferences: { ...prefs }, image: image || null };
  }
  async function restore(value, commit) {
    const preferences = normalizePreferences(value.preferences);
    return enqueueBackground(async () => {
      const old = { preferences: { ...prefs }, image: await imageTransaction('readonly', store => store.get('background')) };
      let url = value.image ? await decodedURL(value.image.blob) : null;
      try {
        await imageTransaction('readwrite', store => value.image ? store.put(value.image, 'background') : store.delete('background'));
        commit();
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        await imageTransaction('readwrite', store => old.image ? store.put(old.image, 'background') : store.delete('background'));
        throw error;
      }
      prefs = preferences; applyPreferences(); applyBackground(url, value.image?.name);
    });
  }
  window.StepAppearance = Object.freeze({ ready, snapshot, restore, normalizePreferences });
})();
