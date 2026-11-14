const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pageUrlPath = '/research/tools/stage4/storage-bridge.html';
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' :
    file.endsWith('.js') || file.endsWith('.cjs') ? 'text/javascript' :
      file.endsWith('.html') ? 'text/html' :
        file.endsWith('.zip') ? 'application/zip' : 'application/octet-stream');
  fs.createReadStream(file).on('error', () => {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}${pageUrlPath}`;
  const profile = path.join(__dirname, 'results', 'edge-profile');
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
    if (!page) throw new Error('Edge storage test page not found');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
    };

    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      try {
        const response = await send('Runtime.evaluate', {
          expression: 'JSON.stringify({status:document.body?.dataset.status,text:document.getElementById("result")?.textContent})',
          returnByValue: true
        });
        const state = JSON.parse(response.result.value);
        if (state.status === 'complete' || state.status === 'error') {
          const result = JSON.parse(state.text);
          if (state.status !== 'complete') throw new Error(JSON.stringify(result));
          console.log(JSON.stringify(result, null, 2));
          return;
        }
      } catch (error) {
        if (!error.message.includes('Cannot find default execution context')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('Storage bridge test timed out');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (socket) socket.close();
    proc.kill();
    server.close();
  }
});
