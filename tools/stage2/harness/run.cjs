const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..', '..');
const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' :
    file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(404); res.end(); });
  stream.pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/tools/stage2/harness/index.html`;
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(root, 'build-stage2-browser-profile')}`, '--remote-debugging-port=0', url],
    { stdio: ['ignore', 'ignore', 'pipe'] });
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
      const timeout = setTimeout(() => reject(new Error(`Browser did not start: ${stderr}`)), 30000);
      proc.stderr.on('data', chunk => {
        stderr += chunk;
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      proc.on('error', reject);
      proc.on('exit', code => reject(new Error(`Browser exited: ${code}\n${stderr}`)));
    });
    const port = new URL(endpoint).port;
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find(target => target.type === 'page' && target.url.startsWith(url));
      if (!page) await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!page) throw new Error('Browser page not found');
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
        const r = await send('Runtime.evaluate', { expression:
          'JSON.stringify({status:document.body?.dataset.status, text:document.getElementById("result")?.textContent})',
          returnByValue: true });
        const data = JSON.parse(r.result.value);
        if (data.status) {
          console.log(data.text);
          if (data.status !== 'complete') {
            process.exitCode = 1;
          } else {
            const result = JSON.parse(data.text);
            if (!result.airr) throw new Error('Browser returned no AIRR output');
            fs.writeFileSync(path.join(root, 'browser-airr.tsv'), result.airr);
          }
          return;
        }
      } catch (error) {
        if (!error.message.includes('Cannot find default execution context')) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Browser test timed out');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (socket) socket.close();
    proc.kill();
    server.close();
  }
});
