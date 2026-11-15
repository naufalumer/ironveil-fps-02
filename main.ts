// IRONVEIL — Foundry Breach: the entrypoint for make.fun's
// threejs-fps-02 bounty (Node 22, standard library only). The game is
// plain static files under game/, loaded by the browser as ES modules
// with three.js 0.187.0 vendored under game/vendor/three/. This program
// hands the game in: it copies game/ and screenshots/ from beside this
// file into /output and writes /output/dossier.json, the summary the
// judge reads, using the vendored make.fun library. Play it locally with
// `node serve.ts`, then open http://localhost:8080. Outside the grader's
// container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import {
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(rootDir, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(rootDir, 'screenshots'))) {
  cpSync(join(rootDir, 'screenshots'), join(outDir, 'screenshots'), {
    recursive: true,
  });
}

// The scorer's caps, from the gate reference: only text_max_bytes shapes
// the bytes; the rest refuse an entry the scorer would refuse — more than
// four screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all, since game/ counts beside /output's own
// 1000-entry cap with its screenshots/ and dossier.json.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
