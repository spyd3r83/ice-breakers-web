'use strict';
// Hazard-free geometry and scoring route: title -> all five summits -> win with
// real movement inputs. Regular enemies, thrown shots and the bear are removed
// before climbing; the summit boss remains. It proves level geometry, goal
// collection, the single +500 clear bonus, level order and the final win state.
// It does NOT prove a playable route with hazards; that is tracked in #27.
// Run: node web/test_route.js
const assert = require('assert');
const G = require('./game.js');
const { boot } = require('./test_harness.js');

const FLOOR = G.FLOOR_Y;
const COLS = 30;
let checks = 0;
function ok(cond, label) { assert.ok(cond, label); checks++; console.log('PASS ' + label); }

// Pin level layout, enemy directions and bob phases for a repeatable route.
let seed = 297;
const realRandom = Math.random;
Math.random = function () {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const ROUTE = {
  0: { 1: [20, 1], 2: [25, -1], 3: [21, -1], 4: [17, -1] },
  1: { 1: [26, -1], 2: [21, -1], 3: [14, -1], 4: [9, 1] },
  2: { 1: [25, 1], 2: [27, -1], 3: [22, -1], 4: [16, -1] },
  3: { 1: [13, 1], 2: [17, -1], 3: [15, 1], 4: 'mover' },
  4: { 1: [16, 1], 2: [24, 1], 3: [27, -1], 4: [25, -1] }
};

function makeBot(env) {
  const g = env.g;
  const p = g.player;
  const down = {};
  const CODES = ['ArrowLeft', 'ArrowRight', 'Space', 'KeyZ', 'KeyS'];
  function set(code, on) {
    on = !!on;
    if (down[code] === on) return;
    down[code] = on;
    env.key(on ? 'keydown' : 'keyup', code);
  }
  function stop() { CODES.forEach((c) => set(c, false)); }
  function tap(code) { set(code, true); env.frames(1); set(code, false); }
  function center() { return p.x + p.w / 2; }
  function floor() {
    for (let f = 0; f < 5; f++) if (p.grounded && Math.abs(p.y + p.h - FLOOR[f]) < 3) return f;
    return -1;
  }
  function solidCol(col, f) {
    const b = g.level.blocks.get(col + ':' + FLOOR[f]);
    return !!(b && b.alive);
  }
  function supportedAt(x) {
    const y = p.y + p.h;
    for (let c = Math.floor(x / 64); c <= Math.floor((x + p.w - 1) / 64); c++) {
      const b = g.level.blocks.get(c + ':' + y);
      if (!b || !b.alive) {
        if (g.level.movers.some((m) => Math.abs(m.y - y) < 2 && x + p.w > m.x + 1 && x < m.x + m.w - 1)) return true;
        return false;
      }
    }
    return true;
  }
  function moveTo(tx, allowJump) {
    allowJump = allowJump !== false;
    let n = 0;
    while (Math.abs(center() - tx) > 5 && n++ < 1400) {
      const dir = tx > center() ? 1 : -1;
      if (allowJump && p.grounded && !supportedAt(p.x + dir * 24)) {
        stop();
        tap('Space');
        for (let i = 0; i < 26; i++) {
          set(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
          env.frames(1);
          if (p.grounded && i > 6) break;
        }
        stop();
        env.frames(2);
        continue;
      }
      set(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
      env.frames(1);
    }
    stop();
    env.frames(2);
  }
  function gapRun(f, gs) {
    const open = [];
    for (let c = gs; c < COLS; c++) {
      if (!solidCol(c, f)) open.push(c);
      else if (open.length) break;
    }
    return open.length ? open : [gs];
  }
  function climb(f, gs, side) {
    const open = gapRun(f, gs);
    const gapC = (open[0] + open[open.length - 1] + 1) * 32;
    moveTo(gapC);
    env.frames(4);
    let land = null;
    for (let off = 0; off < 12 && land === null; off++) {
      const c = side > 0 ? open[open.length - 1] + 1 + off : open[0] - 1 - off;
      if (c >= 0 && c < COLS && solidCol(c, f)) land = c;
    }
    assert.notStrictEqual(land, null, 'route has a landing column on floor ' + f);
    const lc = land * 64 + 32;
    tap('Space');
    for (let i = 0; i < 24; i++) {
      if (p.y + p.h < FLOOR[f] - 4) break;
      env.frames(1);
    }
    const dir = lc > center() ? 1 : -1;
    let n = 0;
    while (n++ < 180) {
      set(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
      env.frames(1);
      if (p.grounded) break;
      if (Math.abs(center() - lc) < 8) break;
    }
    stop();
    env.frames(120);
    return floor();
  }
  function moverClimb() {
    const m = g.level.movers.find((mv) => mv.y === FLOOR[3]);
    moveTo(1176, false);
    let n = 0;
    while ((m.x > 1219 || !p.grounded) && n++ < 900) env.frames(1);
    set('ArrowRight', true);
    for (let i = 0; i < 10; i++) env.frames(1);
    let bf = 0;
    while (p.x < 1220 && bf++ < 10) env.frames(1);
    stop();
    n = 0;
    while ((m.x > 1245 || !p.grounded) && n++ < 900) env.frames(1);
    tap('Space');
    for (let i = 0; i < 24; i++) {
      if (p.y + p.h < FLOOR[4] - 4) break;
      env.frames(1);
    }
    let dir = 1152 > center() ? 1 : -1;
    n = 0;
    while (n++ < 180) {
      set(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
      env.frames(1);
      if (p.grounded) break;
    }
    stop();
    env.frames(120);
    return floor();
  }
  return { env, g, p, set, stop, tap, center, floor, solidCol, supportedAt, moveTo, climb, moverClimb };
}

function pressEnter(env) { env.key('keydown', 'Enter'); env.key('keyup', 'Enter'); }

function hazardsOff(g) {
  g.level.topis.forEach((e) => { e.alive = false; });
  g.level.ladies.forEach((e) => { e.alive = false; });
  g.level.nits.length = 0;
  g.level.shots.length = 0;
  g.level.bearDelay = 0;
}

function loseOneLife(bot) {
  const env = bot.env, g = bot.g, p = bot.p;
  const sx = g.level.startX, sy = g.level.startY;
  env.frames(130);
  let n = 0;
  while (g.lives === 3 && n++ < 1500) {
    const alive = g.level.topis.filter((e) => e.alive);
    if (!alive.length) break;
    let t = alive[0];
    for (const e of alive) if (Math.abs(e.x + e.w / 2 - bot.center()) < Math.abs(t.x + t.w / 2 - bot.center())) t = e;
    const dir = t.x + t.w / 2 > bot.center() ? 1 : -1;
    bot.set(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
    env.frames(1);
  }
  bot.stop();
  env.frames(6);
  assert.strictEqual(g.lives, 2, 'the route loses exactly one life to a patrol');
  assert.ok(Math.abs(p.x - sx) <= 1 && Math.abs(p.y - sy) <= 1 && p.grounded,
    'respawn position matches stage start: got (' + p.x + ',' + p.y + ') expected (' + sx + ',' + sy + ') grounded=' + p.grounded);
  ok(p.x === sx && p.y === sy && p.grounded, 'one life loss respawns at the stage start position');
}

function fightBoss(bot) {
  const env = bot.env, g = bot.g, p = bot.p;
  let n = 0;
  while (!g.level.boss && n++ < 120) env.frames(1);
  assert.ok(g.level.boss, 'the Summit Storm boss wakes');
  const b = g.level.boss;
  while (Math.abs(830 - bot.center()) > 8 && n++ < 900 && g.state === 'playing') {
    const d = 830 - bot.center();
    bot.set(d > 0 ? 'ArrowRight' : 'ArrowLeft', true);
    if (b.mode === 'raise' && b.timer < 0.4 && p.grounded) bot.tap('Space');
    env.frames(1);
  }
  bot.stop();
  n = 0;
  while (b.mode !== 'dead' && g.state === 'playing' && n++ < 12000) {
    const diff = 830 - bot.center();
    if (Math.abs(diff) > 8) bot.set(diff > 0 ? 'ArrowRight' : 'ArrowLeft', true);
    else bot.stop();
    if (b.mode === 'raise' && b.timer < 0.6 && p.grounded) bot.tap('Space');
    if (b.mode === 'stuck' && p.facing < 0) bot.tap('ArrowRight');
    if (b.mode === 'stuck') bot.tap('KeyZ');
    env.frames(1);
  }
  bot.stop();
  assert.strictEqual(b.mode, 'dead', 'the route defeats the summit boss');
  ok(b.mode === 'dead', 'the route defeats the summit boss with real kicks');
}

const env = boot();
const g = env.g;
let bot;
let gems = 0;

pressEnter(env);
hazardsOff(g);
env.frames(240);
assert.strictEqual(g.state, 'playing', 'the run starts on Glacier Gate');
ok(g.state === 'playing' && g.levelIndex === 0, 'title input starts a fresh run on the first mountain');
bot = makeBot(env);

for (let level = 0; level < 5; level++) {
  assert.strictEqual(g.levelIndex, level, 'the run reaches mountain ' + (level + 1) + ' in order');
  assert.strictEqual(g.state, 'playing', 'mountain ' + (level + 1) + ' is in play');
  assert.strictEqual(g.gear, null, 'the scenario keeps the starting equipment');
  if (level === 1) loseOneLife(bot);
  hazardsOff(g);
  assert.strictEqual(g.lives, level === 0 ? 3 : 2,
    'mountain ' + (level + 1) + ' starts with the lives carried from the one loss');

  let guard = 0;
  while (bot.floor() < 4 && guard++ < 10) {
    const f = bot.floor();
    assert.ok(f >= 0, 'the climber stays on the geometry path');
    let t = f + 1, step;
    while (t <= 4 && !ROUTE[level][t]) t++;
    step = ROUTE[level][t];
    const got = step === 'mover' ? bot.moverClimb() : bot.climb(t, step[0], step[1]);
    assert.ok(got > f, 'the climb advances past floor ' + f);
    if (got > t) ok(got === 4 || got === t + 1, 'a jump carried the climb to floor ' + got);
  }
  assert.strictEqual(bot.floor(), 4, 'mountain ' + (level + 1) + ' summit reached on the hazard-free path');

  if (level === 4) fightBoss(bot);

  const goal = g.level.items.find((i) => i.kind === 'goal');
  assert.ok(goal && !goal.locked, 'the summit goal is available');
  const before = g.score;
  bot.moveTo(goal.x + goal.w / 2, false);
  for (let i = 0; i < 30 && g.state === 'playing'; i++) env.frames(1);
  assert.strictEqual(g.state, 'levelclear', 'touching the goal clears mountain ' + (level + 1));
  assert.strictEqual(g.score, before + 500, 'the clear bonus is awarded once');
  ok(g.climb.cleared && g.run.cleared === level + 1, 'run summary counts mountain ' + (level + 1) + ' once');
  gems += g.climb.gems;

  if (level < 4) {
    pressEnter(env);
    assert.strictEqual(g.state, 'reward', 'the gear choice follows the recap');
    env.key('keydown', 'ArrowLeft'); env.key('keyup', 'ArrowLeft');
    pressEnter(env);
    assert.strictEqual(g.state, 'intro', 'skipping gear resumes the next climb');
    if (level + 1 !== 1) hazardsOff(g);
    env.frames(240);
    assert.strictEqual(g.state, 'playing', 'the next mountain starts playing');
    bot = makeBot(env);
  }
}

pressEnter(env);
assert.strictEqual(g.state, 'win', 'the final continue shows the win screen');
ok(g.state === 'win' && g.run.cleared === 5, 'all five summits clear in one run');
ok(g.lives >= 1, 'the geometry scenario survives its life losses');
ok(g.climb.cleared && g.run.cleared === 5, 'the final climb is complete');
ok(g.score === 2500 + gems * 250, 'score is exactly five clear bonuses plus collected gems (' + gems + ')');

Math.random = realRandom;
console.log('\n' + checks + ' hazard-free geometry checks passed.');
