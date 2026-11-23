/* Ice Breakers Classic Remake - vanilla JS canvas port of the Pygame prototype.
 * Logical resolution 1920x1080. No dependencies, no build step.
 */
(function (root) {
  'use strict';

  var W = 1920;
  var H = 1080;
  var BLOCK = 64;
  var FPS = 60;
  var DT = 1 / FPS;

  // Reference constants: 20 m screen height, gravity 60 m/s^2, 8 m/s run,
  // 12 m jump. Scaled to logical pixels with 54 px/m.
  var PPM = 54;
  var GRAVITY = 60 * PPM;
  var JUMP_HEIGHT = 12 * PPM;
  var JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
  var MOVE_SPEED = 8 * PPM;
  var JUMP_BUFFER = 0.12;
  var COYOTE_BASE = 0.09;
  var CLEATS_GRACE = 0.2;
  var KICK_BONUS = 18;
  var INTRO_TIME = 3.3;
  // Gem PNG is 70x70 with a 34x24 visible area starting at (18, 23).
  var GEM_SRC = { x: 18, y: 23, w: 34, h: 24 };
  var GEM_DRAW = { w: 44, h: 31 };
  var SLIDE_TIME = 0.4;
  var SLIDE_CD = 0.9;
  var SLIDE_START = 0.08;
  var SLIDE_ENABLED = true;
  // Glide art draws ~105 px wide at 0.32; the 44 px hitbox stays narrow to favour the player.
  var SLIDE_H = 29;
  var SLIDE_DRAW_SCALE = 0.32;

  var FLOOR_Y = [1016, 824, 632, 440, 248];
  var COLS = 30;
  var ROWS = 5;
  var GAP_W = 2;

    function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* Time-of-impact sweep of a moving AABB against a static AABB.
   * Returns t in [0,1], or null. Handles zero velocity per axis and touching
   * edges without reporting a false hit. */
  function sweptAABB(ax, ay, aw, ah, dx, dy, bx, by, bw, bh) {
    if (dx === 0 && dy === 0) return null;
    if (dx === 0 && !(ax < bx + bw && ax + aw > bx)) return null;
    if (dy === 0 && !(ay < by + bh && ay + ah > by)) return null;

    var xEntry, xExit, yEntry, yExit;
    if (dx === 0) {
      xEntry = -Infinity; xExit = Infinity;
    } else if (dx > 0) {
      xEntry = (bx - (ax + aw)) / dx;
      xExit = ((bx + bw) - ax) / dx;
    } else {
      xEntry = ((bx + bw) - ax) / dx;
      xExit = (bx - (ax + aw)) / dx;
    }
    if (dy === 0) {
      yEntry = -Infinity; yExit = Infinity;
    } else if (dy > 0) {
      yEntry = (by - (ay + ah)) / dy;
      yExit = ((by + bh) - ay) / dy;
    } else {
      yEntry = ((by + bh) - ay) / dy;
      yExit = (by - (ay + ah)) / dy;
    }

    var entry = Math.max(xEntry, yEntry);
    var exit = Math.min(xExit, yExit);
    if (entry > exit || entry < 0 || entry > 1) return null;
    return entry;
  }

  function computeJumpVelocity(height, gravity) {
    return Math.sqrt(2 * (gravity === undefined ? GRAVITY : gravity) * height);
  }

  /* Axis-separated swept movement. Mutates e.x/e.y/e.vy and reports contact. */
  function resolveMove(e, dx, dy, solids) {
    var grounded = false;
    var hitWall = false;
    var i, s, t, bestT, best;

    if (dx !== 0) {
      bestT = 1; best = null;
      for (i = 0; i < solids.length; i++) {
        s = solids[i];
        t = sweptAABB(e.x, e.y, e.w, e.h, dx, 0, s.x, s.y, s.w, s.h);
        if (t !== null && t < bestT) { bestT = t; best = s; }
      }
      if (best) {
        e.x = dx > 0 ? best.x - e.w - 0.01 : best.x + best.w + 0.01;
        hitWall = true;
      } else {
        e.x += dx;
      }
    }

    if (dy !== 0) {
      bestT = 1; best = null;
      for (i = 0; i < solids.length; i++) {
        s = solids[i];
        t = sweptAABB(e.x, e.y, e.w, e.h, 0, dy, s.x, s.y, s.w, s.h);
        if (t !== null && t < bestT) { bestT = t; best = s; }
      }
      if (best) {
        if (dy > 0) { e.y = best.y - e.h; grounded = true; }
        else { e.y = best.y + best.h; }
        e.vy = 0;
      } else {
        e.y += dy;
      }
    }
    return { grounded: grounded, hitWall: hitWall };
  }

  var API = {
    W: W, H: H, BLOCK: BLOCK, FPS: FPS, DT: DT,
    GRAVITY: GRAVITY, JUMP_HEIGHT: JUMP_HEIGHT, JUMP_VELOCITY: JUMP_VELOCITY,
    MOVE_SPEED: MOVE_SPEED, FLOOR_Y: FLOOR_Y,
    rectsOverlap: rectsOverlap, sweptAABB: sweptAABB,
    computeJumpVelocity: computeJumpVelocity, resolveMove: resolveMove
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
    return;
  }

  // Every sprite path used by the game lives here. Swap a path or add an
  // override key to restyle without touching drawing code.
  // Placeholders below have no PNG yet; the fallback colour is drawn instead.
  // All art faces RIGHT natively and is mirrored when facing left.
  //   slide        96x48   bottom-centre anchor
  //   gear_cleats  64x64   centred icon
  //   gear_boots   64x64   centred icon
  //   guardian_<form>_<pose>  244/232/216 tall, bottom-centre foot anchor;
  //     form = intact|fractured|core, pose = idle|warn|impact|stuck
  var MANIFEST = {
    idle: 'assets/sprites/karate_idle.png',
    walk1: 'assets/sprites/karate_walk1.png',
    walk2: 'assets/sprites/karate_walk2.png',
    jump: 'assets/sprites/karate_jump.png',
    punch: 'assets/sprites/karate_punch.png',
    kick: 'assets/sprites/karate_kick.png',
    karate_slide_start: 'assets/sprites/karate_slide_start.png',
    karate_slide: 'assets/sprites/karate_slide.png',
    karate_slide_recover: 'assets/sprites/karate_slide_recover.png',
    mil1: 'assets/sprites/mil_walk1.png',
    mil2: 'assets/sprites/mil_walk2.png',
    milp: 'assets/sprites/mil_point.png',
    ex1: 'assets/sprites/ex_walk1.png',
    ex2: 'assets/sprites/ex_walk2.png',
    exp: 'assets/sprites/ex_point.png',
    sign: 'assets/sprites/sign_clean.png',
    clip: 'assets/sprites/clip_clean.png',
    ice: 'assets/sprites/ice.png',
    topi: 'assets/sprites/seal.png',
    nitpicker: 'assets/sprites/bird.png',
    bear: 'assets/sprites/bear.png',
    veggie: 'assets/sprites/carrot.png',
    veggie1: 'assets/sprites/eggplant.png',
    veggie2: 'assets/sprites/corn.png',
    guardian_intact_idle: 'assets/sprites/guardian_intact_idle.png',
    guardian_intact_warn: 'assets/sprites/guardian_intact_warn.png',
    guardian_intact_impact: 'assets/sprites/guardian_intact_impact.png',
    guardian_intact_stuck: 'assets/sprites/guardian_intact_stuck.png',
    guardian_fractured_idle: 'assets/sprites/guardian_fractured_idle.png',
    guardian_fractured_warn: 'assets/sprites/guardian_fractured_warn.png',
    guardian_fractured_impact: 'assets/sprites/guardian_fractured_impact.png',
    guardian_fractured_stuck: 'assets/sprites/guardian_fractured_stuck.png',
    guardian_core_idle: 'assets/sprites/guardian_core_idle.png',
    guardian_core_warn: 'assets/sprites/guardian_core_warn.png',
    guardian_core_impact: 'assets/sprites/guardian_core_impact.png',
    guardian_core_stuck: 'assets/sprites/guardian_core_stuck.png',
    gem: 'assets/gem.png',
    heart: 'assets/heart.png',
    gear_cleats: 'assets/sprites/gear_cleats.png',
    gear_boots: 'assets/sprites/gear_boots.png'
  };

  var FALLBACK = {
    idle: '#ffcf5c', ice: '#bfe6ff',
    topi: '#8bd17c', nitpicker: '#d98cff', bear: '#f2f2f2',
    walk1: '#ffcf5c', walk2: '#ffcf5c', jump: '#ffcf5c', punch: '#ffcf5c', kick: '#ffcf5c',
    karate_slide_start: '#ffcf5c', karate_slide: '#ffcf5c', karate_slide_recover: '#ffcf5c',
    mil1: '#c9a0dc', mil2: '#c9a0dc', milp: '#c9a0dc',
    ex1: '#7f8fb5', ex2: '#7f8fb5', exp: '#7f8fb5',
    sign: '#ff4d4d', clip: '#c8a26a', veggie1: '#8e5bd0', veggie2: '#ffd84d',
    veggie: '#ff6b6b', gem: '#58e0c0', heart: '#ff5470',
    gear_cleats: '#7fe3ff', gear_boots: '#ffb84d',
    guardian_intact_idle: '#8fc7ee', guardian_intact_warn: '#8fc7ee',
    guardian_intact_impact: '#8fc7ee', guardian_intact_stuck: '#8fc7ee',
    guardian_fractured_idle: '#a9d8f5', guardian_fractured_warn: '#a9d8f5',
    guardian_fractured_impact: '#a9d8f5', guardian_fractured_stuck: '#a9d8f5',
    guardian_core_idle: '#e9fbff', guardian_core_warn: '#e9fbff',
    guardian_core_impact: '#e9fbff', guardian_core_stuck: '#e9fbff'
  };

  var VEGGIES = ['veggie', 'veggie1', 'veggie2'];

  var GEAR = {
    cleats: { name: 'ICE CLEATS', key: 'gear_cleats', effect: 'Longer jump grace after a ledge' },
    boots: { name: 'KICK BOOTS', key: 'gear_boots', effect: 'Kick 18 px further' }
  };
  var GEAR_ORDER = ['cleats', 'boots'];

  var BOSS_SCALE = 0.77;
  var BOSS_FORMS = [
    { form: 'intact', baseH: 200, aspect: 192 / 193 },
    { form: 'fractured', baseH: 160, aspect: 183 / 195 },
    { form: 'core', baseH: 140, aspect: 145 / 159 }
  ].map(function (f) {
    var h = Math.round(f.baseH * BOSS_SCALE);
    return { form: f.form, h: h, w: Math.round(h * f.aspect) };
  });

  var STORAGE_KEY = 'icebreakers.best.v1';

  // Bests are a convenience only: blocked, broken or hostile storage must never stop play.
  function loadBest() {
    var out = { score: 0, mountains: {} };
    try {
      var raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      if (!raw) return out;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return out;
      if (typeof data.score === 'number' && isFinite(data.score) && data.score > 0) {
        out.score = Math.floor(data.score);
      }
      if (data.mountains && typeof data.mountains === 'object') {
        for (var k in data.mountains) {
          var t = data.mountains[k];
          if (/^[0-4]$/.test(k) && typeof t === 'number' && isFinite(t) && t > 0) out.mountains[k] = t;
        }
      }
    } catch (e) {}
    return out;
  }

  function saveBest() {
    try {
      if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(best));
    } catch (e) {}
  }

  var best = loadBest();

  var CHECKPOINT_KEY = 'icebreakers.checkpoint.v1';

  function loadCheckpoint() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(CHECKPOINT_KEY);
      if (!raw) return null;
      var cp = JSON.parse(raw);
      if (!cp || cp.v !== 1) return null;
      if (!Number.isInteger(cp.levelIndex) || cp.levelIndex < 0 || cp.levelIndex >= 5) return null;
      if (!Number.isInteger(cp.lives) || cp.lives < 1 || cp.lives > 3) return null;
      if (typeof cp.score !== 'number' || !isFinite(cp.score) || cp.score < 0) return null;
      if (cp.gear !== null && !GEAR.hasOwnProperty(cp.gear)) return null;
      return { v: 1, levelIndex: cp.levelIndex, score: Math.floor(cp.score), lives: cp.lives, gear: cp.gear };
    } catch (e) { return null; }
  }

  var checkpoint = loadCheckpoint();

  function saveCheckpoint(cp) {
    checkpoint = cp;
    try {
      if (root.localStorage) root.localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
    } catch (e) {}
  }

  function clearCheckpoint() {
    checkpoint = null;
    try {
      if (root.localStorage) root.localStorage.removeItem(CHECKPOINT_KEY);
    } catch (e) {}
  }

  var images = {};
  var assetsReady = 0;
  var assetsTotal = 0;

  function loadAssets() {
    Object.keys(MANIFEST).forEach(function (name) {
      var img = new Image();
      assetsTotal++;
      img.onload = function () { assetsReady++; };
      img.onerror = function () { images[name] = null; assetsReady++; };
      img.src = MANIFEST[name];
      images[name] = img;
    });
  }

  function spriteReady(name) {
    var img = images[name];
    return !!img && img.complete && img.naturalWidth > 0;
  }

    var LEVELS = [
    {
      name: 'Glacier Gate',
      gaps: [[9, 20], [5, 15, 25], [11, 21], [7, 17]],
      movers: [], topis: 1, nits: 0, bear: 0,
      itemCols: [6, 23]
    },
    {
      name: 'Frostbite Fields',
      gaps: [[7, 17, 26], [11, 21], [4, 14, 24], [9, 19]],
      movers: [{ floor: 1, col: 10, speed: 62, dir: 1 }],
      topis: 2, nits: 1, bear: 0,
      itemCols: [3, 26]
    },
    {
      name: 'Slippery Steps',
      gaps: [[5, 15, 25], [8, 18, 27], [3, 12, 22], [6, 16, 26]],
      movers: [
        { floor: 1, col: 8, speed: 70, dir: -1 },
        { floor: 2, col: 11, speed: 58, dir: 1 }
      ],
      topis: 2, nits: 2, bear: 30,
      itemCols: [2, 27]
    },
    {
      name: 'Avalanche Ridge',
      gaps: [[4, 13, 24], [7, 17, 27], [5, 15, 25], [9, 19]],
      movers: [
        { floor: 2, col: 9, speed: 76, dir: 1 },
        { floor: 3, col: 19, speed: 64, dir: -1 }
      ],
      topis: 3, nits: 3, bear: 24,
      itemCols: [2, 25]
    },
    {
      name: 'Summit Storm',
      gaps: [[6, 16, 26], [4, 14, 24], [8, 18, 27], [5, 15, 25]],
      movers: [
        { floor: 1, col: 10, speed: 84, dir: 1 },
        { floor: 3, col: 19, speed: 72, dir: -1 }
      ],
      topis: 3, nits: 4, bear: 18,
      itemCols: [2, 26]
    }
  ];

  function key(col, y) { return col + ':' + y; }

  // Kicked blocks stay in the map with alive=false, so check both.
  function solidAt(level, col, y) {
    var b = level.blocks.get(key(col, y));
    return !!b && b.alive;
  }

  function buildLevel(index) {
    var cfg = LEVELS[index];
    var blocks = new Map();
    var movers = [];
    var topis = [];
    var nits = [];
    var items = [];
    var f, c, g, spec, i;
    var startX = W / 2 - 22;
    var claimed = [{ x: startX - 140, y: FLOOR_Y[0] - 90, w: 320, h: 90 }];

    function addBlock(col, y) {
      if (col < 0 || col >= COLS) return;
      blocks.set(key(col, y), {
        x: col * BLOCK, y: y, w: BLOCK, h: BLOCK, alive: true
      });
    }

    for (c = 0; c < COLS; c++) addBlock(c, FLOOR_Y[0]);

    for (f = 1; f < ROWS; f++) {
      var starts = cfg.gaps[f - 1];
      for (c = 0; c < COLS; c++) {
        var inGap = false;
        for (g = 0; g < starts.length; g++) {
          if (c >= starts[g] && c < starts[g] + GAP_W) { inGap = true; break; }
        }
        if (!inGap) addBlock(c, FLOOR_Y[f]);
      }
    }

    // Protected summit arena covers the full slam zone (373 px) and the goal.
    var crownStart = index === LEVELS.length - 1 ? 11 : 13;
    var crownEnd = index === LEVELS.length - 1 ? 19 : 16;
    for (c = crownStart; c <= crownEnd; c++) {
      addBlock(c, FLOOR_Y[4]);
      blocks.get(key(c, FLOOR_Y[4])).fixed = true;
    }

    for (i = 0; i < cfg.movers.length; i++) {
      spec = cfg.movers[i];
      var my = FLOOR_Y[spec.floor];
      for (c = spec.col; c < spec.col + 6; c++) blocks.delete(key(c, my));
      movers.push({
        x: (spec.col + 1) * BLOCK, y: my,
        w: 4 * BLOCK, h: BLOCK,
        minX: spec.col * BLOCK, maxX: (spec.col + 2) * BLOCK,
        vx: spec.speed * spec.dir, speed: spec.speed
      });
    }

    function floorIsSolid(floorIdx, x, w) {
      var fy = FLOOR_Y[floorIdx];
      var first = Math.floor(x / BLOCK), last = Math.floor((x + w - 1) / BLOCK);
      for (var cc = first; cc <= last; cc++) {
        if (cc < 0 || cc >= COLS || !blocks.has(key(cc, fy))) return false;
      }
      return true;
    }

    function isClaimed(x, y, w, h) {
      for (var ci = 0; ci < claimed.length; ci++) {
        if (rectsOverlap({ x: x, y: y, w: w, h: h }, claimed[ci])) return true;
      }
      return false;
    }

    // Distinct authored slots per floor, scanning outward; movers delete their blocks
    // first, so a slot is only accepted over intact ice.
    function placePatrol(floorIdx, prefCol, w, h) {
      var fy = FLOOR_Y[floorIdx];
      function tryCol(col) {
        var x = col * BLOCK + 6;
        if (col < 1 || col > COLS - 2 || !floorIsSolid(floorIdx, x, w) || isClaimed(x, fy - h, w, h)) return null;
        claimed.push({ x: x, y: fy - h, w: w, h: h });
        return x;
      }
      var r, found;
      for (r = 0; r < COLS; r++) {
        found = tryCol(prefCol + r);
        if (found !== null) return found;
        if (r > 0) {
          found = tryCol(prefCol - r);
          if (found !== null) return found;
        }
      }
      for (var cc = 1; cc < COLS - 1; cc++) {
        found = tryCol(cc);
        if (found !== null) return found;
      }
      claimed.push({ x: 2 * BLOCK + 6, y: fy - h, w: w, h: h });
      return 2 * BLOCK + 6;
    }

    var TOPI_SLOTS = [4, 25, 10, 20];
    for (i = 0; i < cfg.topis; i++) {
      var tf = i % 4;
      var tx = placePatrol(tf, TOPI_SLOTS[i % TOPI_SLOTS.length], 52, 40);
      topis.push({
        x: tx, y: FLOOR_Y[tf] - 40, w: 52, h: 40,
        floorY: FLOOR_Y[tf], vx: (Math.random() < 0.5 ? -1 : 1) * (62 + index * 9),
        fillCd: 2 + Math.random() * 3, anim: Math.random() * 4,
        kind: 'topi', alive: true
      });
    }

    for (i = 0; i < cfg.nits; i++) {
      var baseY = FLOOR_Y[1] - 60 + Math.random() * (FLOOR_Y[3] - FLOOR_Y[1]);
      nits.push({
        x: 200 + Math.random() * (W - 400), y: baseY,
        baseY: baseY, w: 60, h: 30,
        vx: (Math.random() < 0.5 ? -1 : 1) * (110 + index * 14),
        phase: Math.random() * 6, kind: 'nit', alive: true, warn: 0, warned: false
      });
    }

    // Two comic patrol enemies ('mil' from level 2, 'ex' from level 3) walk a floor and throw signs.
    var ladies = [];
    var ladyKinds = [];
    if (index >= 1) ladyKinds.push('mil');
    if (index >= 2) ladyKinds.push('ex');
    if (index >= 3) ladyKinds.push('mil');
    if (index >= 4) ladyKinds.push('ex');
    var LADY_SLOTS = [14, 9, 20, 24];
    for (i = 0; i < ladyKinds.length; i++) {
      var lf = 1 + (i % 3);
      var lx = placePatrol(lf, LADY_SLOTS[i % LADY_SLOTS.length], 44, 92);
      ladies.push({
        x: lx, y: FLOOR_Y[lf] - 92, w: 44, h: 92,
        floorY: FLOOR_Y[lf], vx: (Math.random() < 0.5 ? -1 : 1) * (48 + index * 6),
        shotCd: 2 + Math.random() * 2, anim: Math.random() * 4, point: 0, windup: 0,
        kind: ladyKinds[i], alive: true
      });
    }

    items.push({
      x: cfg.itemCols[0] * BLOCK + 8, y: FLOOR_Y[2] - 110,
      w: 52, h: 52, kind: 'veggie', phase: 0.7
    });
    items.push({
      x: cfg.itemCols[1] * BLOCK + 6, y: FLOOR_Y[3] - 106,
      w: 52, h: 40, kind: 'gem', phase: 2.1
    });
    items.push({
      x: 14 * BLOCK + 4, y: FLOOR_Y[4] - 56, w: 56, h: 56,
      kind: 'goal', phase: 0, locked: index === LEVELS.length - 1
    });

    return {
      index: index, name: cfg.name, cfg: cfg,
      blocks: blocks, movers: movers, topis: topis, nits: nits, ladies: ladies, shots: [],
      items: items, bear: null, bearDelay: cfg.bear, time: 0,
      startX: startX, startY: FLOOR_Y[0] - 60
    };
  }

    var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var game = {
    state: 'title',
    levelIndex: 0,
    lives: 3,
    score: 0,
    time: 0,
    level: null,
    player: null,
    run: null,
    climb: null,
    gear: null,
    rewardCard: 0,
    introTimer: 0,
    shake: 0,
    particles: [],
    flash: 0,
    paused: false
  };

  var keys = {};
  var steerId = null;
  var steerDir = 0;
  var steerPad = null;
  var steerArrows = [];

  function paintSteer(dir) {
    if (!steerArrows.length) return;
    if (dir < 0) steerArrows[0].classList.add('on');
    else steerArrows[0].classList.remove('on');
    if (dir > 0) steerArrows[1].classList.add('on');
    else steerArrows[1].classList.remove('on');
  }

  function resetSteer() {
    steerId = null;
    steerDir = 0;
    keys.ArrowLeft = false;
    keys.ArrowRight = false;
    paintSteer(0);
  }
  // ?touch forces the phone layout on desktop for testing.
  var IS_TOUCH = (!!root.matchMedia && root.matchMedia('(pointer: coarse)').matches) ||
    /[?&]touch(=|&|$)/.test(root.location.search);
  if (IS_TOUCH) document.documentElement.classList.add('touch');
  var ZOOM = IS_TOUCH ? 2.2 : 1;
  var HUD_SCALE = IS_TOUCH ? 1.7 : 1;
  var cam = { x: 0, y: H };
  var jumpQueued = false;
  var jumpBuffer = 0;
  var kickQueued = false;
  var slideQueued = false;
  var invuln = 0;
  var frameAccumulator = 0;
  var lastFrame = 0;

  var stars = [];
  var snow = [];
  var mountains = [];

  function resetAmbient() {
    var i;
    stars = [];
    for (i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * 620,
        r: Math.random() * 2 + 0.6, p: Math.random() * 6
      });
    }
    snow = [];
    for (i = 0; i < 90; i++) {
      snow.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 1 + Math.random() * 2.6,
        vx: -18 - Math.random() * 30, vy: 22 + Math.random() * 46,
        p: Math.random() * 6
      });
    }
    mountains = [];
    for (i = 0; i < 3; i++) {
      var baseY = 560 + i * 90;
      var pts = [{ x: -100, y: baseY }];
      for (var x = -100; x <= W + 100; x += 180) {
        pts.push({ x: x, y: baseY - 120 - Math.random() * (260 - i * 60) });
        pts.push({ x: x + 90, y: baseY - 40 - Math.random() * 90 });
      }
      pts.push({ x: W + 100, y: baseY });
      mountains.push({ pts: pts, color: ['#102a4c', '#173a63', '#1e4a78'][i] });
    }
  }

    var actx = null;

  function audioCtx() {
    if (!actx) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    var a = audioCtx();
    if (!a) return;
    var t = a.currentTime;
    var osc = a.createOscillator();
    var gain = a.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(a.destination);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol) {
    var a = audioCtx();
    if (!a) return;
    var len = Math.max(1, Math.floor((a.sampleRate || 44100) * dur));
    var buf = a.createBuffer(1, len, a.sampleRate || 44100);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    var src = a.createBufferSource();
    var gain = a.createGain();
    var t = a.currentTime;
    src.buffer = buf;
    gain.gain.setValueAtTime(vol || 0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(gain); gain.connect(a.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function sfx(name) {
    switch (name) {
      case 'jump': tone(330, 0.12, 'square', 0.035, 660); break;
      case 'swing': tone(180, 0.06, 'triangle', 0.03, 90); break;
      case 'break': tone(240, 0.1, 'square', 0.05, 70); tone(560, 0.06, 'triangle', 0.02, 220); break;
      case 'growl': tone(70, 0.45, 'sawtooth', 0.07, 45); tone(140, 0.35, 'square', 0.03, 60); break;
      case 'throw': noise(0.12, 0.035); break;
      case 'chirp': tone(1100, 0.08, 'square', 0.035, 1600); break;
      case 'land': noise(0.06, 0.025); break;
      case 'landHeavy': noise(0.16, 0.06); tone(90, 0.12, 'triangle', 0.03, 50); break;
      case 'ice': tone(420, 0.09, 'square', 0.05, 120); noise(0.08, 0.04); break;
      case 'miss': tone(120, 0.06, 'triangle', 0.02, 70); break;
      case 'slamWarn': tone(80, 0.4, 'sawtooth', 0.06, 55); tone(120, 0.25, 'square', 0.03, 70); break;
      case 'slam': noise(0.18, 0.07); tone(60, 0.2, 'sawtooth', 0.05, 35); break;
      case 'armorCrack': noise(0.12, 0.05); tone(700, 0.1, 'square', 0.035, 180); break;
      case 'hit': tone(220, 0.35, 'sawtooth', 0.06, 55); break;
      case 'pickup': tone(660, 0.1, 'sine', 0.05, 990); tone(990, 0.12, 'sine', 0.03, 1320); break;
      case 'enemy': tone(160, 0.15, 'square', 0.045, 40); break;
      case 'win':
        tone(523, 0.16, 'triangle', 0.05);
        setTimeout(function () { tone(659, 0.16, 'triangle', 0.05); }, 120);
        setTimeout(function () { tone(784, 0.18, 'triangle', 0.05); }, 240);
        setTimeout(function () { tone(1046, 0.3, 'triangle', 0.055); }, 380);
        break;
      case 'lose':
        tone(330, 0.4, 'sawtooth', 0.05, 80);
        break;
    }
  }

    function solidsOf(level) {
    var out = [];
    level.blocks.forEach(function (b) { if (b.alive) out.push(b); });
    for (var i = 0; i < level.movers.length; i++) out.push(level.movers[i]);
    return out;
  }

  function isSupported(p, solids) {
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      if (Math.abs(p.y + p.h - s.y) < 2 && p.x + p.w > s.x + 1 && p.x < s.x + s.w - 1) {
        return true;
      }
    }
    return false;
  }

  function addParticles(x, y, color, count, spread, minSize, maxSize) {
    for (var i = 0; i < count; i++) {
      game.particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 320,
        vy: -80 - Math.random() * 260,
        life: 0.5 + Math.random() * 0.5, max: 1,
        size: minSize === undefined ? 3 + Math.random() * 6 : minSize + Math.random() * (maxSize - minSize),
        color: color
      });
    }
  }

  // Draw a sprite by height, keeping its aspect, centred on cx with feet at bottom.
  function drawKeepAspect(name, cx, bottom, h, flip, fallbackAspect) {
    var img = images[name];
    var w = spriteReady(name) ? h * img.naturalWidth / img.naturalHeight : h * (fallbackAspect || 0.5);
    drawSprite(name, cx - w / 2, bottom - h, w, h, flip);
  }

  function drawSprite(name, x, y, w, h, flip) {
    if (spriteReady(name)) {
      if (flip) {
        ctx.save();
        ctx.translate(x + w, y);
        ctx.scale(-1, 1);
        ctx.drawImage(images[name], 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(images[name], x, y, w, h);
      }
    } else {
      ctx.fillStyle = FALLBACK[name] || '#ffffff';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
  }

  function text(str, x, y, size, color, align, weight) {
    ctx.font = (weight || 'bold') + ' ' + size + 'px "Courier New", monospace';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h, alpha) {
    ctx.fillStyle = 'rgba(4, 14, 30,' + (alpha === undefined ? 0.78 : alpha) + ')';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(150, 220, 255, 0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  }

    function startGame() {
    clearCheckpoint();
    game.lives = 3;
    game.score = 0;
    game.levelIndex = 0;
    game.particles = [];
    game.flash = 0;
    game.run = { furthest: 1, cleared: 0 };
    game.gear = null;
    game.rewardCard = 0;
    loadLevel(0);
  }

  function continueRun() {
    if (!checkpoint || game.state !== 'title') return;
    game.lives = checkpoint.lives;
    game.score = checkpoint.score;
    game.gear = checkpoint.gear;
    game.run = { furthest: checkpoint.levelIndex + 1, cleared: checkpoint.levelIndex };
    loadLevel(checkpoint.levelIndex);
  }

  function loadLevel(index) {
    game.levelIndex = index;
    game.level = buildLevel(index);
    game.player = {
      x: game.level.startX, y: game.level.startY,
      w: 44, h: 60, vy: 0, vx: 0,
      facing: 1, grounded: true, groundedOnMover: false,
      swing: 0, swingCd: 0, walkT: 0, frame: 0, moving: false,
      sliding: false, slideT: 0, slideCd: 0, slideStart: 0, slideDir: 1, slideRecover: 0,
      coyote: 0, coyoteMax: game.gear === 'cleats' ? CLEATS_GRACE : COYOTE_BASE,
      kickReach: game.gear === 'boots' ? KICK_BONUS : 0, airTime: 0, lastGroundY: game.level.startY,
      whiff: 0
    };
    var gemTotal = 0;
    game.level.items.forEach(function (it) { if (it.kind === 'gem') gemTotal++; });
    game.climb = {
      time: 0, gems: 0, gemsTotal: gemTotal, enemies: 0, livesLost: 0,
      reachedSummit: false, cleared: false, firstClear: false, newBest: false
    };
    if (game.run) game.run.furthest = Math.max(game.run.furthest, index + 1);
    invuln = 1.4;
    game.state = 'intro';
    game.introTimer = INTRO_TIME;
    var slideBtn = document.getElementById('slide');
    if (slideBtn) slideBtn.style.display = index === 1 && SLIDE_ENABLED ? 'block' : 'none';
    game.particles = [];
    game.shake = 0;
    jumpQueued = false;
    jumpBuffer = 0;
    kickQueued = false;
    slideQueued = false;
    if (game.run) {
      saveCheckpoint({ v: 1, levelIndex: index, score: game.score, lives: game.lives, gear: game.gear });
    }
  }

  function loseLife(reason) {
    if (invuln > 0 || game.state !== 'playing') return;
    game.climb.livesLost++;
    game.lives--;
    game.shake = 0.45;
    game.flash = 0.25;
    invuln = 2.2;
    sfx('hit');
    addParticles(game.player.x + game.player.w / 2, game.player.y + game.player.h / 2, '#ffffff', 14, 30);
    if (game.lives <= 0) {
      game.state = 'gameover';
      endRun();
      sfx('lose');
      return;
    }
    cancelSlide(game.player);
    game.player.x = game.level.startX;
    game.player.y = game.level.startY;
    game.player.vy = 0;
    game.player.grounded = true;
    game.player.airTime = 0;
    game.player.lastGroundY = game.level.startY;
    game.level.shots.length = 0;
    jumpQueued = false;
    jumpBuffer = 0;
    kickQueued = false;
    slideQueued = false;
    if (game.level.boss && game.level.boss.mode !== 'dead') resetBoss(game.level, game.player);
  }

  function clearLevel() {
    if (game.state !== 'playing') return;
    game.score += 500;
    game.state = 'levelclear';
    game.climb.cleared = true;
    if (game.run) game.run.cleared++;
    var prev = best.mountains[game.levelIndex];
    game.climb.firstClear = !(prev > 0);
    game.climb.newBest = game.climb.firstClear || game.climb.time < prev;
    if (game.climb.newBest) {
      best.mountains[game.levelIndex] = game.climb.time;
      saveBest();
    }
    sfx('win');
    addParticles(game.player.x + game.player.w / 2, game.player.y, '#ffe680', 22, 20);
  }

  function endRun() {
    clearCheckpoint();
    if (game.score > best.score) {
      best.score = game.score;
      saveBest();
    }
  }

  function nextLevel() {
    if (game.levelIndex >= LEVELS.length - 1) {
      game.state = 'win';
      endRun();
      return;
    }
    loadLevel(game.levelIndex + 1);
  }

  function confirmReward() {
    if (game.state !== 'reward') return;
    var id = game.rewardCard < GEAR_ORDER.length ? GEAR_ORDER[game.rewardCard] : null;
    if (id) {
      game.gear = id;
      sfx('pickup');
    }
    game.rewardCard = 0;
    nextLevel();
  }

  function updatePlaying() {
    var level = game.level;
    var p = game.player;
    var dt = DT;

    level.time += dt;
    game.climb.time += dt;
    if (game.state !== 'playing') return;
    // The wake-up should never be interrupted by an unrelated hazard.
    if (game.level.boss && game.level.boss.mode === 'reveal') invuln = Math.max(invuln, 0.02);

    // Moving platforms first so riders inherit the platform delta.
    for (var i = 0; i < level.movers.length; i++) {
      var m = level.movers[i];
      var wasOn = p.grounded &&
        Math.abs(p.y + p.h - m.y) <= 3 &&
        p.x + p.w > m.x + 2 && p.x < m.x + m.w - 2;
      var oldX = m.x;
      m.x += m.vx * dt;
      if (m.x <= m.minX) { m.x = m.minX; m.vx = Math.abs(m.vx); }
      if (m.x >= m.maxX) { m.x = m.maxX; m.vx = -Math.abs(m.vx); }
      if (wasOn) p.x += m.x - oldX;
    }

    var solids = solidsOf(level);
    p.grounded = isSupported(p, solids);

    p.swingCd -= dt;
    p.swing = Math.max(-1, p.swing - dt);
    p.slideCd = Math.max(0, p.slideCd - dt);
    if (p.slideRecover > 0) p.slideRecover = Math.max(0, p.slideRecover - dt);
    if (p.whiff > 0) p.whiff = Math.max(0, p.whiff - dt);
    // Input before the kick: a turn and a kick in the same tick hit the new facing (#4).
    var dir = 0;
    if (keys.ArrowLeft || keys.KeyA) dir -= 1;
    if (keys.ArrowRight || keys.KeyD) dir += 1;

    if (slideQueued) {
      slideQueued = false;
      if (dir !== 0 && p.swing <= 0) p.facing = dir;
      startSlide(level, p);
    }
    p.moving = dir !== 0 || p.sliding;
    if (dir !== 0 && !p.sliding) {
      // Facing stays locked during an active kick so pose, swoosh and damage agree.
      if (p.swing <= 0) p.facing = dir;
      p.walkT += dt;
      if (p.walkT > 0.12) { p.walkT = 0; p.frame = 1 - p.frame; }
    } else {
      p.walkT = 0.1;
    }

    if (p.grounded) p.coyote = p.coyoteMax;
    else p.coyote = Math.max(0, p.coyote - dt);

    if (jumpBuffer > 0) {
      jumpBuffer = Math.max(0, jumpBuffer - dt);
      if (jumpBuffer === 0) jumpQueued = false;
    }
    if (jumpQueued && !p.sliding && (p.grounded || p.coyote > 0)) {
      p.vy = -JUMP_VELOCITY;
      p.grounded = false;
      p.coyote = 0;
      jumpQueued = false;
      jumpBuffer = 0;
      sfx('jump');
      addParticles(p.x + p.w / 2, p.y + p.h, '#e8f7ff', 5, 18);
    }

    if (kickQueued) {
      kickQueued = false;
      if (!p.sliding && p.swingCd <= 0) {
        p.swing = 0.2;
        p.swingCd = 0.34;
        sfx('swing');
        doKick(level, p);
      }
    }

    var dx = 0;
    if (p.sliding) {
      if (p.slideStart > 0) {
        p.slideStart -= dt;
        dx = p.slideDir * MOVE_SPEED * 0.35 * dt;
        if (p.slideStart <= 0) { p.h = SLIDE_H; p.y += 60 - SLIDE_H; }
      } else {
        p.slideT -= dt;
        var prog = 1 - Math.max(0, p.slideT) / SLIDE_TIME;
        dx = p.slideDir * MOVE_SPEED * (1.45 - 0.9 * prog) * dt;
        if (p.slideT <= 0) {
          if (canStand(level, p)) standUp(p);
          else dx = 0;
        }
      }
    } else if (dir !== 0) {
      dx = dir * MOVE_SPEED * dt;
    }

    p.vy += GRAVITY * dt;
    if (p.vy > 3400) p.vy = 3400;
    var wasAir = !p.grounded;
    var res = resolveMove(p, dx, p.vy * dt, solids);
    if (res.grounded) { p.grounded = true; }
    if (!p.grounded && isSupported(p, solids)) { p.grounded = true; p.vy = 0; }
    if (p.grounded) {
      if (wasAir && p.airTime > 0) {
        var heavyLand = p.y - p.lastGroundY > 160;
        sfx(heavyLand ? 'landHeavy' : 'land');
        addParticles(p.x + p.w / 2, p.y + p.h, heavyLand ? '#dff3ff' : '#ffffff',
          heavyLand ? 18 : 10, heavyLand ? 70 : 30, heavyLand ? 6 : 5, heavyLand ? 14 : 11);
        if (heavyLand) game.shake = Math.max(game.shake, 0.25);
      }
      p.airTime = 0;
      p.lastGroundY = p.y;
    } else {
      p.airTime += dt;
    }

    // Sliding off a ledge keeps normal gravity; stand only where there is headroom.
    if (p.sliding && p.slideStart <= 0 && !p.grounded && canStand(level, p)) standUp(p);

    if (p.y + p.h <= FLOOR_Y[4] + 2) game.climb.reachedSummit = true;
    if (p.x < 0) p.x = 0;
    if (p.x + p.w > W) p.x = W - p.w;
    if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }

    for (var it = 0; it < level.items.length; it++) {
      var item = level.items[it];
      if (item.taken || item.locked) continue;
      var pickup = item;
      if (item.kind === 'gem') {
        pickup = {
          x: item.x, y: item.y + Math.sin(game.time * 3 + item.phase) * 5,
          w: item.w, h: item.h
        };
      }
      if (rectsOverlap(p, pickup)) {
        item.taken = true;
        if (item.kind === 'goal') {
          addParticles(item.x + item.w / 2, item.y + item.h / 2, '#ffe680', 18, 24);
          sfx('pickup');
          clearLevel();
          return;
        }
        if (item.kind === 'gem') game.climb.gems++;
        game.score += item.kind === 'gem' ? 250 : 200;
        sfx('pickup');
        addParticles(item.x + item.w / 2, item.y + item.h / 2,
          item.kind === 'gem' ? '#58e0c0' : '#ff6b6b', 12, 16);
      }
    }

    updateEnemies(level, p, dt);

    if (level.index === LEVELS.length - 1 && !level.boss && p.grounded && p.y + p.h <= FLOOR_Y[4] + 2) {
      spawnBoss(level);
    }
    updateBoss(level, p, dt);

    if (level.bearDelay && !level.bear && level.time >= level.bearDelay && !level.boss) {
      spawnBear(level, p);
    }

    if (invuln > 0) invuln -= dt;

    for (var pi = game.particles.length - 1; pi >= 0; pi--) {
      var pt = game.particles[pi];
      pt.life -= dt;
      pt.vy += GRAVITY * 0.55 * dt;
      pt.x += pt.vx * dt;
      if (pt.x < 0) { pt.x = 0; if (pt.vx < 0) pt.vx = 0; }
      if (pt.x > W) { pt.x = W; if (pt.vx > 0) pt.vx = 0; }
      pt.y += pt.vy * dt;
      if (pt.life <= 0) game.particles.splice(pi, 1);
    }
  }

  function canStand(level, p) {
    if (p.h >= 60) return true;
    var stand = { x: p.x, y: p.y + p.h - 60, w: p.w, h: 60 };
    var solids = solidsOf(level);
    for (var i = 0; i < solids.length; i++) {
      if (rectsOverlap(stand, solids[i])) return false;
    }
    return true;
  }

  function cancelSlide(p) {
    p.sliding = false;
    p.slideStart = 0;
    p.slideT = 0;
    p.slideRecover = 0;
    p.slideCd = 0;
    p.h = 60;
  }

  function standUp(p) {
    p.h = 60;
    p.y -= 60 - SLIDE_H;
    p.sliding = false;
    p.slideT = 0;
    p.slideStart = 0;
    p.slideRecover = 0.12;
  }

  function startSlide(level, p) {
    if (!SLIDE_ENABLED || p.sliding || !p.grounded || p.slideCd > 0 || level.index !== 1) return;
    p.sliding = true;
    p.slideStart = SLIDE_START;
    p.slideT = SLIDE_TIME;
    p.slideCd = SLIDE_CD;
    p.slideDir = p.facing;
  }

  function spawnBoss(level) {
    if (level.boss) return;
    var f = BOSS_FORMS[0];
    level.boss = {
      x: 960 - f.w / 2, y: FLOOR_Y[4] - f.h, w: f.w, h: f.h, floorY: FLOOR_Y[4],
      centerX: 960, layers: 3, form: 0, mode: 'reveal', timer: 1.4,
      hitFlash: 0, facing: -1
    };
    invuln = Math.max(invuln, 1.6);
    game.shake = 0.6;
    sfx('growl');
  }

  function bossImpact(b) {
    return { x: b.x - 110, y: b.floorY - 34, w: b.w + 220, h: 34 };
  }

  function setBossMode(b, mode, timer) {
    b.mode = mode;
    b.timer = timer;
  }

  function resetBoss(level, p) {
    var b = level.boss, f = BOSS_FORMS[0];
    b.layers = 3;
    b.form = 0;
    b.w = f.w;
    b.h = f.h;
    b.x = b.centerX - f.w / 2;
    b.y = b.floorY - f.h;
    b.hitFlash = 0;
    setBossMode(b, 'idle', 1.2);
    for (var c = 11; c <= 19; c++) {
      level.blocks.set(key(c, FLOOR_Y[4]), {
        x: c * BLOCK, y: FLOOR_Y[4], w: BLOCK, h: BLOCK, alive: true, fixed: true
      });
    }
    p.x = 14 * BLOCK + 4;
    p.y = FLOOR_Y[4] - 60;
    p.vy = 0;
    p.grounded = true;
  }

  function hitBoss(level) {
    var b = level.boss;
    b.layers--;
    b.hitFlash = 0.25;
    game.shake = 0.3;
    sfx('armorCrack');
    addParticles(b.centerX, b.y + b.h / 2, '#e9fbff', 20, 40);
    if (b.layers <= 0) {
      b.mode = 'dead';
      game.climb.enemies++;
      sfx('enemy');
      var goal = level.items.find(function (it) { return it.kind === 'goal'; });
      if (goal) goal.locked = false;
      return;
    }
    b.form = 3 - b.layers;
    var f = BOSS_FORMS[b.form];
    b.w = f.w;
    b.h = f.h;
    b.x = b.centerX - f.w / 2;
    b.y = b.floorY - f.h;
    setBossMode(b, 'idle', 1.0);
  }

  function updateBoss(level, p, dt) {
    var b = level.boss;
    if (!b || b.mode === 'dead') return;
    b.timer -= dt;
    b.facing = p.x + p.w / 2 < b.centerX ? -1 : 1;
    if (b.hitFlash > 0) b.hitFlash -= dt;
    if (b.mode === 'reveal') {
      if (b.timer <= 0) setBossMode(b, 'idle', 0.9);
    } else if (b.mode === 'idle') {
      if (b.timer <= 0) { setBossMode(b, 'raise', 0.75); sfx('slamWarn'); }
    } else if (b.mode === 'raise') {
      if (b.timer <= 0) {
        game.shake = 0.45;
        sfx('slam');
        addParticles(b.centerX, b.floorY - 10, '#cfeaff', 18, 120);
        setBossMode(b, 'impact', 0.22);
        if (p.grounded && rectsOverlap(shrink(p, 4), bossImpact(b))) {
          loseLife('boss');
          return;
        }
      }
    } else if (b.mode === 'impact') {
      if (b.timer <= 0) setBossMode(b, 'stuck', 1.3);
    } else if (b.mode === 'stuck') {
      if (b.timer <= 0) setBossMode(b, 'idle', 0.9);
    }
  }

  function doKick(level, p) {
    var above = { x: p.x - 10, y: p.y - 78, w: p.w + 20, h: 80 };
    var reach = 76 + p.kickReach;
    var front = p.facing > 0
      ? { x: p.x + p.w - 6, y: p.y - 6, w: reach, h: p.h + 4 }
      : { x: p.x + 6 - reach, y: p.y - 6, w: reach, h: p.h + 4 };
    var broke = 0;

    level.blocks.forEach(function (b) {
      if (!b.alive || b.fixed) return;
      if (rectsOverlap(above, b) || rectsOverlap(front, b)) {
        b.alive = false;
        broke++;
        game.score += 10;
        addParticles(b.x + BLOCK / 2, b.y + BLOCK / 2, '#cfeaff', 8, 40);
      }
    });
    var hitAny = broke > 0;
    if (broke > 0) game.shake = 0.12;

    if (kickLadies(level, front) > 0) hitAny = true;
    if (level.boss && level.boss.mode === 'stuck' &&
      rectsOverlap(front, { x: level.boss.x, y: level.boss.y, w: level.boss.w, h: level.boss.h })) {
      hitBoss(level);
      hitAny = true;
    }
    // Ground enemies can be kicked; flying nitpickers and the bear cannot.
    for (var i = 0; i < level.topis.length; i++) {
      var e = level.topis[i];
      if (!e.alive) continue;
      if (rectsOverlap(front, e)) {
        e.alive = false;
        hitAny = true;
        game.climb.enemies++;
        game.score += 100;
        sfx('enemy');
        addParticles(e.x + e.w / 2, e.y + e.h / 2, '#8bd17c', 12, 24);
      }
    }
    if (broke > 0) sfx('ice');
    else if (!hitAny) {
      sfx('miss');
      p.whiff = 0.2;
      addParticles(Math.max(10, Math.min(W - 10, front.x + front.w / 2)),
        Math.max(10, Math.min(H - 10, front.y + front.h / 2)), '#c7d3de', 3, 12, 4, 7);
      var wpn = game.particles.slice(-3);
      for (var wpi = 0; wpi < wpn.length; wpi++) {
        var q = wpn[wpi];
        q.x = Math.max(8, Math.min(W - 8, q.x));
        q.y = Math.max(8, Math.min(H - 8, q.y));
        if (q.x <= 8 && q.vx < 0) q.vx = 0;
        if (q.x >= W - 8 && q.vx > 0) q.vx = 0;
        if (q.y <= 8 && q.vy < 0) q.vy = 0;
        if (q.y >= H - 8 && q.vy > 0) q.vy = 0;
      }
    }
  }

  function kickLadies(level, front) {
    var killed = 0;
    for (var i = 0; i < level.ladies.length; i++) {
      var e = level.ladies[i];
      if (!e.alive || !rectsOverlap(front, e)) continue;
      e.alive = false;
      killed++;
      game.climb.enemies++;
      game.score += 200;
      sfx('enemy');
      addParticles(e.x + e.w / 2, e.y + e.h / 2, '#ffd0e8', 14, 28);
    }
    return killed;
  }

  function spawnBear(level, p) {
    var floorY = FLOOR_Y[0];
    for (var i = 0; i < FLOOR_Y.length; i++) {
      if (FLOOR_Y[i] >= p.y + p.h - 4) floorY = FLOOR_Y[i];
    }
    var fromLeft = p.x > W / 2;
    // Nearest intact cell to the chosen edge on the player's floor.
    var col = fromLeft ? 1 : COLS - 2;
    var stepDir = fromLeft ? 1 : -1;
    while (!solidAt(level, col, floorY) && col > 0 && col < COLS - 1) col += stepDir;
    level.bear = {
      x: col * BLOCK, y: floorY - 62, w: 66, h: 62,
      floorY: floorY, vx: fromLeft ? 150 : -150,
      kind: 'bear', alive: true, anim: 0, cue: 2, entrySide: fromLeft ? -1 : 1
    };
    game.shake = 0.5;
    sfx('growl');
  }

  function updateEnemies(level, p, dt) {
    var i;
    for (i = 0; i < level.topis.length; i++) {
      var t = level.topis[i];
      if (!t.alive) continue;
      t.anim += dt;
      t.fillCd -= dt;
      var nextX = t.x + t.vx * dt;
      if (nextX < 0 || nextX + t.w > W) { t.vx = -t.vx; nextX = t.x; }
      var centerCol = Math.floor((nextX + t.w / 2) / BLOCK);
      if (!solidAt(level, centerCol, t.floorY)) {
        var cell = { x: centerCol * BLOCK, y: t.floorY, w: BLOCK, h: BLOCK, alive: true };
        var blocked = centerCol < 0 || centerCol >= COLS || rectsOverlap(cell, p) ||
          level.movers.some(function (mv) {
            return rectsOverlap(cell, { x: mv.minX, y: mv.y, w: mv.maxX + mv.w - mv.minX, h: mv.h });
          });
        if (blocked) {
          t.vx = -t.vx;
          nextX = t.x;
        } else if (t.fillCd <= 0) {
          level.blocks.set(key(centerCol, t.floorY), cell);
          t.fillCd = 5.5;
          addParticles(centerCol * BLOCK + 32, t.floorY + 32, '#bfe6ff', 6, 24);
        } else {
          t.vx = -t.vx;
          nextX = t.x;
        }
      }
      t.x = nextX;
      if (rectsOverlap(shrink(p, 6), shrink(t, 6))) loseLife('topi');
    }

    for (i = 0; i < level.nits.length; i++) {
      var n = level.nits[i];
      n.phase += dt;
      n.x += n.vx * dt;
      if (n.x < 80) { n.x = 80; n.vx = Math.abs(n.vx); }
      if (n.x + n.w > W - 80) { n.x = W - 80 - n.w; n.vx = -Math.abs(n.vx); }
      var diving = Math.sin(n.phase * 0.55) > 0.94 && Math.abs(n.x - p.x) < 720;
      if (diving && !n.warned) { n.warned = true; n.warn = IS_TOUCH ? 0.6 : 0.35; game.nitAlerts = (game.nitAlerts || 0) + 1; sfx('chirp'); }
      if (!diving) n.warned = false;
      if (n.warn > 0) {
        n.warn = Math.max(0, n.warn - dt);
        var warnY = n.baseY + Math.sin(n.phase * 2.1) * 46;
        n.y += (warnY - n.y) * Math.min(1, dt * 3);
      } else if (diving) {
        n.y += (p.y + 8 - n.y) * Math.min(1, dt * 4);
      } else {
        var targetY = n.baseY + Math.sin(n.phase * 2.1) * 46;
        n.y += (targetY - n.y) * Math.min(1, dt * 3);
      }
      n.y = Math.max(110, Math.min(FLOOR_Y[0] - 30, n.y));
      if (rectsOverlap(shrink(p, 7), shrink(n, 8))) loseLife('nitpicker');
    }

    for (i = 0; i < level.ladies.length; i++) {
      var l = level.ladies[i];
      if (!l.alive) continue;
      l.anim += dt;
      l.shotCd -= dt;
      l.point -= dt;
      var lx = l.x + l.vx * dt;
      var lcol = Math.floor((lx + l.w / 2) / BLOCK);
      if (lx < 0 || lx + l.w > W || !solidAt(level, lcol, l.floorY)) {
        l.vx = -l.vx;
        l.x += l.vx * dt * 2;
      } else {
        l.x = lx;
      }
      var sameFloor = Math.abs((p.y + p.h) - l.floorY) < 24;
      if (l.windup > 0) {
        // Telegraph: she stops and points for 0.5 s, then throws.
        l.windup -= dt;
        l.x -= l.vx * dt;
        if (l.windup <= 0) {
          var dir = l.vx < 0 ? -1 : 1;
          level.shots.push({
            x: dir > 0 ? l.x + l.w : l.x - 36, y: l.y + 26, w: 36, h: 36, vx: dir * 300,
            life: 3, kind: l.kind === 'mil' ? 'sign' : 'clip'
          });
          sfx('throw');
        }
      } else if (sameFloor && l.shotCd <= 0 && Math.abs(p.x - l.x) < 700) {
        l.vx = (p.x < l.x ? -1 : 1) * Math.abs(l.vx);
        l.windup = 0.5;
        l.point = 0.5;
        l.shotCd = 2.6 + Math.random() * 1.6;
      }
      if (rectsOverlap(shrink(p, 6), shrink(l, 8))) loseLife(l.kind);
    }
    for (i = level.shots.length - 1; i >= 0; i--) {
      var sh = level.shots[i];
      sh.x += sh.vx * dt;
      sh.life -= dt;
      if (sh.life <= 0 || sh.x < -40 || sh.x > W + 40) { level.shots.splice(i, 1); continue; }
      if (rectsOverlap(shrink(p, 6), shrink(sh, 5))) { level.shots.splice(i, 1); loseLife('shot'); break; }
    }

    if (level.bear) {
      var b = level.bear;
      b.anim += dt;
      if (b.cue > 0) b.cue = Math.max(0, b.cue - dt);
      b.vx = p.x + p.w / 2 < b.x + b.w / 2 ? -Math.abs(b.vx) : Math.abs(b.vx);
      var bx = Math.max(0, Math.min(W - b.w, b.x + b.vx * dt));
      if (solidAt(level, Math.floor((bx + b.w / 2) / BLOCK), b.floorY)) b.x = bx;
      if (rectsOverlap(shrink(p, 7), shrink(b, 8))) loseLife('bear');
    }
  }

  function shrink(r, n) {
    return { x: r.x + n, y: r.y + n, w: r.w - n * 2, h: r.h - n * 2 };
  }

    function drawBackground(t) {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#04101f');
    sky.addColorStop(0.45, '#0b2947');
    sky.addColorStop(0.8, '#1b4a72');
    sky.addColorStop(1, '#2a6a92');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var a = 0; a < 3; a++) {
      var g = ctx.createLinearGradient(0, 100 + a * 60, 0, 420 + a * 40);
      g.addColorStop(0, 'rgba(80,255,200,0)');
      g.addColorStop(0.5, a === 1 ? 'rgba(90,200,255,0.10)' : 'rgba(110,255,190,0.08)');
      g.addColorStop(1, 'rgba(80,255,200,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 220 + a * 70);
      for (var x = 0; x <= W; x += 120) {
        ctx.lineTo(x, 220 + a * 70 + Math.sin(x * 0.003 + t * 0.25 + a) * 40);
      }
      ctx.lineTo(W, 460 + a * 60);
      ctx.lineTo(0, 460 + a * 60);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.35 + Math.sin(t * 1.7 + s.p) * 0.25;
      ctx.fillStyle = '#e9f6ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (var m = 0; m < mountains.length; m++) {
      ctx.fillStyle = mountains[m].color;
      ctx.beginPath();
      var pts = mountains[m].pts;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var pi = 1; pi < pts.length; pi++) ctx.lineTo(pts[pi].x, pts[pi].y);
      ctx.lineTo(W + 100, H);
      ctx.lineTo(-100, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawSnow(elapsed) {
    ctx.fillStyle = 'rgba(235, 248, 255, 0.75)';
    for (var i = 0; i < snow.length; i++) {
      var f = snow[i];
      f.x += f.vx * elapsed;
      f.y += f.vy * elapsed;
      if (f.y > H) { f.y = -10; f.x = Math.random() * W; }
      if (f.x < -10) f.x = W + 10;
      ctx.globalAlpha = 0.35 + Math.sin(f.p + game.time * 2) * 0.2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function shotTrail(shp) {
    var dir = shp.vx > 0 ? -1 : 1;
    var edge = dir < 0 ? shp.x - 4 : shp.x + shp.w + 4;
    var segs = [];
    for (var i = 0; i < 3; i++) {
      var len = 12 - i * 3;
      segs.push({ x1: edge, x2: edge + dir * len, y: shp.y + 10 + i * 8 });
    }
    return segs;
  }

  function drawShot(shp) {
    var segs = shotTrail(shp), i;
    ctx.strokeStyle = 'rgba(235, 248, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (i = 0; i < segs.length; i++) {
      ctx.beginPath();
      ctx.moveTo(segs[i].x1, segs[i].y);
      ctx.lineTo(segs[i].x2, segs[i].y);
      ctx.stroke();
    }
    drawSprite(shp.kind, shp.x, shp.y, shp.w, shp.h, false);
  }

  function drawGem(item, bob) {
    var img = images.gem;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, GEM_SRC.x, GEM_SRC.y, GEM_SRC.w, GEM_SRC.h,
        item.x + (item.w - GEM_DRAW.w) / 2, item.y + (item.h - GEM_DRAW.h) / 2 + bob,
        GEM_DRAW.w, GEM_DRAW.h);
    } else {
      drawSprite('gem', item.x, item.y + bob, item.w, item.h, false);
    }
  }

  function bossPoseKey(b) {
    var pose = b.mode === 'raise' ? 'warn' : b.mode === 'impact' ? 'impact' : b.mode === 'stuck' ? 'stuck' : 'idle';
    return 'guardian_' + BOSS_FORMS[b.form].form + '_' + pose;
  }

  function bossDrawHeight(b) {
    return b.h;
  }

  function bossCueRect(b) {
    var w = 118, h = 56;
    var x = b.x + b.w + 12;
    if (x + w > W - 8) x = b.x - w - 12;
    var y = Math.max(92, Math.min(Math.round(b.y + b.h * 0.45), b.floorY - h - 8));
    return { x: x, y: y, w: w, h: h };
  }

  function bossCueTouchRect() {
    var s = HUD_SCALE, w = 136 * s, h = 84 * s;
    return { x: (W - w) / 2, y: 92 * s + 12, w: w, h: h };
  }

  function drawBoss(level) {
    var b = level.boss;
    if (!b || b.mode === 'dead') return;
    var jx = b.hitFlash > 0 ? (Math.random() - 0.5) * 8 : 0;
    if (b.mode === 'raise') {
      ctx.strokeStyle = 'rgba(255, 80, 110, 0.75)';
      ctx.lineWidth = 3;
      var z = bossImpact(b);
      ctx.strokeRect(z.x, z.y, z.w, z.h);
    }
    var drawH = bossDrawHeight(b);
    drawKeepAspect(bossPoseKey(b), b.centerX + jx, b.floorY, drawH, b.facing < 0, b.w / b.h);
    if (!IS_TOUCH) drawBossCue(b, bossCueRect(b), 1);
  }

  function drawBossCue(b, cue, s) {
    ctx.fillStyle = 'rgba(4, 14, 30, 0.74)';
    ctx.fillRect(cue.x, cue.y, cue.w, cue.h);
    ctx.strokeStyle = 'rgba(150, 220, 255, 0.55)';
    ctx.lineWidth = 2 * s;
    ctx.strokeRect(cue.x + 1, cue.y + 1, cue.w - 2, cue.h - 2);
    var label = b.mode === 'stuck' ? 'KICK!' : b.mode === 'raise' ? 'SLAM!' :
      b.mode === 'impact' ? 'DOWN!' : b.mode === 'reveal' ? 'WAKE!' : 'GUARD';
    var font = (s > 1 ? 32 : 20) * s;
    text(label, cue.x + 9 * s, cue.y + 32 * s, font,
      b.mode === 'stuck' ? '#ffe680' : b.mode === 'raise' ? '#ff8a9e' : '#eaf8ff');
    for (var i = 0; i < 3; i++) {
      ctx.fillStyle = i < b.layers ? '#e9fbff' : 'rgba(233,251,255,0.22)';
      ctx.beginPath();
      ctx.arc(cue.x + (14 + i * 24) * s, cue.y + 62 * s, 8 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function playerPose(p) {
    if (p.sliding) return p.slideStart > 0 ? 'karate_slide_start' : 'karate_slide';
    if (p.slideRecover > 0) return 'karate_slide_recover';
    if (p.swing > 0) return p.grounded ? 'kick' : 'punch';
    if (!p.grounded) return 'jump';
    return p.moving ? (p.frame === 1 ? 'walk2' : 'walk1') : 'idle';
  }

  function nitWarningLayout(nits) {
    var safe = { left: W * 0.25, right: W * 0.75, top: 92 * HUD_SCALE + 100, bottom: H - 100 };
    var placed = [], out = [], birds = [];
    for (var b = 0; b < nits.length; b++) {
      birds.push({ x: (nits[b].x + nits[b].w / 2 - cam.x) * ZOOM - nits[b].w * ZOOM / 2,
        y: (nits[b].y + nits[b].h / 2 - cam.y) * ZOOM - nits[b].h * ZOOM / 2,
        w: nits[b].w * ZOOM, h: nits[b].h * ZOOM });
    }
    function area(a, b) {
      var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      return x * y;
    }
    for (var i = 0; i < nits.length; i++) {
      var r = nitWarningScreenRect(nits[i]), step = r.w + 12, best = null, bestScore = Infinity;
      for (var oy = 0; oy <= 4; oy++) for (var ox = -2; ox <= 2; ox++) {
        var x = Math.max(safe.left, Math.min(safe.right - r.w, r.x + ox * step));
        var y = Math.max(safe.top, Math.min(safe.bottom - r.h, r.y + oy * step));
        var cand = { x: x, y: y, w: r.w, h: r.h };
        var score = 0;
        for (var p = 0; p < placed.length; p++) score += area(cand, placed[p]) + 1;
        for (var bb = 0; bb < birds.length; bb++) {
          if (bb === i) continue;
          score += area(cand, birds[bb]) * 4;
        }
        if (score < bestScore) { bestScore = score; best = cand; }
      }
      out.push({ x: best.x, y: best.y, w: r.w, h: r.h, arrow: r.arrow, offscreen: r.offscreen });
      placed.push(out[out.length - 1]);
    }
    return out;
  }

  function nitPose(nit) {
    var warning = nit.warn > 0;
    return { h: 52 * (warning ? 1.12 : 1), flap: warning ? Math.sin(nit.warn * 60) * 5 : 0, warning: warning };
  }

  function whiffArc(p) {
    var r = 34, maxR = 44;
    var pts = p.facing > 0
      ? [[maxR * Math.cos(-0.25), maxR * Math.sin(-0.25)], [maxR * Math.cos(1.25), maxR * Math.sin(1.25)]]
      : [[-maxR * Math.cos(-0.25), maxR * Math.sin(-0.25)], [-maxR * Math.cos(1.25), maxR * Math.sin(1.25)]];
    var x0 = Math.min(pts[0][0], pts[1][0]), x1 = Math.max(pts[0][0], pts[1][0]);
    var y0 = Math.min(pts[0][1], pts[1][1]), y1 = Math.max(pts[0][1], pts[1][1]);
    var cx = Math.max(8 - x0, Math.min(W - 8 - x1, p.x + p.w / 2));
    var cy = Math.max(8 - y0, Math.min(H - 8 - y1, p.y + p.h * 0.7));
    return {
      x: cx, y: cy, radius: r, color: '#c7d3de', width: 6,
      bounds: { x0: cx + x0, x1: cx + x1, y0: cy + y0, y1: cy + y1 }
    };
  }

  function nitBadge(nit) {
    return { x: nit.x + nit.w / 2, y: nit.y - 40, size: 52 };
  }

  function nitWarningScreenRect(nit) {
    var badge = nitBadge(nit), size = badge.size * ZOOM, r = size / 2;
    var sx = (badge.x - cam.x) * ZOOM, sy = (badge.y - cam.y) * ZOOM;
    var safe = { left: W * 0.25, right: W * 0.75, top: 92 * HUD_SCALE + 100, bottom: H - 100 };
    var birdSx = (nit.x + nit.w / 2 - cam.x) * ZOOM;
    var birdSy = (nit.y + nit.h / 2 - cam.y) * ZOOM;
    var birdOnScreen = birdSx >= 0 && birdSx <= W && birdSy >= 0 && birdSy <= H;
    var cx, cy, arrow = '';
    if (birdOnScreen) {
      cx = birdSx + r + 34;
      if (cx + r > safe.right) cx = birdSx - r - 34;
      cy = birdSy;
      if (cx - r < safe.left || cx + r > safe.right) { cx = birdSx; cy = birdSy + r + 34; }
    } else {
      cx = sx; cy = sy;
      if (Math.abs(sx - cx) > 1 || Math.abs(sy - cy) > 1) {
        if (Math.abs(sx - cx) >= Math.abs(sy - cy)) arrow = sx < cx ? 'left' : 'right';
        else arrow = sy < cy ? 'up' : 'down';
      }
    }
    cx = Math.max(safe.left + r, Math.min(safe.right - r, cx));
    cy = Math.max(safe.top + r, Math.min(safe.bottom - r, cy));
    if (!birdOnScreen) {
      var dx = sx - cx, dy = sy - cy;
      arrow = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    }
    return { x: cx - r, y: cy - r, w: size, h: size, arrow: arrow, offscreen: !birdOnScreen };
  }

  function drawNitWarningScreen(nit) { drawNitWarningScreenRect(nitWarningScreenRect(nit)); }

  function drawNitWarningScreenRect(rect) {
    var r = rect.w / 2;
    var cx = rect.x + r, cy = rect.y + r;
    ctx.fillStyle = 'rgba(4,14,30,0.92)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.stroke();
    text('!', cx, cy + 2, rect.w * 0.65, '#ffe680', 'center');
    if (rect.arrow) {
      var ax = cx, ay = cy, d = r + 20;
      ctx.fillStyle = '#ffe680';
      ctx.beginPath();
      if (rect.arrow === 'left') { ctx.moveTo(ax - d - 10, ay); ctx.lineTo(ax - d + 6, ay - 12); ctx.lineTo(ax - d + 6, ay + 12); }
      else if (rect.arrow === 'right') { ctx.moveTo(ax + d + 10, ay); ctx.lineTo(ax + d - 6, ay - 12); ctx.lineTo(ax + d - 6, ay + 12); }
      else if (rect.arrow === 'up') { ctx.moveTo(ax, ay - d - 10); ctx.lineTo(ax - 12, ay - d + 6); ctx.lineTo(ax + 12, ay - d + 6); }
      else { ctx.moveTo(ax, ay + d + 10); ctx.lineTo(ax - 12, ay + d - 6); ctx.lineTo(ax + 12, ay + d - 6); }
      ctx.closePath(); ctx.fill();
    }
  }

  function drawLevel(level, p, t) {
    level.blocks.forEach(function (b) {
      if (!b.alive) return;
      drawSprite('ice', b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, 4);
    });

    for (var mi = 0; mi < level.movers.length; mi++) {
      var m = level.movers[mi];
      for (var k = 0; k < 4; k++) {
        drawSprite('ice', m.x + k * BLOCK, m.y, BLOCK, BLOCK);
      }
      ctx.strokeStyle = 'rgba(120, 220, 255, 0.75)';
      ctx.lineWidth = 3;
      ctx.strokeRect(m.x + 1, m.y + 1, m.w - 2, m.h - 2);
      text('<>', m.x + m.w / 2, m.y + m.h / 2, 22, 'rgba(180,240,255,0.85)', 'center');
    }

    for (var ii = 0; ii < level.items.length; ii++) {
      var item = level.items[ii];
      if (item.taken) continue;
      var bob = Math.sin(t * 3 + item.phase) * 5;
      if (item.kind === 'goal') {
        var glow = ctx.createRadialGradient(
          item.x + item.w / 2, item.y + item.h / 2 + bob, 6,
          item.x + item.w / 2, item.y + item.h / 2 + bob, 74
        );
        glow.addColorStop(0, 'rgba(255, 236, 140, 0.5)');
        glow.addColorStop(1, 'rgba(255, 236, 140, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(item.x + item.w / 2, item.y + item.h / 2 + bob, 74, 0, Math.PI * 2);
        ctx.fill();
      }
      if (item.kind === 'gem') drawGem(item, bob);
      else drawKeepAspect(VEGGIES[level.index % 3], item.x + item.w / 2, item.y + item.h + bob, item.h, false);
    }

    if (level.boss) drawBoss(level);

    for (var ti = 0; ti < level.topis.length; ti++) {
      var topi = level.topis[ti];
      if (!topi.alive) continue;
      drawSprite('topi', topi.x, topi.y + Math.sin(topi.anim * 6) * 2,
        topi.w, topi.h, topi.vx < 0);
    }
    for (var ni = 0; ni < level.nits.length; ni++) {
      var nit = level.nits[ni];
      var np = nitPose(nit);
      ctx.save();
      if (np.warning) { ctx.shadowColor = '#ffe680'; ctx.shadowBlur = 12; }
      drawKeepAspect('nitpicker', nit.x + nit.w / 2 + np.flap, nit.y + nit.h + 6, np.h, nit.vx < 0);
      ctx.restore();
      if (nit.warn > 0) {
        ctx.strokeStyle = 'rgba(255,230,128,0.85)';
        ctx.lineWidth = 3;
        ctx.strokeRect(nit.x - 4, nit.y - 2, nit.w + 8, nit.h + 10);
        if (!IS_TOUCH) {
          var badge = nitBadge(nit), r = badge.size / 2;
          ctx.fillStyle = 'rgba(4,14,30,0.9)';
          ctx.beginPath(); ctx.arc(badge.x, badge.y, r, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#ffe680'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(badge.x, badge.y, r - 1, 0, Math.PI * 2); ctx.stroke();
          text('!', badge.x, badge.y + 1, 38, '#ffe680', 'center');
        }
      }
    }
    for (var li = 0; li < level.ladies.length; li++) {
      var ld = level.ladies[li];
      if (!ld.alive) continue;
      var lk = ld.kind === 'mil' ? 'mil' : 'ex';
      var lname = ld.point > 0 ? (lk === 'mil' ? 'milp' : 'exp') : lk + (Math.floor(ld.anim * 4) % 2 ? '2' : '1');
      drawKeepAspect(lname, ld.x + ld.w / 2, ld.y + ld.h, ld.h + 4, ld.vx < 0);
    }
    for (var si = 0; si < level.shots.length; si++) drawShot(level.shots[si]);
    if (level.bear) {
      drawSprite('bear', level.bear.x, level.bear.y + Math.sin(level.bear.anim * 5) * 2,
        level.bear.w, level.bear.h, level.bear.vx < 0);
      text('!', level.bear.x + level.bear.w / 2, level.bear.y - 18, 36, '#ff5470', 'center');
      if (level.bear.cue > 0) {
        text(level.bear.entrySide < 0 ? '>>>' : '<<<',
          level.bear.entrySide < 0 ? 34 : W - 34, level.bear.y + level.bear.h / 2, 40, '#ff8a9e',
          level.bear.entrySide < 0 ? 'left' : 'right');
      }
    }

    var blink = invuln > 0 && Math.floor(invuln * 14) % 2 === 0;
    ctx.globalAlpha = blink ? 0.4 : 1;
    var pk = playerPose(p);
    var pkShift = p.swing > 0 ? p.facing * 12 : 0;
    var slideKey = pk.indexOf('karate_slide') === 0;
    var pkHeight = slideKey
      ? (spriteReady(pk) ? images[pk].naturalHeight * SLIDE_DRAW_SCALE : 40)
      : p.h + 22;
    drawKeepAspect(pk, p.x + p.w / 2 + pkShift, p.y + p.h, pkHeight,
      p.facing < 0, slideKey ? 2 : undefined);
    ctx.globalAlpha = 1;
    if (p.whiff > 0) {
      var wp = 1 - p.whiff / 0.2, wa = whiffArc(p);
      game.fxWhiff = (game.fxWhiff || 0) + 1;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(43,58,71,' + (0.6 * (1 - wp)) + ')';
      ctx.lineWidth = wa.width + 4;
      ctx.beginPath();
      if (p.facing > 0) ctx.arc(wa.x, wa.y, wa.radius + wp * 10, -0.25, 1.25);
      else ctx.arc(wa.x, wa.y, wa.radius + wp * 10, Math.PI - 1.25, Math.PI + 0.25);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(199,211,222,' + (0.9 * (1 - wp)) + ')';
      ctx.lineWidth = wa.width;
      ctx.beginPath();
      if (p.facing > 0) ctx.arc(wa.x, wa.y, wa.radius + wp * 10, -0.25, 1.25);
      else ctx.arc(wa.x, wa.y, wa.radius + wp * 10, Math.PI - 1.25, Math.PI + 0.25);
      ctx.stroke();
    }

    // Kick: a white swoosh arc in front of the player 
    if (p.swing > 0 && p.whiff <= 0) {
      game.fxSwoosh = (game.fxSwoosh || 0) + 1;
      var prog = 1 - p.swing / 0.2;
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h * 0.6);
      ctx.scale(p.facing, 1);
      ctx.strokeStyle = 'rgba(255,255,255,' + (1 - prog) + ')';
      ctx.lineWidth = 8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, 38 + p.kickReach + prog * 22, -0.9, 0.9);
      ctx.stroke();
      ctx.restore();
    }

    for (var pi2 = 0; pi2 < game.particles.length; pi2++) {
      var pt = game.particles[pi2];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud(level) {
    // Phones: draw the HUD larger, in a narrower virtual width, clear of the pause button.
    ctx.save();
    ctx.scale(HUD_SCALE, HUD_SCALE);
    var W = 1920 / HUD_SCALE;
    var R = 30;
    var bar = ctx.createLinearGradient(0, 0, 0, 92);
    bar.addColorStop(0, 'rgba(3, 12, 26, 0.86)');
    bar.addColorStop(1, 'rgba(3, 12, 26, 0)');
    ctx.fillStyle = bar;
    ctx.fillRect(0, 0, W, 92);

    for (var i = 0; i < game.lives; i++) {
      drawKeepAspect('heart', 43 + i * 42, 58, 34, false);
    }
    text('x' + game.lives, 154, 42, 30, '#ffdfe6');

    text('SCORE ' + String(game.score).padStart(6, '0'), W / 2, 42, 34, '#eaf8ff', 'center');
    text('LEVEL ' + (game.levelIndex + 1) + '/' + LEVELS.length, W - R, 42, 28, '#bfe6ff', 'right');
    text(level.name.toUpperCase(), W - R, 74, 18, 'rgba(191,230,255,0.65)', 'right');

    var alive = 0;
    level.blocks.forEach(function (b) { if (b.alive) alive++; });
    text('ICE ' + alive, 30, 74, 18, 'rgba(191,230,255,0.65)');

    if (level.bear) {
      ctx.globalAlpha = 0.5 + Math.sin(game.time * 10) * 0.5;
      text('WHITE BEAR!', W / 2, 92, 26, '#ff5470', 'center');
      ctx.globalAlpha = 1;
    }

    if (!IS_TOUCH) {
      text('<- -> MOVE   UP/SPACE JUMP   Z/X KICK' + (SLIDE_ENABLED && level.index === 1 ? '   DOWN/S SLIDE' : '') + '   ESC PAUSE',
        30, 112, 19, 'rgba(210,238,255,0.55)');
    }
    ctx.restore();
  }

  function drawOverlayDark(alpha) {
    ctx.fillStyle = 'rgba(3, 10, 22,' + alpha + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function titleRows() {
    var rows = IS_TOUCH ? [
      'LEFT PAD          MOVE',
      'JUMP BUTTON       JUMP',
      'KICK BUTTON       KICK',
      'II BUTTON         PAUSE'
    ] : [
      'ARROWS / A D      MOVE',
      'UP / SPACE        JUMP',
      'Z / X             KICK',
      'ESC               PAUSE'
    ];
    if (SLIDE_ENABLED) rows.splice(3, 0, IS_TOUCH ? 'SLIDE BUTTON      SLIDE*' : 'DOWN / S          SLIDE*');
    return rows;
  }

  function titleRuleRect() {
    if (!checkpoint) return null;
    var line = 'CONTINUE RESTARTS ' + LEVELS[checkpoint.levelIndex].name.toUpperCase() + ' FROM ITS START';
    var size = IS_TOUCH ? 43 : 18;
    var w = line.length * 0.6 * size;
    return { x: (W - w) / 2, y: IS_TOUCH ? 790 : 891, w: w, h: size, line: line };
  }

  function titleMenuRects() {
    if (!checkpoint) return null;
    return {
      newrun: { x: W / 2 - 330, y: 792, w: 300, h: 70 },
      cont: { x: W / 2 + 30, y: 792, w: 300, h: 70 }
    };
  }

  function drawTitle(t) {
    drawOverlayDark(0.55);
    var g = ctx.createLinearGradient(0, 170, 0, 340);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#9fe6ff');
    g.addColorStop(1, '#4aa8d8');
    ctx.font = 'bold 138px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = g;
    ctx.fillText('ICE BREAKERS', W / 2, 250);
    text('CLASSIC REMAKE', W / 2, 340, 34, '#9fe6ff', 'center');
    text('Kick the ice. Climb the summit. Dodge the wildlife.', W / 2, 410, 26, 'rgba(220,243,255,0.8)', 'center');

    panel(W / 2 - 430, 470, 860, 300, 0.62);
    var rows = titleRows();
    for (var i = 0; i < rows.length; i++) {
      text(rows[i].slice(0, 18), W / 2 - 330, 516 + i * 40, 26, '#dff4ff', 'left');
      text(rows[i].slice(18), W / 2 + 20, 516 + i * 40, 26, '#dff4ff', 'left');
    }
    if (SLIDE_ENABLED) text('* FROSTBITE FIELDS', W / 2, 704, 18, 'rgba(255,214,120,0.85)', 'center');
    text('3 LIVES   -   5 SUMMITS   -   1 WHITE BEAR', W / 2, 740, 22, 'rgba(255,214,120,0.9)', 'center');

    if (checkpoint) {
      var rule = titleRuleRect();
      if (!IS_TOUCH) {
        var menu = titleMenuRects();
        panel(menu.newrun.x, menu.newrun.y, menu.newrun.w, menu.newrun.h, 0.72);
        text('NEW RUN (ENTER)', menu.newrun.x + 150, 827, 24, '#ffffff', 'center');
        panel(menu.cont.x, menu.cont.y, menu.cont.w, menu.cont.h, 0.72);
        text('CONTINUE (C)', menu.cont.x + 150, 827, 24, '#ffe680', 'center');
        text(rule.line, rule.x + rule.w / 2, rule.y + rule.h / 2, rule.h, '#bfe6ff', 'center');
      } else {
        text(rule.line, rule.x + rule.w / 2, rule.y + rule.h / 2, rule.h, '#bfe6ff', 'center');
      }
    } else {
      ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.45;
      text(IS_TOUCH ? 'TAP TO CLIMB' : 'PRESS ENTER TO CLIMB', W / 2, 850, 44, '#ffe680', 'center');
      ctx.globalAlpha = 1;
    }
    if (!IS_TOUCH) text('Best played with sound on. Arrow keys or WASD.', W / 2, 930, 20, 'rgba(200,230,250,0.5)', 'center');
  }

  function countdownValue() {
    var n = Math.ceil(game.introTimer - 0.3);
    return n > 3 ? 3 : n;
  }

  function drawIntro(level) {
    var x = W / 2;
    panel(x - 420, 360, 840, 300, 0.72);
    text('LEVEL ' + (game.levelIndex + 1), x, 420, 34, '#9fe6ff', 'center');
    text(level.name.toUpperCase(), x, 490, 58, '#ffffff', 'center');
    text('Grab the glowing vegetable at the summit.', x, 555, 24, 'rgba(220,243,255,0.8)', 'center');
    if (level.index === 1 && SLIDE_ENABLED) {
      text(IS_TOUCH ? 'SLIDE BUTTON: DODGE THROWN SIGNS' : 'DOWN / S: SLIDE UNDER THROWN SIGNS',
        x, 600, 22, 'rgba(255,214,120,0.9)', 'center');
    }
    if (game.gear) text('GEAR: ' + GEAR[game.gear].name, x, 638, 20, '#ffe680', 'center');
    var n = countdownValue();
    text(n > 0 ? String(n) : 'GO', x, 745, 92, '#ffe680', 'center');
  }

  function drawReward() {
    var o = beginOverlay();
    var cx = o.w / 2;
    var cw = Math.min(330, (o.w - 140) / 2 - 20), ch = 190;
    var top = o.h * 0.34;
    text('CHOOSE GEAR', cx, o.h * 0.16, 46, '#ffe680', 'center');
    text('CURRENT: ' + (game.gear ? GEAR[game.gear].name : 'NONE'), cx, o.h * 0.16 + 44, 22, '#bfe6ff', 'center');
    text('Swap it, or keep what you have.', cx, o.h * 0.16 + 74, 18, 'rgba(220,243,255,0.7)', 'center');

    for (var i = 0; i < GEAR_ORDER.length; i++) {
      var g = GEAR[GEAR_ORDER[i]];
      var x = cx - cw - 14 + i * (cw + 28);
      var sel = game.rewardCard === i;
      panel(x, top, cw, ch, sel ? 0.92 : 0.6);
      if (sel) {
        ctx.strokeStyle = '#ffe680';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 3, top + 3, cw - 6, ch - 6);
      }
      drawSprite(g.key, x + cw / 2 - 32, top + 18, 64, 64, false);
      text(g.name, x + cw / 2, top + 104, 20, '#ffffff', 'center');
      text(g.effect, x + cw / 2, top + 140, 15, 'rgba(220,243,255,0.8)', 'center');
      if (game.gear === GEAR_ORDER[i]) text('EQUIPPED', x + cw / 2, top + 168, 14, '#58e0c0', 'center');
    }

    var keep = game.rewardCard === GEAR_ORDER.length;
    var kx = cx - Math.min(o.w - 80, 620) / 2, kw = Math.min(o.w - 80, 620);
    panel(kx, top + ch + 22, kw, 62, keep ? 0.92 : 0.6);
    if (keep) {
      ctx.strokeStyle = '#ffe680';
      ctx.lineWidth = 4;
      ctx.strokeRect(kx + 3, top + ch + 25, kw - 6, 56);
    }
    text('KEEP ' + (game.gear ? GEAR[game.gear].name : 'STARTING MOVES'), cx, top + ch + 53, 19, '#ffffff', 'center');

    ctx.globalAlpha = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(IS_TOUCH ? 'PAD TO SELECT   TAP TO CONFIRM' : 'ARROWS SELECT   ENTER TO CONFIRM',
      cx, o.h - 70, 20, '#ffe680', 'center');
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function fmtTime(t) {
    var m = Math.floor(t / 60), sec = t - m * 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec.toFixed(1);
  }

  function padScore(n) { return String(n).padStart(6, '0'); }

  // Screens that must stay readable on a phone draw in the scaled HUD space.
  function beginOverlay() {
    var s = IS_TOUCH ? HUD_SCALE : 1;
    ctx.save();
    ctx.scale(s, s);
    var o = { w: W / s, h: H / s, s: s };
    ctx.fillStyle = 'rgba(3, 10, 22, 0.62)';
    ctx.fillRect(0, 0, o.w, o.h);
    return o;
  }

  function drawLevelClear() {
    var o = beginOverlay();
    var pw = Math.min(o.w - 60, 860), ph = Math.min(o.h - 100, 360);
    var px = (o.w - pw) / 2, py = (o.h - ph) / 2, cx = o.w / 2;
    var c = game.climb;
    panel(px, py, pw, ph, 0.8);
    text('SUMMIT CLEARED!', cx, py + 52, 48, '#ffe680', 'center');
    if (c.firstClear) text('FIRST CLEAR', cx, py + 92, 24, '#58e0c0', 'center');
    else if (c.newBest) text('NEW BEST', cx, py + 92, 24, '#58e0c0', 'center');
    var bestTime = best.mountains[game.levelIndex];
    text('TIME ' + fmtTime(c.time) + '   BEST ' + (bestTime > 0 ? fmtTime(bestTime) : '--'),
      cx, py + 138, 26, '#eaf8ff', 'center');
    text('GEMS ' + c.gems + '/' + c.gemsTotal + '   ENEMIES ' + c.enemies + '   LIVES LOST ' + c.livesLost,
      cx, py + 174, 23, '#bfe6ff', 'center');
    text('REACHED ' + (c.reachedSummit ? 'YES' : 'NO') + '   CLEARED ' + (c.cleared ? 'YES' : 'NO'),
      cx, py + 210, 24, '#58e0c0', 'center');
    text('SCORE ' + padScore(game.score) + '   BEST SCORE ' + padScore(best.score),
      cx, py + 252, 28, '#ffffff', 'center');
    ctx.globalAlpha = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(IS_TOUCH ? 'TAP TO CONTINUE' : 'ENTER TO CONTINUE', cx, py + ph - 34, 26, '#ffe680', 'center');
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGameOver() {
    var o = beginOverlay();
    var pw = Math.min(o.w - 60, 820), ph = Math.min(o.h - 80, 400);
    var px = (o.w - pw) / 2, py = (o.h - ph) / 2, cx = o.w / 2;
    var c = game.climb;
    panel(px, py, pw, ph, 0.82);
    text('GAME OVER', cx, py + 56, 58, '#ff5470', 'center');
    text('FINAL SCORE ' + padScore(game.score), cx, py + 116, 30, '#ffffff', 'center');
    text('SUMMIT REACHED ' + (c.reachedSummit ? 'YES' : 'NO') + '   CLEARED ' + (c.cleared ? 'YES' : 'NO'),
      cx, py + 158, 24, '#58e0c0', 'center');
    text('MOUNTAINS CLEARED ' + game.run.cleared + '/' + LEVELS.length, cx, py + 196, 23, '#bfe6ff', 'center');
    text('FURTHEST: MOUNTAIN ' + game.run.furthest, cx, py + 230, 23, '#bfe6ff', 'center');
    text('BEST SCORE ' + padScore(best.score), cx, py + 270, 25, '#ffe680', 'center');
    ctx.globalAlpha = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(IS_TOUCH ? 'TAP TO RESTART' : 'ENTER TO RESTART', cx, py + ph - 32, 26, '#ffe680', 'center');
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawWin() {
    var o = beginOverlay();
    var pw = Math.min(o.w - 60, 820), ph = Math.min(o.h - 100, 360);
    var px = (o.w - pw) / 2, py = (o.h - ph) / 2, cx = o.w / 2;
    panel(px, py, pw, ph, 0.82);
    text('YOU WIN!', cx, py + 62, 68, '#ffe680', 'center');
    text('ALL 5 SUMMITS CLEARED', cx, py + 126, 30, '#ffffff', 'center');
    text('FINAL SCORE ' + padScore(game.score), cx, py + 176, 30, '#ffffff', 'center');
    text('BEST SCORE ' + padScore(best.score), cx, py + 220, 26, '#ffe680', 'center');
    ctx.globalAlpha = 0.55 + Math.sin(game.time * 4) * 0.45;
    text(IS_TOUCH ? 'TAP TO PLAY AGAIN' : 'ENTER TO PLAY AGAIN', cx, py + ph - 34, 26, '#9fe6ff', 'center');
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPause() {
    drawOverlayDark(0.55);
    panel(W / 2 - 300, 430, 600, 200, 0.8);
    text('PAUSED', W / 2, 510, 64, '#ffffff', 'center');
    text(IS_TOUCH ? 'TAP II TO RESUME' : 'ESC TO RESUME', W / 2, 585, 28, '#9fe6ff', 'center');
  }

  function syncTitleMenu() {
    var nb = document.getElementById('newrun');
    var cb = document.getElementById('continue');
    if (nb) {
      nb.style.display = IS_TOUCH && game.state === 'title' ? 'block' : 'none';
      if (checkpoint) nb.textContent = 'NEW RUN';
    }
    if (cb) {
      cb.style.display = IS_TOUCH && game.state === 'title' && checkpoint ? 'block' : 'none';
      if (checkpoint) cb.textContent = 'CONTINUE: ' + LEVELS[checkpoint.levelIndex].name.toUpperCase() + ' — RESTARTS FROM START';
    }
  }

  function render(elapsed) {
    ctx.save();
    if (game.shake > 0) {
      var s = game.shake * 20;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    drawBackground(game.time);
    drawSnow(elapsed);

    if (game.level && game.player) {
      // Phones zoom in on the player so the stage is readable; the HUD stays fixed on screen.
      ctx.save();
      if (ZOOM > 1) {
        var p = game.player, vw = W / ZOOM, vh = H / ZOOM;
        var tx = Math.max(0, Math.min(W - vw, p.x + p.w / 2 - vw / 2));
        var ty = Math.max(0, Math.min(H - vh, p.y + p.h / 2 - vh * 0.55));
        // Frame-rate independent easing: composing 1-exp(-rate*h) steps equals one big step.
        var k = game.state === 'intro' || Math.abs(tx - cam.x) > vw / 2 || Math.abs(ty - cam.y) > vh / 2
          ? 1 : 1 - Math.exp(-6 * elapsed);
        cam.x += (tx - cam.x) * k;
        cam.y += (ty - cam.y) * k;
        ctx.scale(ZOOM, ZOOM);
        ctx.translate(-cam.x, -cam.y);
      }
      drawLevel(game.level, game.player, game.time);
      ctx.restore();
      if (IS_TOUCH && game.level.boss) drawBossCue(game.level.boss, bossCueTouchRect(), HUD_SCALE);
      if (IS_TOUCH && game.level) {
        var wn = game.level.nits.filter(function (n) { return n.warn > 0; });
        if (wn.length) {
          var wl = nitWarningLayout(wn);
          for (var ni2 = 0; ni2 < wl.length; ni2++) drawNitWarningScreenRect(wl[ni2]);
        }
      }
      drawHud(game.level);
    } else {
      for (var c = 0; c < COLS; c++) {
        for (var r = 0; r < 2; r++) {
          drawSprite('ice', c * BLOCK, FLOOR_Y[0] - r * BLOCK, BLOCK, BLOCK);
        }
      }
    }

    if (game.state === 'title') drawTitle(game.time);
    else if (game.state === 'intro') drawIntro(game.level);
    else if (game.state === 'levelclear') drawLevelClear();
    else if (game.state === 'gameover') drawGameOver();
    else if (game.state === 'win') drawWin();
    else if (game.state === 'reward') drawReward();
    else if (game.state === 'paused') drawPause();

    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(255, 80, 110,' + (game.flash * 0.7) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    ctx.restore();
  }

    function step() {
    game.time += DT;
    if (game.shake > 0) game.shake = Math.max(0, game.shake - DT);
    if (game.flash > 0) game.flash = Math.max(0, game.flash - DT);

    if (game.state === 'playing') {
      updatePlaying();
    } else if (game.state === 'intro') {
      game.introTimer -= DT;
      if (game.introTimer <= 0) game.state = 'playing';
    } else if (game.state === 'levelclear') {
      for (var i = game.particles.length - 1; i >= 0; i--) {
        var pt = game.particles[i];
        pt.life -= DT;
        pt.vy += GRAVITY * 0.55 * DT;
        pt.x += pt.vx * DT;
        if (pt.x < 0) { pt.x = 0; if (pt.vx < 0) pt.vx = 0; }
        if (pt.x > W) { pt.x = W; if (pt.vx > 0) pt.vx = 0; }
        pt.y += pt.vy * DT;
        if (pt.life <= 0) game.particles.splice(i, 1);
      }
    }
  }

  function frame(now) {
    if (!lastFrame) lastFrame = now;
    var elapsed = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    frameAccumulator += elapsed;
    // A long hidden gap is clamped, so camera and snow advance by display time, not callback count.
    var guard = 0;
    while (frameAccumulator >= DT && guard < 8) {
      step();
      frameAccumulator -= DT;
      guard++;
    }
    render(elapsed);
    syncTitleMenu();
    requestAnimationFrame(frame);
  }

    var BLOCKED = {
    ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1,
    KeyZ: 1, KeyX: 1, KeyS: 1
  };

  // Drop held directions and one-shot actions so nothing fires after resuming.
  function clearInputs() {
    keys = {};
    jumpQueued = false;
    jumpBuffer = 0;
    kickQueued = false;
    slideQueued = false;
    resetSteer();
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    clearInputs();
  }

  function onKeyDown(e) {
    if (BLOCKED[e.code]) e.preventDefault();

    if (game.state === 'title' && e.code === 'KeyC' && checkpoint) {
      audioCtx();
      continueRun();
      return;
    }

    if (e.code === 'Enter') {
      if (e.repeat) return;
      if (game.state === 'title' || game.state === 'gameover' || game.state === 'win') {
        audioCtx();
        startGame();
      } else if (game.state === 'levelclear') {
        if (game.levelIndex >= LEVELS.length - 1) nextLevel();
        else { game.state = 'reward'; game.rewardCard = 0; }
      } else if (game.state === 'reward') {
        confirmReward();
      }
      return;
    }

    // A held Escape repeats keydown; only the initial press may toggle pause.
    if (e.code === 'Escape') {
      if (e.repeat) return;
      if (game.state === 'playing') pauseGame();
      else if (game.state === 'paused') {
        game.state = 'playing';
        clearInputs();
      }
      return;
    }

    if (game.state === 'reward') {
      var slots = GEAR_ORDER.length + 1;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') game.rewardCard = (game.rewardCard + slots - 1) % slots;
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') game.rewardCard = (game.rewardCard + 1) % slots;
      else if (!e.repeat && (e.code === 'Space' || e.code === 'KeyZ' || e.code === 'KeyX')) confirmReward();
      return;
    }

    if (game.state !== 'playing') return;
    keys[e.code] = true;

    if (e.code === 'ArrowUp' || e.code === 'Space' || e.code === 'KeyW') {
      if (!e.repeat) { jumpQueued = true; jumpBuffer = JUMP_BUFFER; }
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      if (!e.repeat) kickQueued = true;
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      if (!e.repeat) slideQueued = true;
    }
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  // Pause when the tab or app is hidden, so enemies can't take lives while you're away.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pauseGame();
    clearInputs();
  });

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('keyup', onKeyUp);

  // Touch controls: on-screen buttons feed the same handlers as the keyboard.
  var ROTATED = root.matchMedia ? root.matchMedia('(orientation: portrait) and (pointer: coarse)') : { matches: false };
  // Stop pinch, double-tap and scroll gestures from zooming or moving the page.
  ['touchmove', 'gesturestart', 'dblclick'].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  var touchUI = document.getElementById('touch');
  if (touchUI) {
    var press = function (code) {
      onKeyDown({ code: code, repeat: false, preventDefault: function () {} });
    };
    var release = function (code) { onKeyUp({ code: code }); };
    // Capture keeps the release coming to the button; it can throw for pointers the browser no longer tracks.
    var capture = function (el, e) { try { el.setPointerCapture(e.pointerId); } catch (err) {} };
    Array.prototype.forEach.call(touchUI.querySelectorAll('[data-code]'), function (btn) {
      var code = btn.getAttribute('data-code');
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        press(code);
        capture(btn, e);
      });
      btn.addEventListener('pointerup', function () { release(code); });
      btn.addEventListener('pointercancel', function () { release(code); });
    });

    var newRunBtn = document.getElementById('newrun');
    var continueBtn = document.getElementById('continue');
    if (newRunBtn) newRunBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (game.state !== 'title') return;
      audioCtx(); startGame();
    });
    if (continueBtn) continueBtn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (game.state !== 'title' || !checkpoint) return;
      audioCtx(); continueRun();
    });

    // One pad for left/right; a neutral band keeps the last direction through thumb drift.
    var dpad = document.getElementById('dpad');
    steerPad = dpad;
    steerArrows = dpad.querySelectorAll('span');
    var setSteer = function (dir) {
      if (dir === steerDir) return;
      release('ArrowLeft');
      release('ArrowRight');
      steerDir = dir;
      if (dir < 0) press('ArrowLeft');
      else if (dir > 0) press('ArrowRight');
      paintSteer(dir);
    };
    var steer = function (e) {
      var r = steerPad.getBoundingClientRect();
      // In portrait the page is rotated 90deg (see index.html), so the pad's axis is the screen's Y.
      var half = ROTATED.matches ? r.height / 2 : r.width / 2;
      var offset = ROTATED.matches ? e.clientY - (r.top + half) : e.clientX - (r.left + half);
      if (Math.abs(offset) > half * 0.22) setSteer(offset < 0 ? -1 : 1);
    };
    var steerEnd = function (e) {
      if (steerId !== e.pointerId) return;
      resetSteer();
    };
    dpad.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (steerId !== null) return;
      steerId = e.pointerId;
      steer(e);
      capture(dpad, e);
    });
    dpad.addEventListener('pointermove', function (e) {
      if (e.pointerId !== steerId) return;
      e.preventDefault();
      steer(e);
    });
    dpad.addEventListener('pointerup', steerEnd);
    dpad.addEventListener('pointercancel', steerEnd);
    dpad.addEventListener('lostpointercapture', steerEnd);

    // Tap the screen to start or restart (same as Enter).
    canvas.addEventListener('pointerdown', function (e) {
      if (game.state === 'title' && checkpoint) {
        if (!IS_TOUCH && e) {
          var r = canvas.getBoundingClientRect();
          var x = (e.clientX - r.left) * W / r.width;
          var y = (e.clientY - r.top) * H / r.height;
          var menu = titleMenuRects();
          var inside = function (m) { return x >= m.x && x <= m.x + m.w && y >= m.y && y <= m.y + m.h; };
          if (inside(menu.cont)) { audioCtx(); continueRun(); }
          else if (inside(menu.newrun)) { audioCtx(); startGame(); }
        }
        return;
      }
      press('Enter'); release('Enter');
    });
  }

  root.addEventListener('blur', function () {
    pauseGame();
    clearInputs();
  });

  function resize() {
    // Body size, not window size: the body is rotated in portrait on phones.
    var scale = Math.min(document.body.clientWidth / W, document.body.clientHeight / H);
    canvas.style.width = Math.floor(W * scale) + 'px';
    canvas.style.height = Math.floor(H * scale) + 'px';
  }

    resetAmbient();
  loadAssets();
  resize();
  root.addEventListener('resize', resize);
  if (/[?&]debug(=|&|$)/.test(root.location.search)) {
    root.iceBreakers = {
      game: game, startGame: startGame, loadLevel: loadLevel,
      cam: cam, snow: snow, hurt: loseLife,
      best: function () { return best; },
      countdown: countdownValue,
      shotTrail: shotTrail,
      bossPose: bossPoseKey,
      bossCue: bossCueRect,
      bossCueTouch: bossCueTouchRect,
      bossCueTouchLabel: 32 * HUD_SCALE,
      bossDraw: function (b) { var h = bossDrawHeight(b); return { h: h, top: b.floorY - h }; },
      slideDrawScale: SLIDE_DRAW_SCALE,
      slideHitHeight: SLIDE_H,
      slideEnabled: function () { return SLIDE_ENABLED; },
      titleRows: titleRows,
      continueRun: continueRun,
      checkpoint: function () { return checkpoint; },
      titleMenu: titleMenuRects,
      titleRule: titleRuleRect,
      nitBadge: nitBadge,
      nitWarning: nitWarningScreenRect,
      nitWarningLayout: nitWarningLayout,
      nitPose: nitPose,
      whiffArc: whiffArc,
      setSlideEnabled: function (v) { SLIDE_ENABLED = !!v; },
      pose: playerPose,
      manifest: MANIFEST
    };
  }
  requestAnimationFrame(frame);

})(typeof window !== 'undefined' ? window : this);
