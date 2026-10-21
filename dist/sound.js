(() => {
  'use strict';
  // Generated locally with WebAudio so the app stays offline and ships no media files.
  const kinds = ['off', 'rain', 'breeze', 'white'];
  let context = null, master = null, session = null, current = 'off', volume = 0.35;
  const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return null;
    try {
      context = new Audio();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
      context.resume?.().catch(() => {});
      return context;
    } catch { context = null; return null; }
  }

  function noise(ctx, brown) {
    const length = Math.floor(ctx.sampleRate * 3), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.2; }
      else data[i] = white;
    }
    return buffer;
  }

  function teardown() {
    if (!session || !context) return;
    const old = session; session = null;
    const now = context.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setTargetAtTime(0.0001, now, 0.12);
    for (const node of old.nodes) { try { node.stop(now + 0.5); } catch {} }
  }

  function play(kind = 'rain', level) {
    if (!kinds.includes(kind)) kind = 'rain';
    if (kind === 'off') { stop(); return false; }
    const ctx = ensure();
    if (!ctx) return false;
    if (level !== undefined) volume = clamp(level);
    master.gain.setTargetAtTime(volume, ctx.currentTime, 0.18);
    teardown();
    const now = ctx.currentTime, nodes = [];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9, now + 0.9);
    gain.connect(master);

    const source = brown => {
      const node = ctx.createBufferSource();
      node.buffer = noise(ctx, brown); node.loop = true; node.start(now); nodes.push(node); return node;
    };
    const filter = (type, frequency, q = 0.6) => {
      const node = ctx.createBiquadFilter(); node.type = type; node.frequency.value = frequency; node.Q.value = q; return node;
    };
    const amount = value => { const node = ctx.createGain(); node.gain.value = value; return node; };
    const swell = (target, frequency, depth) => {
      const lfo = ctx.createOscillator(), level = ctx.createGain();
      lfo.frequency.value = frequency; level.gain.value = depth;
      lfo.connect(level); level.connect(target); lfo.start(now); nodes.push(lfo);
    };

    if (kind === 'rain') {
      const rain = amount(0.75);
      source(false).connect(filter('bandpass', 1150, 0.5)).connect(rain).connect(gain);
      source(true).connect(filter('lowpass', 330, 0.4)).connect(amount(0.6)).connect(gain);
      swell(rain.gain, 0.09, 0.18);
    } else if (kind === 'breeze') {
      const wind = amount(0.75);
      source(true).connect(filter('lowpass', 480, 0.35)).connect(wind).connect(gain);
      source(false).connect(filter('highpass', 1800, 0.4)).connect(amount(0.1)).connect(gain);
      swell(wind.gain, 0.07, 0.3);
    } else {
      source(false).connect(filter('highpass', 120, 0.5)).connect(filter('lowpass', 5200, 0.4)).connect(amount(0.42)).connect(gain);
    }

    session = { gain, nodes };
    current = kind;
    return true;
  }

  function stop() {
    current = 'off';
    teardown();
  }

  function setVolume(level) {
    volume = clamp(level);
    if (master && context) master.gain.setTargetAtTime(volume, context.currentTime, 0.15);
  }

  window.StepSound = Object.freeze({
    play, stop, setVolume,
    get current() { return current; },
    supported: () => !!(window.AudioContext || window.webkitAudioContext)
  });
})();