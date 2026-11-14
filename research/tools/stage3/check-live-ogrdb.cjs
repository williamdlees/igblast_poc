const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const output = path.join(__dirname, 'results', 'live-ogrdb.json');
const targetUrl = 'https://ogrdb.airr-community.org/';
const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${path.join(__dirname, 'results', 'edge-live-profile')}`,
  '--remote-debugging-port=0', 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });

let socket;
let nextId = 0;
const pending = new Map();
const externalResponses = new Map();
const failedLoads = [];
const requestUrls = new Map();
let documentHeaders = {};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

function header(headers, name) {
  const key = Object.keys(headers || {}).find(value => value.toLowerCase() === name);
  return key ? headers[key] : '';
}

async function main() {
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
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const page = targets.find(target => target.type === 'page');
    if (!page) throw new Error('Edge page target not found');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });

    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.requestWillBeSent') {
        requestUrls.set(message.params.requestId, message.params.request.url);
      } else if (message.method === 'Network.responseReceived') {
        const response = message.params.response;
        if (message.params.type === 'Document' && response.url.startsWith(targetUrl)) {
          documentHeaders = response.headers;
        }
        const origin = new URL(response.url).origin;
        if (['http:', 'https:'].includes(new URL(response.url).protocol) &&
            origin !== 'https://ogrdb.airr-community.org') {
          externalResponses.set(response.url, {
            type: message.params.type,
            status: response.status,
            corp: header(response.headers, 'cross-origin-resource-policy'),
            allow_origin: header(response.headers, 'access-control-allow-origin')
          });
        }
      } else if (message.method === 'Network.loadingFailed') {
        failedLoads.push({
          url: requestUrls.get(message.params.requestId) || message.params.requestId,
          error: message.params.errorText,
          blockedReason: message.params.blockedReason || ''
        });
      }

      if (!message.id || !pending.has(message.id)) return;
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.navigate', { url: targetUrl });

    const deadline = Date.now() + 120000;
    let apiResult;
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', {
        expression: `(${async () => {
          if (!location.hostname.endsWith('ogrdb.airr-community.org') ||
              document.readyState !== 'complete') return null;
          const get = async path => {
            const url = new URL(path, location.href);
            const response = await fetch(url.href, { cache: 'no-store' });
            const body = await response.text();
            return { path, origin: url.origin, status: response.status,
              contentType: response.headers.get('content-type') || '',
              length: body.length, body };
          };
          try {
            const species = await get('/api_v2/germline/species');
            const sets = await get('/api_v2/germline/sets/9606');
            const setList = JSON.parse(sets.body);
            const entry = setList.germline_species.find(x =>
              x.locus === 'IGH' && x.germline_set_name === 'IGH_VDJ');
            if (!entry) throw new Error('IGH_VDJ not listed for Homo sapiens');
            const prefix = '/api_v2/germline/set/' + entry.germline_set_id + '/latest';
            const json = await get(prefix);
            const ungapped = await get(prefix + '/ungapped_ex');
            const gapped = await get(prefix + '/gapped_ex');
            const responses = [species, sets, json, ungapped, gapped];
            const failed = responses.filter(response => response.status !== 200);
            if (failed.length) {
              throw new Error('OGRDB same-origin request failed: ' +
                failed.map(response => response.path + ' HTTP ' + response.status).join(', '));
            }
            const body = JSON.parse(json.body);
            const set = Array.isArray(body.GermlineSet) ? body.GermlineSet[0] : body.GermlineSet;
            if (!set.allele_descriptions?.length ||
                !(ungapped.body.match(/^>/gm) || []).length ||
                !(gapped.body.match(/^>/gm) || []).length) {
              throw new Error('OGRDB response is missing germline records');
            }
            return {
              origin: location.origin,
              crossOriginIsolated,
              sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
              iframes: [...document.querySelectorAll('iframe')].map(frame => frame.src || ''),
              setId: entry.germline_set_id,
              setName: set.germline_set_name,
              alleleCount: set.allele_descriptions.length,
              responses: responses.map(r => ({
                path: r.path, origin: r.origin, status: r.status,
                contentType: r.contentType, characters: r.length,
                fastaRecords: r.path.endsWith('_ex') ? (r.body.match(/^>/gm) || []).length : undefined
              }))
            };
          } catch (error) {
            return { origin: location.origin, crossOriginIsolated, error: String(error) };
          }
        }})()`,
        awaitPromise: true,
        returnByValue: true
      });
      apiResult = evaluated.result.value;
      if (apiResult && (apiResult.responses || apiResult.error)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!apiResult) throw new Error('OGRDB page/API test timed out');

    const riskyThirdParty = [...externalResponses.entries()]
      .filter(([, value]) => !value.corp && !value.allow_origin)
      .map(([url, value]) => ({ url, ...value }));
    const result = {
      page_origin: apiResult.origin,
      same_origin_fetch: apiResult.responses ? 'passed' : 'failed',
      page_cross_origin_isolated: apiResult.crossOriginIsolated,
      shared_array_buffer_available: apiResult.sharedArrayBuffer,
      iframes: apiResult.iframes || [],
      ogrdb_set_id: apiResult.setId || null,
      allele_count: apiResult.alleleCount || null,
      api_responses: apiResult.responses || [],
      page_response_headers: {
        coop: header(documentHeaders, 'cross-origin-opener-policy'),
        coep: header(documentHeaders, 'cross-origin-embedder-policy')
      },
      third_party_resources_observed: [...externalResponses.entries()].map(([url, value]) => ({
        url, ...value
      })),
      third_party_without_corp_or_cors: riskyThirdParty,
      failed_resource_loads: failedLoads,
      conclusion: riskyThirdParty.length
        ? 'At least one observed third-party response lacks CORP and ACAO; COEP require-corp may block it when embedded without CORS mode.'
        : 'No observed third-party response lacked both CORP and ACAO. The actual OGRDB origin does not currently set COOP/COEP; a separate isolated localhost test checks these assets with the required headers.'
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (result.same_origin_fetch !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (socket) socket.close();
    proc.kill();
  }
}

main();
