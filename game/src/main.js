// IRONVEIL — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. One state object owns the match; modules own
// their slice (map, player, weapons, bots, bomb, grenades, effects, audio,
// hud, input, rounds). ?shot=cover|play|objective|end&seed=N stages a
// deterministic frame for a capture, renders it twice, freezes it, sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap, SPAWNS, SITES } from './map.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPON_DEFS, WEAPON_ORDER } from './weapons.js';
import { createBots } from './bots.js';
import { createBomb, PLANT_SECONDS, FUSE_SECONDS } from './bomb.js';
import { createGrenades } from './grenades.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createRounds } from './rounds.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.night);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = createMap(scene);
const audio = createAudio();
const effects = createEffects(scene, camera);
const hud = createHud();
const rounds = createRounds();
const player = createPlayer(map.colliders, SPAWNS.attackers[0]);
const weapons = createWeapons(camera);
const bots = createBots(scene, map, random);
const bomb = createBomb(scene);
const grenades = createGrenades(scene, map);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = map.shootables.concat(bots.hitMeshes);
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

const game = {
  time: 0,
  started: false,
  frozen: false,
  buyMenuOpen: true,
  prevFiring: false,
  zoomFov: 74,
};

const hooks = {
  damagePlayer(amount, fromPos) {
    if (shot) return; // staged captures are never interrupted by bot fire
    const p = player.state;
    if (!p.alive || (rounds.state.phase !== 'LIVE' && rounds.state.phase !== 'PLANTED')) return;
    p.health -= amount;
    audio.hurt();
    hud.setHealth(p.health);
    const dx = fromPos.x - p.position.x;
    const dz = fromPos.z - p.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const relative = worldAngle + p.yaw;
    hud.damageFrom((relative * 180) / Math.PI);
    if (p.health <= 0) {
      p.health = 0;
      p.alive = false;
      rounds.onDeath();
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showOverlay('dead');
      checkElimination();
    }
  },
  botKilled(bot, killer) {
    const killerName = killer === player.state ? 'You' : killer.name || 'Unknown';
    const killerTeam = killer === player.state ? 'attackers' : killer.team;
    hud.killfeed(killerName, bot.name, !!bot.killedByHead, killerTeam);
    if (killer === player.state) {
      rounds.onKill(false);
      audio.kill();
    }
    checkElimination();
  },
  chargeDefused(bot) {
    endRound('defenders', 'Charge defused');
  },
};

function checkElimination() {
  if (shot) return; // staged captures never end a round
  const r = rounds.state;
  if (r.phase !== 'LIVE' && r.phase !== 'PLANTED') return;
  const atkAlive = bots.aliveCount('attackers') + (player.state.alive ? 1 : 0);
  const defAlive = bots.aliveCount('defenders');
  if (defAlive === 0) {
    endRound('attackers', 'Defenders eliminated');
  } else if (atkAlive === 0 && !bomb.state.planted) {
    endRound('defenders', 'Attackers eliminated');
  }
}

function endRound(winner, reason) {
  const r = rounds.state;
  if (r.phase === 'END' || r.phase === 'MATCH') return;
  const result = rounds.endRound(winner, reason);
  const won = winner === 'attackers';
  if (won) audio.roundWin();
  else audio.roundLose();
  hud.showBanner(
    won ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — Attackers ${rounds.state.scoreAtk} · Defenders ${rounds.state.scoreDef}`,
    won ? 'win' : 'lose',
    3400,
  );
  hud.setBomb('', null);
  if (document.pointerLockElement) document.exitPointerLock();
  if (result.matchOver) {
    setTimeout(() => hud.showMatchOverlay(won, rounds.state.scoreAtk, rounds.state.scoreDef), 1200);
  }
}

function startMatch() {
  rounds.state.round = 1;
  rounds.state.scoreAtk = 0;
  rounds.state.scoreDef = 0;
  rounds.state.money = 900;
  rounds.state.kills = 0;
  rounds.state.deaths = 0;
  rounds.state.plants = 0;
  rounds.state.matchWinner = null;
  weapons.state.owned = { pistol: true, smg: false, rifle: true, marksman: false };
  weapons.switchTo('rifle');
  startRound();
}

function startRound() {
  player.reset(SPAWNS.attackers[1 % SPAWNS.attackers.length]);
  player.state.yaw = 0;
  weapons.refillAmmo();
  grenades.resetRound();
  bomb.reset();
  bots.resetRound(rounds.state.round, SPAWNS);
  rounds.startRound();
  game.buyMenuOpen = true;
  hud.setHealth(100);
  hud.setMoney(rounds.state.money);
  hud.setScore(rounds.state.scoreAtk, rounds.state.scoreDef, rounds.state.round);
  hud.setBomb('', null);
  hud.setHint('');
  hud.setChargeCarry(true);
  syncHud();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    game.started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (rounds.state.phase === 'MATCH') {
    hud.showMatchOverlay(
      rounds.state.matchWinner === 'attackers',
      rounds.state.scoreAtk,
      rounds.state.scoreDef,
    );
  } else if (!player.state.alive) {
    hud.showOverlay('dead');
  } else if (rounds.state.phase !== 'END') {
    hud.showOverlay(game.started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'MATCH') {
    startMatch();
    input.requestLock();
    return;
  }
  if (rounds.state.phase === 'END') return;
  input.requestLock();
});

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const p = player.state;
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function shoot() {
  const def = weapons.def();
  if (!weapons.takeRound()) {
    audio.dryFire();
    weapons.reload();
    return;
  }
  const spread = weapons.spread(player.groundSpeed()) * (weapons.state.zoomed ? 0.4 : 1);
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  player.eyePosition(eyePos);
  scene.updateMatrixWorld(true);
  raycaster.set(eyePos, direction);
  const hits = raycaster.intersectObjects(shootables, false);
  const end = hits.length ? hits[0].point : tmpVec.copy(direction).multiplyScalar(60).add(eyePos);
  weapons.muzzleWorld(muzzlePos);
  effects.tracer(muzzlePos, end, true);
  audio.shot('player', 0);
  bots.alert(player.state.position, 26);
  weapons.pullTrigger();
  player.recoil(0.006 + def.kick * 0.6, (random() * 2 - 1) * def.kick * 0.4);
  if (hits.length) {
    const hit = hits[0];
    const hitBot = hit.object.userData.bot;
    if (hitBot && hitBot.alive) {
      const isHead = hit.object.userData.part === 'head';
      const damage = def.damage * (isHead ? def.headMult : 1);
      const killed = hitBot.health - damage <= 0;
      // damageBot reports the kill through hooks.botKilled (killfeed, money,
      // sound) — this call only shows the hit marker and the headshot tick.
      bots.damageBot(hitBot, damage, player.state, { ...botCtx(), hooks }, isHead);
      hud.hitMarker(killed, killed ? 400 : 90);
      if (!killed) audio.hit();
      checkElimination();
    } else {
      effects.impact(hit.point);
    }
  }
  hud.setAmmo(weapons.state.ammo[weapons.state.current].mag, weapons.state.ammo[weapons.state.current].reserve, weapons.state.current);
}

function botCtx() {
  return {
    player,
    time: game.time,
    phase: rounds.state.phase,
    smoke: grenades.clouds,
    spikePlanted: bomb.state.planted,
    spikeSite: bomb.state.site,
    spikePos: bomb.state.position,
    effects,
    audio,
    hooks,
  };
}

function grenadeCtx() {
  return { time: game.time, effects, audio, bots };
}

function syncHud() {
  const r = rounds.state;
  const slot = weapons.state.ammo[weapons.state.current];
  hud.setHealth(player.state.health);
  hud.setAmmo(slot.mag, slot.reserve, weapons.state.current);
  hud.setMoney(r.money);
  hud.setGrenades(grenades.state.smoke, grenades.state.flash, grenades.state.selected);
  hud.setTimer(r.phaseLeft, r.phase);
  hud.setScore(r.scoreAtk, r.scoreDef, r.round);
  const spreadPx = 6 + weapons.spread(player.groundSpeed()) * 900 + player.groundSpeed() * 1.5;
  hud.setCrosshairGap(spreadPx);
  hud.setChargeCarry(bomb.state.carried && player.state.alive);
  if (bomb.state.planted) {
    const defusing = bots.bots.some((b) => b.alive && b.team === 'defenders' && b.state === 'DEFUSE');
    hud.setBomb(
      defusing ? 'DEFUSE IN PROGRESS — STOP THEM' : `CHARGE PLANTED · ${Math.ceil(bomb.state.fuseLeft)}s`,
      defusing ? 'danger' : 'planted',
    );
  } else if (bomb.state.plantProgress > 0) {
    hud.setBomb(`PLANTING ${Math.round((bomb.state.plantProgress / PLANT_SECONDS) * 100)}%`, 'planting');
  } else {
    hud.setBomb('', null);
  }
}

function step(dt) {
  game.time += dt;
  const r = rounds.state;
  const phaseEvent = rounds.tick(dt);
  if (phaseEvent === 'buy-over') {
    game.buyMenuOpen = false;
    hud.showBanner(`ROUND ${r.round}`, 'Plant the charge at A or B', '', 2200);
  } else if (phaseEvent === 'time-up') {
    endRound('defenders', 'Time expired');
    return;
  } else if (phaseEvent === 'end-over') {
    if (rounds.nextRound()) startRound();
    return;
  }

  // Keys that fire once per press.
  for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
    if (!input.consumePressed(code)) continue;
    if (r.phase === 'BUY') {
      const res = rounds.buy(code, weapons, grenades);
      if (res && res.startsWith('bought')) audio.buy();
    } else if (r.phase === 'LIVE' || r.phase === 'PLANTED') {
      // Same mapping as the buy menu: 1 SMG, 2 rifle, 3 marksman. Q cycles
      // everything owned, pistol included.
      if (code === 'Digit1') weapons.switchTo('smg');
      else if (code === 'Digit2') weapons.switchTo('rifle');
      else if (code === 'Digit3') weapons.switchTo('marksman');
      else if (code === 'Digit4') grenades.state.selected = 'smoke';
      else grenades.state.selected = 'flash';
    }
  }
  if (input.consumePressed('KeyQ') && (r.phase === 'LIVE' || r.phase === 'PLANTED')) {
    const owned = WEAPON_ORDER.filter((k) => weapons.state.owned[k]);
    const next = owned[(owned.indexOf(weapons.state.current) + 1) % owned.length];
    weapons.switchTo(next);
  }
  if (input.consumePressed('KeyB') && r.phase === 'BUY') game.buyMenuOpen = !game.buyMenuOpen;
  if (input.consumePressed('KeyG') && (r.phase === 'LIVE' || r.phase === 'PLANTED') && player.state.alive) {
    player.eyePosition(eyePos);
    camera.getWorldDirection(direction);
    grenades.throwSelected(eyePos, direction, grenadeCtx());
  }
  if (input.consumePressed('KeyR')) {
    if (weapons.reload()) audio.reload();
  }

  // Movement + look are read every step; firing is held for autos, edged for semis.
  const look = input.takeLook();
  player.look(look.x, look.y);
  player.state.speedFactor = weapons.def().moveSpeed;
  player.step(dt, input.state.keys);
  weapons.step(dt);

  const live = (r.phase === 'LIVE' || r.phase === 'PLANTED') && player.state.alive;
  if (live && input.state.firing && weapons.ready()) {
    const def = weapons.def();
    if (def.auto || !game.prevFiring) shoot();
  }
  game.prevFiring = input.state.firing;

  // Zoom: right mouse, marksman only.
  const wantZoom = input.state.zoomHeld && weapons.state.current === 'marksman' && live;
  weapons.state.zoomed = wantZoom;
  game.zoomFov += ((wantZoom ? 74 / WEAPON_DEFS.marksman.zoom : 74) - game.zoomFov) * Math.min(1, dt * 12);
  camera.fov = game.zoomFov;
  camera.updateProjectionMatrix();

  // Plant: hold E inside a site, standing near still.
  if (live && r.phase === 'LIVE') {
    const holding = input.state.keys.has('KeyE') && player.groundSpeed() < 1.5;
    const planted = bomb.plantStep(dt, player.state.position, holding);
    if (planted === 'planted') {
      rounds.onPlant();
      audio.plantBeep();
      hud.showBanner('CHARGE PLANTED', 'Defend it — 35 seconds to detonation', 'win', 3000);
      bots.alert(bomb.state.position, 60);
    }
    if (holding && bomb.state.plantProgress > 0 && Math.floor(game.time * 4) !== Math.floor((game.time - dt) * 4)) {
      audio.plantBeep();
    }
  }
  if (bomb.state.planted) {
    const event = bomb.fuseStep(dt, { beep: (fuseLeft) => audio.beep(fuseLeft) });
    bomb.blink(game.time);
    if (event === 'detonated') {
      effects.explosion(bomb.state.position);
      effects.shake(1);
      audio.explosion();
      endRound('attackers', 'Charge detonated');
      return;
    }
  }

  bots.stepAll(dt, botCtx());
  grenades.step(dt, grenadeCtx());
  effects.step(dt);

  // Hint line: the one thing the player should do right now.
  if (!player.state.alive) hud.setHint('');
  else if (r.phase === 'BUY') hud.setHint('Buy phase — [1–5] buy, [B] hide menu');
  else if (r.phase === 'LIVE' && bomb.state.carried && bomb.siteAt(player.state.position.x, player.state.position.z)) {
    hud.setHint('Hold [E] to plant the charge');
  } else if (r.phase === 'LIVE') hud.setHint('Push a site — A furnace hall west, B rail yard east');
  else if (r.phase === 'PLANTED') hud.setHint('Charge planted — hold the site');
  else hud.setHint('');

  hud.showBuyMenu(game.buyMenuOpen && r.phase === 'BUY', r.money, weapons.state.owned);
  syncHud();
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    effects.dampShake(dt);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  game.buyMenuOpen = false;
  if (name === 'cover') {
    // Clean gameplay cover: mid-round, no buy menu, the player looking up
    // mid toward two defenders holding the doors, allies at the flanks.
    startRound();
    rounds.state.phase = 'LIVE';
    rounds.state.phaseLeft = 62;
    player.state.position.set(2.5, 0, 9);
    player.state.yaw = 0;
    player.state.pitch = 0;
    const defs = bots.bots.filter((b) => b.team === 'defenders');
    defs[0].position.set(-1.5, 0, 3);
    defs[0].alive = true;
    defs[0].state = 'HOLD';
    defs[0].path = [];
    defs[1].position.set(2, 0, 1);
    defs[1].alive = true;
    defs[1].state = 'HOLD';
    defs[1].path = [];
    bots.bots.filter((b) => b.team === 'attackers').forEach((b, i) => {
      b.position.set(-5 + i * 10, 0, 11);
      b.alive = true;
      b.state = 'HOLD';
    });
    settle(10);
    syncCamera();
  } else if (name === 'play') {
    startRound();
    rounds.state.phase = 'LIVE';
    rounds.state.phaseLeft = 62;
    // Stage a mid firefight in the open mid-low ground (south of the mid
    // wall, so no wall stands between the player and the defenders), and
    // clear of the mid ingot stack, whose corner grazes the line of fire to
    // the west lane. Pin their paths so they hold still for the capture.
    player.state.position.set(2.5, 0, 9);
    player.state.yaw = 0;
    player.state.pitch = 0;
    const defs = bots.bots.filter((b) => b.team === 'defenders');
    defs[0].position.set(-1.5, 0, 3);
    defs[0].alive = true;
    defs[0].state = 'HOLD';
    defs[0].path = [];
    defs[1].position.set(2, 0, 1);
    defs[1].alive = true;
    defs[1].state = 'HOLD';
    defs[1].path = [];
    bots.bots.filter((b) => b.team === 'attackers').forEach((b, i) => {
      b.position.set(-5 + i * 10, 0, 11);
      b.alive = true;
      b.state = 'HOLD';
    });
    settle(10);
    // Player drops the first defender with a headshot (one clean kill for
    // the feed), then works the second defender with body shots, re-aiming
    // each time because the target strafes once alerted.
    aimAt(new THREE.Vector3(defs[0].position.x, defs[0].position.y + 1.53, defs[0].position.z));
    shoot();
    settle(8);
    for (let i = 0; i < 2; i += 1) {
      aimAt(new THREE.Vector3(defs[1].position.x, defs[1].position.y + 1.35, defs[1].position.z));
      shoot();
      settle(6);
    }
    // A smoke grenade blooms at the doors while the second defender holds.
    grenades.state.smoke = 1;
    player.eyePosition(eyePos);
    camera.getWorldDirection(direction);
    grenades.throwSelected(eyePos, direction, grenadeCtx());
    settle(40);
    aimAt(new THREE.Vector3(defs[1].position.x, defs[1].position.y + 1.35, defs[1].position.z));
    shoot();
    settle(2);
  } else if (name === 'objective') {
    // Charge planted at Site A, a defender channelling the defuse: the
    // player stands in the furnace hall's east door, looking in at the site.
    startRound();
    rounds.onPlant();
    rounds.state.phaseLeft = 20;
    bomb.state.planted = true;
    bomb.state.carried = false;
    bomb.state.site = 'A';
    bomb.state.fuseLeft = 20;
    bomb.state.position.set(SITES.A.x, 0.12, SITES.A.z);
    bomb.group.position.copy(bomb.state.position);
    bomb.group.visible = true;
    player.state.position.set(-18.5, 0, -8.2);
    const defs = bots.bots.filter((b) => b.team === 'defenders');
    defs[0].position.set(-20, 0, -13.2);
    defs[0].alive = true;
    defs[0].state = 'DEFUSE';
    defs[0].path = [];
    defs[1].position.set(-17, 0, -12);
    defs[1].alive = true;
    defs[1].state = 'HOLD';
    defs[1].path = [];
    defs[2].position.set(-23.5, 0, -13.5);
    defs[2].alive = false;
    defs[2].fall = 1;
    defs[2].group.rotation.x = -1.5;
    defs[2].group.position.y = -0.1;
    settle(6);
    aimAt(new THREE.Vector3(SITES.A.x, 1, SITES.A.z));
  } else {
    // end: attackers won the round by detonation at Site A.
    startRound();
    rounds.state.scoreAtk = 1;
    rounds.state.money = 900 + 250 + 300; // plant + round win
    rounds.state.phase = 'END';
    rounds.state.phaseLeft = 4;
    rounds.state.endReason = 'Charge detonated';
    bomb.state.site = 'A';
    bomb.state.fuseLeft = 0;
    bomb.state.exploded = true;
    bomb.state.carried = false; // the charge already did its work
    bomb.state.planted = false; // the fuse already ran out; HUD shows no timer
    bomb.state.position.set(SITES.A.x, 0.12, SITES.A.z);
    bomb.group.position.copy(bomb.state.position);
    bomb.group.visible = true;
    effects.explosion(bomb.state.position);
    // Stand in the furnace hall's east door, looking in at the site: the ring,
    // the ingots and the fallen defender fill the frame.
    player.state.position.set(-18.5, 0, -8.2);
    const defs = bots.bots.filter((b) => b.team === 'defenders');
    defs[0].position.set(-23.5, 0, -13.5);
    defs[0].alive = false;
    defs[0].fall = 1;
    defs[0].group.rotation.x = -1.5;
    defs[0].group.position.y = -0.1;
    settle(6);
    aimAt(new THREE.Vector3(SITES.A.x, 1, SITES.A.z));
    hud.showBanner('ROUND WON', 'Charge detonated — Attackers 1 · Defenders 0', 'win', 60000);
    hud.setScore(1, 0, 1);
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startRound();
syncCamera();
// Debug handle for live playtesting (bot health, round state, aim + fire).
// Harmless in production: read-only inspection plus the same inputs a
// player has; no cheats wired to it.
window.__ironveil = { player, bots, rounds, bomb, grenades, weapons, game, input, shoot, aimAt, startRound, startMatch };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
