const resultElement = document.getElementById('result');
document.body.dataset.status = 'preparing';

let runDirectory;
let storageRoot;
let runDirectoryName;
let referenceFiles;
let databaseFiles;
let runNumber = 0;
const pageParams = new URL(location.href).searchParams;
const smallFixture = pageParams.get('fixture') === 'small';
const configuredThreads = Number(pageParams.get('threads') || '1');
const toolTimeoutMs = Number(pageParams.get('tool-timeout-ms') || '600000');
const referenceDirectory = pageParams.get('reference-artifacts');
const expectedQueryRecords = smallFixture ? 10 : 10000;
const queryPath = smallFixture
  ? '/tests/fixtures/stage2/query.fasta'
  : '/tools/stage6/results/query-10000.fasta';

if (!Number.isSafeInteger(configuredThreads) || configuredThreads < 1 || configuredThreads > 64) {
  throw new Error(`Invalid thread count: ${pageParams.get('threads')}`);
}
if (!Number.isSafeInteger(toolTimeoutMs) || toolTimeoutMs < 1000 || toolTimeoutMs > 600000) {
  throw new Error(`Invalid tool timeout: ${pageParams.get('tool-timeout-ms')}`);
}

function show(status, value) {
  document.body.dataset.status = status;
  resultElement.textContent = JSON.stringify(value, null, 2);
}

function runWorker(url, message, timeoutMs = 600000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error(`${url}: timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    const finish = callback => value => {
      clearTimeout(timeout);
      worker.terminate();
      callback(value);
    };
    worker.onmessage = finish(event => {
      const data = event.data;
      if (data.error || data.status === 'error') {
        reject(new Error(data.error || `${url} exited with status ${data.status}`));
      } else if (data.status !== undefined && data.status !== 'complete' && data.status !== 0) {
        reject(new Error(`${url} exited with status ${data.status}\n${data.output?.join('\n') || ''}`));
      } else {
        resolve(data);
      }
    });
    worker.onerror = finish(event => reject(new Error(event.message || `${url} failed`)));
    worker.postMessage(message);
  });
}

async function writeBytes(directory, name, bytes) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(bytes);
  } finally {
    await writable.close();
  }
}

async function listFiles(directory) {
  const names = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'file') names.push(name);
  }
  return names.sort();
}

async function runNcbiTool(tool, args, inputNames, outputPrefixes, requiredFiles = []) {
  const response = await runWorker(`/tools/stage5/ncbi-worker.js?tool=${tool}`, {
    directory: runDirectory,
    args,
    inputNames,
    outputNames: outputPrefixes
  }, toolTimeoutMs);
  if (response.status !== 0) {
    throw new Error(`${tool} exited with status ${response.status}\n${response.output?.join('\n') || ''}`);
  }
  for (const name of requiredFiles) {
    if (!response.files?.some(file => file.name === name && file.size > 0)) {
      throw new Error(`${tool} did not create required output ${name}`);
    }
  }
  return response;
}

async function prepare() {
  if (!crossOriginIsolated) throw new Error('Cross-origin isolation is unavailable');
  if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable');
  storageRoot = await navigator.storage.getDirectory();
  runDirectoryName = `igblast-stage6-${crypto.randomUUID()}`;
  runDirectory = await storageRoot.getDirectoryHandle(runDirectoryName, { create: true });

  const queryResponse = await fetch(queryPath);
  if (!queryResponse.ok) throw new Error(`Query fixture: HTTP ${queryResponse.status}`);
  const queryBytes = new Uint8Array(await queryResponse.arrayBuffer());
  const queryRecordCount = new TextDecoder().decode(queryBytes).match(/^>/gm)?.length || 0;
  if (queryRecordCount !== expectedQueryRecords) {
    throw new Error(`Expected ${expectedQueryRecords} FASTA records; found ${queryRecordCount}`);
  }
  await writeBytes(runDirectory, 'query.fasta', queryBytes);

  referenceFiles = [
    'Homo_sapiens_IGH_VDJ_V.fasta',
    'Homo_sapiens_IGH_VDJ_D.fasta',
    'Homo_sapiens_IGH_VDJ_J.fasta',
    'Homo_sapiens_IGH_VDJ.ndm',
    'Homo_sapiens_IGH_VDJ.aux'
  ];
  if (referenceDirectory) {
    const source = new URL(referenceDirectory, location.origin);
    if (source.origin !== location.origin || !source.pathname.startsWith('/tools/stage6/results/')) {
      throw new Error('Reference artifacts must be served from the local Stage 6 results directory');
    }
    for (const name of referenceFiles) {
      const response = await fetch(`${source.pathname.replace(/\/$/, '')}/${name}`);
      if (!response.ok) throw new Error(`Reference artifact ${name}: HTTP ${response.status}`);
      await writeBytes(runDirectory, name, new Uint8Array(await response.arrayBuffer()));
    }
  } else {
    const prepared = await runWorker('/tools/stage3/harness/py-worker.js', {
      outputDirectory: runDirectory
    });
    if (prepared.status !== 'complete') {
      throw new Error(prepared.error || 'OGRDB reference preparation failed');
    }
  }
  for (const [segment, reference] of [
    ['V', referenceFiles[0]],
    ['D', referenceFiles[1]],
    ['J', referenceFiles[2]]
  ]) {
    await runNcbiTool('makeblastdb', [
      '-in', reference,
      '-dbtype', 'nucl',
      '-blastdb_version', '4',
      '-parse_seqids',
      '-out', segment
    ], [reference], [`${segment}.`], [`${segment}.nin`]);
  }
  databaseFiles = (await listFiles(runDirectory)).filter(name =>
    /^[VDJ]\./.test(name)
  );
  if (!databaseFiles.some(name => name === 'V.nin') ||
      !databaseFiles.some(name => name === 'D.nin') ||
      !databaseFiles.some(name => name === 'J.nin')) {
    throw new Error('One or more BLAST v4 databases are incomplete');
  }
  show('ready', {
    status: 'ready',
    queryRecords: expectedQueryRecords,
    queryName: 'query.fasta',
    referenceFiles,
    databaseFiles,
    userAgent: navigator.userAgent,
    configuredThreads,
    hardwareConcurrency: navigator.hardwareConcurrency,
    referenceSource: referenceDirectory || 'Pyodide OGRDB preparation'
  });
}

window.__stage6RunIgblastOnce = async () => {
  runNumber++;
  const inputNames = ['query.fasta', ...referenceFiles, ...databaseFiles];
  const args = [
    '-query', 'query.fasta',
    '-germline_db_V', 'V',
    '-germline_db_D', 'D',
    '-germline_db_J', 'J',
    '-custom_internal_data', 'Homo_sapiens_IGH_VDJ.ndm',
    '-auxiliary_data', 'Homo_sapiens_IGH_VDJ.aux',
    '-organism', 'human',
    '-domain_system', 'imgt',
    '-ig_seqtype', 'Ig',
    '-outfmt', '19',
    '-num_threads', String(configuredThreads),
    '-out', 'airr.tsv'
  ];
  const started = performance.now();
  const response = await runNcbiTool('igblastn', args, inputNames, ['airr.tsv'], ['airr.tsv']);
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  const file = await runDirectory.getFileHandle('airr.tsv');
  const bytes = new Uint8Array(await (await file.getFile()).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const lines = text.trimEnd().split(/\r?\n/);
  const columns = lines[0].split('\t');
  const idIndex = columns.indexOf('sequence_id');
  if (idIndex < 0) throw new Error('AIRR output is missing sequence_id');
  const ids = new Set(lines.slice(1).map(line => line.split('\t')[idIndex]));
  if (lines.length !== expectedQueryRecords + 1 || ids.size !== expectedQueryRecords) {
    throw new Error(`Expected ${expectedQueryRecords} unique AIRR rows; found ${lines.length - 1} rows and ${ids.size} IDs`);
  }
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return {
    run: runNumber,
    elapsedMs,
    outputBytes: bytes.length,
    outputRows: lines.length - 1,
    outputColumns: columns.length,
    outputSha256: [...new Uint8Array(hash)]
      .map(value => value.toString(16).padStart(2, '0')).join(''),
    workerOutput: response.output || [],
    threadDiagnostics: response.threadDiagnostics || null
  };
};

window.__stage6ExportInputs = async () => {
  const names = ['query.fasta', ...referenceFiles];
  for (const name of names) {
    const handle = await runDirectory.getFileHandle(name);
    const url = URL.createObjectURL(await handle.getFile());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return names;
};

window.__stage6ExportOutput = async () => {
  const handle = await runDirectory.getFileHandle('airr.tsv');
  const url = URL.createObjectURL(await handle.getFile());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'airr.tsv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'airr.tsv';
};

window.__stage6Cleanup = async () => {
  if (!storageRoot || !runDirectoryName) return;
  await storageRoot.removeEntry(runDirectoryName, { recursive: true });
  runDirectory = null;
  runDirectoryName = null;
};

prepare().catch(async error => {
  let message = error.message || String(error);
  try {
    await window.__stage6Cleanup();
  } catch (cleanupError) {
    message += `; OPFS cleanup failed: ${cleanupError.message || cleanupError}`;
  }
  show('error', { error: message });
});
