// Bots: two ally attackers and five defender bots with a real state
// machine. MOVE follows the waypoint graph (BFS), HOLD watches a lane,
// ENGAGE fires aimed bursts at what it can see, DEFUSE channels the
// planted charge, RETREAT falls back under 30 HP. Vision is a cone plus
// a line-of-sight ray (smoke blocks it); hearing is a radius: gunfire
// pulls nearby bots to the shooter's position. Thinking runs at 8 Hz;
// movement runs every fixed step.
import * as THREE from 'three';
import { NODES, LINKS, ZONES } from './map.js';
import { shuffleInPlace } from './rng.js';

const BOT_RAD = 0.34;
const BOT_TALL = 1.72;
const BOT_EYE_H = 1.58;
const BOT_PACE = 4.2;
const THINK_RATE = 8;
const SIGHT_RANGE = 44;
const HALF_VIEW = 1.05; // ~60 degrees each side
const BODY_HIT = 14;
const HEAD_HIT = 42;
const DEFUSE_TIME = 5;

const CALLSIGNS = {
  attackers: ['Ember', 'Soot'],
  defenders: ['Anvil', 'Cinder', 'Grit', 'Talon', 'Wren'],
};

// Adjacency built once from the link list, in link order, so BFS visits
// neighbours in exactly the order a scan of the links would.
const ADJ = NODES.map(() => []);
for (const [a, b] of LINKS) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

// BFS over the waypoint graph. Returns an array of node ids, start excluded.
function traceRoute(from, to) {
  if (from === to) return [];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const next of ADJ[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const route = [to];
        let cur = to;
        while (cur !== from) {
          cur = prev[cur];
          route.unshift(cur);
        }
        return route.slice(1);
      }
      queue.push(next);
    }
  }
  return [];
}

function closestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const dx = NODES[i].x - x;
    const dz = NODES[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Closest pass of a ray to a point: how near the shot flies to the target.
function rayPass(from, dir, point) {
  const along = Math.max(
    0,
    (point.x - from.x) * dir.x +
      (point.y - from.y) * dir.y +
      (point.z - from.z) * dir.z,
  );
  const px = from.x + dir.x * along - point.x;
  const py = from.y + dir.y * along - point.y;
  const pz = from.z + dir.z * along - point.z;
  return Math.sqrt(px * px + py * py + pz * pz);
}

export function makeSquad(scene, map, rand) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eyeVec = new THREE.Vector3();
  const targetVec = new THREE.Vector3();
  const dirVec = new THREE.Vector3();
  const facingVec = new THREE.Vector3();
  const headVec = new THREE.Vector3();
  const probe = new THREE.Box3();
  const hitTargets = [];

  const SKINS = {
    allyBody: new THREE.MeshStandardMaterial({
      color: 0xc96a1e,
      roughness: 0.6,
      metalness: 0.1,
    }),
    allyHead: new THREE.MeshStandardMaterial({ color: 0xece7dc, roughness: 0.5 }),
    foeBody: new THREE.MeshStandardMaterial({
      color: 0x2e6b52,
      roughness: 0.6,
      metalness: 0.1,
    }),
    foeHead: new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a2027, roughness: 0.7 }),
  };

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.55, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);

  const squad = [];

  function spawnBot(team, index, name) {
    const group = new THREE.Group();
    const bodyMat = team === 'attackers' ? SKINS.allyBody : SKINS.foeBody;
    const headMat = team === 'attackers' ? SKINS.allyHead : SKINS.foeHead;
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(legGeo, SKINS.dark);
    legL.position.set(-0.13, 0.28, 0);
    const legR = new THREE.Mesh(legGeo, SKINS.dark);
    legR.position.set(0.13, 0.28, 0);
    const gun = new THREE.Mesh(gunGeo, SKINS.dark);
    gun.position.set(0.22, 1.05, -0.28);
    group.add(torso, head, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      index,
      group,
      torso,
      head,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      heading: 0,
      hp: 100,
      living: false,
      mode: 'HOLD',
      route: [],
      routeStep: 0,
      postNode: 0,
      thinkIn: rand() * 0.2,
      shotsLeft: 0,
      shotIn: 0,
      restIn: 0,
      aimHeading: 0,
      aimTilt: 0,
      foe: null, // { kind: 'player'|'bot', ref, pos: Vector3 }
      lastSeen: new THREE.Vector3(),
      knowsLast: false,
      blindTill: 0,
      defuseIn: 0,
      topple: 0,
      strafeWay: 1,
      strafeIn: 0,
    };
    torso.userData.fighter = bot;
    torso.userData.piece = 'torso';
    head.userData.fighter = bot;
    head.userData.piece = 'head';
    hitTargets.push(torso, head);
    squad.push(bot);
    return bot;
  }

  for (let i = 0; i < 2; i += 1) spawnBot('attackers', i, CALLSIGNS.attackers[i]);
  for (let i = 0; i < 5; i += 1) spawnBot('defenders', i, CALLSIGNS.defenders[i]);

  function blockedAt(x, z) {
    probe.min.set(x - BOT_RAD, 0.04, z - BOT_RAD);
    probe.max.set(x + BOT_RAD, BOT_TALL - 0.04, z + BOT_RAD);
    for (const solid of map.solids) {
      if (probe.intersectsBox(solid)) return true;
    }
    return false;
  }

  function walkTo(bot, dt, tx, tz) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) return true;
    const stepX = (dx / dist) * BOT_PACE * dt;
    const stepZ = (dz / dist) * BOT_PACE * dt;
    const nextX = bot.pos.x + stepX;
    if (!blockedAt(nextX, bot.pos.z)) bot.pos.x = nextX;
    const nextZ = bot.pos.z + stepZ;
    if (!blockedAt(bot.pos.x, nextZ)) bot.pos.z = nextZ;
    bot.heading = Math.atan2(-dx, -dz);
    return dist < 0.5;
  }

  // True when nothing solid (and no smoke bank) stands between eye and point.
  function clearView(from, to, banks) {
    dirVec.copy(to).sub(from);
    const dist = dirVec.length();
    if (dist < 0.01) return true;
    dirVec.multiplyScalar(1 / dist);
    raycaster.set(from, dirVec);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(map.targets, false);
    if (hits.length > 0) return false;
    if (banks) {
      for (const bank of banks) {
        // Segment-sphere test against the bank's centre, radius 3.2.
        const cx = bank.x - from.x;
        const cy = bank.y - from.y;
        const cz = bank.z - from.z;
        const t = Math.max(
          0,
          Math.min(dist, cx * dirVec.x + cy * dirVec.y + cz * dirVec.z),
        );
        const px = from.x + dirVec.x * t - bank.x;
        const py = from.y + dirVec.y * t - bank.y;
        const pz = from.z + dirVec.z * t - bank.z;
        if (px * px + py * py + pz * pz < 3.2 * 3.2) return false;
      }
    }
    return true;
  }

  // Pick the best visible enemy: nearest first, prefer the one already targeted.
  function spotFoe(bot, ctx) {
    if (ctx.time < bot.blindTill) return null;
    eyeVec.set(bot.pos.x, BOT_EYE_H, bot.pos.z);
    const candidates = [];
    const player = ctx.player;
    if (player.state.living && bot.team !== 'attackers') {
      targetVec.set(
        player.state.pos.x,
        player.state.pos.y + player.state.eyeH * 0.85,
        player.state.pos.z,
      );
      candidates.push({
        kind: 'player',
        ref: player,
        pos: targetVec.clone(),
        dist: eyeVec.distanceTo(targetVec),
      });
    }
    for (const other of squad) {
      if (!other.living || other.team === bot.team) continue;
      targetVec.set(other.pos.x, other.pos.y + 1.35, other.pos.z);
      candidates.push({
        kind: 'bot',
        ref: other,
        pos: targetVec.clone(),
        dist: eyeVec.distanceTo(targetVec),
      });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const cand of candidates) {
      if (cand.dist > SIGHT_RANGE) continue;
      dirVec.copy(cand.pos).sub(eyeVec).normalize();
      facingVec.set(-Math.sin(bot.heading), 0, -Math.cos(bot.heading));
      const angle = Math.acos(
        Math.max(-1, Math.min(1, dirVec.x * facingVec.x + dirVec.z * facingVec.z)),
      );
      const alerted = bot.knowsLast && bot.lastSeen.distanceTo(cand.pos) < 6;
      if (angle > HALF_VIEW && !alerted) continue;
      if (!clearView(eyeVec, cand.pos, ctx.banks)) continue;
      return cand;
    }
    return null;
  }

  function shootAt(bot, target, ctx) {
    // One burst shot: direction from the bot's eye to the target with an
    // error that grows with range, target speed and the bot's own
    // movement. Walls stop the shot; otherwise the ray's closest pass to
    // the target's chest (or head) decides the hit — the player has no
    // hit mesh, the camera is the player, so proximity to the aim point
    // is the honest test.
    eyeVec.set(bot.pos.x, BOT_EYE_H, bot.pos.z);
    const tpos = target.pos;
    const dist = eyeVec.distanceTo(tpos);
    const speed =
      target.kind === 'player'
        ? Math.hypot(target.ref.state.vel.x, target.ref.state.vel.z)
        : Math.hypot(target.ref.vel.x, target.ref.vel.z);
    const error =
      0.018 + dist * 0.0011 + speed * 0.004 + (bot.mode === 'MOVE' ? 0.02 : 0);
    dirVec.copy(tpos).sub(eyeVec).normalize();
    dirVec.x += (rand() * 2 - 1) * error;
    dirVec.y += (rand() * 2 - 1) * error;
    dirVec.z += (rand() * 2 - 1) * error;
    dirVec.normalize();
    raycaster.set(eyeVec, dirVec);
    raycaster.far = 70;
    const wallHits = raycaster.intersectObjects(map.targets, false);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
    const endPoint = dirVec
      .clone()
      .multiplyScalar(Math.min(wallDist, 40))
      .add(eyeVec);
    ctx.effects.trace(eyeVec, endPoint, bot.team === 'attackers');
    ctx.audio.gunshot('bot', dist);
    if (wallDist < dist - 0.1) {
      ctx.effects.sparksAt(wallHits[0].point);
      return;
    }
    const pass = rayPass(eyeVec, dirVec, tpos);
    if (target.kind === 'player') {
      headVec.set(
        target.ref.state.pos.x,
        target.ref.state.pos.y + target.ref.state.eyeH + 0.05,
        target.ref.state.pos.z,
      );
    } else {
      headVec.set(
        target.ref.pos.x,
        target.ref.pos.y + 1.53,
        target.ref.pos.z,
      );
    }
    const headPass = rayPass(eyeVec, dirVec, headVec);
    if (headPass < 0.2) {
      ctx.effects.sparksAt(tpos);
      if (target.kind === 'player') ctx.events.hurtPlayer(HEAD_HIT, bot.pos);
      else woundBot(target.ref, HEAD_HIT, bot, ctx, true);
    } else if (pass < 0.45) {
      ctx.effects.sparksAt(tpos);
      if (target.kind === 'player') ctx.events.hurtPlayer(BODY_HIT, bot.pos);
      else woundBot(target.ref, BODY_HIT, bot, ctx, false);
    }
  }

  function woundBot(bot, amount, attacker, ctx, isHead = false) {
    if (!bot.living) return;
    bot.hp -= amount;
    bot.lastSeen.copy(attacker.pos);
    bot.knowsLast = true;
    if (bot.hp <= 0) {
      bot.living = false;
      bot.hp = 0;
      bot.topple = 0.0001;
      bot.mode = 'DEAD';
      bot.headKill = isHead;
      ctx.events.botDown(bot, attacker);
    } else if (bot.hp < 30 && bot.mode !== 'RETREAT') {
      bot.mode = 'RETREAT';
      const home = bot.team === 'attackers' ? 0 : 11;
      bot.route = traceRoute(closestNode(bot.pos.x, bot.pos.z), home);
      bot.routeStep = 0;
    }
  }

  function handOutPosts(roundNo) {
    // Defenders: two hold A, two hold B, one roams mid. Allies: one A, one
    // B by round parity, so the attack does not always come down one lane.
    const defHolds = shuffleInPlace([6, 7, 17, 18, 25], rand);
    const atkTargets = roundNo % 2 === 1 ? [5, 16] : [16, 5];
    for (const bot of squad) {
      if (bot.team === 'defenders') {
        bot.postNode = defHolds[bot.index];
        bot.route = traceRoute(closestNode(bot.pos.x, bot.pos.z), bot.postNode);
        bot.routeStep = 0;
        bot.mode = 'MOVE';
      } else {
        bot.postNode = atkTargets[bot.index];
        bot.route = traceRoute(closestNode(bot.pos.x, bot.pos.z), bot.postNode);
        bot.routeStep = 0;
        bot.mode = 'MOVE';
      }
      bot.foe = null;
      bot.knowsLast = false;
      bot.defuseIn = 0;
      bot.blindTill = 0;
    }
  }

  function resetSquad(roundNo, spawns) {
    for (const bot of squad) {
      const spawn = spawns[bot.team][bot.index % spawns[bot.team].length];
      bot.pos.set(spawn.x + (rand() - 0.5), 0, spawn.z + (rand() - 0.5));
      bot.vel.set(0, 0, 0);
      bot.heading = bot.team === 'attackers' ? Math.PI : 0;
      bot.hp = 100;
      bot.living = true;
      bot.topple = 0;
      bot.group.rotation.set(0, bot.heading, 0);
      bot.group.visible = true;
    }
    handOutPosts(roundNo);
  }

  function decide(bot, ctx) {
    if (!bot.living) return;
    // Freeze time: during the buy phase bots walk to their holds but do
    // not fight — the round has not started yet.
    const target =
      ctx.stage === 'LIVE' || ctx.stage === 'PLANTED' ? spotFoe(bot, ctx) : null;
    bot.foe = target;
    if (target) {
      bot.mode = 'ENGAGE';
      bot.lastSeen.copy(target.pos);
      bot.knowsLast = true;
      const dx = target.pos.x - bot.pos.x;
      const dz = target.pos.z - bot.pos.z;
      bot.aimHeading = Math.atan2(-dx, -dz);
      bot.aimTilt = Math.atan2(target.pos.y - BOT_EYE_H, Math.hypot(dx, dz));
      if (bot.shotsLeft === 0 && bot.restIn <= 0) {
        bot.shotsLeft = 3 + Math.floor(rand() * 3);
        bot.shotIn = 0;
      }
      return;
    }
    // No target: a planted charge pulls every living defender to the site.
    if (ctx.chargeSet && bot.team === 'defenders') {
      const zone = ctx.chargeZone === 'A' ? ZONES.A : ZONES.B;
      const dist = Math.hypot(zone.x - bot.pos.x, zone.z - bot.pos.z);
      if (dist < 2.5) {
        bot.mode = 'DEFUSE';
        bot.route = [];
        return;
      }
      if (bot.mode !== 'MOVE' || bot.route.length === 0) {
        bot.route = traceRoute(
          closestNode(bot.pos.x, bot.pos.z),
          ctx.chargeZone === 'A' ? 5 : 16,
        );
        bot.routeStep = 0;
        bot.mode = 'MOVE';
      }
      return;
    }
    if (bot.mode === 'ENGAGE' || bot.mode === 'DEFUSE') {
      bot.mode = bot.route.length > 0 ? 'MOVE' : 'HOLD';
    }
    if (bot.mode === 'HOLD' && bot.knowsLast) {
      // Investigate the last heard position, then return to the hold.
      const dist = Math.hypot(
        bot.lastSeen.x - bot.pos.x,
        bot.lastSeen.z - bot.pos.z,
      );
      if (dist > 2) {
        bot.route = traceRoute(
          closestNode(bot.pos.x, bot.pos.z),
          closestNode(bot.lastSeen.x, bot.lastSeen.z),
        );
        bot.routeStep = 0;
        bot.mode = 'MOVE';
      } else {
        bot.knowsLast = false;
      }
    }
  }

  function followRoute(bot, dt) {
    const node = NODES[bot.route[bot.routeStep]];
    if (walkTo(bot, dt, node.x, node.z)) {
      bot.routeStep += 1;
      if (bot.routeStep >= bot.route.length) {
        bot.route = [];
        bot.mode = 'HOLD';
      }
    }
  }

  function advanceBot(bot, dt, ctx) {
    if (!bot.living) {
      if (bot.topple > 0 && bot.topple < 1) {
        bot.topple = Math.min(1, bot.topple + dt / 0.45);
        bot.group.rotation.x = -bot.topple * 1.5;
        bot.group.position.y = -bot.topple * 0.1;
      }
      return;
    }
    bot.thinkIn -= dt;
    if (bot.thinkIn <= 0) {
      bot.thinkIn = 1 / THINK_RATE;
      decide(bot, ctx);
    }
    bot.restIn = Math.max(0, bot.restIn - dt);
    bot.strafeIn -= dt;

    switch (bot.mode) {
      case 'ENGAGE': {
        if (!bot.foe) {
          bot.mode = 'HOLD';
          break;
        }
        // Face the target, strafe sideways while firing in bursts.
        bot.heading += (bot.aimHeading - bot.heading) * Math.min(1, dt * 10);
        if (bot.strafeIn <= 0) {
          bot.strafeWay = rand() < 0.5 ? -1 : 1;
          bot.strafeIn = 0.5 + rand() * 0.9;
        }
        const sideX = Math.cos(bot.heading) * bot.strafeWay;
        const sideZ = -Math.sin(bot.heading) * bot.strafeWay;
        const nx = bot.pos.x + sideX * 1.6 * dt;
        const nz = bot.pos.z + sideZ * 1.6 * dt;
        if (!blockedAt(nx, bot.pos.z)) bot.pos.x = nx;
        if (!blockedAt(bot.pos.x, nz)) bot.pos.z = nz;
        if (bot.shotsLeft > 0) {
          bot.shotIn -= dt;
          if (bot.shotIn <= 0) {
            bot.shotIn = 0.13;
            bot.shotsLeft -= 1;
            shootAt(bot, bot.foe, ctx);
            if (bot.shotsLeft === 0) bot.restIn = 0.6 + rand() * 0.9;
          }
        }
        break;
      }
      case 'MOVE':
      case 'RETREAT': {
        if (bot.route.length > 0) followRoute(bot, dt);
        else bot.mode = 'HOLD';
        break;
      }
      case 'HOLD': {
        // Scan: slow sweep of the heading, so a hold still looks alive.
        bot.heading += Math.sin(ctx.time * 0.7 + bot.index * 2.1) * dt * 0.5;
        break;
      }
      case 'DEFUSE': {
        bot.heading = Math.atan2(
          -(ctx.chargePos.x - bot.pos.x),
          -(ctx.chargePos.z - bot.pos.z),
        );
        const nearAttacker = spotFoe(bot, ctx);
        if (nearAttacker && nearAttacker.dist < 14) {
          bot.defuseIn = Math.max(0, bot.defuseIn - dt * 2);
        } else {
          bot.defuseIn += dt;
          if (bot.defuseIn >= DEFUSE_TIME) {
            bot.defuseIn = 0;
            ctx.events.chargeCleared(bot);
          }
        }
        break;
      }
      default:
        break;
    }

    bot.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
    bot.group.rotation.y = bot.heading;
  }

  return {
    squad,
    hitTargets,
    resetSquad,
    woundBot,
    clearView,
    // Bots hear gunfire: anyone within radius investigates the position.
    alarm(position, radius) {
      for (const bot of squad) {
        if (!bot.living) continue;
        const d = Math.hypot(bot.pos.x - position.x, bot.pos.z - position.z);
        if (d < radius) {
          bot.lastSeen.copy(position);
          bot.knowsLast = true;
        }
      }
    },
    blindFoes(position, radius, until) {
      for (const bot of squad) {
        if (!bot.living || bot.team === 'attackers') continue;
        const d = Math.hypot(bot.pos.x - position.x, bot.pos.z - position.z);
        if (d < radius) bot.blindTill = Math.max(bot.blindTill, until);
      }
    },
    tickAll(dt, ctx) {
      for (const bot of squad) advanceBot(bot, dt, ctx);
    },
    livingCount(team) {
      return squad.filter((b) => b.living && b.team === team).length;
    },
  };
}
