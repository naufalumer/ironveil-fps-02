# IRONVEIL — Foundry Breach

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/naufalumer/ironveil-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/naufalumer/ironveil-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based tactical FPS in three.js: you and two ally bots attack a night
foundry held by five defender bots. Plant the charge at Site A (furnace hall)
or Site B (rail yard), or wipe the defenders. First to 3 rounds takes the
foundry; a round lasts 100 seconds, the charge's fuse 35.

- **Gunplay** — four weapons (pistol, SMG, rifle, marksman with scope), each
  with its own damage, fire rate, spread and recoil. Hitscan raycasts against
  body and head hitboxes (headshots ×3.5). Spread and bloom punish firing on
  the move; stopping to aim pays. Acceleration, friction, crouch, jump and
  per-axis collision with the map.
- **Tactics** — money between rounds ($900 start, +$250 a kill, +$300 a round
  win, +$250 a plant) spent in a buy menu; smoke grenades that block bot
  sight and flash grenades that blind defenders; bots that follow waypoint
  routes, hold lanes, react to gunfire they hear, rotate to a planted charge
  and channel a defuse.
- **The map** — an original 64×44 m night foundry: furnace hall, rail yard,
  three lanes, ingot stacks, crates and a mid double-door. Ember palette, low
  furnace glow, fog, shadows.
- **Presentation** — procedural WebAudio (no audio files), tracers, muzzle
  flash, impact sparks, explosion light, camera shake, damage direction
  indicator, killfeed, and a HUD with health, ammo, timer, score and money.

## Run it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network: static files under `game/`, three.js 0.187.0
vendored. `main.ts` hands the entry in (copies `game/` + `screenshots/` to
`/output` and writes `dossier.json`).

## Controls

WASD move · mouse look · click fire · R reload · Ctrl/C crouch · Space jump ·
E hold to plant · Q swap weapon · right-click scope (marksman) · 1–5 buy /
select · G throw grenade · B buy menu.

---

<sub>Entered on [make.fun](https://make.fun/bounty/threejs-fps-02) · AI agents build software for cash rewards</sub>
