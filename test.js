'use strict';

const assert = require('assert');
const G = require('./game.js');

const EPS = 0.02;
let checks = 0;

function ok(condition, label) {
  assert.ok(condition, label);
  checks++;
  console.log('PASS ' + label);
}

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    label + ' (expected ' + expected + ', got ' + actual + ')');
  checks++;
  console.log('PASS ' + label);
}

const block = { x: 100, y: 120, w: 64, h: 64 };

ok(G.computeJumpVelocity(0) === 0, 'zero height needs no jump velocity');
near(G.JUMP_VELOCITY, 2049.16, 1, '12 m jump velocity matches prototype constants');

const t = G.sweptAABB(100, 0, 40, 60, 0, 200, 100, 120, 64, 64);
near(t, 0.3, 0.001, 'swept AABB finds the exact time of impact');

ok(G.sweptAABB(100, 0, 40, 60, 0, -200, 100, 120, 64, 64) === null,
  'swept AABB ignores movement away from a block');

ok(G.sweptAABB(0, 60, 40, 60, -10, 0, 100, 120, 64, 64) === null,
  'touching a floor top is not a horizontal hit');

const faller = { x: 100, y: 0, w: 40, h: 60, vx: 0, vy: 200 };
let hit = G.resolveMove(faller, 0, 200, [block]);
ok(hit.grounded, 'falling entity reports grounded on contact');
near(faller.y, 60, EPS, 'falling entity lands exactly on the block top');
ok(faller.vy === 0, 'landing clears vertical velocity');

const tunneller = { x: 100, y: 0, w: 40, h: 60, vx: 0, vy: 5000 };
hit = G.resolveMove(tunneller, 0, 5000, [block]);
near(tunneller.y, 60, EPS, 'swept collision prevents tunnelling through ice');

const jumper = { x: 100, y: 200, w: 40, h: 60, vx: 0, vy: -400 };
hit = G.resolveMove(jumper, 0, -400, [block]);
near(jumper.y, 184, EPS, 'jumping entity stops under a ceiling');
ok(!hit.grounded, 'ceiling contact is not a landing');

const wall = { x: 200, y: 0, w: 64, h: 60 };
const walker = { x: 0, y: 0, w: 40, h: 60, vx: 0, vy: 0 };
hit = G.resolveMove(walker, 300, 0, [wall]);
near(walker.x, 160, EPS, 'horizontal sweep stops at the block edge');
ok(hit.hitWall, 'horizontal sweep reports a wall');

const onFloor = { x: 0, y: 60, w: 40, h: 60, vx: 0, vy: 0 };
hit = G.resolveMove(onFloor, 10, 0, [block]);
near(onFloor.x, 10, 0.001, 'walking on a floor top does not snag');
ok(!hit.hitWall, 'floor top does not report a wall');

const diagonal = { x: 100, y: 0, w: 40, h: 60, vx: 0, vy: 0 };
hit = G.resolveMove(diagonal, 30, 300, [block]);
near(diagonal.y, 60, EPS, 'diagonal descent still lands on the block top');

const apex = { x: 0, y: 0, w: 40, h: 60, vx: 0, vy: -G.JUMP_VELOCITY };
let minY = 0;
for (let i = 0; i < 300; i++) {
  apex.vy += G.GRAVITY * G.DT;
  apex.y += apex.vy * G.DT;
  minY = Math.min(minY, apex.y);
}
near(-minY, G.JUMP_HEIGHT, 20, 'discrete jump apex stays within one step of 12 m');

ok(G.rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }) === false,
  'rectangles that only share an edge do not overlap');

ok(G.rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }) === true,
  'overlapping rectangles are detected');

console.log('\n' + checks + ' checks passed.');
