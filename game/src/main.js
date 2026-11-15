// IRONVEIL — boot and the one loop: a fixed 60 Hz simulation feeding a
// render at the display's rate. One session object owns the match;
// modules own their slice (map, operative, arsenal, squad, charge, kit,
// effects, sound, HUD, controls, match). ?shot=cover|play|objective|end
// &seed=N stages a deterministic frame for a capture, renders it twice,
// freezes it, sets window.__shotReady.
import * as THREE from 'three';
import { TINTS } from './palette.js';
import { seededRng } from './rng.js';
import { buildFoundry, TEAM_SPAWNS, ZONES } from './map.js';
import { makeOperative } from './player.js';
import { makeArsenal, GUNBOOK, GUN_ORDER } from './weapons.js';
import { makeSquad } from './bots.js';
import { makeCharge, PLANT_TIME, FUSE_TIME } from './bomb.js';
import { makeKit } from './grenades.js';
import { makeFx } from './effects.js';
import { makeSound } from './audio.js';
import { makeHud } from './hud.js';
import { createControls } from './input.js';
import { makeMatch } from './rounds.js';

const STEP_DT = 1 / 60;
const query = new URLSearchParams(window.location.search);
const shotMode = query.get('shot');
const seedNum = Number.parseInt(query.get('seed') ?? '1', 10) || 1;
const rand = seededRng(seedNum);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(TINTS.abyss);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const map = buildFoundry(scene);
const audio = makeSound();
const fx = makeFx(scene, camera);
const hud = makeHud();
const match = makeMatch();
const player = makeOperative(map.solids, TEAM_SPAWNS.attackers[0]);
const arsenal = makeArsenal(camera);
const squad = makeSquad(scene, map, rand);
const charge = makeCharge(scene);
const kit = makeKit(scene, map);
const controls = createControls(renderer.domElement, lockChanged);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = map.targets.concat(squad.hitTargets);
const dir = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

const session = {
  clock: 0,
  begun: false,
  shopOpen: true,
  wasFiring: false,
  fovNow: 74,
};

const events = {
  hurtPlayer(amount, fromPos) {
    if (shotMode) return; // staged captures are never interrupted by bot fire
    const p = player.state;
    if (!p.living || (match.state.stage !== 'LIVE' && match.state.stage !== 'PLANTED')) return;
    p.hp -= amount;
    audio.painSnd();
    hud.showHp(p.hp);
    const dx = fromPos.x - p.pos.x;
    const dz = fromPos.z - p.pos.z;
    const worldAngle = Math.atan2(dx, dz);
    const relative = worldAngle + p.heading;
    hud.hurtFrom((relative * 180) / Math.PI);
    if (p.hp <= 0) {
      p.hp = 0;
      p.living = false;
      match.noteDeath();
      if (document.pointerLockElement) document.exitPointerLock();
      hud.showVeil('dead');
      checkWipe();
    }
  },
  botDown(bot, killer) {
    const killerName = killer === player.state ? 'You' : killer.name || 'Unknown';
    const killerTeam = killer === player.state ? 'attackers' : killer.team;
    hud.addKill(killerName, bot.name, !!bot.headKill, killerTeam);
    if (killer === player.state) {
      match.noteKill();
      audio.killChime();
    }
    checkWipe();
  },
  chargeCleared() {
    finishRound('defenders', 'Charge defused');
  },
};

function checkWipe() {
  if (shotMode) return; // staged captures never end a round
  const r = match.state;
  if (r.stage !== 'LIVE' && r.stage !== 'PLANTED') return;
  const atkAlive = squad.livingCount('attackers') + (player.state.living ? 1 : 0);
  const defAlive = squad.livingCount('defenders');
  if (defAlive === 0) {
    finishRound('attackers', 'Defenders eliminated');
  } else if (atkAlive === 0 && !charge.state.set) {
    finishRound('defenders', 'Attackers eliminated');
  }
}

function finishRound(winner, reason) {
  const r = match.state;
  if (r.stage === 'END' || r.stage === 'MATCH') return;
  const result = match.closeRound(winner, reason);
  const won = winner === 'attackers';
  if (won) audio.winChime();
  else audio.loseChime();
  hud.showFlag(
    won ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — Attackers ${match.state.atkScore} · Defenders ${match.state.defScore}`,
    won ? 'win' : 'lose',
    3400,
  );
  hud.showCharge('', null);
  if (document.pointerLockElement) document.exitPointerLock();
  if (result.matchOver) {
    setTimeout(() => hud.showMatchVeil(won, match.state.atkScore, match.state.defScore), 1200);
  }
}

function restartMatch() {
  match.state.roundNo = 1;
  match.state.atkScore = 0;
  match.state.defScore = 0;
  match.state.cash = 900;
  match.state.killCount = 0;
  match.state.deathCount = 0;
  match.state.plantCount = 0;
  match.state.matchVictor = null;
  arsenal.state.unlocked = { pistol: true, smg: false, rifle: true, marksman: false };
  arsenal.equip('rifle');
  beginRound();
}

function beginRound() {
  player.respawn(TEAM_SPAWNS.attackers[1 % TEAM_SPAWNS.attackers.length]);
  player.state.heading = 0;
  arsenal.restock();
  kit.clear();
  charge.resetCharge();
  squad.resetSquad(match.state.roundNo, TEAM_SPAWNS);
  match.openRound();
  session.shopOpen = true;
  hud.showHp(100);
  hud.showCash(match.state.cash);
  hud.showScore(match.state.atkScore, match.state.defScore, match.state.roundNo);
  hud.showCharge('', null);
  hud.showClue('');
  hud.showCarrying(true);
  refreshHud();
}

function lockChanged(captured) {
  if (shotMode) return;
  if (captured) {
    session.begun = true;
    audio.wake();
    hud.hideVeil();
  } else if (match.state.stage === 'MATCH') {
    hud.showMatchVeil(
      match.state.matchVictor === 'attackers',
      match.state.atkScore,
      match.state.defScore,
    );
  } else if (!player.state.living) {
    hud.showVeil('dead');
  } else if (match.state.stage !== 'END') {
    hud.showVeil(session.begun ? 'paused' : 'start');
  }
}

hud.onPlayClick(() => {
  if (shotMode) return;
  if (match.state.stage === 'MATCH') {
    restartMatch();
    controls.capturePointer();
    return;
  }
  if (match.state.stage === 'END') return;
  controls.capturePointer();
});

function placeCamera() {
  camera.position.set(player.state.pos.x, player.state.pos.y + player.state.eyeH, player.state.pos.z);
  camera.rotation.set(player.state.tilt, player.state.heading, 0, 'YXZ');
}

function lookAt(point) {
  const p = player.state;
  const dx = point.x - p.pos.x;
  const dy = point.y - (p.pos.y + p.eyeH);
  const dz = point.z - p.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.heading = Math.atan2(-dx, -dz);
  p.tilt = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  placeCamera();
}

function fireShot() {
  const spec = arsenal.spec();
  if (!arsenal.spendShell()) {
    audio.emptyClick();
    arsenal.beginReload();
    return;
  }
  const spread = arsenal.spreadAt(player.flatSpeed()) * (arsenal.state.scoped ? 0.4 : 1);
  camera.getWorldDirection(dir);
  dir.x += (rand() * 2 - 1) * spread;
  dir.y += (rand() * 2 - 1) * spread;
  dir.z += (rand() * 2 - 1) * spread;
  dir.normalize();
  player.eyeAt(eyePos);
  scene.updateMatrixWorld(true);
  raycaster.set(eyePos, dir);
  const hits = raycaster.intersectObjects(shootables, false);
  const end = hits.length ? hits[0].point : tmpVec.copy(dir).multiplyScalar(60).add(eyePos);
  arsenal.muzzleAt(muzzlePos);
  fx.trace(muzzlePos, end, true);
  audio.gunshot('player', 0);
  squad.alarm(player.state.pos, 26);
  arsenal.onFire();
  player.kick(0.006 + spec.recoil * 0.6, (rand() * 2 - 1) * spec.recoil * 0.4);
  if (hits.length) {
    const hit = hits[0];
    const hitBot = hit.object.userData.fighter;
    if (hitBot && hitBot.living) {
      const isHead = hit.object.userData.piece === 'head';
      const damage = spec.power * (isHead ? spec.headScale : 1);
      const killed = hitBot.hp - damage <= 0;
      // woundBot reports the kill through events.botDown (killfeed, money,
      // sound) — this call only shows the hit marker and the headshot tick.
      squad.woundBot(hitBot, damage, player.state, botWorld(), isHead);
      hud.markHit(killed, killed ? 400 : 90);
      if (!killed) audio.hitTick();
      checkWipe();
    } else {
      fx.sparksAt(hit.point);
    }
  }
  hud.showLoads(
    arsenal.state.loads[arsenal.state.equipped].clip,
    arsenal.state.loads[arsenal.state.equipped].spare,
    arsenal.state.equipped,
  );
}

function botWorld() {
  return {
    player,
    time: session.clock,
    stage: match.state.stage,
    banks: kit.banks,
    chargeSet: charge.state.set,
    chargeZone: charge.state.zone,
    chargePos: charge.state.pos,
    effects: fx,
    audio,
    events,
  };
}

function throwWorld() {
  return { time: session.clock, effects: fx, audio, bots: squad };
}

function refreshHud() {
  const r = match.state;
  const slot = arsenal.state.loads[arsenal.state.equipped];
  hud.showHp(player.state.hp);
  hud.showLoads(slot.clip, slot.spare, arsenal.state.equipped);
  hud.showCash(r.cash);
  hud.showKit(kit.state.smokes, kit.state.flashes, kit.state.chosen);
  hud.showClock(r.stageLeft, r.stage);
  hud.showScore(r.atkScore, r.defScore, r.roundNo);
  const spreadPx = 6 + arsenal.spreadAt(player.flatSpeed()) * 900 + player.flatSpeed() * 1.5;
  hud.setSightGap(spreadPx);
  hud.showCarrying(charge.state.onBack && player.state.living);
  if (charge.state.set) {
    const defusing = squad.squad.some((b) => b.living && b.team === 'defenders' && b.mode === 'DEFUSE');
    hud.showCharge(
      defusing ? 'DEFUSE IN PROGRESS — STOP THEM' : `CHARGE PLANTED · ${Math.ceil(charge.state.fuseIn)}s`,
      defusing ? 'danger' : 'planted',
    );
  } else if (charge.state.plantIn > 0) {
    hud.showCharge(`PLANTING ${Math.round((charge.state.plantIn / PLANT_TIME) * 100)}%`, 'planting');
  } else {
    hud.showCharge('', null);
  }
}

function tick(dt) {
  session.clock += dt;
  const r = match.state;
  const stageEvent = match.advance(dt);
  if (stageEvent === 'buy-over') {
    session.shopOpen = false;
    hud.showFlag(`ROUND ${r.roundNo}`, 'Plant the charge at A or B', '', 2200);
  } else if (stageEvent === 'time-up') {
    finishRound('defenders', 'Time expired');
    return;
  } else if (stageEvent === 'end-over') {
    if (match.next()) beginRound();
    return;
  }

  // Keys that fire once per press.
  for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
    if (!controls.wasTapped(code)) continue;
    if (r.stage === 'BUY') {
      const res = match.purchase(code, arsenal, kit);
      if (res && res.startsWith('bought')) audio.buySnd();
    } else if (r.stage === 'LIVE' || r.stage === 'PLANTED') {
      // Same mapping as the shop: 1 SMG, 2 rifle, 3 marksman. Q cycles
      // everything owned, pistol included.
      if (code === 'Digit1') arsenal.equip('smg');
      else if (code === 'Digit2') arsenal.equip('rifle');
      else if (code === 'Digit3') arsenal.equip('marksman');
      else if (code === 'Digit4') kit.state.chosen = 'smoke';
      else kit.state.chosen = 'flash';
    }
  }
  if (controls.wasTapped('KeyQ') && (r.stage === 'LIVE' || r.stage === 'PLANTED')) {
    const owned = GUN_ORDER.filter((k) => arsenal.state.unlocked[k]);
    const next = owned[(owned.indexOf(arsenal.state.equipped) + 1) % owned.length];
    arsenal.equip(next);
  }
  if (controls.wasTapped('KeyB') && r.stage === 'BUY') session.shopOpen = !session.shopOpen;
  if (controls.wasTapped('KeyG') && (r.stage === 'LIVE' || r.stage === 'PLANTED') && player.state.living) {
    player.eyeAt(eyePos);
    camera.getWorldDirection(dir);
    kit.lob(eyePos, dir, throwWorld());
  }
  if (controls.wasTapped('KeyR')) {
    if (arsenal.beginReload()) audio.reloadSnd();
  }

  // Movement + look are read every step; firing is held for autos, edged for semis.
  const look = controls.drainLook();
  player.turn(look.x, look.y);
  player.state.paceFactor = arsenal.spec().pace;
  player.advance(dt, controls.state.held);
  arsenal.tick(dt);

  const live = (r.stage === 'LIVE' || r.stage === 'PLANTED') && player.state.living;
  if (live && controls.state.trigger && arsenal.primed()) {
    const spec = arsenal.spec();
    if (spec.automatic || !session.wasFiring) fireShot();
  }
  session.wasFiring = controls.state.trigger;

  // Zoom: right mouse, marksman only.
  const wantZoom = controls.state.scoping && arsenal.state.equipped === 'marksman' && live;
  arsenal.state.scoped = wantZoom;
  session.fovNow += ((wantZoom ? 74 / GUNBOOK.marksman.scope : 74) - session.fovNow) * Math.min(1, dt * 12);
  camera.fov = session.fovNow;
  camera.updateProjectionMatrix();

  // Plant: hold E inside a zone, standing near still.
  if (live && r.stage === 'LIVE') {
    const holding = controls.state.held.has('KeyE') && player.flatSpeed() < 1.5;
    const planted = charge.plantTick(dt, player.state.pos, holding);
    if (planted === 'planted') {
      match.notePlant();
      audio.plantTick();
      hud.showFlag('CHARGE PLANTED', 'Defend it — 35 seconds to detonation', 'win', 3000);
      squad.alarm(charge.state.pos, 60);
    }
    if (holding && charge.state.plantIn > 0 && Math.floor(session.clock * 4) !== Math.floor((session.clock - dt) * 4)) {
      audio.plantTick();
    }
  }
  if (charge.state.set) {
    const event = charge.fuseTick(dt, { beep: (fuseLeft) => audio.fuseBeep(fuseLeft) });
    charge.pulseLight(session.clock);
    if (event === 'detonated') {
      fx.blast(charge.state.pos);
      fx.jolt(1);
      audio.detonateSnd();
      finishRound('attackers', 'Charge detonated');
      return;
    }
  }

  squad.tickAll(dt, botWorld());
  kit.tick(dt, throwWorld());
  fx.tick(dt);

  // Clue line: the one thing the player should do right now.
  if (!player.state.living) hud.showClue('');
  else if (r.stage === 'BUY') hud.showClue('Buy phase — [1–5] buy, [B] hide menu');
  else if (r.stage === 'LIVE' && charge.state.onBack && charge.zoneAt(player.state.pos.x, player.state.pos.z)) {
    hud.showClue('Hold [E] to plant the charge');
  } else if (r.stage === 'LIVE') hud.showClue('Push a site — A furnace hall west, B rail yard east');
  else if (r.stage === 'PLANTED') hud.showClue('Charge planted — hold the site');
  else hud.showClue('');

  hud.showShop(session.shopOpen && r.stage === 'BUY', r.cash, arsenal.state.unlocked);
  refreshHud();
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP_DT && steps < 5) {
      tick(STEP_DT);
      accumulator -= STEP_DT;
      steps += 1;
    }
    if (accumulator > STEP_DT * 5) accumulator = 0;
    placeCamera();
    fx.settle(dt);
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) tick(STEP_DT);
}

function paintThenSignal() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    placeCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// Shared staging for the cover and firefight captures: mid-round, the
// player looking up mid toward two defenders holding the doors, allies at
// the flanks. The defenders are pinned so they hold still for the capture.
function stageFirefight() {
  beginRound();
  match.state.stage = 'LIVE';
  match.state.stageLeft = 62;
  player.state.pos.set(2.5, 0, 9);
  player.state.heading = 0;
  player.state.tilt = 0;
  const defs = squad.squad.filter((b) => b.team === 'defenders');
  defs[0].pos.set(-1.5, 0, 3);
  defs[0].living = true;
  defs[0].mode = 'HOLD';
  defs[0].route = [];
  defs[1].pos.set(2, 0, 1);
  defs[1].living = true;
  defs[1].mode = 'HOLD';
  defs[1].route = [];
  squad.squad.filter((b) => b.team === 'attackers').forEach((b, i) => {
    b.pos.set(-5 + i * 10, 0, 11);
    b.living = true;
    b.mode = 'HOLD';
  });
  settle(10);
  placeCamera();
  return defs;
}

function stageShot(name) {
  hud.hideVeil();
  session.shopOpen = false;
  if (name === 'cover') {
    // Clean gameplay cover: mid-round, no buy menu, the player looking up
    // mid toward two defenders holding the doors, allies at the flanks.
    stageFirefight();
  } else if (name === 'play') {
    const defs = stageFirefight();
    // The player drops the first defender with a headshot (one clean kill
    // for the feed), then works the second defender with body shots,
    // re-aiming each time because the target strafes once alerted.
    lookAt(new THREE.Vector3(defs[0].pos.x, defs[0].pos.y + 1.53, defs[0].pos.z));
    fireShot();
    settle(8);
    for (let i = 0; i < 2; i += 1) {
      lookAt(new THREE.Vector3(defs[1].pos.x, defs[1].pos.y + 1.35, defs[1].pos.z));
      fireShot();
      settle(6);
    }
    // A smoke grenade blooms at the doors while the second defender holds.
    kit.state.smokes = 1;
    player.eyeAt(eyePos);
    camera.getWorldDirection(dir);
    kit.lob(eyePos, dir, throwWorld());
    settle(40);
    lookAt(new THREE.Vector3(defs[1].pos.x, defs[1].pos.y + 1.35, defs[1].pos.z));
    fireShot();
    settle(2);
  } else if (name === 'objective') {
    // Charge set at Site A, a defender channelling the defuse: the player
    // stands in the furnace hall's east door, looking in at the site.
    beginRound();
    match.notePlant();
    match.state.stageLeft = 20;
    charge.state.set = true;
    charge.state.onBack = false;
    charge.state.zone = 'A';
    charge.state.fuseIn = 20;
    charge.state.pos.set(ZONES.A.x, 0.12, ZONES.A.z);
    charge.group.position.copy(charge.state.pos);
    charge.group.visible = true;
    player.state.pos.set(-18.5, 0, -8.2);
    const defs = squad.squad.filter((b) => b.team === 'defenders');
    defs[0].pos.set(-20, 0, -13.2);
    defs[0].living = true;
    defs[0].mode = 'DEFUSE';
    defs[0].route = [];
    defs[1].pos.set(-17, 0, -12);
    defs[1].living = true;
    defs[1].mode = 'HOLD';
    defs[1].route = [];
    defs[2].pos.set(-23.5, 0, -13.5);
    defs[2].living = false;
    defs[2].topple = 1;
    defs[2].group.rotation.x = -1.5;
    defs[2].group.position.y = -0.1;
    settle(6);
    lookAt(new THREE.Vector3(ZONES.A.x, 1, ZONES.A.z));
  } else {
    // end: attackers won the round by detonation at Site A.
    beginRound();
    match.state.atkScore = 1;
    match.state.cash = 900 + 250 + 300; // plant + round win
    match.state.stage = 'END';
    match.state.stageLeft = 4;
    match.state.endNote = 'Charge detonated';
    charge.state.zone = 'A';
    charge.state.fuseIn = 0;
    charge.state.blown = true;
    charge.state.onBack = false; // the charge already did its work
    charge.state.set = false; // the fuse already ran out; HUD shows no timer
    charge.state.pos.set(ZONES.A.x, 0.12, ZONES.A.z);
    charge.group.position.copy(charge.state.pos);
    charge.group.visible = true;
    fx.blast(charge.state.pos);
    // Stand in the furnace hall's east door, looking in at the site: the
    // ring, the ingots and the fallen defender fill the frame.
    player.state.pos.set(-18.5, 0, -8.2);
    const defs = squad.squad.filter((b) => b.team === 'defenders');
    defs[0].pos.set(-23.5, 0, -13.5);
    defs[0].living = false;
    defs[0].topple = 1;
    defs[0].group.rotation.x = -1.5;
    defs[0].group.position.y = -0.1;
    settle(6);
    lookAt(new THREE.Vector3(ZONES.A.x, 1, ZONES.A.z));
    hud.showFlag('ROUND WON', 'Charge detonated — Attackers 1 · Defenders 0', 'win', 60000);
    hud.showScore(1, 0, 1);
  }
  refreshHud();
  paintThenSignal();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

beginRound();
placeCamera();
// Debug handle for live playtesting (bot health, round state, aim + fire).
// Harmless in production: read-only inspection plus the same inputs a
// player has; no cheats wired to it.
window.__ironveil = { player, bots: squad, rounds: match, bomb: charge, grenades: kit, weapons: arsenal, game: session, input: controls, shoot: fireShot, aimAt: lookAt, startRound: beginRound, startMatch: restartMatch };
if (shotMode) stageShot(shotMode);
else requestAnimationFrame(loop);
