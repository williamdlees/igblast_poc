const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const sourceRoot = path.join(root, 'src');
const port = Number(process.env.PORT || 8080);

function resolveFile(pathname) {
  const isSource = pathname.startsWith('/src/');
  const relativePath = pathname === '/' ? 'index.html' :
    isSource ? pathname.slice('/src/'.length) : pathname.slice(1);
  const base = isSource ? sourceRoot : publicRoot;
  const file = path.resolve(base, relativePath);
  if (!file.startsWith(`${base}${path.sep}`) && file !== path.join(publicRoot, 'index.html')) {
    return null;
  }
  return file;
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js') || file.endsWith('.cjs')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.webmanifest') || file.endsWith('.json')) return 'application/manifest+json';
  return 'application/octet-stream';
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Invalid URL');
    return;
  }

  const file = resolveFile(pathname);
  if (!file) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  const stream = fs.createReadStream(file);
  stream.on('error', error => {
    if (!response.headersSent) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
    }
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read requested file');
  });
  if (request.method === 'HEAD') {
    stream.on('open', () => {
      response.writeHead(200, { 'Content-Type': contentType(file) });
      response.end();
      stream.destroy();
    });
  } else {
    response.setHeader('Content-Type', contentType(file));
    stream.pipe(response);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`IgBLAST app scaffold: http://127.0.0.1:${port}/`);
});

server.on('error', error => {
  console.error(`Development server failed: ${error.message}`);
  process.exitCode = 1;
});
