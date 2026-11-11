const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'stage3', 'ogrdb');
const failedFixturePath = process.env.OGRDB_FAIL_PATH;
const fixtureManifest = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8')
);
const port = Number(process.env.PORT || 8000);

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.cjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.wasm')) return 'application/wasm';
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.fasta') || file.endsWith('.fa')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function securityHeaders(response) {
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

const server = http.createServer((request, response) => {
  securityHeaders(response);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api_v2/')) {
    if (failedFixturePath && pathname === failedFixturePath) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`Synthetic OGRDB fixture failure for ${pathname}`);
      return;
    }
    const entry = fixtureManifest.responses[pathname];
    if (!entry) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`No local OGRDB fixture for ${pathname}`);
      return;
    }
    const file = path.join(fixtureRoot, entry.file);
    response.writeHead(entry.status, {
      'Content-Type': entry.headers['content-type'] || 'application/octet-stream'
    });
    if (request.method === 'HEAD') response.end();
    else fs.createReadStream(file).pipe(response);
    return;
  }

  const relative = pathname === '/' ? 'tools/stage5/index.html' : pathname.slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  response.setHeader('Content-Type', contentType(file));
  const stream = fs.createReadStream(file);
  stream.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    response.end(`Not found: ${pathname}`);
  });
  if (request.method === 'HEAD') {
    stream.on('open', () => {
      response.writeHead(200);
      response.end();
      stream.destroy();
    });
  } else {
    stream.pipe(response);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Stage 5 app: http://127.0.0.1:${port}/`);
  console.log('Local OGRDB requests use the checked-in fixture; live mode requires OGRDB same-origin hosting.');
  console.log('COOP: same-origin; COEP: require-corp');
});

server.on('error', error => {
  console.error(`Stage 5 server failed: ${error.message}`);
  process.exitCode = 1;
});
