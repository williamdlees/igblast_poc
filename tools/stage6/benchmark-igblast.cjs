const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..', '..');
const resultsRoot = path.join(__dirname, 'results');
const browser = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const nativeOnlyIndex = process.argv.indexOf('--native-only');
const nativeOnlyArtifacts = nativeOnlyIndex >= 0 ? process.argv[nativeOnlyIndex + 1] : null;
const smallParityRun = process.argv.includes('--small-parity');
const threadsIndex = process.argv.indexOf('--threads');
const threads = threadsIndex < 0 ? 1 : Number(process.argv[threadsIndex + 1]);
const timeoutIndex = process.argv.indexOf('--tool-timeout-ms');
const toolTimeoutMs = timeoutIndex < 0 ? 600000 : Number(process.argv[timeoutIndex + 1]);
const referenceArtifactsIndex = process.argv.indexOf('--reference-artifacts');
const referenceArtifacts = referenceArtifactsIndex < 0
  ? null
  : path.resolve(root, process.argv[referenceArtifactsIndex + 1] || '');
const repeats = smallParityRun ? 1 : 5;
const expectedQueryRecords = smallParityRun ? 10 : 10000;
const requiredInputs = [
  'query.fasta',
  'Homo_sapiens_IGH_VDJ_V.fasta',
  'Homo_sapiens_IGH_VDJ_D.fasta',
  'Homo_sapiens_IGH_VDJ_J.fasta',
  'Homo_sapiens_IGH_VDJ.ndm',
  'Homo_sapiens_IGH_VDJ.aux'
];

if (!Number.isSafeInteger(threads) || threads < 1 || threads > 64) {
  throw new Error(`Invalid --threads value: ${threadsIndex < 0 ? '' : process.argv[threadsIndex + 1]}`);
}
if (!Number.isSafeInteger(toolTimeoutMs) || toolTimeoutMs < 1000 || toolTimeoutMs > 600000) {
  throw new Error(`Invalid --tool-timeout-ms value: ${timeoutIndex < 0 ? '' : process.argv[timeoutIndex + 1]}`);
}
if (referenceArtifacts && (!fs.existsSync(referenceArtifacts) ||
    !fs.statSync(referenceArtifacts).isDirectory())) {
  throw new Error(`Reference artifact directory does not exist: ${referenceArtifacts}`);
}

function assertCommand(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited with ${result.status}\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
}

function runNative(executable, args, cwd, env, label) {
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 600000,
    windowsHide: true
  });
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  assertCommand(result, label);
  return { elapsedMs, stdout: result.stdout, stderr: result.stderr };
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function connectDevTools(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 0;
    socket.addEventListener('open', () => resolve({
      socket,
      send(method, params = {}) {
        return new Promise((sendResolve, sendReject) => {
          const id = ++nextId;
          pending.set(id, { resolve: sendResolve, reject: sendReject });
          socket.send(JSON.stringify({ id, method, params }));
        });
      }
    }));
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.addEventListener('error', reject, { once: true });
  });
}

async function waitForPage(port, url, edgeProcess) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (edgeProcess.exitCode !== null) throw new Error(`Edge exited with ${edgeProcess.exitCode}`);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const target = targets.find(item => item.type === 'page' && item.url.startsWith(url));
    if (target) return target;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Edge benchmark page did not appear in DevTools');
}

async function evaluate(devtools, expression) {
  const response = await devtools.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text || 'Browser evaluation failed');
  }
  return response.result?.value;
}

async function getBrowserProcessCpu(devtools) {
  const result = await devtools.send('SystemInfo.getProcessInfo');
  return new Map((result.processInfo || []).map(process => [
    process.id,
    { type: process.type, cpuTime: process.cpuTime }
  ]));
}

function browserCpuDelta(before, after) {
  let cpuTimeSeconds = 0;
  for (const [id, process] of after) {
    cpuTimeSeconds += process.cpuTime - (before.get(id)?.cpuTime || 0);
  }
  return {
    cpuTimeSeconds: Math.round(cpuTimeSeconds * 1000) / 1000,
    processCount: after.size,
    processTypes: [...new Set([...after.values()].map(process => process.type))].sort()
  };
}

async function waitForBrowserPreparation(devtools) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const encoded = await evaluate(devtools,
      'JSON.stringify({status:document.body?.dataset.status,text:document.getElementById("result")?.textContent})');
    const state = JSON.parse(encoded);
    if (!state?.status) {
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    if (state.status === 'ready') return JSON.parse(state.text);
    if (state.status === 'error') throw new Error(`Browser setup failed: ${state.text}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Browser reference/database preparation timed out');
}

async function waitForDownloads(directory, requiredNames) {
  const deadline = Date.now() + 600000;
  while (Date.now() < deadline) {
    const names = new Set(fs.readdirSync(directory));
    const allPresent = requiredNames.every(name => {
      const file = path.join(directory, name);
      return names.has(name) && fs.statSync(file).size > 0;
    });
    if (allPresent && ![...names].some(name => name.endsWith('.crdownload'))) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const names = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
  throw new Error(`Browser artifact downloads timed out; found: ${names.join(', ')}`);
}

function buildNativeDatabases(makeblastdb, artifactDirectory, databaseDirectory, env) {
  fs.mkdirSync(databaseDirectory, { recursive: true });
  const references = {
    V: 'Homo_sapiens_IGH_VDJ_V.fasta',
    D: 'Homo_sapiens_IGH_VDJ_D.fasta',
    J: 'Homo_sapiens_IGH_VDJ_J.fasta'
  };
  for (const [segment, file] of Object.entries(references)) {
    runNative(makeblastdb, [
      '-in', path.join(artifactDirectory, file),
      '-dbtype', 'nucl',
      '-blastdb_version', '4',
      '-parse_seqids',
      '-out', segment
    ], databaseDirectory, env, `makeblastdb ${segment}`);
  }
  const internalDirectory = path.join(databaseDirectory, 'internal_data', 'human');
  fs.mkdirSync(internalDirectory, { recursive: true });
  for (const file of fs.readdirSync(databaseDirectory)) {
    if (file.startsWith('V.')) {
      fs.copyFileSync(
        path.join(databaseDirectory, file),
        path.join(internalDirectory, `human_${file}`)
      );
    }
  }
  if (!fs.existsSync(path.join(databaseDirectory, 'V.nin'))) {
    throw new Error('Native makeblastdb did not create V.nin');
  }
}

function summarizeFasta(file) {
  const content = fs.readFileSync(file);
  const identifiers = content.toString('utf8').split(/\r?\n/)
    .filter(line => line.startsWith('>'))
    .map(line => line.slice(1).split(/\s/, 1)[0]);
  return {
    source: path.relative(root, file),
    recordCount: identifiers.length,
    uniqueIdentifierCount: new Set(identifiers).size,
    sizeBytes: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

function summarizeFiles(directory, names) {
  return Object.fromEntries(names.map(name => {
    const file = path.join(directory, name);
    const content = fs.readFileSync(file);
    return [name, {
      sizeBytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    }];
  }));
}

function runNativeIgblast(executable, artifactDirectory, databaseDirectory, outputPath, env) {
  const args = [
    '-query', path.join(artifactDirectory, 'query.fasta'),
    '-germline_db_V', 'V',
    '-germline_db_D', 'D',
    '-germline_db_J', 'J',
    '-custom_internal_data', path.join(artifactDirectory, 'Homo_sapiens_IGH_VDJ.ndm'),
    '-auxiliary_data', path.join(artifactDirectory, 'Homo_sapiens_IGH_VDJ.aux'),
    '-organism', 'human',
    '-domain_system', 'imgt',
    '-ig_seqtype', 'Ig',
    '-outfmt', '19',
    '-num_threads', String(threads),
    '-out', outputPath
  ];
  const result = runNative(executable, args, databaseDirectory, env, 'native igblastn');
  const lines = fs.readFileSync(outputPath, 'utf8').trimEnd().split(/\r?\n/);
  if (lines.length !== expectedQueryRecords + 1) {
    throw new Error(`Native IgBLAST returned ${lines.length - 1} rows, expected ${expectedQueryRecords}`);
  }
  return result;
}

async function main() {
  fs.mkdirSync(resultsRoot, { recursive: true });
  if (nativeOnlyIndex >= 0) {
    if (!nativeOnlyArtifacts) {
      throw new Error('Usage: node tools\\stage6\\benchmark-igblast.cjs --native-only <browser-artifact-directory>');
    }
    const artifactDirectory = path.resolve(root, nativeOnlyArtifacts);
    const queryManifest = summarizeFasta(path.join(artifactDirectory, 'query.fasta'));
    if (queryManifest.recordCount !== 10000 || queryManifest.uniqueIdentifierCount !== 10000) {
      throw new Error('Native-only mode requires the generated 10,000-record query');
    }
    const makeblastdb = path.join(root, 'bin', 'makeblastdb.exe');
    const igblastn = path.join(root, 'bin', 'igblastn.exe');
    for (const executable of [makeblastdb, igblastn]) {
      if (!fs.existsSync(executable)) throw new Error(`Required native executable is missing: ${executable}`);
    }
    const environment = {
      ...process.env,
      BLAST_USAGE_REPORT: '0',
      PATH: `${path.dirname(igblastn)};${process.env.PATH || ''}`
    };
    const id = `igblast-native-only-${new Date().toISOString().replace(/[-:.]/g, '')}`;
    const runDirectory = path.join(resultsRoot, id);
    const databaseDirectory = path.join(runDirectory, 'native-db');
    const outputDirectory = path.join(runDirectory, 'native-output');
    fs.mkdirSync(outputDirectory, { recursive: true });
    buildNativeDatabases(makeblastdb, artifactDirectory, databaseDirectory, environment);
    const measurements = [];
    for (let run = 1; run <= 5; run++) {
      const outputPath = path.join(outputDirectory, `native-${run}.tsv`);
      const measurement = runNativeIgblast(
        igblastn, artifactDirectory, databaseDirectory, outputPath, environment
      );
      measurements.push({ run, elapsedMs: measurement.elapsedMs, outputPath });
    }
    const sorted = measurements.map(run => run.elapsedMs).sort((a, b) => a - b);
    const summary = {
      status: 'native-only',
      query: queryManifest,
      repeats: measurements.length,
      igblastArguments: [
        '-organism human', '-domain_system imgt', '-ig_seqtype Ig', '-outfmt 19', `-num_threads ${threads}`
      ],
      timerBoundary: 'Fresh native igblastn process launch through completed AIRR output; excludes reference preparation, makeblastdb, and query generation.',
      measurements,
      medianMs: sorted[Math.floor(sorted.length / 2)],
      artifacts: {
        directory: path.relative(root, runDirectory),
        output: path.relative(root, measurements[measurements.length - 1].outputPath)
      }
    };
    const summaryPath = path.join(runDirectory, 'native-only.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  let queryManifest;
  if (smallParityRun) {
    const sourcePath = path.join(root, 'tests', 'fixtures', 'stage2', 'query.fasta');
    const content = fs.readFileSync(sourcePath);
    queryManifest = {
      source: path.relative(root, sourcePath),
      recordCount: (content.toString('utf8').match(/^>/gm) || []).length,
      uniqueIdentifierCount: 10,
      sizeBytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex')
    };
  } else if (referenceArtifacts) {
    const queryPath = path.join(resultsRoot, 'query-10000.fasta');
    if (!fs.existsSync(queryPath)) {
      throw new Error(`Generated 10,000-record query is missing: ${queryPath}`);
    }
    queryManifest = summarizeFasta(queryPath);
  } else {
    const generated = spawnSync(process.execPath, [
      path.join(__dirname, 'generate-10k-fasta.cjs')
    ], { cwd: root, encoding: 'utf8', windowsHide: true });
    assertCommand(generated, '10,000-record FASTA generator');
    queryManifest = JSON.parse(generated.stdout);
  }
  if (queryManifest.recordCount !== expectedQueryRecords ||
      queryManifest.uniqueIdentifierCount !== expectedQueryRecords) {
    throw new Error(`Query manifest does not describe ${expectedQueryRecords} unique records`);
  }
  if (referenceArtifacts) {
    const referenceQuery = summarizeFasta(path.join(referenceArtifacts, 'query.fasta'));
    if (referenceQuery.sha256 !== queryManifest.sha256) {
      throw new Error('Reference artifact query does not match the generated benchmark query');
    }
    for (const name of requiredInputs.slice(1)) {
      if (!fs.existsSync(path.join(referenceArtifacts, name))) {
        throw new Error(`Required reference artifact is missing: ${path.join(referenceArtifacts, name)}`);
      }
    }
  }
  const referenceManifest = referenceArtifacts
    ? summarizeFiles(referenceArtifacts, requiredInputs.slice(1))
    : null;

  const makeblastdb = path.join(root, 'bin', 'makeblastdb.exe');
  const igblastn = path.join(root, 'bin', 'igblastn.exe');
  for (const executable of [makeblastdb, igblastn]) {
    if (!fs.existsSync(executable)) throw new Error(`Required native executable is missing: ${executable}`);
  }
  const id = `igblast-speed-${new Date().toISOString().replace(/[-:.]/g, '')}`;
  const runDirectory = path.join(resultsRoot, id);
  const downloadDirectory = path.join(runDirectory, 'browser-artifacts');
  const nativeDatabaseDirectory = path.join(runDirectory, 'native-db');
  const nativeOutputDirectory = path.join(runDirectory, 'native-output');
  fs.mkdirSync(downloadDirectory, { recursive: true });
  fs.mkdirSync(nativeOutputDirectory, { recursive: true });

  const environment = {
    ...process.env,
    BLAST_USAGE_REPORT: '0',
    PATH: `${path.dirname(igblastn)};${process.env.PATH || ''}`
  };
  const nativeVersions = {
    igblastn: runNative(igblastn, ['-version'], root, environment, 'igblastn version').stdout.trim(),
    makeblastdb: runNative(makeblastdb, ['-version'], root, environment, 'makeblastdb version').stdout.trim()
  };

  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, [path.join(root, 'tools', 'stage5', 'server.cjs')], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let serverError = '';
  serverProcess.stderr.on('data', chunk => { serverError += chunk; });
  let edgeProcess;
  let devtools;
  let browserControl;

  try {
    const serverDeadline = Date.now() + 30000;
    while (Date.now() < serverDeadline) {
      if (serverProcess.exitCode !== null) {
        throw new Error(`Stage 5 server exited: ${serverError}`);
      }
      try {
        const response = await fetch(`${baseUrl}/tools/stage6/igblast-speed.html`);
        if (response.ok) break;
      } catch {
        // Wait for the local server to bind.
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const pageParams = new URLSearchParams();
    if (smallParityRun) pageParams.set('fixture', 'small');
    pageParams.set('threads', String(threads));
    pageParams.set('tool-timeout-ms', String(toolTimeoutMs));
    if (referenceArtifacts) {
      pageParams.set(
        'reference-artifacts',
        `/${path.relative(root, referenceArtifacts).split(path.sep).join('/')}`
      );
    }
    const pageUrl = `${baseUrl}/tools/stage6/igblast-speed.html?${pageParams}`;
    edgeProcess = spawn(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${path.join(runDirectory, 'edge-profile')}`,
      '--remote-debugging-port=0',
      pageUrl
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

    let edgeError = '';
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Edge did not start: ${edgeError}`)), 30000);
      edgeProcess.stderr.on('data', chunk => {
        edgeError += chunk;
        const match = edgeError.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
      edgeProcess.once('error', reject);
      edgeProcess.once('exit', code => reject(new Error(`Edge exited with ${code}\n${edgeError}`)));
    });
    const devtoolsPort = new URL(endpoint).port;
    browserControl = await connectDevTools(endpoint);
    const target = await waitForPage(devtoolsPort, pageUrl, edgeProcess);
    devtools = await connectDevTools(target.webSocketDebuggerUrl);
    await devtools.send('Runtime.enable');
    await devtools.send('Page.enable');
    await devtools.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadDirectory
    });

    const browserPreparation = await waitForBrowserPreparation(devtools);
    const exportedNames = await evaluate(devtools,
      'window.__stage6ExportInputs().then(JSON.stringify)');
    if (JSON.parse(exportedNames).join('\n') !== requiredInputs.join('\n')) {
      throw new Error(`Unexpected browser artifacts: ${exportedNames}`);
    }
    await waitForDownloads(downloadDirectory, requiredInputs);

    buildNativeDatabases(makeblastdb, downloadDirectory, nativeDatabaseDirectory, environment);
    const browserMeasurements = [];
    const nativeMeasurements = [];
    const runOrder = [];
    for (let index = 0; index < repeats; index++) {
      const browserFirst = index % 2 === 0;
      for (const mode of browserFirst ? ['browser', 'native'] : ['native', 'browser']) {
        runOrder.push(mode);
        if (mode === 'browser') {
          let cpuBefore;
          let cpuSamplingNote = null;
          try {
            cpuBefore = await getBrowserProcessCpu(browserControl);
          } catch (error) {
            cpuSamplingNote = error.message;
          }
          const wallStarted = performance.now();
          const encoded = await evaluate(devtools,
            'window.__stage6RunIgblastOnce().then(JSON.stringify)');
          const measurement = JSON.parse(encoded);
          const wallElapsedMs = performance.now() - wallStarted;
          let cpuAfter;
          try {
            cpuAfter = await getBrowserProcessCpu(browserControl);
          } catch (error) {
            cpuSamplingNote = cpuSamplingNote || error.message;
          }
          if (cpuBefore && cpuAfter) {
            const cpu = browserCpuDelta(cpuBefore, cpuAfter);
            measurement.browserCpu = {
              ...cpu,
              measuredWallMs: Math.round(wallElapsedMs * 100) / 100,
              averageCoresUsed: Math.round(cpu.cpuTimeSeconds / (wallElapsedMs / 1000) * 1000) / 1000
            };
          } else {
            measurement.browserCpu = {
              status: 'unavailable',
              note: cpuSamplingNote || 'Edge process CPU time was unavailable'
            };
          }
          if (measurement.outputRows !== expectedQueryRecords) {
            throw new Error(`Browser run returned ${measurement.outputRows} rows, expected ${expectedQueryRecords}`);
          }
          browserMeasurements.push(measurement);
        } else {
          const outputPath = path.join(nativeOutputDirectory, `native-${index + 1}.tsv`);
          const measurement = runNativeIgblast(
            igblastn, downloadDirectory, nativeDatabaseDirectory, outputPath, environment
          );
          nativeMeasurements.push({
            run: index + 1,
            elapsedMs: measurement.elapsedMs,
            outputPath
          });
        }
      }
    }

    const exportedOutput = await evaluate(devtools,
      'window.__stage6ExportOutput().then(JSON.stringify)');
    if (JSON.parse(exportedOutput) !== 'airr.tsv') {
      throw new Error(`Unexpected browser output artifact: ${exportedOutput}`);
    }
    await waitForDownloads(downloadDirectory, [...requiredInputs, 'airr.tsv']);

    const browserOutputPath = path.join(downloadDirectory, 'airr.tsv');
    const nativeOutputPath = nativeMeasurements[nativeMeasurements.length - 1].outputPath;
    const comparison = spawnSync(process.execPath, [
      path.join(root, 'tools', 'stage2', 'harness', 'compare.cjs'),
      nativeOutputPath,
      browserOutputPath
    ], { cwd: root, encoding: 'utf8', windowsHide: true });
    assertCommand(comparison, 'native/browser AIRR comparison');
    const comparisonResult = JSON.parse(comparison.stdout);
    if (comparisonResult.rows !== expectedQueryRecords || comparisonResult.differences.length !== 0) {
      throw new Error(`Native/browser comparison failed: ${comparison.stdout}`);
    }
    const median = values => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };
    const summary = {
      status: 'complete',
      query: queryManifest,
      queryRecordCount: expectedQueryRecords,
      nativeVersions,
      browser: browserPreparation.userAgent,
      browserHardwareConcurrency: browserPreparation.hardwareConcurrency,
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model || 'unknown',
      logicalCpus: os.cpus().length,
      timerBoundary: 'Native: fresh process launch through output completion and row-count check. Browser: fresh tool worker through OPFS-to-MEMFS input transfer, annotation, output persistence, OPFS readback, row/ID validation, and SHA-256; excludes Edge startup, reference preparation, makeblastdb, and query generation.',
      repeats,
      runOrder,
      igblastArguments: [
        '-organism human', '-domain_system imgt', '-ig_seqtype Ig', '-outfmt 19', `-num_threads ${threads}`
      ],
      configuredThreads: threads,
      referenceArtifacts: referenceArtifacts ? path.relative(root, referenceArtifacts) : 'Pyodide OGRDB preparation',
      referenceManifest,
      database: 'Separate native and browser BLAST v4 databases generated from the exact same Stage 5 OGRDB V/D/J FASTAs with -dbtype nucl -parse_seqids.',
      browserMeasurements,
      nativeMeasurements,
      mediansMs: {
        browser: median(browserMeasurements.map(run => run.elapsedMs)),
        native: median(nativeMeasurements.map(run => run.elapsedMs))
      },
      nativeToBrowserMedianTimeRatio: Math.round(
        median(nativeMeasurements.map(run => run.elapsedMs)) /
        median(browserMeasurements.map(run => run.elapsedMs)) * 1000
      ) / 1000,
      parity: comparisonResult,
      artifacts: {
        directory: path.relative(root, runDirectory),
        browserOutput: path.relative(root, browserOutputPath),
        nativeOutput: path.relative(root, nativeOutputPath)
      }
    };
    const summaryPath = path.join(runDirectory, 'igblast-speed.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    const cleanupResult = await evaluate(devtools, 'window.__stage6Cleanup().then(() => "cleaned")');
    if (cleanupResult !== 'cleaned') throw new Error(`OPFS cleanup failed: ${cleanupResult}`);
  } finally {
    if (devtools?.socket.readyState === WebSocket.OPEN) {
      try {
        await evaluate(devtools, 'window.__stage6Cleanup().then(() => "cleaned")');
      } catch (error) {
        console.error(`OPFS cleanup failed: ${error.message}`);
      }
    }
    if (devtools?.socket.readyState === WebSocket.OPEN) devtools.socket.close();
    if (browserControl?.socket.readyState === WebSocket.OPEN) browserControl.socket.close();
    if (edgeProcess && edgeProcess.exitCode === null) edgeProcess.kill();
    if (serverProcess.exitCode === null) serverProcess.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
