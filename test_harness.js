'use strict';
// Shared stub-browser harness for the game-loop and route checks.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const zlib = require('zlib');
const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');

function readPngAlpha(file) {
  return readPngAlphaBuffer(fs.readFileSync(file));
}

function readPngAlphaBuffer(b) {
  let pos = 8, W = 0, H = 0, depth = 0, color = 0, interlace = 0;
  const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString('ascii', pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  if (depth !== 8 || color !== 6 || interlace !== 0) throw new Error('unsupported PNG: ' + file);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = W * bpp;
  const alpha = new Uint8Array(W * H);
  const rgba = new Uint8Array(W * H * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < H; y++) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) row[x] = (row[x] + a) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((a + up) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
        row[x] = (row[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c)) & 255;
      }
    }
    for (let x = 0; x < W; x++) {
      alpha[y * W + x] = row[x * bpp + 3];
      rgba[(y * W + x) * 4] = row[x * bpp];
      rgba[(y * W + x) * 4 + 1] = row[x * bpp + 1];
      rgba[(y * W + x) * 4 + 2] = row[x * bpp + 2];
      rgba[(y * W + x) * 4 + 3] = row[x * bpp + 3];
    }
    prev = row;
  }
  return { w: W, h: H, alpha, rgba };
}

function alphaComponents(png, threshold) {
  const w = png.w, h = png.h, a = png.alpha;
  const seen = new Uint8Array(w * h);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || a[i] <= threshold) continue;
    stack.push(i); seen[i] = 1; let n = 0;
    while (stack.length) {
      const j = stack.pop(); n++;
      const y = Math.floor(j / w), x = j - y * w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (!seen[k] && a[k] > threshold) { seen[k] = 1; stack.push(k); }
        }
      }
    }
    sizes.push(n);
  }
  return sizes;
}

function memStorage() {
  const data = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[k] = String(v); },
    removeItem(k) { delete data[k]; }
  };
}

function stubTarget() {
  const map = {};
  return {
    addEventListener(type, fn) { (map[type] = map[type] || []).push(fn); },
    fire(type, e) { (map[type] || []).forEach((fn) => fn(e)); },
    setPointerCapture() {}
  };
}

function boot(opts) {
  opts = opts || {};
  const winListeners = {};
  const docListeners = {};
  let raf = null;

  const draws = [];
  const audio = { tones: 0, noises: 0 };
  const texts = [];
  // Any canvas call is a no-op; gradients need addColorStop.
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'drawImage') return (...args) => draws.push(args);
      if (k === 'fillText') return (...args) => texts.push(args[0]);
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });

  const canvas = Object.assign(stubTarget(), {
    getContext: () => ctx, style: {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
  });
  const menuButtons = {};
  ['newrun', 'continue'].forEach((id) => {
    menuButtons[id] = Object.assign(stubTarget(), { id: id, style: {}, textContent: '' });
  });
  const buttons = {};
  ['KeyZ', 'Space', 'Escape', 'ArrowDown'].forEach((code) => {
    const btn = Object.assign(stubTarget(), {
      getAttribute() { return code; },
      style: {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 112, height: 76 }; }
    });
    buttons[code] = btn;
  });
  function stubClassList() {
    const set = new Set();
    return {
      add(c) { set.add(c); }, remove(c) { set.delete(c); },
      contains(c) { return set.has(c); }
    };
  }
  const arrows = [{ classList: stubClassList() }, { classList: stubClassList() }];
  const dpad = Object.assign(stubTarget(), {
    getBoundingClientRect() { return { left: 0, top: 0, width: 112, height: 132 }; },
    querySelectorAll() { return arrows; }
  });
  const touchRoot = {
    addEventListener() {},
    querySelectorAll() { return Object.keys(buttons).map((k) => buttons[k]); }
  };

  const doc = {
    getElementById: (id) => (id === 'game' ? canvas : id === 'touch' ? touchRoot
      : id === 'dpad' ? dpad : id === 'slide' ? buttons.ArrowDown
      : menuButtons[id] || null),
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    documentElement: { classList: { add() {} } },
    body: { clientWidth: 1920, clientHeight: 1080 },
    hidden: false
  };

  const win = {
    location: { search: '?debug' + (opts.touch ? '&touch' : '') },
    matchMedia: (q) => ({ matches: !!opts.touch && /pointer: coarse/.test(q) }),
    addEventListener(type, fn) { (winListeners[type] = winListeners[type] || []).push(fn); },
    innerWidth: 1920, innerHeight: 1080
  };
  if (opts.storage !== 'blocked') win.localStorage = opts.storage || memStorage();
  win.window = win;

  const sandbox = {
    window: win,
    document: doc,
    Image: function () { this.complete = true; this.naturalWidth = 70; this.naturalHeight = 70; },
    requestAnimationFrame: (cb) => { raf = cb; },
    setTimeout: () => 0,
    Math, Date, JSON, Object, Array, Map, Set, console
  };
  if (!opts.noAudio) {
    win.AudioContext = function () {
      return {
        currentTime: 0, state: 'running', sampleRate: 44100, destination: {},
        resume() { this.state = 'running'; },
        createOscillator() {
          audio.tones++;
          return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
        },
        createGain() {
          return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
        },
        createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; },
        createBufferSource() {
          audio.noises++;
          return { buffer: null, connect() {}, start() {}, stop() {} };
        }
      };
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  let now = 1000;
  const env = {
    ib: win.iceBreakers,
    draws,
    texts,
    audio,
    menu(id) { return menuButtons[id]; },
    tapMenu(id) { menuButtons[id].fire('pointerdown', { preventDefault() {} }); },
    get g() { return win.iceBreakers.game; },
    key(type, code, repeat) {
      (winListeners[type] || []).forEach((fn) => fn({ code, repeat: !!repeat, preventDefault() {} }));
    },
    now() { return now; },
    frames(n) { for (let i = 0; i < (n || 1); i++) { now += 1000 / 60; raf(now); } },
    frameAt(at) { now = at; raf(now); },
    // Evenly spaced display callbacks over `ms` of wall time.
    advance(ms, hz) {
      const start = now, n = Math.round(ms / 1000 * hz);
      for (let i = 1; i <= n; i++) { now = start + Math.round(i * ms / n); raf(now); }
    },
    tap(code) {
      const btn = buttons[code];
      btn.fire('pointerdown', { preventDefault() {}, pointerId: 1 });
      btn.fire('pointerup', { preventDefault() {}, pointerId: 1 });
    },
    tapCanvas() { canvas.fire('pointerdown', { preventDefault() {}, pointerId: 1 }); },
    tapCanvasAt(x, y) { canvas.fire('pointerdown', { preventDefault() {}, pointerId: 1, clientX: x, clientY: y }); },
    tapDpad(left) {
      dpad.fire('pointerdown', { preventDefault() {}, pointerId: 1, clientX: left ? 10 : 100, clientY: left ? 10 : 120 });
    },
    dpadDown(id, x, y) { dpad.fire('pointerdown', { preventDefault() {}, pointerId: id, clientX: x, clientY: y }); },
    dpadMove(id, x, y) { dpad.fire('pointermove', { preventDefault() {}, pointerId: id, clientX: x, clientY: y }); },
    dpadUp(id) { dpad.fire('pointerup', { preventDefault() {}, pointerId: id }); },
    dpadCancel(id) { dpad.fire('pointercancel', { preventDefault() {}, pointerId: id }); },
    highlight() { return [arrows[0].classList.contains('on'), arrows[1].classList.contains('on')]; },
    slideDisplay() { return buttons.ArrowDown.style.display; },
    releaseDpad() { dpad.fire('pointerup', { preventDefault() {}, pointerId: 1 }); },
    visibility(hidden) {
      doc.hidden = hidden;
      (docListeners.visibilitychange || []).forEach((fn) => fn());
    },
    blur() { (winListeners.blur || []).forEach((fn) => fn()); }
  };
  env.frames(2);
  return env;
}


module.exports = { boot, memStorage, readPngAlpha, readPngAlphaBuffer, alphaComponents };
