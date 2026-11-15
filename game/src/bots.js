// Bots: two ally attackers and five defender bots with a real state machine.
// MOVE follows the waypoint graph (BFS), HOLD watches a lane, ENGAGE fires
// aimed bursts at what it can see, DEFUSE channels the planted charge,
// RETREAT falls back under 30 HP. Vision is a cone + a line-of-sight raycast
// (smoke blocks it); hearing is a radius: gunfire pulls nearby bots to the
// shooter's position. Thinking runs at 8 Hz; movement runs every fixed step.
import * as THREE from 'three';
import { WAYPOINTS, EDGES, SITES } from './map.js';
import { shuffle } from './rng.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const BOT_EYE = 1.58;
const WALK_SPEED = 4.2;
const THINK_HZ = 8;
const SEE_RANGE = 44;
const SEE_HALF_FOV = 1.05; // ~60 degrees each side
const BODY_DAMAGE = 16;
const HEAD_DAMAGE = 48;
const DEFUSE_SECONDS = 5;

const NAMES = {
  attackers: ['Dusk', 'Ash'],
  defenders: ['Slag', 'Cinder', 'Forge', 'Talon', 'Wren'],
};

// BFS over the waypoint graph. Returns an array of node ids, start excluded.
function findPath(from, to) {
  if (from === to) return [];
  const prev = new Int16Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const [a, b] of EDGES) {
      const next = a === node ? b : b === node ? a : -1;
      if (next >= 0 && prev[next] === -1) {
        prev[next] = node;
        if (next === to) {
          const path = [to];
          let cur = to;
          while (cur !== from) {
            cur = prev[cur];
            path.unshift(cur);
          }
          return path.slice(1);
        }
        queue.push(next);
      }
    }
  }
  return [];
}

function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function createBots(scene, map, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eyeVec = new THREE.Vector3();
  const targetVec = new THREE.Vector3();
  const dirVec = new THREE.Vector3();
  const probe = new THREE.Box3();
  const hitMeshes = [];

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c96a1e'), roughness: 0.6, metalness: 0.1 });
  const allyHead = new THREE.MeshStandardMaterial({ color: new THREE.Color('#ece7dc'), roughness: 0.5 });
  const foeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e6b52'), roughness: 0.6, metalness: 0.1 });
  const foeHead = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a2027'), roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a2027'), roughness: 0.7 });

  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 14, 10);
  const legGeo = new THREE.BoxGeometry(0.2, 0.55, 0.22);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.5);

  const bots = [];

  function makeBot(team, index, name) {
    const group = new THREE.Group();
    const bodyMat = team === 'attackers' ? allyMat : foeMat;
    const headMat = team === 'attackers' ? allyHead : foeHead;
    const torso = new THREE.Mesh(torsoGeo, bodyMat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.53;
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.13, 0.28, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.13, 0.28, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
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
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      yaw: 0,
      health: 100,
      alive: false,
      state: 'HOLD',
      path: [],
      pathIndex: 0,
      holdNode: 0,
      thinkTimer: random() * 0.2,
      burstLeft: 0,
      burstTimer: 0,
      pauseTimer: 0,
      aimYaw: 0,
      aimPitch: 0,
      target: null, // { kind: 'player'|'bot', ref, pos: Vector3 }
      lastKnown: new THREE.Vector3(),
      hasLastKnown: false,
      blindUntil: 0,
      defuseProgress: 0,
      fall: 0,
      strafeDir: 1,
      strafeTimer: 0,
      shootTimer: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 2; i += 1) makeBot('attackers', i, NAMES.attackers[i]);
  for (let i = 0; i < 5; i += 1) makeBot('defenders', i, NAMES.defenders[i]);

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.04, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, BOT_HEIGHT - 0.04, z + BOT_RADIUS);
    for (let i = 0; i < map.colliders.length; i += 1) {
      if (probe.intersectsBox(map.colliders[i])) return true;
    }
    return false;
  }

  function moveBot(bot, dt, tx, tz) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.08) return true;
    const speed = WALK_SPEED;
    const stepX = (dx / dist) * speed * dt;
    const stepZ = (dz / dist) * speed * dt;
    const nextX = bot.position.x + stepX;
    if (!overlaps(nextX, bot.position.z)) bot.position.x = nextX;
    const nextZ = bot.position.z + stepZ;
    if (!overlaps(bot.position.x, nextZ)) bot.position.z = nextZ;
    bot.yaw = Math.atan2(-dx, -dz);
    return dist < 0.5;
  }

  // True when nothing solid (and no smoke cloud) stands between eye and point.
  function hasLineOfSight(from, to, smoke) {
    dirVec.copy(to).sub(from);
    const dist = dirVec.length();
    if (dist < 0.01) return true;
    dirVec.multiplyScalar(1 / dist);
    raycaster.set(from, dirVec);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(map.shootables, false);
    if (hits.length > 0) return false;
    if (smoke) {
      for (const cloud of smoke) {
        // Segment-sphere test against the cloud's centre, radius 3.2.
        const cx = cloud.x - from.x;
        const cy = cloud.y - from.y;
        const cz = cloud.z - from.z;
        const t = Math.max(0, Math.min(dist, cx * dirVec.x + cy * dirVec.y + cz * dirVec.z));
        const px = from.x + dirVec.x * t - cloud.x;
        const py = from.y + dirVec.y * t - cloud.y;
        const pz = from.z + dirVec.z * t - cloud.z;
        if (px * px + py * py + pz * pz < 3.2 * 3.2) return false;
      }
    }
    return true;
  }

  // Pick the best visible enemy: nearest first, prefer the one already targeted.
  function acquireTarget(bot, ctx) {
    if (ctx.time < bot.blindUntil) return null;
    eyeVec.set(bot.position.x, BOT_EYE, bot.position.z);
    const candidates = [];
    const player = ctx.player;
    if (player.state.alive && bot.team !== 'attackers') {
      targetVec.set(player.state.position.x, player.state.position.y + player.state.eye * 0.85, player.state.position.z);
      candidates.push({ kind: 'player', ref: player, pos: targetVec.clone(), dist: eyeVec.distanceTo(targetVec) });
    }
    for (const other of bots) {
      if (!other.alive || other.team === bot.team) continue;
      targetVec.set(other.position.x, other.position.y + 1.35, other.position.z);
      candidates.push({ kind: 'bot', ref: other, pos: targetVec.clone(), dist: eyeVec.distanceTo(targetVec) });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const cand of candidates) {
      if (cand.dist > SEE_RANGE) continue;
      dirVec.copy(cand.pos).sub(eyeVec).normalize();
      const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      const angle = Math.acos(Math.max(-1, Math.min(1, dirVec.x * facing.x + dirVec.z * facing.z)));
      const alerted = bot.hasLastKnown && bot.lastKnown.distanceTo(cand.pos) < 6;
      if (angle > SEE_HALF_FOV && !alerted) continue;
      if (!hasLineOfSight(eyeVec, cand.pos, ctx.smoke)) continue;
      return cand;
    }
    return null;
  }

  function fireAt(bot, target, ctx) {
    // One burst shot: direction from the bot's eye to the target with an error
    // that grows with range, target speed and the bot's own movement. Walls
    // stop the shot; otherwise the ray's closest pass to the target's chest
    // (or head) decides the hit — the player has no hit mesh, the camera is
    // the player, so proximity to the aim point is the honest test.
    eyeVec.set(bot.position.x, BOT_EYE, bot.position.z);
    const tpos = target.pos;
    const dist = eyeVec.distanceTo(tpos);
    const speed = target.kind === 'player'
      ? Math.hypot(target.ref.state.velocity.x, target.ref.state.velocity.z)
      : Math.hypot(target.ref.velocity.x, target.ref.velocity.z);
    const error = 0.018 + dist * 0.0011 + speed * 0.004 + (bot.state === 'MOVE' ? 0.02 : 0);
    dirVec.copy(tpos).sub(eyeVec).normalize();
    dirVec.x += (random() * 2 - 1) * error;
    dirVec.y += (random() * 2 - 1) * error;
    dirVec.z += (random() * 2 - 1) * error;
    dirVec.normalize();
    raycaster.set(eyeVec, dirVec);
    raycaster.far = 70;
    const wallHits = raycaster.intersectObjects(map.shootables, false);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
    const endPoint = dirVec.clone().multiplyScalar(Math.min(wallDist, 40)).add(eyeVec);
    ctx.effects.tracer(eyeVec, endPoint, bot.team === 'attackers');
    ctx.audio.shot('bot', dist);
    if (wallDist < dist - 0.1) {
      ctx.effects.impact(wallHits[0].point);
      return;
    }
    // Closest pass of the ray to the chest point.
    const along = Math.max(0, (tpos.x - eyeVec.x) * dirVec.x + (tpos.y - eyeVec.y) * dirVec.y + (tpos.z - eyeVec.z) * dirVec.z);
    const px = eyeVec.x + dirVec.x * along - tpos.x;
    const py = eyeVec.y + dirVec.y * along - tpos.y;
    const pz = eyeVec.z + dirVec.z * along - tpos.z;
    const pass = Math.sqrt(px * px + py * py + pz * pz);
    const headPos = target.kind === 'player'
      ? new THREE.Vector3(target.ref.state.position.x, target.ref.state.position.y + target.ref.state.eye + 0.05, target.ref.state.position.z)
      : new THREE.Vector3(target.ref.position.x, target.ref.position.y + 1.53, target.ref.position.z);
    const hAlong = Math.max(0, (headPos.x - eyeVec.x) * dirVec.x + (headPos.y - eyeVec.y) * dirVec.y + (headPos.z - eyeVec.z) * dirVec.z);
    const hx = eyeVec.x + dirVec.x * hAlong - headPos.x;
    const hy = eyeVec.y + dirVec.y * hAlong - headPos.y;
    const hz = eyeVec.z + dirVec.z * hAlong - headPos.z;
    const headPass = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (headPass < 0.2) {
      ctx.effects.impact(tpos);
      if (target.kind === 'player') ctx.hooks.damagePlayer(HEAD_DAMAGE, bot.position);
      else damageBot(target.ref, HEAD_DAMAGE, bot, ctx, true);
    } else if (pass < 0.45) {
      ctx.effects.impact(tpos);
      if (target.kind === 'player') ctx.hooks.damagePlayer(BODY_DAMAGE, bot.position);
      else damageBot(target.ref, BODY_DAMAGE, bot, ctx, false);
    }
  }

  function damageBot(bot, amount, attacker, ctx, isHead = false) {
    if (!bot.alive) return;
    bot.health -= amount;
    bot.lastKnown.copy(attacker.position);
    bot.hasLastKnown = true;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.fall = 0.0001;
      bot.state = 'DEAD';
      bot.killedByHead = isHead;
      ctx.hooks.botKilled(bot, attacker);
    } else if (bot.health < 30 && bot.state !== 'RETREAT') {
      bot.state = 'RETREAT';
      const home = bot.team === 'attackers' ? 0 : 11;
      bot.path = findPath(nearestNode(bot.position.x, bot.position.z), home);
      bot.pathIndex = 0;
    }
  }

  function assignRoundRoles(roundNumber) {
    // Defenders: two hold A, two hold B, one roams mid. Allies: one A, one B
    // by round parity, so the attack does not always come down one lane.
    const defHolds = shuffle([6, 7, 17, 18, 25], random);
    const atkTargets = roundNumber % 2 === 1 ? [5, 16] : [16, 5];
    for (const bot of bots) {
      if (bot.team === 'defenders') {
        bot.holdNode = defHolds[bot.index];
        bot.path = findPath(nearestNode(bot.position.x, bot.position.z), bot.holdNode);
        bot.pathIndex = 0;
        bot.state = 'MOVE';
      } else {
        bot.holdNode = atkTargets[bot.index];
        bot.path = findPath(nearestNode(bot.position.x, bot.position.z), bot.holdNode);
        bot.pathIndex = 0;
        bot.state = 'MOVE';
      }
      bot.target = null;
      bot.hasLastKnown = false;
      bot.defuseProgress = 0;
      bot.blindUntil = 0;
    }
  }

  function resetRound(roundNumber, spawns) {
    for (const bot of bots) {
      const spawn = spawns[bot.team][bot.index % spawns[bot.team].length];
      bot.position.set(spawn.x + (random() - 0.5), 0, spawn.z + (random() - 0.5));
      bot.velocity.set(0, 0, 0);
      bot.yaw = bot.team === 'attackers' ? Math.PI : 0;
      bot.health = 100;
      bot.alive = true;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.visible = true;
    }
    assignRoundRoles(roundNumber);
  }

  function think(bot, ctx) {
    if (!bot.alive) return;
    // Freeze time: during the buy phase bots walk to their holds but do not
    // fight — the round has not started yet.
    const target = ctx.phase === 'LIVE' || ctx.phase === 'PLANTED' ? acquireTarget(bot, ctx) : null;
    bot.target = target;
    if (target) {
      bot.state = 'ENGAGE';
      bot.lastKnown.copy(target.pos);
      bot.hasLastKnown = true;
      const dx = target.pos.x - bot.position.x;
      const dz = target.pos.z - bot.position.z;
      bot.aimYaw = Math.atan2(-dx, -dz);
      bot.aimPitch = Math.atan2(target.pos.y - BOT_EYE, Math.hypot(dx, dz));
      if (bot.burstLeft === 0 && bot.pauseTimer <= 0) {
        bot.burstLeft = 3 + Math.floor(random() * 3);
        bot.burstTimer = 0;
      }
      return;
    }
    // No target: planted charge pulls every living defender to the site.
    if (ctx.spikePlanted && bot.team === 'defenders') {
      const site = ctx.spikeSite === 'A' ? SITES.A : SITES.B;
      const dist = Math.hypot(site.x - bot.position.x, site.z - bot.position.z);
      if (dist < 2.5) {
        bot.state = 'DEFUSE';
        bot.path = [];
        return;
      }
      if (bot.state !== 'MOVE' || bot.path.length === 0) {
        bot.path = findPath(nearestNode(bot.position.x, bot.position.z), ctx.spikeSite === 'A' ? 5 : 16);
        bot.pathIndex = 0;
        bot.state = 'MOVE';
      }
      return;
    }
    if (bot.state === 'ENGAGE' || bot.state === 'DEFUSE') {
      bot.state = bot.path.length > 0 ? 'MOVE' : 'HOLD';
    }
    if (bot.state === 'HOLD' && bot.hasLastKnown) {
      // Investigate the last heard position, then return to the hold.
      const dist = Math.hypot(bot.lastKnown.x - bot.position.x, bot.lastKnown.z - bot.position.z);
      if (dist > 2) {
        bot.path = findPath(nearestNode(bot.position.x, bot.position.z), nearestNode(bot.lastKnown.x, bot.lastKnown.z));
        bot.pathIndex = 0;
        bot.state = 'MOVE';
      } else {
        bot.hasLastKnown = false;
      }
    }
  }

  function step(bot, dt, ctx) {
    if (!bot.alive) {
      if (bot.fall > 0 && bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.45);
        bot.group.rotation.x = -bot.fall * 1.5;
        bot.group.position.y = -bot.fall * 0.1;
      }
      return;
    }
    bot.thinkTimer -= dt;
    if (bot.thinkTimer <= 0) {
      bot.thinkTimer = 1 / THINK_HZ;
      think(bot, ctx);
    }
    bot.pauseTimer = Math.max(0, bot.pauseTimer - dt);
    bot.strafeTimer -= dt;

    if (bot.state === 'ENGAGE' && bot.target) {
      // Face the target, strafe sideways while firing in bursts.
      bot.yaw += (bot.aimYaw - bot.yaw) * Math.min(1, dt * 10);
      if (bot.strafeTimer <= 0) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeTimer = 0.5 + random() * 0.9;
      }
      const sideX = Math.cos(bot.yaw) * bot.strafeDir;
      const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.position.x + sideX * 1.6 * dt;
      const nz = bot.position.z + sideZ * 1.6 * dt;
      if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
      if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
      if (bot.burstLeft > 0) {
        bot.burstTimer -= dt;
        if (bot.burstTimer <= 0) {
          bot.burstTimer = 0.13;
          bot.burstLeft -= 1;
          fireAt(bot, bot.target, ctx);
          if (bot.burstLeft === 0) bot.pauseTimer = 0.6 + random() * 0.9;
        }
      }
    } else if (bot.state === 'MOVE' && bot.path.length > 0) {
      const node = WAYPOINTS[bot.path[bot.pathIndex]];
      if (moveBot(bot, dt, node[0], node[1])) {
        bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          bot.path = [];
          bot.state = 'HOLD';
        }
      }
    } else if (bot.state === 'HOLD') {
      // Scan: slow sweep of the yaw, so a hold still looks alive.
      bot.yaw += Math.sin(ctx.time * 0.7 + bot.index * 2.1) * dt * 0.5;
    } else if (bot.state === 'DEFUSE') {
      bot.yaw = Math.atan2(-(ctx.spikePos.x - bot.position.x), -(ctx.spikePos.z - bot.position.z));
      const nearAttacker = acquireTarget(bot, ctx);
      if (nearAttacker && nearAttacker.dist < 14) {
        bot.defuseProgress = Math.max(0, bot.defuseProgress - dt * 2);
      } else {
        bot.defuseProgress += dt;
        if (bot.defuseProgress >= DEFUSE_SECONDS) {
          bot.defuseProgress = 0;
          ctx.hooks.spikeDefused(bot);
        }
      }
    } else if (bot.state === 'RETREAT') {
      if (bot.path.length > 0) {
        const node = WAYPOINTS[bot.path[bot.pathIndex]];
        if (moveBot(bot, dt, node[0], node[1])) {
          bot.pathIndex += 1;
          if (bot.pathIndex >= bot.path.length) {
            bot.path = [];
            bot.state = 'HOLD';
          }
        }
      } else {
        bot.state = 'HOLD';
      }
    }

    bot.group.position.set(bot.position.x, bot.position.y, bot.position.z);
    bot.group.rotation.y = bot.yaw;
  }

  return {
    bots,
    hitMeshes,
    resetRound,
    damageBot,
    hasLineOfSight,
    // Bots hear gunfire: anyone within radius investigates the position.
    alert(position, radius) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
        if (d < radius) {
          bot.lastKnown.copy(position);
          bot.hasLastKnown = true;
        }
      }
    },
    blindAll(position, radius, until) {
      for (const bot of bots) {
        if (!bot.alive || bot.team === 'attackers') continue;
        const d = Math.hypot(bot.position.x - position.x, bot.position.z - position.z);
        if (d < radius) bot.blindUntil = Math.max(bot.blindUntil, until);
      }
    },
    stepAll(dt, ctx) {
      for (const bot of bots) step(bot, dt, ctx);
    },
    aliveCount(team) {
      return bots.filter((b) => b.alive && b.team === team).length;
    },
  };
}
