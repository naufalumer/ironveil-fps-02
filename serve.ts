// A tiny static server for game/ (Node 22, standard library only), so
// the entry can be played locally with no build step: `node serve.ts`
// serves game/ on http://localhost:8080. It sends the MIME types a
// browser game needs, refuses any path outside game/, and otherwise does
// nothing clever: a development convenience, not a web server for the
// internet.
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--port');
const wanted = flagAt === -1 ? 8080 : Number(argv[flagAt + 1]);
const portNo =
  Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function fail(response, code, text) {
  response.writeHead(code).end(text);
}

// Resolve a request path to a file inside game/, or describe the refusal.
function locate(pathname) {
  const file = resolve(join(gameRoot, normalize(pathname)));
  if (file !== gameRoot && !file.startsWith(gameRoot + sep)) {
    return { code: 403, text: 'forbidden' };
  }
  let info;
  try {
    info = statSync(file);
  } catch {
    return { code: 404, text: 'not found' };
  }
  if (!info.isFile()) return { code: 404, text: 'not found' };
  return { file, size: info.size };
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    fail(response, 400, 'bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const found = locate(pathname);
  if (found.code) {
    fail(response, found.code, found.text);
    return;
  }
  response.writeHead(200, {
    'content-type':
      TYPES[extname(found.file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': found.size,
    'cache-control': 'no-store',
  });
  createReadStream(found.file).pipe(response);
}).listen(portNo, '127.0.0.1', () => {
  console.log(`game/ is on http://localhost:${portNo}`);
});
