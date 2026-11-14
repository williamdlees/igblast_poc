const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const stage = path.join(root, 'research', 'tools', 'stage3');
const fixtureDir = path.join(root, 'research', 'tests', 'fixtures', 'stage3', 'ogrdb');
const nativeDir = path.join(stage, 'results', 'native');
const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const responseManifest = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'manifest.json'), 'utf8'));
const fixtures = responseManifest.responses;

const contentType = file => file.endsWith('.wasm') ? 'application/wasm' :
  file.endsWith('.js') || file.endsWith('.cjs') ? 'text/javascript' :
    file.endsWith('.json') ? 'application/json' :
      file.endsWith('.html') ? 'text/html' :
        file.endsWith('.whl') ? 'application/octet-stream' : 'application/octet-stream';

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const fixture = fixtures[pathname];
  if (fixture) {
    const body = fs.readFileSync(path.join(fixtureDir, fixture.file));
    res.writeHead(fixture.status, {
      'Content-Type': fixture.headers['content-type'] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }).end(body);
    return;
  }
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Type', contentType(file));
  fs.createReadStream(file).on('error', () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/research/tools/stage3/harness/index.html`;
  const profile = path.join(stage, 'results', 'edge-profile');
  fs.mkdirSync(path.dirname(profile), { recursive: true });
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', url
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  let nextId = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      const timeout = setTimeout(() => reject(new Error(`Edge did not start: ${stderr}`)), 30000);
      proc.stderr.on('data', chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      proc.on('error', reject);
      proc.on('exit', code => reject(new Error(`Edge exited: ${code}\n${stderr}`)));
    });
    const port = new URL(endpoint).port;
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find(target => target.type === 'page' && target.url.startsWith(url));
      if (!page) await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!page) throw new Error('Edge test page not found');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!pending.has(message.id)) return;
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
    };

    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      try {
        const response = await send('Runtime.evaluate', {
          expression: 'JSON.stringify({status:document.body?.dataset.status,text:document.getElementById("result")?.textContent,assets:document.body?.dataset.assets,crossOriginIsolated})',
          returnByValue: true
        });
        const state = JSON.parse(response.result.value);
        if (state.status === 'complete' || state.status === 'error') {
          if (!state.crossOriginIsolated) throw new Error('Worker page is not cross-origin isolated');
          const result = JSON.parse(state.text);
          if (state.status !== 'complete') throw new Error(JSON.stringify(result));
          const artifacts = result.result.artifacts;
          const names = Object.keys(artifacts).sort();
          if (names.length !== 6) throw new Error(`Expected six reference artifacts, received ${names.length}`);
          const artifactSummary = {};
          for (const name of names) {
            fs.writeFileSync(
              path.join(stage, 'results', `browser-${name}`),
              Buffer.from(artifacts[name], 'base64')
            );
          }
          for (const name of names) {
            const actual = Buffer.from(artifacts[name], 'base64');
            const expected = fs.readFileSync(path.join(nativeDir, name));
            const actualText = actual.toString('utf8').replace(/\r\n/g, '\n');
            const expectedText = expected.toString('utf8').replace(/\r\n/g, '\n');
            if (actualText !== expectedText) {
              let offset = 0;
              while (offset < actualText.length && actualText[offset] === expectedText[offset]) offset++;
              throw new Error(
                `Native/browser artifact mismatch: ${name}; first normalized difference ${offset}; ` +
                `browser=${JSON.stringify(actualText.slice(Math.max(0, offset - 30), offset + 70))}; ` +
                `native=${JSON.stringify(expectedText.slice(Math.max(0, offset - 30), offset + 70))}`
              );
            }
            artifactSummary[name] = {
              browser_bytes: actual.length,
              native_bytes: expected.length,
              browser_sha256: crypto.createHash('sha256').update(actual).digest('hex'),
              native_sha256: crypto.createHash('sha256').update(expected).digest('hex'),
              newline_only_difference: !actual.equals(expected)
            };
          }
          const summary = {
            crossOriginIsolated: state.crossOriginIsolated,
            coepThirdPartyAssets: JSON.parse(state.assets),
            pyodide: '0.27.7',
            python: result.result.python,
            biopython: result.result.biopython,
            requests: result.result.requests,
            receptor_utils: result.result.receptor_utils,
            ogrdb_set_id: result.result.set_id,
            artifact_count: names.length,
            artifacts: artifactSummary,
            parity: 'identical content after normalizing Windows CRLF to LF',
            worker_log: result.log
          };
          fs.writeFileSync(path.join(stage, 'results', 'browser-summary.json'),
            JSON.stringify(summary, null, 2) + '\n');
          console.log(JSON.stringify(summary, null, 2));
          return;
        }
      } catch (error) {
        if (!error.message.includes('Cannot find default execution context')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Pyodide browser run timed out');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (socket) socket.close();
    proc.kill();
    server.close();
  }
});
