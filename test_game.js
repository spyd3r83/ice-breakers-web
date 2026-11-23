'use strict';
// Game-loop regression checks: runs game.js with stub browser objects and drives
// real key events through the real frame loop. Run: node test_game.js
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const G = require('./game.js');
const { boot, memStorage, readPngAlpha, readPngAlphaBuffer, alphaComponents } = require('./test_harness.js');

const src = fs.readFileSync(path.join(__dirname, 'game.js'), 'utf8');
let checks = 0;
function ok(cond, label) { assert.ok(cond, label); checks++; console.log('PASS ' + label); }

function startGame(env, levelIndex) {
  env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
  env.frames(210);
  if (levelIndex) { env.ib.loadLevel(levelIndex); env.frames(210); }
  assert.strictEqual(env.g.state, 'playing', 'level should be in play');
  return env.g;
}

function clearHazards(g) {
  g.level.topis.forEach((e) => { e.alive = false; });
  g.level.ladies.forEach((e) => { e.alive = false; });
  g.level.nits.length = 0;
  g.level.shots.length = 0;
  g.level.bearDelay = 0;
}

// Start a level with two kickable seals, one on each side of the player, and no other enemies.
function arena(facing) {
  const env = boot();
  const g = startGame(env);
  const L = g.level, p = g.player;
  L.nits.forEach((n) => { n.alive = false; });
  L.ladies.forEach((l) => { l.alive = false; });
  L.bearDelay = 0;
  p.facing = facing;
  const floorY = p.y + p.h;
  const seal = (x) => ({ x, y: floorY - 40, w: 52, h: 40, floorY, vx: 0, fillCd: 99, anim: 0, kind: 'topi', alive: true });
  const left = seal(p.x - 56), right = seal(p.x + p.w + 4);
  L.topis = [left, right];
  env.frames(180);
  return { env, g, p, left, right };
}

// #4: turning and kicking in the same tick hits the direction the player turned to.
for (const [start, turnKey, hitSide] of [[1, 'ArrowLeft', 'left'], [-1, 'ArrowRight', 'right']]) {
  const a = arena(start);
  a.env.key('keydown', turnKey);
  a.env.key('keydown', 'KeyZ');
  a.env.frames(1);
  const hit = a[hitSide], other = hitSide === 'left' ? a.right : a.left;
  ok(!hit.alive && other.alive, 'turn + kick in one tick hits the ' + hitSide + ' seal, not the one behind');
  ok(a.p.facing === (hitSide === 'left' ? -1 : 1), 'player faces the kicked seal');
}

// Stationary kicks still hit the side the player faces.
for (const facing of [1, -1]) {
  const a = arena(facing);
  a.env.key('keydown', 'KeyZ');
  a.env.frames(1);
  const front = facing > 0 ? a.right : a.left, back = facing > 0 ? a.left : a.right;
  ok(!front.alive && back.alive, 'stationary kick facing ' + (facing > 0 ? 'right' : 'left') + ' hits only the front seal');
}

// Turning during an active kick keeps the kick's facing until it ends.
{
  const a = arena(1);
  a.env.key('keydown', 'KeyZ');
  a.env.frames(1);
  a.env.key('keyup', 'KeyZ');
  a.env.key('keydown', 'ArrowLeft');
  a.env.frames(3);
  ok(a.p.facing === 1, 'facing stays locked while the kick is active');
  a.env.frames(15);
  ok(a.p.facing === -1, 'facing follows input once the kick ends');
}

// #11: auto-repeat while Escape is held must not resume the game.
{
  const env = boot();
  const g = startGame(env);
  env.key('keydown', 'Escape');
  ok(g.state === 'paused', 'Escape pauses on the initial press');
  env.key('keydown', 'Escape', true);
  env.key('keydown', 'Escape', true);
  env.frames(3);
  ok(g.state === 'paused', 'held Escape auto-repeat keeps the game paused');
  env.key('keyup', 'Escape');
  env.key('keydown', 'Escape');
  ok(g.state === 'playing', 'a fresh Escape press resumes');
}

// #11: a pending jump is dropped when pausing before the next tick.
{
  const env = boot();
  const g = startGame(env);
  const y0 = g.player.y;
  env.key('keydown', 'Space');
  env.key('keydown', 'Escape');
  env.frames(2);
  env.key('keyup', 'Escape');
  env.key('keydown', 'Escape');
  env.frames(2);
  ok(g.player.y === y0 && g.player.vy === 0, 'jump queued before pause does not fire on resume');
}

// #11: a pending kick is dropped when pausing before the next tick.
{
  const a = arena(1);
  a.env.key('keydown', 'KeyZ');
  a.env.key('keydown', 'Escape');
  a.env.frames(2);
  a.env.key('keyup', 'Escape');
  a.env.key('keydown', 'Escape');
  a.env.frames(2);
  ok(a.right.alive && a.left.alive, 'kick queued before pause does not fire on resume');
}

// #11: tab hide pauses and clears held movement; returning stays paused with no injected move.
{
  const env = boot();
  const g = startGame(env);
  env.key('keydown', 'ArrowRight');
  env.frames(2);
  env.visibility(true);
  const x = g.player.x;
  env.visibility(false);
  env.frames(2);
  ok(g.state === 'paused', 'returning from a hidden tab stays paused');
  ok(g.player.x === x, 'returning from a hidden tab injects no movement');
  env.key('keyup', 'ArrowRight');
  env.key('keydown', 'Escape');
  env.frames(2);
  ok(g.player.x === x, 'resume without fresh input does not move');
}

// #11: a single tap of the touch pause button pauses, a second tap resumes.
{
  const env = boot({ touch: true });
  const g = startGame(env);
  env.tap('Escape');
  ok(g.state === 'paused', 'one touch pause tap pauses');
  env.frames(2);
  ok(g.state === 'paused', 'pause holds after the touch release');
  env.tap('Escape');
  ok(g.state === 'playing', 'a second touch pause tap resumes');
}

// #11: losing window focus pauses and drops held input.
{
  const env = boot();
  const g = startGame(env);
  env.key('keydown', 'ArrowLeft');
  env.blur();
  ok(g.state === 'paused', 'blur pauses active play');
  const x = g.player.x;
  env.frames(2);
  ok(g.player.x === x, 'no movement while blurred');
}

// #9: the low slide dodges a thrown sign on Frostbite Fields and stays bounded.
{
  function field() {
    const env = boot();
    env.ib.setSlideEnabled(true);
    const g = startGame(env, 1);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    env.frames(150);
    g.lives = 3;
    const p = g.player;
    p.x = g.level.startX; p.y = g.level.startY; p.vy = 0; p.grounded = true; p.h = 60;
    p.sliding = false; p.slideT = 0; p.slideCd = 0; p.slideStart = 0; p.slideRecover = 0; p.facing = 1;
    return { env, g, p };
  }
  function signAt(x) {
    return { x, y: 950, w: 36, h: 36, vx: -300, life: 3, kind: 'sign' };
  }

  {
    const a = field();
    a.g.level.shots.push(signAt(a.p.x + 10));
    a.env.frames(1);
    ok(a.g.lives === 2, 'a sign hits a standing climber');
  }
  {
    const a = field();
    const signBottom = 950 + 36;
    const glideTop = G.FLOOR_Y[0] - a.env.ib.slideHitHeight;
    ok(glideTop - signBottom === 1,
      'glide top ' + glideTop + ' clears sign bottom ' + signBottom + ' by 1 px');
    a.g.level.shots.push(signAt(a.p.x + 130));
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(30);
    ok(a.g.lives === 3, 'a well-timed slide clears the thrown sign with the matching hitbox');
    ok(!a.p.sliding && a.p.h === 60, 'the slide finishes standing again');
  }
  {
    const a = field();
    a.g.level.shots.push(signAt(a.p.x + 20));
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(1);
    ok(a.g.lives === 2, 'a late slide is still hit during the crouch');
  }
  {
    const a = field();
    const x0 = a.p.x;
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(30);
    const dist = Math.abs(a.p.x - x0);
    ok(dist > 40 && dist < 300, 'slide distance is bounded (' + Math.round(dist) + ' px)');
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(5);
    ok(!a.p.sliding, 'the slide cooldown blocks an immediate second slide');
  }
  {
    const a = field();
    a.env.tap('ArrowDown');
    a.env.frames(7);
    ok(a.p.sliding && a.p.h === 29, 'the touch SLIDE button starts a low slide');
  }
  {
    const a = field();
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(5);
    a.env.key('keydown', 'Space');
    a.env.frames(1);
    ok(a.p.vy >= 0, 'jump is ignored during a slide');
  }
  {
    const a = field();
    a.env.key('keydown', 'Space');
    a.env.frames(1);
    ok(a.p.vy < 0, 'the normal jump route still works');
  }
  {
    const a = field();
    a.g.player.x = 520; a.g.player.y = 824 - 60;
    a.env.frames(1);
    a.env.key('keydown', 'ArrowLeft');
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(10);
    ok(a.g.player.y > 824 - 60, 'sliding off an edge enters the existing fall');
  }
  {
    const a = field();
    a.g.player.x = 1200;
    a.g.level.blocks.set('20:956', { x: 1280, y: 956, w: 64, h: 64, alive: true });
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(20);
    ok(a.g.player.x <= 1237, 'a wall still stops the slide');
  }
  {
    const a = field();
    a.g.level.topis.push({
      x: a.g.player.x + 60, y: a.g.player.y + 20, w: 52, h: 40,
      floorY: a.g.player.y + a.g.player.h, vx: 0, fillCd: 99, anim: 0, kind: 'topi', alive: true
    });
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(20);
    ok(a.g.lives < 3, 'running into an enemy still uses normal collision while sliding');
  }
  {
    const a = field();
    a.env.ib.loadLevel(0);
    a.env.frames(210);
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(7);
    ok(!a.g.player.sliding, 'slide is not enabled before Frostbite Fields');
  }
}

// Re-review: glide art height and recover phase.
{
  const env = boot();
  env.ib.startGame();
  const png = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'karate_slide.png'));
  ok(png.w > png.h * 3, 'the glide art is a flat, wide pose');
  const drawn = png.h * env.ib.slideDrawScale;
  ok(Math.abs(drawn - env.ib.slideHitHeight) <= 4,
    'drawn glide height ' + drawn.toFixed(1) + ' matches SLIDE_H ' + env.ib.slideHitHeight);
  const low = { sliding: true, slideStart: 0, slideT: 0.05, slideRecover: 0, swing: 0, grounded: true, moving: false, frame: 0 };
  ok(env.ib.pose(low) === 'karate_slide', 'the low glide does not show recover while sliding');
  const after = { sliding: false, slideStart: 0, slideT: 0, slideRecover: 0.1, swing: 0, grounded: true, moving: false, frame: 0 };
  ok(env.ib.pose(after) === 'karate_slide_recover', 'recover shows only after stand-up begins');
  after.slideRecover = 0;
  ok(env.ib.pose(after) !== 'karate_slide_recover', 'recover clears after its short window');
}

// #12: camera tracking and snowfall advance with elapsed time, not render callbacks.
{
  function sample(hz) {
    const env = boot({ touch: true });
    const g = startGame(env);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    const snow = env.ib.snow[0];
    snow.x = 500; snow.y = 0; snow.vx = -20; snow.vy = 0; snow.r = 2; snow.p = 0;
    env.key('keydown', 'ArrowRight');
    env.advance(600, hz);
    const right = { x: g.player.x, camX: env.ib.cam.x, camY: env.ib.cam.y };
    env.key('keyup', 'ArrowRight');
    env.key('keydown', 'ArrowLeft');
    env.advance(500, hz);
    const reverse = { x: g.player.x, camX: env.ib.cam.x };
    env.key('keyup', 'ArrowLeft');
    env.key('keydown', 'Space');
    env.frames(1);
    env.key('keyup', 'Space');
    env.advance(300, hz);
    const airborne = { y: g.player.y, camY: env.ib.cam.y, grounded: g.player.grounded };
    env.advance(1200, hz);
    const landed = { y: g.player.y, camY: env.ib.cam.y, grounded: g.player.grounded };
    // Two far teleports guarantee at least one large-jump snap at every rate.
    g.player.x = 0;
    env.frames(1);
    g.player.x = 1920 - g.player.w;
    env.frames(1);
    const snapX = env.ib.cam.x;
    // A long hidden gap advances camera/snow only by the clamped elapsed time.
    const snowX = snow.x;
    env.visibility(true);
    env.frameAt(env.now ? env.now() + 2000 : 0);
    const afterGap = { camX: env.ib.cam.x, snow: snow.x };
    return { right, reverse, airborne, landed, snapX, afterGap, snowX };
  }
  const a = sample(30), b = sample(60), c = sample(120);
  ok(Math.abs(a.right.x - b.right.x) <= 12 && Math.abs(b.right.x - c.right.x) <= 12,
    '60/30/120 Hz runs reach the same player position');
  ok(Math.abs(a.right.camX - b.right.camX) <= 12 && Math.abs(b.right.camX - c.right.camX) <= 12,
    'camera center matches after the same elapsed time at 30/60/120 Hz');
  ok(Math.abs(a.reverse.camX - c.reverse.camX) <= 12, 'camera center matches after a sudden reversal');
  ok(Math.abs(a.airborne.camY - c.airborne.camY) <= 12, 'camera tracks a jump consistently');
  ok(a.landed.grounded && c.landed.grounded && Math.abs(a.landed.camY - c.landed.camY) <= 12,
    'camera matches after landing');
  ok(Math.abs(a.snapX - 1047.27) < 0.1 && a.snapX === b.snapX && b.snapX === c.snapX,
    'large jumps still snap the camera at every rate');
  ok(Math.abs(a.afterGap.camX - c.afterGap.camX) <= 12 &&
    Math.abs(a.afterGap.snow - c.afterGap.snow) <= 1,
    'returning after a hidden tab advances camera and snow consistently');
  ok(Math.abs(a.afterGap.snow - (a.snowX - 2)) <= 1.5, 'snow moves by elapsed time, not callback count');
}

// #6: summit recap, per-mountain bests and run summary.
{
  function quiet(g) {
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
  }
  function touchItem(env, g, kind) {
    const it = g.level.items.find((i) => i.kind === kind);
    g.player.x = it.x; g.player.y = it.y;
    env.frames(2);
    return it;
  }
  function pressEnter(env) {
    env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
  }

  {
    const env = boot();
    const g = startGame(env);
    ok(g.climb && g.climb.gems === 0 && g.climb.enemies === 0 && g.climb.livesLost === 0 && g.climb.gemsTotal === 1,
      'a climb starts with zeroed counters and one gem available');
    quiet(g);
    env.frames(30);
    const t1 = g.climb.time;
    env.key('keydown', 'Escape');
    env.frames(120);
    env.key('keyup', 'Escape'); env.key('keydown', 'Escape');
    ok(Math.abs(g.climb.time - t1) < 0.03, 'climb time excludes pause');
    const before = g.score;
    touchItem(env, g, 'gem');
    ok(g.climb.gems === 1 && g.score === before + 250, 'collecting a gem updates the counter and score once');
    touchItem(env, g, 'goal');
    ok(g.state === 'levelclear', 'touching the goal opens the summit recap');
    ok(g.climb.cleared && g.run.cleared === 1 && g.score === before + 750, 'clearing awards +500 exactly once');
    const t = g.climb.time;
    ok(t > 0, 'recap shows active climb time');
    env.frames(180);
    ok(g.state === 'levelclear' && g.score === before + 750, 'the recap waits for input and cannot double count');
    pressEnter(env);
    ok(g.state === 'reward', 'continue opens the gear reward once');
    pressEnter(env);
    ok(g.state === 'intro' && g.levelIndex === 1, 'one confirm advances exactly one level');
    pressEnter(env);
    ok(g.state === 'intro', 'a second Enter during the intro cannot skip a screen');
    env.frames(210);
    const store = env.ib.best();
    ok(store.mountains['0'] === t, 'the first clear records a per-mountain best time');
  }

  {
    const env = boot();
    let g = startGame(env);
    quiet(g);
    env.frames(210);
    const clearedScore = (g.score = 320);
    env.ib.hurt('test');
    ok(g.lives === 2 && g.climb.livesLost === 1, 'losing a life updates the climb counter');
    env.frames(150); env.ib.hurt('test');
    env.frames(150); env.ib.hurt('test');
    ok(g.state === 'gameover', 'an early loss ends the run');
    ok(env.ib.best().score === clearedScore, 'game over records the run score as a personal best');
    ok(g.run.cleared === 0 && g.run.furthest === 1, 'the run summary separates cleared summits from furthest mountain');
    pressEnter(env);
    g = env.g;
    ok(g.state === 'intro' && g.score === 0 && g.run.cleared === 0 && g.climb.gems === 0,
      'a new run starts at zero while bests are kept');
    ok(env.ib.best().score === clearedScore, 'earlier best score survives a worse run');
  }

  {
    const env = boot();
    const g = startGame(env, 1);
    quiet(g);
    env.frames(210);
    touchItem(env, g, 'gem');
    env.ib.hurt('test');
    ok(g.lives === 2 && g.climb.gems === 1 && g.climb.livesLost === 1,
      'a respawn within a stage keeps earned counters');
  }

  {
    const env = boot();
    const g = startGame(env);
    quiet(g);
    g.player.x = 800; g.player.y = 248 - 60;
    env.frames(2);
    ok(g.climb.reachedSummit && !g.climb.cleared, 'reaching the summit is tracked separately from clearing it');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    quiet(g);
    env.frames(20);
    touchItem(env, g, 'goal');
    const t = g.climb.time;
    const env2 = boot({ storage: store });
    ok(env2.ib.best().mountains['0'] === t, 'per-mountain best survives a reload');
    store.setItem('icebreakers.best.v1', '{not json');
    const env3 = boot({ storage: store });
    env3.key('keydown', 'Enter'); env3.key('keyup', 'Enter'); env3.frames(210);
    ok(env3.g.state === 'playing' && env3.ib.best().mountains['0'] === undefined,
      'an invalid stored entry is ignored and play continues');
  }

  {
    const env = boot({ storage: 'blocked' });
    const g = startGame(env);
    quiet(g);
    touchItem(env, g, 'goal');
    ok(g.state === 'levelclear' && env.ib.best().mountains['0'] > 0,
      'blocked storage still allows play and keeps in-memory bests');
  }

  {
    const env = boot();
    const g = startGame(env);
    quiet(g);
    for (let i = 0; i < 5; i++) {
      if (i) { env.ib.loadLevel(i); env.frames(210); quiet(g); }
      if (i === 4) {
        g.player.x = 800; g.player.y = 248 - 60;
        env.frames(2);
        for (let k = 0; k < 3; k++) {
          g.level.boss.mode = 'stuck'; g.level.boss.timer = 10;
          env.key('keydown', 'KeyZ'); env.frames(1); env.frames(25);
        }
      }
      touchItem(env, g, 'goal');
      assert.strictEqual(g.state, 'levelclear', 'each summit reaches the recap');
      env.frames(2);
      pressEnter(env);
      if (i < 4) {
        assert.strictEqual(g.state, 'reward', 'each of the first four summits offers gear');
        pressEnter(env);
        assert.strictEqual(g.state, 'intro', 'confirming gear resumes the climb');
      }
    }
    ok(g.state === 'win' && g.run.cleared === 5 && g.score === 2500, 'a full run clears five summits and records 5 x 500');
    ok(env.ib.best().score === 2500, 'the final clear records the completed-run score');
    pressEnter(env);
    ok(g.state === 'intro' && g.score === 0, 'the win screen starts a fresh run');
  }
}

// #7: gear reward between climbs, applied to the next player.
{
  function quiet(g) {
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
  }
  function touchItem(env, g, kind) {
    const it = g.level.items.find((i) => i.kind === kind);
    g.player.x = it.x; g.player.y = it.y;
    env.frames(2);
  }
  function pressEnter(env) { env.key('keydown', 'Enter'); env.key('keyup', 'Enter'); }
  function clearToReward(env, g) {
    quiet(g);
    touchItem(env, g, 'goal');
    pressEnter(env);
    assert.strictEqual(g.state, 'reward', 'clearing a summit opens the gear choice');
  }
  function bootWithGear(gear) {
    const env = boot();
    const g = startGame(env);
    if (gear) {
      g.gear = gear;
      env.ib.loadLevel(0);
    }
    clearHazards(g);
    env.frames(210);
    return { env, g, p: g.player };
  }
  function sealAt(a, dx) {
    const p = a.g.player, floorY = p.y + p.h;
    const seal = { x: p.x + p.w + dx, y: floorY - 40, w: 52, h: 40, floorY, vx: 0, fillCd: 99, anim: 0, kind: 'topi', alive: true };
    quiet(a.g);
    a.g.level.topis = [seal];
    return seal;
  }

  {
    const env = boot();
    const g = startGame(env);
    ok(Math.abs(g.player.coyoteMax - 0.09) < 1e-9, 'a short ledge grace is part of the base move set');
    clearToReward(env, g);
    ok(g.gear === null, 'the reward screen starts with no gear equipped');
    pressEnter(env);
    ok(g.state === 'intro' && g.gear === 'cleats', 'choosing ice cleats equips them once');
    ok(Math.abs(g.player.coyoteMax - 0.2) < 1e-9, 'ice cleats extend the base ledge grace');
  }

  {
    const env = boot();
    const g = startGame(env);
    clearToReward(env, g);
    env.key('keydown', 'ArrowRight');
    env.key('keyup', 'ArrowRight');
    ok(g.rewardCard === 1, 'the reward selection moves between cards');
    pressEnter(env);
    ok(g.gear === 'boots' && g.player.kickReach === 18, 'kick boots extend the next player');
  }

  {
    const base = bootWithGear(null);
    const baseSeal = sealAt(base, 72);
    base.env.key('keydown', 'KeyZ');
    base.env.frames(1);
    ok(baseSeal.alive, 'a base kick misses a seal 72 px past the player');

    const boots = bootWithGear('boots');
    const bootsSeal = sealAt(boots, 72);
        boots.env.key('keydown', 'KeyZ');
    boots.env.frames(1);
        ok(!bootsSeal.alive, 'kick boots reach a seal 72 px past the player');
  }

  {
    const a = bootWithGear('boots');
    a.env.frames(210);
    a.env.ib.hurt('test');
    ok(a.g.player.kickReach === 18, 'gear survives losing a life');
    a.env.ib.loadLevel(1);
    a.env.frames(210);
    ok(a.g.gear === 'boots' && a.g.player.kickReach === 18, 'gear carries into the next climb');
    a.env.ib.startGame();
    ok(a.g.gear === null && a.g.player.kickReach === 0 && Math.abs(a.g.player.coyoteMax - 0.09) < 1e-9,
      'a new game restores the starting move set');
  }

  {
    const env = boot();
    const g = startGame(env);
    clearToReward(env, g);
    env.key('keydown', 'ArrowLeft');
    env.key('keyup', 'ArrowLeft');
    ok(g.rewardCard === 2, 'the reward selection reaches the keep option');
    pressEnter(env);
    ok(g.gear === null && g.state === 'intro', 'keeping the current gear resumes the climb unchanged');
  }

  {
    const env = boot({ touch: true });
    const g = startGame(env);
    clearToReward(env, g);
    env.tapCanvas();
    ok(g.state === 'intro' && g.gear === 'cleats', 'touch tap confirms the default gear card');
  }

  {
    const env = boot({ touch: true });
    const g = startGame(env);
    clearToReward(env, g);
    env.tapDpad(false);
    env.releaseDpad();
    ok(g.rewardCard === 1, 'the touch pad selects the second gear card');
    env.tapCanvas();
    ok(g.gear === 'boots' && g.state === 'intro', 'touch confirms the selected gear');
  }

  {
    const env = boot();
    const g = startGame(env);
    quiet(g);
    touchItem(env, g, 'goal');
    pressEnter(env);
    ok(g.state === 'reward', 'one input opens the reward and stops there');
    pressEnter(env);
    env.ib.loadLevel(1); env.frames(210);
    quiet(g);
    touchItem(env, g, 'goal');
    pressEnter(env);
    env.key('keydown', 'ArrowRight'); env.key('keyup', 'ArrowRight');
    pressEnter(env);
    ok(g.gear === 'boots', 'a later reward swaps the equipped item');
  }
}

// #5: the Summit Storm boss sheds layers and unlocks the goal.
{
  function quiet(g) {
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
  }
  function bossArena(gear) {
    const env = boot();
    const g = startGame(env, 4);
    quiet(g);
    if (gear) { g.gear = gear; env.ib.loadLevel(4); env.frames(210); quiet(g); }
    const p = g.player;
    p.x = 200; p.y = 248 - 60; p.vy = 0; p.grounded = true;
    env.frames(2);
    env.frames(140);
    g.lives = 3;
    return { env, g, p, b: g.level.boss };
  }
  function kick(env, g) {
    env.key('keydown', 'KeyZ'); env.frames(1); env.frames(25);
    return g.level.boss;
  }

  {
    const a = bossArena();
    ok(a.b && a.b.mode === 'reveal' || a.b.mode === 'idle' || a.b.mode === 'raise' || a.b.mode === 'stuck',
      'standing on the fifth summit wakes the boss');
    const goal = a.g.level.items.find((i) => i.kind === 'goal');
    ok(goal.locked, 'the summit goal is locked while the boss lives');
    a.g.player.x = goal.x; a.g.player.y = goal.y;
    a.env.frames(1);
    ok(a.g.state === 'playing' && !goal.taken, 'a premature goal touch does not clear the summit');
  }

  {
    const a = bossArena();
    a.b.mode = 'raise'; a.b.timer = 0.001;
    a.p.x = 780; a.p.y = 188; a.p.grounded = true;
    a.env.frames(1);
    ok(a.g.lives === 2, 'a grounded climber takes the slam');
  }

  {
    const a = bossArena();
    a.b.mode = 'raise'; a.b.timer = 0.001;
    a.p.x = 780; a.p.y = 60; a.p.grounded = false; a.p.vy = 0;
    a.env.frames(1);
    ok(a.g.lives === 3, 'jumping over the slam avoids damage');
  }

  {
    const a = bossArena();
    a.b.mode = 'idle'; a.b.timer = 10;
    a.p.x = 780; a.p.y = 188;
    kick(a.env, a.g);
    ok(a.b.layers === 3, 'kicks outside the opening do not damage the boss');
    a.b.mode = 'stuck'; a.b.timer = 10;
    kick(a.env, a.g);
    ok(a.b.layers === 2, 'a kick in the opening removes exactly one layer');
    ok(a.b.form === 1 && a.b.w === 115 && a.b.h === 123 && a.b.y + a.b.h === 248,
      'the cracked form shrinks and keeps its feet on the floor');
  }

  {
    const a = bossArena();
    a.p.x = 800; a.p.y = 188;
    for (let k = 0; k < 2; k++) { a.b.mode = 'stuck'; a.b.timer = 10; kick(a.env, a.g); }
    ok(a.b.form === 2 && a.b.w === 98, 'the final form is the small exposed core');
    a.b.mode = 'stuck'; a.b.timer = 10;
    kick(a.env, a.g);
    ok(a.b.mode === 'dead', 'the last clean hit frees the vegetable');
    const goal = a.g.level.items.find((i) => i.kind === 'goal');
    ok(!goal.locked, 'the goal unlocks after the boss dies');
    const before = a.g.score;
    a.g.player.x = goal.x; a.g.player.y = goal.y;
    a.env.frames(1);
    ok(a.g.state === 'levelclear' && a.g.score === before + 500, 'the freed goal awards +500 once');
    a.env.key('keydown', 'Enter'); a.env.key('keyup', 'Enter');
    ok(a.g.state === 'win', 'the final summit still ends the run');
  }

  {
    const a = bossArena();
    a.b.mode = 'raise'; a.b.timer = 0.001;
    a.p.x = 780; a.p.y = 188; a.p.grounded = true;
    a.env.frames(1);
    ok(a.p.x === 14 * 64 + 4 && a.p.y === 188 && a.p.grounded, 'a life loss restarts on the protected summit floor');
    ok(a.b.layers === 3 && a.b.form === 0 && a.b.mode === 'idle', 'retry restores the full boss encounter');
    let intact = true;
    for (let c = 13; c <= 16; c++) {
      const blk = a.g.level.blocks.get(c + ':' + 248);
      if (!blk || !blk.alive) intact = false;
    }
    ok(intact, 'the summit arena floor stays intact on retry');
  }

  {
    const a = bossArena();
    a.b.mode = 'raise'; a.b.timer = 0.5;
    const t = a.b.timer;
    a.env.key('keydown', 'Escape');
    a.env.frames(60);
    ok(a.b.timer === t, 'pausing freezes the boss cycle');
    a.env.key('keyup', 'Escape'); a.env.key('keydown', 'Escape');
    a.env.frames(1);
    ok(a.b.timer < t, 'resuming continues the boss cycle');
  }

  {
    const a = bossArena();
    a.b.mode = 'reveal'; a.b.timer = 1.0;
    a.g.level.topis.push({
      x: a.p.x, y: a.p.y + 10, w: 52, h: 40, floorY: 248, vx: 0, fillCd: 99, anim: 0, kind: 'topi', alive: true
    });
    a.env.frames(2);
    ok(a.g.lives === 3, 'another hazard cannot hurt the player during the reveal');
  }

  {
    function coreReach(gear) {
      const a = bossArena(gear);
      const b = a.b;
      b.layers = 1; b.form = 2; b.w = 98; b.h = 108;
      b.x = 960 - 49; b.y = 248 - 108;
      b.mode = 'stuck'; b.timer = 10;
      a.p.x = 785; a.p.y = 188;
      kick(a.env, a.g);
      return b;
    }
    ok(coreReach(null).layers === 1, 'the core sits out of base kick reach from the approach spot');
    ok(coreReach('boots').layers === 0, 'kick boots let the starting player reach the core');
  }
}

// #3: a visible 3-2-1 countdown runs before each climb starts.
{
  const env = boot();
  const g = env.g;
  env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
  ok(g.state === 'intro' && g.introTimer > 3, 'a climb opens on a counting-down intro');
  ok(env.ib.countdown() === 3, 'the countdown starts at 3');
  const x0 = g.player.x;
  env.key('keydown', 'ArrowRight');
  env.frames(66);
  ok(g.player.x === x0, 'movement is held during the countdown');
  ok(env.ib.countdown() === 2, 'the countdown shows 2');
  env.frames(66);
  ok(env.ib.countdown() === 1, 'the countdown shows 1');
  env.frames(60);
  ok(env.ib.countdown() === 0 && g.state === 'intro', 'the countdown ends on GO');
  env.frames(12);
  ok(g.state === 'playing', 'the climb starts after the countdown');
  env.key('keyup', 'ArrowRight');
  env.ib.loadLevel(1);
  ok(g.state === 'intro' && env.ib.countdown() === 3, 'every new climb counts down again');
}

// #18: forgiving early and late jump taps.
{
  function jumpArena(level) {
    const env = boot();
    const g = startGame(env, level || 0);
    clearHazards(g);
    env.frames(210);
    return { env, g, p: g.player };
  }
  function tap(env) { env.key('keydown', 'Space'); env.key('keyup', 'Space'); }

  {
    const a = jumpArena();
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < -G.JUMP_VELOCITY + G.GRAVITY * G.DT + 1, 'an ordinary grounded tap keeps the full jump');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.frames(2);
    ok(a.p.vy < 0, 'a tap on the landing frame still jumps');
  }

  {
    const a = jumpArena();
    a.p.y = 600; a.p.vy = 0; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.frames(10);
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false;
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0, 'an expired early tap does nothing on landing');
  }

  {
    const a = jumpArena();
    a.p.x = 528; a.p.y = 824 - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    a.env.key('keydown', 'ArrowRight');
    a.env.frames(8);
    a.env.key('keyup', 'ArrowRight');
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < 0, 'a fresh tap just after stepping off a ledge jumps');
  }

  {
    const a = jumpArena();
    a.p.x = 528; a.p.y = 824 - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    a.env.key('keydown', 'ArrowRight');
    a.env.frames(8);
    a.env.key('keyup', 'ArrowRight');
    a.env.frames(6);
    tap(a.env);
    a.env.frames(2);
    ok(a.p.vy >= 0, 'the ledge grace expires after about 90 ms');
  }

  {
    const a = jumpArena(1);
    const m = a.g.level.movers[0];
    a.p.x = m.x + 100; a.p.y = m.y - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    ok(a.p.grounded && Math.abs(a.p.coyote - 0.09) < 1e-9, 'standing on moving ice arms the ledge grace');
    a.g.level.movers.length = 0;
    a.env.frames(1);
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < 0, 'the ledge grace works after leaving moving ice');
  }

  {
    const a = jumpArena();
    tap(a.env);
    a.env.frames(1);
    a.env.key('keydown', 'Space', true);
    a.env.key('keydown', 'Space', true);
    a.env.frames(90);
    ok(a.p.grounded && a.p.vy === 0, 'a held or repeated jump button cannot double jump');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.key('keydown', 'Escape');
    a.env.frames(2);
    a.env.key('keyup', 'Escape'); a.env.key('keydown', 'Escape');
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0, 'pausing clears a buffered jump tap');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.ib.hurt('test');
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0 && a.g.lives === 2, 'losing a life clears a buffered jump tap');
  }
}

// #25: patrols get distinct, ice-supported starting positions on every map.
{
  function snapshot(index, rnd) {
    const env = boot();
    env.ib.startGame();
    const prev = Math.random;
    if (rnd !== undefined) Math.random = () => rnd;
    env.ib.loadLevel(index);
    Math.random = prev;
    return env.g.level;
  }
  function groundOf(level) { return level.topis.concat(level.ladies); }
  function overlappingPairs(level) {
    const all = groundOf(level);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].floorY === all[j].floorY && G.rectsOverlap(all[i], all[j])) return [all[i], all[j]];
      }
    }
    return null;
  }
  function onIce(level, e) {
    const cols = [Math.floor(e.x / 64), Math.floor((e.x + e.w - 1) / 64)];
    for (let c = cols[0]; c <= cols[1]; c++) {
      const b = level.blocks.get(c + ':' + e.floorY);
      if (!b || !b.alive) return false;
    }
    return true;
  }

  for (const rnd of [0.1, 0.9]) {
    for (let i = 0; i < 5; i++) {
      const level = snapshot(i, rnd);
      ok(!overlappingPairs(level), 'level ' + (i + 1) + ' has no overlapping ground patrols (random ' + rnd + ')');
      const all = groundOf(level);
      ok(all.every((e) => onIce(level, e)), 'level ' + (i + 1) + ' patrols stand on intact ice (random ' + rnd + ')');
      const start = { x: level.startX - 140, y: 926, w: 320, h: 90 };
      ok(!all.some((e) => G.rectsOverlap(e, start)), 'level ' + (i + 1) + ' keeps the player start clear (random ' + rnd + ')');
    }
  }

  {
    const level = snapshot(4, 0.1);
    const floorOne = level.ladies.filter((l) => l.floorY === 824);
    ok(floorOne.length === 2, 'Summit Storm starts two throwers on the same floor');
    ok(floorOne[0].x !== floorOne[1].x && !G.rectsOverlap(floorOne[0], floorOne[1]),
      'Summit Storm fixture keeps the two throwers apart');
    ok(floorOne[0].x !== 198 || floorOne[1].x !== 198, 'Summit Storm no longer stacks both throwers at x=198');
  }

  for (let i = 1; i < 5; i++) {
    const level = snapshot(i);
    const first = level.ladies[0];
    ok(Math.abs(first.x - level.startX) < 436 && first.y > 340 && first.y < 840,
      'level ' + (i + 1) + ' leaves the first patrol visible at phone zoom');
  }

  {
    const level = snapshot(4);
    const floorOne = level.ladies.filter((l) => l.floorY === 824);
    ok(!G.rectsOverlap(floorOne[0], floorOne[1]), 'a normal Summit Storm run separates its throwers');
  }
}

// #14: the gem's visible art matches its pickup area.
{
  function gemLevel() {
    const env = boot();
    const g = startGame(env);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    const item = g.level.items.find((i) => i.kind === 'gem');
    return { env, g, item, p: g.player };
  }

  {
    const a = gemLevel();
    const call = a.env.draws.filter((d) => d[1] === 18 && d[2] === 23 && d[3] === 34 && d[4] === 24).pop();
    ok(!!call, 'the gem draws only its visible source region');
    ok(call && call[7] === 44 && call[8] === 31, 'the visible gem is drawn at 44 x 31 logical pixels');
    ok(a.item.w === 52 && a.item.h === 40, 'the pickup box gives symmetric forgiveness around the art');
    const bob = Math.sin(a.g.time * 3 + a.item.phase) * 5;
    const artCx = call[5] + call[7] / 2, artCy = call[6] + call[8] / 2;
    const pickCx = a.item.x + a.item.w / 2, pickCy = a.item.y + a.item.h / 2 + bob;
    ok(Math.abs(artCx - pickCx) < 0.01 && Math.abs(artCy - pickCy) < 0.01,
      'the visible gem and pickup box share a centre through the bob');
    ok(call[5] - a.item.x === 4 && (a.item.h - call[8]) / 2 === 4.5,
      'the pickup box leaves four pixels of forgiveness around the art');
  }

  {
    const a = gemLevel();
    a.p.x = a.item.x - a.p.w - 1; a.p.y = a.item.y;
    a.env.frames(1);
    ok(!a.item.taken, 'a near miss to the left does not collect');
    a.p.x = a.item.x; a.p.y = a.item.y - a.p.h - 8;
    a.env.frames(1);
    ok(!a.item.taken, 'a near miss above does not collect');
  }

  {
    const a = gemLevel();
    const before = a.g.score;
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 4;
    a.env.frames(1);
    ok(a.item.taken && a.g.score === before + 250, 'the gem still awards 250 once');
    a.env.frames(5);
    ok(a.g.score === before + 250, 'the gem cannot be collected twice');
  }

  {
    const a = gemLevel();
    a.item.phase = 2.1;
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 39; a.p.vy = 0; a.p.grounded = false;
    a.g.time = (Math.PI * 2 - 2.1 - Math.PI / 2) / 3;
    a.env.frames(1);
    ok(!a.item.taken, 'at the bottom of the bob a low graze misses');
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 39; a.p.vy = 0; a.p.grounded = false;
    a.g.time = (Math.PI * 2 - 2.1 + Math.PI / 2) / 3;
    a.env.frames(1);
    ok(a.item.taken, 'the pickup follows the gem as it bobs down');
  }
}

// #15: projectile art has no painted speed lines; code lines trail the throw.
{
  const sign = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'sign_clean.png'));
  const clip = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'clip_clean.png'));
  const signOrig = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'sign.png'));
  const clipOrig = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'clip.png'));
  ok(alphaComponents(sign, 40).length === 1, 'the clean sign has no detached speed-line strokes');
  ok(alphaComponents(clip, 40).length === 1, 'the clean clipboard has no detached speed-line strokes');
  ok(alphaComponents(signOrig, 40).length > 1 && alphaComponents(clipOrig, 40).length > 1,
    'the original sheets do carry detached strokes, so the pixel check is real');

  const env = boot();
  const g = startGame(env);
  g.level.topis.forEach((e) => { e.alive = false; });
  g.level.ladies.forEach((e) => { e.alive = false; });
  g.level.nits.length = 0;
  g.level.bearDelay = 0;
  env.frames(1);
  const drawn = env.draws.filter((d) => d.length === 5 && d[3] === 36 && d[4] === 36);
  ok(drawn.length === 0, 'no cropped projectile region is drawn');
  ok(/sign_clean\.png$/.test(env.ib.manifest.sign) && /clip_clean\.png$/.test(env.ib.manifest.clip),
    'the manifest points at the line-free copies');

  const shots = [
    { x: 600, y: 600, w: 36, h: 36, vx: 300, life: 3, kind: 'sign' },
    { x: 800, y: 600, w: 36, h: 36, vx: -300, life: 3, kind: 'sign' },
    { x: 600, y: 680, w: 36, h: 36, vx: 300, life: 3, kind: 'clip' },
    { x: 800, y: 680, w: 36, h: 36, vx: -300, life: 3, kind: 'clip' }
  ];
  g.level.shots = shots;
  env.frames(1);
  const fullDraws = env.draws.filter((d) => d.length === 5 && d[3] === 36 && d[4] === 36);
  ok(fullDraws.length >= 4, 'projectiles are drawn from the full clean image');
  for (const sh of shots) {
    const segs = env.ib.shotTrail(sh);
    if (sh.vx > 0) ok(segs.every((q) => q.x1 < sh.x && q.x2 < q.x1), 'a rightward ' + sh.kind + ' trails lines on the left');
    else ok(segs.every((q) => q.x1 > sh.x + sh.w && q.x2 > q.x1), 'a leftward ' + sh.kind + ' trails lines on the right');
  }
  ok(shots.every((sh) => sh.w === 36 && sh.h === 36), 'speed lines do not change projectile size');
}

// Every manifest path must exist on disk.
{
  const env = boot();
  env.ib.startGame();
  const missing = Object.keys(env.ib.manifest).filter((k) =>
    !fs.existsSync(path.join(__dirname, env.ib.manifest[k])));
  ok(missing.length === 0, 'every MANIFEST path exists on disk' + (missing.length ? ': ' + missing.join(', ') : ''));
  let total = 0;
  for (const f of ['intact', 'fractured', 'core']) for (const p of ['idle', 'warn', 'impact', 'stuck']) {
    total += fs.statSync(path.join(__dirname, 'assets', 'sprites', 'guardian_' + f + '_' + p + '.png')).size;
  }
  ok(total < 700 * 1024, 'guardian PNG total stays under 700 KB (' + total + ')');
  const feet = [];
  for (const p of ['idle', 'warn', 'impact', 'stuck']) {
    const png = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'guardian_fractured_' + p + '.png'));
    const w = png.w, h = png.h;
    let legWhite = 0;
    for (let y = Math.floor(h * 0.7); y < h; y++) for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      if (png.rgba[j + 3] > 40 && png.rgba[j] > 245 && png.rgba[j + 1] > 245 && png.rgba[j + 2] > 245) legWhite++;
    }
    ok(legWhite <= 10, 'fractured ' + p + ' leg band has at most 10 near-white pixels (' + legWhite + ')');
    const band = Math.max(1, Math.floor(h * 0.08));
    let a = 1e9, b = -1;
    for (let y = h - band; y < h; y++) for (let x = 0; x < w; x++) {
      if (png.alpha[y * w + x] > 40) { a = Math.min(a, x); b = Math.max(b, x); }
    }
    feet.push((a + b) / 2);
  }
  ok(Math.max(...feet) - Math.min(...feet) <= 2,
    'fractured frames share a foot/shadow centre (' + feet.join(', ') + ')');

  for (const form of ['intact', 'fractured', 'core']) for (const pose of ['idle', 'warn', 'impact', 'stuck']) {
    const png = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'guardian_' + form + '_' + pose + '.png'));
    const w = png.w, h = png.h;
    const isWhite = (x, y) => {
      const j = (y * w + x) * 4;
      return png.rgba[j + 3] > 40 && png.rgba[j] > 245 && png.rgba[j + 1] > 245 && png.rgba[j + 2] > 245;
    };
    const seen = new Uint8Array(w * h);
    let trapped = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isWhite(x, y) || seen[i]) continue;
      const stack = [i]; seen[i] = 1; const pts = [];
      while (stack.length) {
        const j = stack.pop(); pts.push(j);
        const jy = Math.floor(j / w), jx = j - jy * w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (isWhite(nx, ny) && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      const miny = Math.min(...pts.map((j) => Math.floor(j / w)));
      if (pts.length >= 40 && miny >= Math.floor(h * 0.45)) trapped += pts.length;
    }
    ok(trapped <= 10, form + ' ' + pose + ' has at most 10 trapped lower-white pixels (' + trapped + ')');
  }
}

// #3: a visible 3-2-1 countdown runs before each climb starts.
{
  const env = boot();
  const g = env.g;
  env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
  ok(g.state === 'intro' && g.introTimer > 3, 'a climb opens on a counting-down intro');
  ok(env.ib.countdown() === 3, 'the countdown starts at 3');
  const x0 = g.player.x;
  env.key('keydown', 'ArrowRight');
  env.frames(66);
  ok(g.player.x === x0, 'movement is held during the countdown');
  ok(env.ib.countdown() === 2, 'the countdown shows 2');
  env.frames(66);
  ok(env.ib.countdown() === 1, 'the countdown shows 1');
  env.frames(60);
  ok(env.ib.countdown() === 0 && g.state === 'intro', 'the countdown ends on GO');
  env.frames(12);
  ok(g.state === 'playing', 'the climb starts after the countdown');
  env.key('keyup', 'ArrowRight');
  env.ib.loadLevel(1);
  ok(g.state === 'intro' && env.ib.countdown() === 3, 'every new climb counts down again');
}

// #18: forgiving early and late jump taps.
{
  function jumpArena(level) {
    const env = boot();
    const g = startGame(env, level || 0);
    clearHazards(g);
    env.frames(210);
    return { env, g, p: g.player };
  }
  function tap(env) { env.key('keydown', 'Space'); env.key('keyup', 'Space'); }

  {
    const a = jumpArena();
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < -G.JUMP_VELOCITY + G.GRAVITY * G.DT + 1, 'an ordinary grounded tap keeps the full jump');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.frames(2);
    ok(a.p.vy < 0, 'a tap on the landing frame still jumps');
  }

  {
    const a = jumpArena();
    a.p.y = 600; a.p.vy = 0; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.frames(10);
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false;
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0, 'an expired early tap does nothing on landing');
  }

  {
    const a = jumpArena();
    a.p.x = 528; a.p.y = 824 - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    a.env.key('keydown', 'ArrowRight');
    a.env.frames(8);
    a.env.key('keyup', 'ArrowRight');
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < 0, 'a fresh tap just after stepping off a ledge jumps');
  }

  {
    const a = jumpArena();
    a.p.x = 528; a.p.y = 824 - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    a.env.key('keydown', 'ArrowRight');
    a.env.frames(8);
    a.env.key('keyup', 'ArrowRight');
    a.env.frames(6);
    tap(a.env);
    a.env.frames(2);
    ok(a.p.vy >= 0, 'the ledge grace expires after about 90 ms');
  }

  {
    const a = jumpArena(1);
    const m = a.g.level.movers[0];
    a.p.x = m.x + 100; a.p.y = m.y - 60; a.p.vy = 0; a.p.grounded = true;
    a.env.frames(1);
    ok(a.p.grounded && Math.abs(a.p.coyote - 0.09) < 1e-9, 'standing on moving ice arms the ledge grace');
    a.g.level.movers.length = 0;
    a.env.frames(1);
    tap(a.env);
    a.env.frames(1);
    ok(a.p.vy < 0, 'the ledge grace works after leaving moving ice');
  }

  {
    const a = jumpArena();
    tap(a.env);
    a.env.frames(1);
    a.env.key('keydown', 'Space', true);
    a.env.key('keydown', 'Space', true);
    a.env.frames(90);
    ok(a.p.grounded && a.p.vy === 0, 'a held or repeated jump button cannot double jump');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.key('keydown', 'Escape');
    a.env.frames(2);
    a.env.key('keyup', 'Escape'); a.env.key('keydown', 'Escape');
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0, 'pausing clears a buffered jump tap');
  }

  {
    const a = jumpArena();
    a.p.y = 1016 - 62; a.p.vy = 200; a.p.grounded = false; a.p.coyote = 0;
    tap(a.env);
    a.env.ib.hurt('test');
    a.env.frames(4);
    ok(a.p.grounded && a.p.vy === 0 && a.g.lives === 2, 'losing a life clears a buffered jump tap');
  }
}

// #25: patrols get distinct, ice-supported starting positions on every map.
{
  function snapshot(index, rnd) {
    const env = boot();
    env.ib.startGame();
    const prev = Math.random;
    if (rnd !== undefined) Math.random = () => rnd;
    env.ib.loadLevel(index);
    Math.random = prev;
    return env.g.level;
  }
  function groundOf(level) { return level.topis.concat(level.ladies); }
  function overlappingPairs(level) {
    const all = groundOf(level);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (all[i].floorY === all[j].floorY && G.rectsOverlap(all[i], all[j])) return [all[i], all[j]];
      }
    }
    return null;
  }
  function onIce(level, e) {
    const cols = [Math.floor(e.x / 64), Math.floor((e.x + e.w - 1) / 64)];
    for (let c = cols[0]; c <= cols[1]; c++) {
      const b = level.blocks.get(c + ':' + e.floorY);
      if (!b || !b.alive) return false;
    }
    return true;
  }

  for (const rnd of [0.1, 0.9]) {
    for (let i = 0; i < 5; i++) {
      const level = snapshot(i, rnd);
      ok(!overlappingPairs(level), 'level ' + (i + 1) + ' has no overlapping ground patrols (random ' + rnd + ')');
      const all = groundOf(level);
      ok(all.every((e) => onIce(level, e)), 'level ' + (i + 1) + ' patrols stand on intact ice (random ' + rnd + ')');
      const start = { x: level.startX - 140, y: 926, w: 320, h: 90 };
      ok(!all.some((e) => G.rectsOverlap(e, start)), 'level ' + (i + 1) + ' keeps the player start clear (random ' + rnd + ')');
    }
  }

  {
    const level = snapshot(4, 0.1);
    const floorOne = level.ladies.filter((l) => l.floorY === 824);
    ok(floorOne.length === 2, 'Summit Storm starts two throwers on the same floor');
    ok(floorOne[0].x !== floorOne[1].x && !G.rectsOverlap(floorOne[0], floorOne[1]),
      'Summit Storm fixture keeps the two throwers apart');
    ok(floorOne[0].x !== 198 || floorOne[1].x !== 198, 'Summit Storm no longer stacks both throwers at x=198');
  }

  for (let i = 1; i < 5; i++) {
    const level = snapshot(i);
    const first = level.ladies[0];
    ok(Math.abs(first.x - level.startX) < 436 && first.y > 340 && first.y < 840,
      'level ' + (i + 1) + ' leaves the first patrol visible at phone zoom');
  }

  {
    const level = snapshot(4);
    const floorOne = level.ladies.filter((l) => l.floorY === 824);
    ok(!G.rectsOverlap(floorOne[0], floorOne[1]), 'a normal Summit Storm run separates its throwers');
  }
}

// #14: the gem's visible art matches its pickup area.
{
  function gemLevel() {
    const env = boot();
    const g = startGame(env);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    const item = g.level.items.find((i) => i.kind === 'gem');
    return { env, g, item, p: g.player };
  }

  {
    const a = gemLevel();
    const call = a.env.draws.filter((d) => d[1] === 18 && d[2] === 23 && d[3] === 34 && d[4] === 24).pop();
    ok(!!call, 'the gem draws only its visible source region');
    ok(call && call[7] === 44 && call[8] === 31, 'the visible gem is drawn at 44 x 31 logical pixels');
    ok(a.item.w === 52 && a.item.h === 40, 'the pickup box gives symmetric forgiveness around the art');
    const bob = Math.sin(a.g.time * 3 + a.item.phase) * 5;
    const artCx = call[5] + call[7] / 2, artCy = call[6] + call[8] / 2;
    const pickCx = a.item.x + a.item.w / 2, pickCy = a.item.y + a.item.h / 2 + bob;
    ok(Math.abs(artCx - pickCx) < 0.01 && Math.abs(artCy - pickCy) < 0.01,
      'the visible gem and pickup box share a centre through the bob');
    ok(call[5] - a.item.x === 4 && (a.item.h - call[8]) / 2 === 4.5,
      'the pickup box leaves four pixels of forgiveness around the art');
  }

  {
    const a = gemLevel();
    a.p.x = a.item.x - a.p.w - 1; a.p.y = a.item.y;
    a.env.frames(1);
    ok(!a.item.taken, 'a near miss to the left does not collect');
    a.p.x = a.item.x; a.p.y = a.item.y - a.p.h - 8;
    a.env.frames(1);
    ok(!a.item.taken, 'a near miss above does not collect');
  }

  {
    const a = gemLevel();
    const before = a.g.score;
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 4;
    a.env.frames(1);
    ok(a.item.taken && a.g.score === before + 250, 'the gem still awards 250 once');
    a.env.frames(5);
    ok(a.g.score === before + 250, 'the gem cannot be collected twice');
  }

  {
    const a = gemLevel();
    a.item.phase = 2.1;
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 39; a.p.vy = 0; a.p.grounded = false;
    a.g.time = (Math.PI * 2 - 2.1 - Math.PI / 2) / 3;
    a.env.frames(1);
    ok(!a.item.taken, 'at the bottom of the bob a low graze misses');
    a.p.x = a.item.x + 4; a.p.y = a.item.y + 39; a.p.vy = 0; a.p.grounded = false;
    a.g.time = (Math.PI * 2 - 2.1 + Math.PI / 2) / 3;
    a.env.frames(1);
    ok(a.item.taken, 'the pickup follows the gem as it bobs down');
  }
}

// #10: the twelve guardian pose frames are sliced, sized and wired into the boss.
{
  const FORMS = ['intact', 'fractured', 'core'];
  const POSES = ['idle', 'warn', 'impact', 'stuck'];
  const HEIGHTS = { intact: 193, fractured: 195, core: 159 };
  function pngSize(file) {
    const b = fs.readFileSync(path.join(__dirname, 'assets', 'sprites', file));
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
  }
  const dims = {};
  for (const form of FORMS) {
    let width = null;
    for (const pose of POSES) {
      const file = 'guardian_' + form + '_' + pose + '.png';
      const p = pngSize(file);
      dims[form + '_' + pose] = p;
      ok(p.bytes > 1000 && p.bytes < 120 * 1024, file + ' is small (' + p.bytes + ' bytes)');
      ok(p.h === HEIGHTS[form], file + ' is ' + HEIGHTS[form] + ' px tall');
      if (width === null) width = p.w;
      else ok(p.w === width, file + ' shares its form canvas width');
    }
  }

  {
    const env = boot();
    env.ib.startGame();
    const g = env.g;
    const b = { form: 0, mode: 'idle' };
    ok(env.ib.bossPose(b) === 'guardian_intact_idle', 'intact idle pose is registered');
    b.mode = 'raise'; ok(env.ib.bossPose(b) === 'guardian_intact_warn', 'the slam warning uses the warn pose');
    b.mode = 'impact'; ok(env.ib.bossPose(b) === 'guardian_intact_impact', 'the slam uses the impact pose');
    b.mode = 'stuck'; ok(env.ib.bossPose(b) === 'guardian_intact_stuck', 'the opening uses the stuck pose');
    b.form = 1; ok(env.ib.bossPose(b) === 'guardian_fractured_stuck', 'the fractured form uses its own frames');
    b.form = 2; ok(env.ib.bossPose(b) === 'guardian_core_stuck', 'the core form uses its own frames');
    ok(g.state === 'intro', 'pose wiring does not change game state');
  }

  {
    const env = boot();
    const g = startGame(env, 4);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    const p = g.player;
    p.x = 200; p.y = 188; p.grounded = true;
    env.frames(2);
    const b = g.level.boss;
    b.mode = 'raise'; b.timer = 0;
    p.y = 60; p.grounded = false; p.vy = 0;
    env.frames(1);
    ok(b.mode === 'impact', 'the slam lands in the impact pose');
    env.frames(15);
    ok(b.mode === 'stuck', 'the impact settles into the stuck opening');
  }

  {
    function bossForms() {
      const env = boot();
      const g = startGame(env, 4);
      g.level.topis.forEach((e) => { e.alive = false; });
      g.level.ladies.forEach((e) => { e.alive = false; });
      g.level.nits.length = 0;
      g.level.shots.length = 0;
      g.level.bearDelay = 0;
      const p = g.player;
      p.x = 200; p.y = 188; p.grounded = true;
      env.frames(2);
      const b = g.level.boss;
      p.x = 800; p.y = 188;
      return { env, g, p, b };
    }
    const a = bossForms();
    const sizes = [];
    sizes.push({ form: 'intact', w: a.b.w, h: a.b.h });
    a.b.mode = 'stuck'; a.b.timer = 10;
    a.env.key('keydown', 'KeyZ'); a.env.frames(1); a.env.frames(25);
    sizes.push({ form: 'fractured', w: a.b.w, h: a.b.h });
    a.b.mode = 'stuck'; a.b.timer = 10;
    a.env.key('keydown', 'KeyZ'); a.env.frames(1); a.env.frames(25);
    sizes.push({ form: 'core', w: a.b.w, h: a.b.h });
    ok(sizes[0].h > sizes[1].h && sizes[1].h > sizes[2].h,
      'drawn boss height decreases intact > fractured > core');
    for (const s of sizes) {
      const art = dims[s.form + '_idle'];
      const drawnW = s.h * art.w / art.h;
      ok(Math.abs(s.w - drawnW) / drawnW <= 0.1,
        'the ' + s.form + ' damage width is within 10% of the drawn body');
    }

    {
      function alphaAt(file, h) {
        const png = readPngAlpha(file);
        const iw = Math.max(1, Math.round(png.w * h / png.h));
        const pts = [];
        for (let y = 0; y < h; y++) for (let x = 0; x < iw; x++) {
          const sx = Math.min(png.w - 1, Math.floor(x * png.w / iw));
          const sy = Math.min(png.h - 1, Math.floor(y * png.h / h));
          if (png.alpha[sy * png.w + sx] > 40) pts.push([x, y]);
        }
        return { w: iw, pts: pts };
      }
      const ia = alphaAt(path.join(__dirname, 'assets', 'sprites', 'guardian_intact_idle.png'), 195);
      const fa = alphaAt(path.join(__dirname, 'assets', 'sprites', 'guardian_fractured_idle.png'), 195);
      const W = Math.max(ia.w, fa.w);
      const A = new Set(ia.pts.map((q) => (q[0] + Math.floor((W - ia.w) / 2)) + ':' + q[1]));
      const B = new Set(fa.pts.map((q) => (q[0] + Math.floor((W - fa.w) / 2)) + ':' + q[1]));
      let inter = 0;
      for (const k of A) if (B.has(k)) inter++;
      const iou = inter / (A.size + B.size - inter);
      ok(iou < 0.85, 'the fractured silhouette differs from intact (IoU ' + iou.toFixed(2) + ')');
    }

    a.b.layers = 1; a.b.form = 2; a.b.w = 99; a.b.h = 108;
    a.b.x = 960 - 49.5; a.b.y = 248 - 108; a.b.mode = 'stuck'; a.b.timer = 10;
    a.p.y = 188;
    a.p.x = a.b.x - 116;
    a.env.key('keydown', 'KeyZ'); a.env.frames(1); a.env.frames(25);
    ok(a.b.layers === 1, 'the core is not hit from just outside its drawn edge');
    a.p.x = a.b.x - 112;
    a.env.key('keydown', 'KeyZ'); a.env.frames(1);
    ok(a.b.layers === 0, 'the core is kickable right at its drawn edge');
  }

  {
    const env = boot();
    env.ib.startGame();
    const g = env.g;
    env.ib.loadLevel(4);
    env.frames(210);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    g.player.x = 200; g.player.y = 188; g.player.grounded = true;
    env.frames(2);
    ok(g.level.boss.facing === -1, 'the boss faces a climber on its left');
    g.player.x = 1100; g.player.y = 188;
    env.frames(1);
    ok(g.level.boss.facing === 1, 'the boss mirrors to face a climber on its right');
  }
}

// #20: touch pad feedback, neutral drift and per-pointer steering.
{
  function padArena() {
    const env = boot({ touch: true });
    const g = startGame(env);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    return { env, g, p: g.player };
  }

  {
    const a = padArena();
    const x0 = a.p.x;
    a.env.dpadDown(1, 0, 90);
    ok(a.env.highlight()[1] && !a.env.highlight()[0], 'pressing the right zone lights only the right arrow');
    a.env.frames(3);
    ok(a.p.x > x0, 'steering right moves the player');
    a.env.dpadMove(1, 0, 66);
    ok(a.env.highlight()[1], 'the neutral centre keeps the last direction');
    a.env.frames(2);
    a.env.dpadMove(1, 0, 76);
    ok(a.env.highlight()[1], 'minor drift inside the neutral band keeps direction');
    a.env.dpadMove(1, 0, 20);
    ok(a.env.highlight()[0] && !a.env.highlight()[1], 'a deliberate slide across the pad reverses promptly');
    const x1 = a.p.x;
    a.env.frames(3);
    ok(a.p.x < x1, 'the reversed direction moves the player left');
    a.env.dpadUp(1);
    ok(!a.env.highlight()[0] && !a.env.highlight()[1], 'releasing the steering finger clears the highlight');
    const x2 = a.p.x;
    a.env.frames(3);
    ok(a.p.x === x2, 'releasing the steering finger stops movement');
  }

  {
    const a = padArena();
    a.env.dpadDown(1, 0, 20);
    a.env.dpadDown(2, 0, 90);
    ok(a.env.highlight()[0] && !a.env.highlight()[1], 'a second finger cannot take over steering');
    a.env.dpadUp(2);
    ok(a.env.highlight()[0], 'releasing the second finger does not cancel steering');
    a.env.frames(2);
    a.env.dpadUp(1);
    ok(!a.env.highlight()[0] && !a.env.highlight()[1], 'releasing the tracked finger stops steering');
  }

  {
    const a = padArena();
    a.env.dpadDown(1, 0, 20);
    a.env.dpadCancel(1);
    ok(!a.env.highlight()[0] && !a.env.highlight()[1], 'pointer cancellation stops steering');
    const x = a.p.x;
    a.env.frames(2);
    ok(a.p.x === x, 'a cancelled pointer does not keep moving');
  }

  {
    const a = padArena();
    a.env.dpadDown(1, 0, 20);
    a.env.tap('Escape');
    ok(a.g.state === 'paused' && !a.env.highlight()[0], 'pausing clears steering and its highlight');
    a.env.key('keydown', 'Escape'); a.env.key('keyup', 'Escape');
    const x = a.p.x;
    a.env.frames(2);
    ok(a.p.x === x && !a.env.highlight()[0], 'resuming does not reactivate a held pad');
  }

  {
    const a = padArena();
    a.env.dpadDown(1, 0, 20);
    a.env.visibility(true);
    ok(!a.env.highlight()[0] && !a.env.highlight()[1], 'backgrounding clears steering');
  }

  {
    const a = padArena();
    const x = a.p.x;
    a.env.dpadDown(1, 0, 20);
    a.env.tap('Space');
    a.env.frames(2);
    ok(a.p.vy < 0 && a.p.x < x, 'jump works while the pad is steering');
  }

  {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    ok(/#dpad span\.on/.test(html), 'the pad has a distinct active-arrow style');
    ok(/#pause \{ top:/.test(html) && !/#pause \{ bottom:/.test(html), 'pause is moved out of the steering thumb area');
    ok(/id="jump"[\s\S]*?class="ico"/.test(html) && /id="kick"[\s\S]*?class="ico"/.test(html),
      'jump and kick carry distinct icons');
    ok(/id="jump"/.test(html) && /id="kick"/.test(html) && /id="slide"/.test(html),
      'Glacier Gate still needs only move, jump and kick');
  }
}

// #10 follow-up: warn shows two fists, stuck drops them.
{
  function topRuns(png, frac) {
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
      if (png.alpha[y * png.w + x] > 40) {
        minx = Math.min(minx, x); maxx = Math.max(maxx, x);
        miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
    }
    const band = miny + Math.floor((maxy - miny + 1) * frac);
    const runs = [];
    let run = 0;
    for (let x = minx; x <= maxx; x++) {
      let hit = false;
      for (let y = miny; y <= band; y++) if (png.alpha[y * png.w + x] > 40) { hit = true; break; }
      if (hit) run++;
      else { if (run) runs.push(run); run = 0; }
    }
    if (run) runs.push(run);
    return runs.filter((r) => r > 4);
  }
  function bandWidth(png, frac, bottom) {
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
      if (png.alpha[y * png.w + x] > 40) {
        minx = Math.min(minx, x); maxx = Math.max(maxx, x);
        miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
    }
    const y0 = bottom ? maxy - Math.floor((maxy - miny + 1) * frac) : miny;
    const y1 = bottom ? maxy : miny + Math.floor((maxy - miny + 1) * frac);
    let w = 0;
    for (let y = y0; y <= y1; y++) {
      let a = -1, b = -1;
      for (let x = 0; x < png.w; x++) if (png.alpha[y * png.w + x] > 40) { if (a < 0) a = x; b = x; }
      if (a >= 0) w = Math.max(w, b - a + 1);
    }
    return w;
  }
  const warn = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'guardian_intact_warn.png'));
  const stuck = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'guardian_intact_stuck.png'));
  ok(topRuns(warn, 0.22).length >= 2, 'the warn pose shows two raised fists');
  ok(topRuns(stuck, 0.22).length < 2, 'the stuck pose does not show two raised fists');
  ok(bandWidth(stuck, 0.2, true) > bandWidth(stuck, 0.2, false) * 1.3,
    'the stuck fists sit low, not above the head');
}

// #4 cues and pips stay below the HUD bar on desktop and phone zoom.
{
  const env = boot();
  env.ib.startGame();
  const forms = [{ w: 153, h: 154 }, { w: 115, h: 123 }, { w: 98, h: 108 }];
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    const b = { x: 960 - f.w / 2, y: 248 - f.h, w: f.w, h: f.h, centerX: 960, form: i, layers: 3, floorY: 248, mode: 'raise' };
    const r = env.ib.bossCue(b);
    ok(r.y >= 92, 'boss cue for form ' + i + ' sits below the desktop HUD bar');
    ok(r.y * 2.2 >= 92 * 1.7, 'boss cue for form ' + i + ' sits below the phone HUD bar');
    ok(r.y + 40 + 7 <= r.y + r.h, 'boss pips stay inside the cue panel');
    ok(r.x >= 0 && r.x + r.w <= 1920, 'boss cue remains on screen');
  }
}

// #9/#20 slide is limited to Frostbite Fields and its button follows.
{
  const env = boot({ touch: true });
  env.ib.setSlideEnabled(true);
  const g = startGame(env);
  ok(env.slideDisplay() === 'none', 'the slide button is hidden on Glacier Gate');
  env.ib.loadLevel(1); env.frames(210);
  ok(env.slideDisplay() === 'block', 'the slide button appears on Frostbite Fields');
  env.key('keydown', 'ArrowDown'); env.frames(7);
  ok(g.player.sliding, 'the slide works on Frostbite Fields');
  env.ib.loadLevel(2); env.frames(210);
  ok(env.slideDisplay() === 'none', 'the slide button is hidden on the next mountain');
  env.key('keydown', 'ArrowDown'); env.frames(7);
  ok(!g.player.sliding, 'the slide is disabled outside Frostbite Fields');
}

// Shipped value: the slide is enabled only on Frostbite Fields.
{
  const env = boot({ touch: true });
  const g = startGame(env);
  ok(env.ib.slideEnabled() === true, 'the shipped slide flag is on');
  for (let level = 0; level < 5; level++) {
    env.ib.loadLevel(level);
    env.frames(210);
    if (level === 1) {
      ok(env.slideDisplay() === 'block', 'slide button shown on Frostbite Fields');
      env.key('keydown', 'ArrowDown');
      env.frames(7);
      ok(g.player.sliding, 'keyboard slide starts on Frostbite Fields');
    } else {
      ok(env.slideDisplay() === 'none', 'slide button hidden on mountain ' + (level + 1));
      env.key('keydown', 'ArrowDown');
      env.frames(7);
      ok(!g.player.sliding, 'keyboard slide does not start on mountain ' + (level + 1));
      env.tap('ArrowDown');
      env.frames(7);
      ok(!g.player.sliding, 'touch slide does not start on mountain ' + (level + 1));
    }
  }
}

// #7/#20 layout: buttons and HUD do not overlap on 600x280 or 844x390.
{
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  function decls(id) {
    let out = '';
    const re = /([^{}]+)\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(html))) if (m[1].indexOf('#' + id) >= 0) out += m[2] + ';';
    return out;
  }
  function val(d, key) {
    const m = d.match(new RegExp(key + ':\\s*(?:calc\\()?\\s*([0-9.]+)px'));
    return m ? Number(m[1]) : null;
  }
  function rect(id, vw, vh) {
    const d = decls(id), w = val(d, 'width'), h = val(d, 'height');
    const l = val(d, 'left'), r = val(d, 'right'), t = val(d, 'top'), b = val(d, 'bottom');
    const lp = d.match(/left:\s*calc\(50%\s*([+-])\s*([0-9.]+)px\)/);
    const x = lp ? vw / 2 + (lp[1] === '-' ? -Number(lp[2]) : Number(lp[2]))
      : l !== null ? l : r !== null ? vw - r - w : (vw - w) / 2;
    const tp = d.match(/top:\s*([0-9.]+)%/);
    const y = t !== null ? t : tp ? vh * Number(tp[1]) / 100 : vh - b - h;
    return { x: x, y: y, w: w, h: h };
  }
  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  const cstore = memStorage();
  const cenv = boot({ storage: cstore });
  const cg = startGame(cenv);
  cg.score = 50; cg.lives = 2;
  cenv.ib.loadLevel(2);
  for (const [vw, vh] of [[600, 280], [844, 390]]) {
    const ids = ['dpad', 'jump', 'kick', 'slide', 'pause'];
    const rs = {};
    for (const id of ids) rs[id] = rect(id, vw, vh);
    let clash = null;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (overlaps(rs[ids[i]], rs[ids[j]])) clash = ids[i] + '/' + ids[j];
    }
    ok(clash === null, 'touch controls do not overlap at ' + vw + 'x' + vh + (clash ? ': ' + clash : ''));
    const hudBottom = 92 * 1.7 * (vh / 1080);
    ok(ids.every((id) => rs[id].y >= hudBottom), 'touch controls stay below the HUD at ' + vw + 'x' + vh);
    ok(ids.every((id) => rs[id].x + rs[id].w <= vw / 3 || rs[id].x >= 2 * vw / 3),
      'no touch control intersects the centre third at ' + vw + 'x' + vh);
    ok(rs.kick.y - (rs.slide.y + rs.slide.h) >= 12,
      'SLIDE keeps a 12 px gap above KICK at ' + vw + 'x' + vh);
    const envT = boot({ touch: true }); envT.ib.startGame();
    const cue = envT.ib.bossCueTouch();
    const cs = vh / 1080, off = (vw - 1920 * cs) / 2;
    for (const id of ids) {
      const lr = { x: (rs[id].x - off) / cs, y: rs[id].y / cs, w: rs[id].w / cs, h: rs[id].h / cs };
      ok(!overlaps(cue, lr), 'touch boss cue clears ' + id + ' at ' + vw + 'x' + vh);
    }
    const menu = ['newrun', 'continue'];
    for (const id of menu) {
      const r = rect(id, vw, vh);
      ok(r.w >= 44 && r.h >= 44, id + ' is a large tap target at ' + vw + 'x' + vh);
      for (const cid of ids) ok(!overlaps(r, rs[cid]), id + ' clears ' + cid + ' at ' + vw + 'x' + vh);
    }
    ok(!overlaps(rect('newrun', vw, vh), rect('continue', vw, vh)),
      'New Run and Continue do not overlap at ' + vw + 'x' + vh);
    const panelBottom = 770 * vh / 1080;
    for (const id of menu) {
      const r = rect(id, vw, vh);
      ok(r.y >= panelBottom, id + ' sits below the controls panel at ' + vw + 'x' + vh);
      for (const cid of ids) {
        const c = rs[cid];
        const vertical = r.y < c.y + c.h && r.y + r.h > c.y;
        const horizontal = r.x < c.x + c.w && r.x + r.w > c.x;
        if (vertical) ok(r.x + r.w + 12 <= c.x || c.x + c.w + 12 <= r.x,
          id + ' keeps 12 px from ' + cid + ' at ' + vw + 'x' + vh);
        if (horizontal) ok(r.y + r.h + 12 <= c.y || c.y + c.h + 12 <= r.y,
          id + ' keeps 12 px vertically from ' + cid + ' at ' + vw + 'x' + vh);
      }
    }
    ok(cue.y >= 92 * 1.7, 'touch boss cue sits below the HUD at ' + vw + 'x' + vh);
    ok(envT.ib.bossCueTouchLabel * cs >= 14,
      'touch boss cue label is at least 14 CSS px at ' + vw + 'x' + vh);
    const rp = boot({ touch: true, storage: cstore });
    rp.frames(2);
    const rule = rp.ib.titleRule();
    const rc = { x: off + rule.x * cs, y: rule.y * cs, w: rule.w * cs, h: rule.h * cs };
    ok(rc.h >= 11, 'touch Continue rule is at least 11 CSS px at ' + vw + 'x' + vh + ' (' + rc.h.toFixed(1) + ')');
    ok(rc.x >= 0 && rc.x + rc.w <= vw && rc.y >= 0 && rc.y + rc.h <= vh,
      'touch Continue rule stays on screen at ' + vw + 'x' + vh);
    for (const id of ids) ok(!overlaps(rc, rs[id]), 'Continue rule clears ' + id + ' at ' + vw + 'x' + vh);
    for (const id of menu) {
      const r = rect(id, vw, vh);
      ok(!overlaps(rc, r), 'Continue rule clears ' + id + ' at ' + vw + 'x' + vh);
      ok(r.y >= rc.y + rc.h + 12, 'Continue rule keeps 12 px above ' + id + ' at ' + vw + 'x' + vh);
    }
    ok(!rp.texts.some((x) => String(x).indexOf('Best played with sound on') >= 0),
      'touch title hides the footer under the buttons at ' + vw + 'x' + vh);

    const wenv = boot({ touch: true });
    const wg = startGame(wenv, 2);
    wg.level.topis.forEach((e) => { e.alive = false; });
    wg.level.ladies.forEach((e) => { e.alive = false; });
    wg.level.shots.length = 0;
    wg.level.bearDelay = 0;
    const floors = G.FLOOR_Y;
    let sawOffscreen = false;
    for (const [pf, bf] of [[0, 3], [0, 4], [4, 0], [2, 4], [4, 2]]) {
      wg.level.nits.length = 0;
      const wp = wg.player;
      wp.x = 960; wp.y = floors[pf] - 60; wp.vy = 0; wp.grounded = true;
      wenv.frames(40);
      const nit = { x: wp.x, y: floors[bf] - 60, baseY: floors[bf] - 60, w: 60, h: 30,
        vx: 0, phase: Math.PI / 2 / 0.55, kind: 'nit', alive: true, warn: 0.6, warned: true };
      wg.level.nits = [nit];
      let allInside = true, allClear = true, frames = 0, marker = null;
      while (nit.warn > 0 && frames++ < 50) {
        wenv.frames(1);
        marker = wenv.ib.nitWarning(nit);
        if (marker.x < 0 || marker.y < 0 || marker.x + marker.w > 1920 || marker.y + marker.h > 1080) allInside = false;
        if (marker.y < 92 * 1.7) allInside = false;
        for (const id of ids) {
          const c = rs[id];
          const lr = { x: (c.x - off) / cs, y: c.y / cs, w: c.w / cs, h: c.h / cs };
          if (overlaps(marker, lr)) { allClear = false; }
        }
        if (marker.offscreen) {
          sawOffscreen = true;
          if (!marker.arrow) allClear = false;
        }
      }
      ok(marker && allInside, 'bird warning stays in the visible view for floors ' + pf + '/' + bf + ' at ' + vw + 'x' + vh);
      ok(marker && allClear, 'bird warning clears HUD and controls for floors ' + pf + '/' + bf + ' at ' + vw + 'x' + vh);
      ok(marker && marker.w === 52 * 2.2, 'bird warning keeps its 52 px size in the 2.2x camera');
    }
    ok(sawOffscreen, 'clamped off-screen bird warnings use the edge marker at ' + vw + 'x' + vh);
    for (const bx2 of [200, 960, 1700]) for (const by2 of [200, 590, 1000]) {
      const pair = wenv.ib.nitWarningLayout([
        { x: bx2, y: by2, w: 60, h: 30, warn: 0.3 },
        { x: bx2, y: by2, w: 60, h: 30, warn: 0.3 }
      ]);
      ok(pair.length === 2 && !overlaps(pair[0], pair[1]),
        'two bird badges do not overlap near ' + bx2 + ',' + by2 + ' at ' + vw + 'x' + vh);
      const z = 2.2;
      const bird = { x: (bx2 + 30 - wenv.ib.cam.x) * z - 30 * z, y: (by2 + 15 - wenv.ib.cam.y) * z - 15 * z, w: 60 * z, h: 30 * z };
      ok(!overlaps(pair[0], bird) && !overlaps(pair[1], bird),
        'nudged badge does not cover a bird body at ' + bx2 + ',' + by2);
    }

    wg.level.nits = [{ x: wg.player.x, y: floors[3] - 60, baseY: floors[3] - 60, w: 60, h: 30,
      vx: 0, phase: Math.PI / 2 / 0.55, kind: 'nit', alive: true, warn: 0, warned: false }];
    wg.nitAlerts = 0;
    wenv.frames(1);
    ok(wg.level.nits[0].warn > 0.55 && wg.nitAlerts === 1,
      'a touch dive warning lasts 0.6 s and is created once');
  }
  ok(decls('pause').indexOf('top:') >= 0 && decls('pause').indexOf('bottom:') < 0,
    'pause is pinned at the top, clear of the d-pad');
}

// Re-review: slide/gear/guardian interiors and drawn slide scale.
{
  function bbox(png) {
    let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1;
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
      if (png.alpha[y * png.w + x] > 40) {
        minx = Math.min(minx, x); maxx = Math.max(maxx, x);
        miny = Math.min(miny, y); maxy = Math.max(maxy, y);
      }
    }
    return { x0: minx, x1: maxx, y0: miny, y1: maxy, w: maxx - minx + 1, h: maxy - miny + 1 };
  }
  function centreAlpha(png, b) {
    let sx = 0, sy = 0, n = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const i = (y * png.w + x) * 4;
      if (png.rgba[i + 3] > 200 && png.rgba[i] > 235 && png.rgba[i + 1] > 235 && png.rgba[i + 2] > 235) {
        sx += x; sy += y; n++;
      }
    }
    if (!n) return 0;
    return png.alpha[Math.round(sy / n) * png.w + Math.round(sx / n)];
  }
  function interior(png, b) {
    let op = 0, white = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const i = (y * png.w + x) * 4;
      if (png.rgba[i + 3] > 200) {
        op++;
        if (png.rgba[i] > 235 && png.rgba[i + 1] > 235 && png.rgba[i + 2] > 235) white++;
      }
    }
    return { whiteFrac: op ? white / op : 0, opFrac: op / (b.w * b.h) };
  }
  function largestComponent(mask, w, h) {
    const seen = new Uint8Array(w * h);
    let best = null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i] || seen[i]) continue;
      const stack = [i];
      seen[i] = 1;
      let n = 0, x0 = x, x1 = x, y0 = y, y1 = y;
      while (stack.length) {
        const j = stack.pop(); n++;
        const jy = Math.floor(j / w), jx = j - jy * w;
        x0 = Math.min(x0, jx); x1 = Math.max(x1, jx);
        y0 = Math.min(y0, jy); y1 = Math.max(y1, jy);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (!best || n > best.n) best = { n: n, x0: x0, y0: y0, x1: x1, y1: y1 };
    }
    return best;
  }
  function headSize(png) {
    const skin = new Uint8Array(png.w * png.h);
    const hair = new Uint8Array(png.w * png.h);
    for (let y = 0; y < png.h; y++) for (let x = 0; x < png.w; x++) {
      const i = y * png.w + x, j = i * 4;
      if (png.rgba[j + 3] < 200) continue;
      const r = png.rgba[j], g = png.rgba[j + 1], b = png.rgba[j + 2];
      if (r > 150 && g > 90 && b < 150 && r > g) skin[i] = 1;
      if (r < 90 && g < 80 && b < 80) hair[i] = 1;
    }
    const face = largestComponent(skin, png.w, png.h);
    const hairBox = largestComponent(hair, png.w, png.h);
    if (!face || !hairBox) return 0;
    if (png.w > png.h) {
      return Math.max(face.x1, hairBox.x1) - Math.min(face.x0, hairBox.x0) + 1;
    }
    return face.y1 - Math.min(face.y0, hairBox.y0) + 1;
  }

  const idle = readPngAlpha(path.join(__dirname, 'assets', 'sprites', 'karate_idle.png'));
  const idleHead = headSize(idle);
  for (const name of ['karate_slide_start', 'karate_slide', 'karate_slide_recover']) {
    const png = readPngAlpha(path.join(__dirname, 'assets', 'sprites', name + '.png'));
    const b = bbox(png);
    ok(centreAlpha(png, b) === 255, name + ' keeps the white gi opaque at the torso centre');
    ok(interior(png, b).whiteFrac >= 0.25, name + ' is at least 25% opaque near-white');
    const head = headSize(png);
    ok(Math.abs(head - idleHead) / idleHead <= 0.1,
      name + ' head box matches karate_idle (' + head + ' vs ' + idleHead + ')');
  }
  const env0 = boot();
  env0.ib.startGame();
  ok(Math.abs(env0.ib.slideDrawScale - 82 / 256) <= 0.005,
    'slide draw scale matches the standing sprite (' + env0.ib.slideDrawScale + ')');

  const all = ['gear_cleats', 'gear_boots'];
  for (let i = 0; i < 12; i++) all.push('guardian_' + ['intact', 'fractured', 'core'][Math.floor(i / 4)] + '_' + ['idle', 'warn', 'impact', 'stuck'][i % 4]);
  for (const name of all) {
    const png = readPngAlpha(path.join(__dirname, 'assets', 'sprites', name + '.png'));
    const b = bbox(png);
    const st = interior(png, b);
    const cx = b.x0 + Math.floor(b.w / 2);
    const cy = b.y0 + Math.floor(b.h * 0.38);
    ok(png.alpha[cy * png.w + cx] === 255, name + ' keeps an opaque interior centre');
    ok(st.opFrac >= 0.25, name + ' has at least 25% opaque figure area');
  }
}

// Re-review: boss draw stays below HUD; touch cue avoids every control.
{
  const forms = [{ w: 153, h: 154 }, { w: 115, h: 123 }, { w: 98, h: 108 }];
  const d = boot(); d.ib.startGame();
  const t = boot({ touch: true }); t.ib.startGame();
  const dh = [], th = [];
  for (let i = 0; i < forms.length; i++) {
    const f = forms[i];
    const b = { x: 960 - f.w / 2, y: 248 - f.h, w: f.w, h: f.h, centerX: 960, form: i, layers: 3, floorY: 248, mode: 'raise' };
    const dd = d.ib.bossDraw(b);
    const tt = t.ib.bossDraw(b);
    dh.push(dd.h); th.push(tt.h);
    ok(dd.top >= 92, 'form ' + i + ' drawn below the desktop HUD');
    ok(tt.top * 2.2 >= 92 * 1.7, 'form ' + i + ' drawn below the 2.2x phone HUD');
    const cue = d.ib.bossCue(b);
    ok(cue.y >= 92, 'form ' + i + ' cue below the desktop HUD');
    ok(cue.x >= b.x + b.w || cue.x + cue.w <= b.x, 'form ' + i + ' cue sits beside the boss');
    ok(!(cue.x < b.x + b.w && cue.x + cue.w > b.x && cue.y < b.y + b.h && cue.y + cue.h > b.y),
      'form ' + i + ' cue does not cover the boss');
  }
  ok(dh[0] > dh[1] && dh[1] > dh[2], 'desktop drawn boss heights decrease intact > fractured > core');
  ok(th[0] > th[1] && th[1] > th[2], 'touch drawn boss heights decrease intact > fractured > core');
  for (const bx of [0, 200, 800, 1600, 1800]) {
    const b = { x: bx, y: 88, w: 160, h: 160, floorY: 248, form: 1, layers: 2, mode: 'raise' };
    const cue = d.ib.bossCue(b);
    ok(cue.x >= 0 && cue.x + cue.w <= 1920 && cue.y >= 92, 'cue stays on screen below HUD at boss x=' + bx);
    ok(cue.x >= b.x + b.w || cue.x + cue.w <= b.x, 'cue stays beside the boss at boss x=' + bx);
  }
}

// Batch 2: boss retry on protected summit floor (#5).
{
  const env = boot();
  const g = startGame(env, 4);
  g.level.topis.forEach((e) => { e.alive = false; });
  g.level.ladies.forEach((e) => { e.alive = false; });
  g.level.nits.length = 0;
  g.level.shots.length = 0;
  g.level.bearDelay = 0;
  const p = g.player;
  p.x = 200; p.y = 188; p.grounded = true;
  env.frames(2); env.frames(140);
  g.lives = 3;
  const block = g.level.blocks.get(14 + ':' + 248);
  ok(block && block.alive && block.fixed, 'the respawn column is protected summit floor');

  p.x = 14 * 64; p.y = 440 - 60; p.vy = 0; p.grounded = true;
  env.frames(2);
  env.key('keydown', 'Space'); env.frames(1); env.key('keyup', 'Space');
  for (let i = 0; i < 40; i++) {
    if (i % 4 === 0) { env.key('keydown', 'KeyZ'); env.key('keyup', 'KeyZ'); }
    env.frames(1);
    if (p.grounded && i > 8) break;
  }
  ok(g.level.blocks.get(14 + ':' + 248).alive, 'a real kick from below cannot break the respawn floor');

  p.x = 800; p.y = 188; p.vy = 0; p.grounded = true;
  g.level.boss.mode = 'raise';
  g.level.boss.timer = 0;
  env.frames(1);
  ok(g.lives === 2, 'a boss slam costs the life');
  ok(p.x === 14 * 64 + 4 && p.y === 188 && p.grounded,
    'the retry respawns on the protected summit floor');
  env.frames(60);
  ok(p.grounded && Math.abs(p.y + p.h - 248) < 2 && g.level.blocks.get(14 + ':' + 248).alive,
    'the retry floor holds and the player does not fall');
}

// Batch 2: pending kick clears on life loss (#34).
{
  const a = arena(1);
  a.env.frames(90);
  a.env.key('keydown', 'KeyZ');
  a.env.ib.hurt('test');
  a.env.frames(2);
  ok(a.g.lives === 2 && a.right.alive && a.left.alive, 'a kick queued before a hit does not fire after respawn');

  const b = boot();
  b.ib.setSlideEnabled(true);
  const g2 = startGame(b, 1);
  b.g.level.topis.forEach((e) => { e.alive = false; });
  b.g.level.ladies.forEach((e) => { e.alive = false; });
  b.g.level.nits.length = 0;
  b.g.level.shots.length = 0;
  b.g.level.bearDelay = 0;
  b.frames(150);
  b.key('keydown', 'ArrowDown');
  b.ib.hurt('test');
  b.frames(2);
  ok(!g2.player.sliding, 'a slide queued before a hit does not fire after respawn');
}

// Batch 2: only the active d-pad arrow highlights (#33).
{
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  ok(/#touch > button:active/.test(html), 'button press feedback is limited to buttons');
  ok(!/#touch > \*:active/.test(html), 'the whole d-pad is not brightened by the generic active rule');
  ok(/#dpad span\.on/.test(html), 'the active arrow keeps its own highlight');
  ok(!/#dpad[^{]*:active/.test(html), 'no d-pad :active rule brightens the whole pad');
}

// Batch 2: reached vs cleared on recap and game over (#31).
{
  const env = boot();
  const g = startGame(env);
  const goal = g.level.items.find((i) => i.kind === 'goal');
  g.player.x = goal.x; g.player.y = 188;
  env.frames(2);
  ok(g.state === 'levelclear' && g.climb.reachedSummit && g.climb.cleared,
    'the recap climbs after reaching the summit');
  ok(env.texts.some((t) => String(t).indexOf('REACHED YES') >= 0 && String(t).indexOf('CLEARED YES') >= 0),
    'the recap shows reached and cleared');
}
{
  const env = boot();
  const g = startGame(env, 4);
  g.level.topis.forEach((e) => { e.alive = false; });
  g.level.ladies.forEach((e) => { e.alive = false; });
  g.level.nits.length = 0;
  g.level.shots.length = 0;
  g.level.bearDelay = 0;
  const p = g.player;
  p.x = 200; p.y = 188; p.grounded = true;
  env.frames(2); env.frames(140);
  g.lives = 1;
  p.x = 800; p.y = 188; p.grounded = true;
  g.level.boss.mode = 'raise'; g.level.boss.timer = 0;
  env.frames(1);
  ok(g.state === 'gameover' && g.climb.reachedSummit && !g.climb.cleared,
    'dying at the boss leaves the summit reached but not cleared');
  ok(env.texts.some((t) => String(t).indexOf('SUMMIT REACHED YES') >= 0),
    'game over shows the summit was reached');

  const e2 = boot();
  const g2 = startGame(e2);
  clearHazards(g2);
  e2.frames(180);
  g2.lives = 1;
  e2.ib.hurt('test');
  e2.frames(1);
  ok(e2.texts.some((t) => String(t).indexOf('SUMMIT REACHED NO') >= 0),
    'game over shows when no summit was reached');
}

// Review: a life loss cancels an active slide before respawn.
{
  function slideField() {
    const env = boot();
    env.ib.setSlideEnabled(true);
    const g = startGame(env, 1);
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    env.frames(180);
    const p = g.player;
    p.x = g.level.startX; p.y = g.level.startY; p.vy = 0; p.grounded = true; p.h = 60;
    p.sliding = false; p.slideT = 0; p.slideStart = 0; p.slideRecover = 0; p.slideCd = 0; p.facing = 1;
    return { env, g, p };
  }

  {
    const a = slideField();
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(1);
    ok(a.p.sliding && a.p.h === 60, 'the crouch starts before any life loss');
    a.env.ib.hurt('test');
    a.env.frames(1);
    ok(!a.p.sliding && a.p.h === 60, 'a crouch is cancelled on life loss');
    ok(a.p.x === a.g.level.startX && a.p.y === a.g.level.startY && a.p.grounded,
      'crouch respawns grounded at the stage start');
    const x = a.p.x;
    a.env.frames(30);
    ok(a.p.x === x, 'the cancelled crouch does not slide after respawn');
  }

  {
    const a = slideField();
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(8);
    ok(a.p.sliding && a.p.h === 29, 'the glide reaches the low hitbox');
    a.env.ib.hurt('test');
    a.env.frames(1);
    ok(!a.p.sliding && a.p.h === 60, 'a glide is cancelled on life loss');
    ok(a.p.x === a.g.level.startX && a.p.y === a.g.level.startY && a.p.grounded,
      'glide respawns grounded at the stage start');
    const x = a.p.x;
    a.env.frames(30);
    ok(a.p.x === x, 'the cancelled glide does not move after respawn');
  }

  {
    const a = slideField();
    a.env.key('keydown', 'ArrowDown');
    a.env.frames(8);
    a.env.ib.loadLevel(2);
    const p2 = a.g.player;
    ok(!p2.sliding && p2.h === 60 && p2.slideRecover === 0 && p2.slideCd === 0,
      'a level change resets the slide state');
    a.env.ib.startGame();
    const p3 = a.g.player;
    ok(!p3.sliding && p3.h === 60 && p3.slideRecover === 0 && p3.slideCd === 0,
      'a new game resets the slide state');
  }
}

// Review: slide hints only where the slide works (Frostbite Fields).
{
  const introDesk = 'DOWN / S: SLIDE UNDER THROWN SIGNS';
  const introTouch = 'SLIDE BUTTON: DODGE THROWN SIGNS';
  const d = boot();
  ok(d.texts.some((t) => String(t).indexOf('* FROSTBITE FIELDS') >= 0),
    'the title names Frostbite Fields in a footnote');
  ok(d.ib.titleRows().some((r) => r.indexOf('SLIDE*') >= 0), 'the slide row is shortened to SLIDE*');
  ok(d.ib.titleRows().every((r) => r.length >= 18 && r.slice(0, 18).trim() && r.slice(18).trim()),
    'title rows share aligned key and action columns');
  for (const [vw, vh] of [[1920, 1080], [600, 280], [844, 390]]) {
    const scale = vh / 1080;
    const panelW = 860 * scale;
    ok(d.ib.titleRows().every((r) => r.length * 0.6 * 26 * scale <= panelW),
      'title rows fit the panel at ' + vw + 'x' + vh);
    ok('* FROSTBITE FIELDS'.length * 0.6 * 18 * scale <= panelW,
      'the footnote fits the panel at ' + vw + 'x' + vh);
  }
  d.ib.setSlideEnabled(true);
  startGame(d);
  for (let level = 0; level < 5; level++) {
    d.texts.length = 0;
    d.ib.loadLevel(level);
    d.frames(1);
    const intro = d.texts.some((t) => String(t).indexOf(introDesk) >= 0);
    d.frames(210);
    const hud = d.texts.some((t) => String(t).indexOf('DOWN/S SLIDE') >= 0);
    if (level === 1) ok(intro && hud, 'desktop slide hints show on Frostbite Fields');
    else ok(!intro && !hud, 'desktop slide hints are absent on mountain ' + (level + 1));
  }

  const t = boot({ touch: true });
  t.ib.setSlideEnabled(true);
  startGame(t);
  for (let level = 0; level < 5; level++) {
    t.texts.length = 0;
    t.ib.loadLevel(level);
    t.frames(1);
    const intro = t.texts.some((x) => String(x).indexOf(introTouch) >= 0);
    if (level === 1) ok(intro, 'touch slide hint shows on Frostbite Fields');
    else ok(!intro, 'touch slide hint is absent on mountain ' + (level + 1));
  }
}

// #26: continue a run from the start of a mountain.
{
  const KEY = 'icebreakers.checkpoint.v1';
  function checkpointOf(store) { const raw = store.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  function reward(env) {
    assert.strictEqual(env.g.state, 'reward');
    env.key('keydown', 'ArrowLeft'); env.key('keyup', 'ArrowLeft');
    env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
  }
  function finishLevel(env) {
    const g = env.g;
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
    const goal = g.level.items.find((i) => i.kind === 'goal');
    if (g.levelIndex === 4) {
      g.player.x = 800; g.player.y = 188; g.player.grounded = true;
      env.frames(2);
      for (let k = 0; k < 3; k++) {
        g.level.boss.mode = 'stuck'; g.level.boss.timer = 10;
        env.key('keydown', 'KeyZ'); env.frames(1); env.frames(25);
      }
    }
    g.player.x = goal.x; g.player.y = 188;
    env.frames(2);
    assert.strictEqual(g.state, 'levelclear');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    g.score = 1500; g.lives = 2; g.gear = 'boots';
    env.ib.loadLevel(2);
    const cp = checkpointOf(store);
    ok(cp && cp.levelIndex === 2 && cp.score === 1500 && cp.lives === 2 && cp.gear === 'boots',
      'the checkpoint saves mountain, score, lives and gear at the start');
    const e2 = boot({ storage: store });
    ok(e2.texts.some((t) => String(t).indexOf('CONTINUE RESTARTS SLIPPERY STEPS FROM ITS START') >= 0),
      'the title shows Continue with the checkpoint mountain');
    e2.key('keydown', 'KeyC'); e2.key('keyup', 'KeyC');
    ok(e2.g.state === 'intro' && e2.g.levelIndex === 2, 'Continue skips the title into that mountain intro');
    ok(e2.g.score === 1500 && e2.g.lives === 2 && e2.g.gear === 'boots', 'Continue restores score, lives and gear');
    e2.frames(210);
    ok(e2.g.state === 'playing', 'Continue reaches the mountain after its countdown');
    const e3 = boot({ storage: store });
    e3.key('keydown', 'KeyC'); e3.key('keyup', 'KeyC');
    ok(e3.g.score === 1500 && e3.g.lives === 2 && e3.g.gear === 'boots',
      'repeated loads do not duplicate score, lives or gear');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    g.score = 800; g.lives = 3; g.gear = null;
    env.ib.loadLevel(0);
    env.frames(210);
    finishLevel(env);
    env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
    assert.strictEqual(g.state, 'reward');
    ok(checkpointOf(store).levelIndex === 0, 'the reward screen keeps the cleared mountain checkpoint');
    const e2 = boot({ storage: store });
    e2.key('keydown', 'KeyC'); e2.key('keyup', 'KeyC');
    ok(e2.g.levelIndex === 0 && e2.g.score === 800,
      'reloading during reward restores the mountain start without the clear bonus');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    env.ib.loadLevel(1);
    clearHazards(g);
    env.frames(210); env.frames(180);
    env.ib.hurt('test');
    ok(g.lives === 2 && checkpointOf(store).lives === 3,
      'a loss does not replace the mountain-start checkpoint');
    const e2 = boot({ storage: store });
    e2.key('keydown', 'KeyC'); e2.key('keyup', 'KeyC');
    ok(e2.g.levelIndex === 1 && e2.g.lives === 3, 'reloading after a loss restores the start lives');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    env.ib.loadLevel(2);
    clearHazards(g);
    env.frames(210); env.frames(180);
    g.lives = 1;
    env.ib.hurt('test');
    ok(g.state === 'gameover' && store.getItem(KEY) === null, 'game over clears the active checkpoint');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    for (let i = 0; i < 5; i++) {
      finishLevel(env);
      env.key('keydown', 'Enter'); env.key('keyup', 'Enter');
      if (i < 4) { reward(env); env.frames(210); } else ok(g.state === 'win', 'the run reaches victory');
    }
    ok(store.getItem(KEY) === null, 'victory clears the active checkpoint');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    startGame(env);
    env.g.score = 999; env.g.lives = 2;
    env.ib.loadLevel(2);
    const e2 = boot({ storage: store });
    e2.key('keydown', 'Enter'); e2.key('keyup', 'Enter');
    const cp = checkpointOf(store);
    ok(cp.levelIndex === 0 && cp.score === 0 && cp.lives === 3,
      'an explicit new run replaces the old checkpoint');
  }

  {
    const store = memStorage();
    const env = boot({ storage: store });
    startGame(env);
    env.ib.loadLevel(2);
    const before = store.getItem(KEY);
    const e2 = boot({ storage: store });
    ok(store.getItem(KEY) === before && e2.ib.checkpoint().levelIndex === 2,
      'visiting the title does not replace the checkpoint');
    const t = boot({ touch: true, storage: store });
    t.frames(2);
    ok(t.menu('continue').style.display === 'block' && /CONTINUE/.test(t.menu('continue').textContent),
      'the touch Continue target is visible on the title');
    t.tapMenu('continue');
    ok(t.g.state === 'intro' && t.g.levelIndex === 2, 'the touch Continue target resumes the checkpoint');
    t.frames(210);
    ok(t.g.state === 'playing', 'touch Continue reaches play');
  }

  {
    const blocked = boot({ storage: 'blocked' });
    ok(blocked.ib.checkpoint() === null, 'blocked storage yields no checkpoint');
    startGame(blocked);
    ok(blocked.g.state === 'playing', 'blocked storage still starts and plays');

    const store = memStorage();
    store.setItem(KEY, '{bad json');
    const corrupt = boot({ storage: store });
    ok(corrupt.ib.checkpoint() === null, 'corrupt storage yields no checkpoint');
    store.setItem(KEY, JSON.stringify({ v: 2, levelIndex: 2, score: 10, lives: 2, gear: null }));
    const wrong = boot({ storage: store });
    ok(wrong.ib.checkpoint() === null, 'an incompatible save is ignored');
    store.setItem(KEY, JSON.stringify({ v: 1, levelIndex: 9, score: 10, lives: 2, gear: 'nope' }));
    const bad = boot({ storage: store });
    ok(bad.ib.checkpoint() === null, 'a wrong-type save is ignored');
  }
}

// #17: distinct hazard, landing and ice cues, once per event.
{
  function quiet(g) {
    g.level.topis.forEach((e) => { e.alive = false; });
    g.level.ladies.forEach((e) => { e.alive = false; });
    g.level.nits.length = 0;
    g.level.shots.length = 0;
    g.level.bearDelay = 0;
  }
  function delta(env, fn) {
    const t = env.audio.tones, n = env.audio.noises;
    fn();
    return { tones: env.audio.tones - t, noises: env.audio.noises - n };
  }

  {
    const env = boot();
    const g = startGame(env);
    quiet(g);
    g.level.blocks.clear();
    g.player.x = 5 * 64 + 10; g.player.y = 700; g.player.vy = 0; g.player.grounded = false;
    g.particles.length = 0;
    const beforeMiss = 0;
    g.fxWhiff = 0; g.fxSwoosh = 0;
    const miss = delta(env, () => { env.key('keydown', 'KeyZ'); env.frames(1); });
    ok(miss.tones === 2 && miss.noises === 0, 'a missed kick has its own tone after the swing');
    ok(g.player.whiff > 0 && g.particles.length - beforeMiss === 3 &&
      g.particles.slice(beforeMiss).every((q) => q.color === '#c7d3de'),
      'a miss draws a whiff with three dull sparks and no shards');
    ok(g.fxWhiff === 1 && g.fxSwoosh === 0, 'the miss draws the whiff and not the hit swoosh');
    const arc = env.ib.whiffArc(g.player);
    ok(arc.x >= 42 && arc.x <= 1920 - 42, 'the whiff arc stays on canvas');
    env.frames(25);
    g.level.blocks.clear();
    g.player.x = 1920 - g.player.w - 2; g.player.y = 700; g.player.vy = 0; g.player.grounded = false;
    const beforeEdge = g.particles.length;
    env.key('keydown', 'KeyZ'); env.frames(1);
    const edgeArc = env.ib.whiffArc(g.player);
    ok(edgeArc.bounds.x0 >= 0 && edgeArc.bounds.x1 <= 1920 &&
      edgeArc.bounds.y0 >= 0 && edgeArc.bounds.y1 <= 1080,
      'the edge miss arc is fully inside the view');
    g.player.facing = -1; g.player.x = 2;
    const leftArc = env.ib.whiffArc(g.player);
    ok(leftArc.bounds.x0 >= 0 && leftArc.bounds.x1 <= 1920,
      'the left-edge miss arc is fully inside the view');
    env.frames(30);
    ok(g.particles.slice(beforeEdge).every((q) => q.x >= 0 && q.x <= 1920 &&
      !(q.x <= 8 && q.vx < 0) && !(q.x >= 1912 && q.vx > 0)),
      'edge miss sparks stay inside the view after drifting');
    env.frames(25);
    g.player.x = 5 * 64 + 10; g.player.y = 700; g.player.vy = 0; g.player.grounded = false;
    g.level.blocks.set('5:700', { x: 5 * 64, y: 700, w: 64, h: 64, alive: true });
    g.particles.length = 0;
    const beforeIce = 0;
    g.fxWhiff = 0; g.fxSwoosh = 0;
    const ice = delta(env, () => { env.key('keydown', 'KeyZ'); env.frames(1); });
    ok(ice.tones === 2 && ice.noises === 1, 'a broken block plays one fracture cue');
    ok(g.player.whiff === 0 && g.particles.length - beforeIce === 8 &&
      g.particles.slice(beforeIce).every((q) => q.color === '#cfeaff'),
      'an ice hit draws shards and no whiff');
    ok(g.fxSwoosh === 1 && g.fxWhiff === 0, 'the hit draws the swoosh and not the whiff');
  }

  {
    const env = boot();
    const g = startGame(env);
    quiet(g);
    g.particles.length = 0;
    g.player.y -= 2; g.player.vy = 0; g.player.grounded = false;
    g.player.airTime = 0.1; g.player.lastGroundY = g.player.y + 2;
    const light = delta(env, () => { for (let i = 0; i < 30 && !g.player.grounded; i++) env.frames(1); });
    ok(light.noises === 1 && light.tones === 0 && g.particles.length === 10 && g.shake === 0 &&
      g.particles.every((q) => q.size >= 5),
      'a light landing shows ten larger snow puffs');
    g.particles.length = 0;
    g.player.x = 9 * 64 + 10;
    g.player.y = 764; g.player.lastGroundY = 764; g.player.vy = 0;
    g.player.grounded = false; g.player.airTime = 1;
    const heavy = delta(env, () => { for (let i = 0; i < 120 && !g.player.grounded; i++) env.frames(1); });
    ok(heavy.noises === 1 && heavy.tones === 1 && g.particles.length === 18 && g.shake > 0,
      'a heavy landing shows eighteen puffs and shakes the camera');
    const walked = g.particles.length;
    env.key('keydown', 'ArrowRight'); env.frames(30); env.key('keyup', 'ArrowRight');
    ok(g.particles.length <= walked, 'ordinary walking spawns no landing puffs');
  }

  {
    const env = boot();
    const g = startGame(env, 1);
    quiet(g);
    const lady = { x: g.player.x + 200, y: 824 - 92, w: 44, h: 92, floorY: 824, vx: 50,
      shotCd: 0, anim: 0, point: 0.5, windup: 0.01, kind: 'mil', alive: true };
    g.level.ladies = [lady];
    const throwCue = delta(env, () => { env.frames(1); });
    ok(throwCue.noises === 1 && throwCue.tones === 0, 'throwing a sign plays one whoosh');
  }

  {
    const env = boot();
    const g = startGame(env, 1);
    quiet(g);
    const nit = { x: g.player.x, y: g.player.y - 120, baseY: g.player.y - 120, w: 60, h: 30,
      vx: 0, phase: Math.PI / 2 / 0.55, kind: 'nit', alive: true, warn: 0, warned: false };
    g.level.nits = [nit];
    g.nitAlerts = 0;
    const firstChirp = delta(env, () => { env.frames(1); });
    ok(firstChirp.tones === 1, 'the bird dive starts with one chirp');
    ok(nit.warn > 0 && env.texts.some((t) => t === '!'), 'the bird shows a warning pose before diving');
    const badge = env.ib.nitBadge(nit);
    ok(badge.size >= 48 && badge.size <= 56, 'the bird warning badge is 48-56 logical px');
    ok(badge.size * 2.2 * (280 / 1080) >= 20,
      'the bird warning badge stays large in the 2.2x camera');
    ok(g.nitAlerts === 1, 'the bird warning marker is created once per dive');
    const onScreen = { x: 200, y: 400, w: 60, h: 30, warn: 0.3 };
    env.ib.cam.x = 0; env.ib.cam.y = 0;
    const onRect = env.ib.nitWarning(onScreen);
    ok(onRect.arrow === '' && onRect.offscreen === false, 'an on-screen bird warning skips the arrow');
    const np = env.ib.nitPose(onScreen);
    ok(np.warning && Math.abs(np.h - 52 * 1.12) < 0.01 && np.flap !== 0,
      'the bird shows a taller, flapping warning pose');
    const chirp = delta(env, () => { env.frames(10); });
    ok(chirp.tones === 0 && g.nitAlerts === 1, 'the bird chirps and marks the dive only once');
    ok(env.texts.some((t) => t === '!'), 'the dive warning stays visible');
  }

  {
    const env = boot();
    const g = startGame(env, 2);
    quiet(g);
    g.level.bearDelay = 0.01; g.level.time = 0;
    const bearCue = delta(env, () => { env.frames(3); });
    ok(g.level.bear && bearCue.tones === 2, 'the bear entrance plays its own growl');
    ok(g.level.bear.cue > 0 && g.level.bear.entrySide !== 0, 'the bear entrance shows a side cue');
    if (g.level.bear.entrySide < 0) ok(env.texts.some((t) => t === '>>>'), 'the left bear cue points into the view');
    else ok(env.texts.some((t) => t === '<<<'), 'the right bear cue points into the view');
    ok(g.flash === 0, 'the bear entrance does not use the damage flash');
  }

  {
    const env = boot();
    const g = startGame(env, 4);
    quiet(g);
    const p = g.player;
    p.x = 200; p.y = 188; p.grounded = true;
    env.frames(2); env.frames(140);
    g.audioBefore = [env.audio.tones, env.audio.noises];
    g.level.boss.mode = 'idle'; g.level.boss.timer = 0;
    const warn = delta(env, () => { env.frames(1); });
    ok(warn.tones === 2, 'the boss raise plays a slam warning');
    g.level.boss.mode = 'stuck'; g.level.boss.timer = 10;
    p.x = 800; p.y = 188;
    const crack = delta(env, () => { env.key('keydown', 'KeyZ'); env.frames(1); });
    ok(crack.noises === 1 && crack.tones === 2, 'a lost armor layer plays one armor crack after the swing');
  }

  {
    const env = boot({ noAudio: true });
    const g = startGame(env);
    env.key('keydown', 'Space'); env.frames(1); env.key('keyup', 'Space');
    env.key('keydown', 'KeyZ'); env.frames(5);
    ok(g.state === 'playing', 'audio unavailable does not crash play or inputs');
  }
}

// Review blocker: title canvas taps never wipe a checkpoint; explicit hit areas only.
{
  function savedStore() {
    const store = memStorage();
    const env = boot({ storage: store });
    const g = startGame(env);
    g.score = 1234; g.lives = 2; g.gear = 'boots';
    env.ib.loadLevel(2);
    return store;
  }
  function cp(store) { const raw = store.getItem('icebreakers.checkpoint.v1'); return raw ? JSON.parse(raw) : null; }

  {
    const store = savedStore();
    const e = boot({ storage: store });
    e.tapCanvasAt(10, 10);
    ok(e.g.state === 'title' && cp(store).levelIndex === 2, 'a canvas tap away from the menu keeps the checkpoint');
    ok(e.g.state === 'title', 'a stray canvas tap does not start a run');
    ok(!e.texts.some((t) => String(t).indexOf('TAP TO CLIMB') >= 0) &&
      e.texts.some((t) => String(t).indexOf('NEW RUN (ENTER)') >= 0) &&
      e.texts.some((t) => String(t).indexOf('CONTINUE (C)') >= 0),
      'the title shows explicit run choices instead of tap-to-climb');
  }
  {
    const store = savedStore();
    const e = boot({ storage: store });
    const menu = e.ib.titleMenu();
    e.tapCanvasAt(menu.cont.x + menu.cont.w / 2, menu.cont.y + menu.cont.h / 2);
    ok(e.g.state === 'intro' && e.g.levelIndex === 2, 'clicking Continue resumes the checkpoint');
    ok(e.g.score === 1234 && e.g.lives === 2 && e.g.gear === 'boots', 'Continue click restores the snapshot');
  }
  {
    const store = savedStore();
    const e = boot({ storage: store });
    const menu = e.ib.titleMenu();
    e.tapCanvasAt(menu.newrun.x + menu.newrun.w / 2, menu.newrun.y + menu.newrun.h / 2);
    const c = cp(store);
    ok(e.g.state === 'intro' && e.g.levelIndex === 0 && e.g.score === 0 && e.g.lives === 3,
      'clicking New Run starts mountain 1');
    ok(c.levelIndex === 0 && c.score === 0 && c.lives === 3, 'clicking New Run replaces the old checkpoint');
  }
  {
    const e = boot();
    e.tapCanvasAt(10, 10);
    ok(e.g.state === 'intro' && e.g.levelIndex === 0, 'without a checkpoint a canvas tap still starts mountain 1');
  }
  {
    const store = savedStore();
    const t = boot({ touch: true, storage: store });
    t.frames(2);
    t.tapCanvasAt(10, 10);
    ok(t.g.state === 'title' && cp(store).levelIndex === 2, 'a touch canvas tap keeps the checkpoint');
    ok(!t.texts.some((x) => String(x).indexOf('TAP TO CLIMB') >= 0),
      'the touch title hides tap-to-climb while a checkpoint exists');
    t.tapMenu('continue');
    ok(t.g.state === 'intro' && t.g.levelIndex === 2 && t.g.score === 1234 && t.g.lives === 2,
      'touch Continue restores the checkpoint');
  }
  {
    const store = savedStore();
    const t = boot({ touch: true, storage: store });
    t.frames(2);
    t.tapMenu('newrun');
    ok(t.g.state === 'intro' && t.g.levelIndex === 0 && t.g.score === 0, 'touch New Run starts mountain 1');
  }
  {
    const t = boot({ touch: true });
    t.frames(2);
    t.tapCanvasAt(10, 10);
    ok(t.g.state === 'intro' && t.g.levelIndex === 0, 'without a checkpoint a touch canvas tap starts the run');
  }
  {
    const store = savedStore();
    const e = boot({ storage: store });
    const line = 'CONTINUE RESTARTS SLIPPERY STEPS FROM ITS START';
    ok(e.texts.some((t) => String(t) === line), 'the title states the Continue restart rule');
    for (const [vw, vh] of [[1920, 1080], [600, 280], [844, 390]]) {
      ok(line.length * 0.6 * 18 * (vh / 1080) <= 860 * (vh / 1080),
        'the Continue rule fits the panel at ' + vw + 'x' + vh);
    }
  }
}

// #41: no near-white fringe borders a transparent hole, and only fringe pixels changed.
{
  // tools/ is not published; this baseline only exists in the repository test tree.
  const baselinePath = path.join(__dirname, '..', 'tools', 'guardian_fringe_baseline.json');
  assert.ok(fs.existsSync(baselinePath), 'guardian fringe baseline missing at tools/guardian_fringe_baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  for (const rel of Object.keys(baseline.frames)) {
    const png = readPngAlpha(path.join(__dirname, rel.replace('web/assets/sprites/', 'assets/sprites/')));
    const w = png.w, h = png.h;
    const white = (x, y) => {
      const j = (y * w + x) * 4;
      return png.rgba[j + 3] > 0 && png.rgba[j] >= 150 && png.rgba[j + 1] >= 150 && png.rgba[j + 2] >= 150;
    };
    const seen = new Uint8Array(w * h), holes = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (png.rgba[i * 4 + 3] !== 0 || seen[i]) continue;
      const stack = [i]; seen[i] = 1; const pts = []; let border = false;
      while (stack.length) {
        const j = stack.pop(); pts.push(j);
        const jy = Math.floor(j / w), jx = j - jy * w;
        if (jx === 0 || jy === 0 || jx === w - 1 || jy === h - 1) border = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (png.rgba[k * 4 + 3] === 0 && !seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (!border) for (const j of pts) holes[j] = 1;
    }
    let fringe = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!white(x, y)) continue;
      if ((x > 0 && holes[y * w + x - 1]) || (x < w - 1 && holes[y * w + x + 1]) ||
        (y > 0 && holes[(y - 1) * w + x]) || (y < h - 1 && holes[(y + 1) * w + x])) fringe++;
    }
    ok(fringe === 0, rel.split('/').pop() + ' has no near-white fringe bordering holes (' + fringe + ')');

    const base = baseline.frames[rel];
    ok(png.w === base.w && png.h === base.h, rel.split('/').pop() + ' keeps its canvas size');
    const excluded = new Set(base.changed.map((q) => q[0] + ':' + q[1]));
    for (const q of base.changed) {
      const j = (q[1] * png.w + q[0]) * 4;
      const a = png.rgba[j + 3];
      ok(a === 0 || (png.rgba[j] < 150 && png.rgba[j + 1] < 150 && png.rgba[j + 2] < 150),
        rel.split('/').pop() + ' cleared or darkened fringe pixel ' + q.join(','));
    }
    const hash = crypto.createHash('sha256');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (excluded.has(x + ':' + y)) continue;
      const j = (y * w + x) * 4;
      hash.update(Buffer.from(png.rgba.slice(j, j + 4)));
    }
    ok(hash.digest('hex') === base.hash, rel.split('/').pop() + ' leaves every other pixel unchanged');
  }
}

console.log('\n' + checks + ' game-loop checks passed.');
