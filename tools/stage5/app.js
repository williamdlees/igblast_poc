const status = document.getElementById('status');
const log = document.getElementById('log');
const inputFile = document.getElementById('query-file');
const queryText = document.getElementById('query-text');
const sourceChoice = document.getElementById('reference-source');
const runButton = document.getElementById('run');
const downloadButton = document.getElementById('download');
const clearButton = document.getElementById('clear');
const cancelButton = document.getElementById('cancel');

let activeWorker;
let activeWorkerCancel;
let activeDirectory;
let currentOutput;

function report(message) {
  status.textContent = message;
  log.textContent += `${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function setBusy(busy) {
  runButton.disabled = busy || Boolean(activeDirectory);
  inputFile.disabled = busy;
  queryText.disabled = busy;
  sourceChoice.disabled = busy;
  cancelButton.disabled = !busy;
  clearButton.disabled = busy || !activeDirectory;
}

function runWorker(url, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url);
    activeWorker = worker;
    const timeout = setTimeout(() => {
      worker.terminate();
      activeWorker = null;
      activeWorkerCancel = null;
      reject(new Error('Worker timed out'));
    }, timeoutMs);
    activeWorkerCancel = () => {
      clearTimeout(timeout);
      worker.terminate();
      activeWorker = null;
      activeWorkerCancel = null;
      reject(new Error('Run cancelled'));
    };
    worker.onmessage = ({ data }) => {
      clearTimeout(timeout);
      worker.terminate();
      activeWorker = null;
      activeWorkerCancel = null;
      if (data.error) reject(new Error(`${data.error}\n${data.output?.join('\n') || ''}`));
      else if (data.status && data.status !== 'complete' && data.status !== 0) {
        reject(new Error(`Worker exited with status ${data.status}\n${data.output?.join('\n') || ''}`));
      } else resolve(data);
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      worker.terminate();
      activeWorker = null;
      activeWorkerCancel = null;
      reject(new Error(event.message || 'Worker failed'));
    };
    worker.postMessage(message);
  });
}

async function writeFile(directory, name, file) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await file.stream().pipeTo(writable);
}

async function writeText(directory, name, text) {
  const file = new File([text], name, { type: 'text/plain' });
  await writeFile(directory, name, file);
}

async function clearDirectory(directory) {
  for await (const [name] of directory.entries()) {
    await directory.removeEntry(name, { recursive: true });
  }
}

async function createRunDirectory() {
  if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable in this browser');
  const root = await navigator.storage.getDirectory();
  const name = `igblast-run-${crypto.randomUUID()}`;
  const directory = await root.getDirectoryHandle(name, { create: true });
  return { root, name, directory };
}

function validateLiveOrigin() {
  if (location.origin !== 'https://ogrdb.airr-community.org') {
    throw new Error(
      'Live OGRDB mode requires this app to be integrated at https://ogrdb.airr-community.org. ' +
      'Use the bundled fixture for local development.'
    );
  }
}

async function prepareReferences(directory) {
  if (sourceChoice.value === 'live') validateLiveOrigin();
  report(sourceChoice.value === 'live'
    ? 'Preparing references from same-origin OGRDB…'
    : 'Preparing references from the bundled OGRDB fixture…');
  const response = await runWorker('/tools/stage3/harness/py-worker.js', {
    outputDirectory: directory
  }, 600000);
  if (response.status !== 'complete') {
    throw new Error(response.error || 'Reference preparation failed');
  }
  report(`Prepared ${response.result.preparedArtifacts.length} reference files for ${response.result.set_id}.`);
}

async function runTool(tool, directory, args, inputNames, outputNames, requiredFiles = []) {
  report(`Running ${tool}…`);
  const response = await runWorker(`/tools/stage5/ncbi-worker.js?tool=${tool}`, {
    directory,
    args,
    inputNames,
    outputNames
  }, 600000);
  if (response.status !== 0) {
    throw new Error(`${tool} exited with status ${response.status}\n${response.output.join('\n')}`);
  }
  if (!response.files?.length) throw new Error(`${tool} produced no persisted output files`);
  for (const required of requiredFiles) {
    if (!response.files.some(file => file.name === required && file.size > 0)) {
      throw new Error(`${tool} did not create required output ${required}`);
    }
  }
  report(`${tool} saved ${response.files.length} file(s).`);
}

async function runPipeline() {
  if (!crossOriginIsolated) throw new Error('Cross-origin isolation is required for the NCBI pthread build');
  const { root, name, directory } = await createRunDirectory();
  activeDirectory = { root, name, directory };
  downloadButton.disabled = true;
  currentOutput = null;
  try {
    const selectedFile = inputFile.files[0];
    if (selectedFile) {
      await writeFile(directory, 'query.fasta', selectedFile);
    } else {
      const text = queryText.value.trim();
      if (!text) throw new Error('Choose a FASTA file or paste a FASTA sequence first');
      await writeText(directory, 'query.fasta', text.endsWith('\n') ? text : `${text}\n`);
    }

    await prepareReferences(directory);
    const referenceInputs = [
      'Homo_sapiens_IGH_VDJ_V.fasta',
      'Homo_sapiens_IGH_VDJ_D.fasta',
      'Homo_sapiens_IGH_VDJ_J.fasta'
    ];
    for (const [segment, reference] of [['V', referenceInputs[0]], ['D', referenceInputs[1]], ['J', referenceInputs[2]]]) {
      await runTool(
        'makeblastdb',
        directory,
        ['-in', reference, '-dbtype', 'nucl', '-blastdb_version', '4',
          '-parse_seqids', '-out', segment],
        [reference],
        [`${segment}.`],
        [`${segment}.nin`]
      );
    }

    const igblastInputs = [
      'query.fasta',
      'Homo_sapiens_IGH_VDJ.ndm',
      'Homo_sapiens_IGH_VDJ.aux'
    ];
    for (const segment of ['V', 'D', 'J']) {
      for await (const [fileName, handle] of directory.entries()) {
        if (handle.kind === 'file' && fileName.startsWith(`${segment}.`)) {
          igblastInputs.push(fileName);
        }
      }
    }
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
      '-num_threads', '1',
      '-out', 'airr.tsv'
    ];
    await runTool('igblastn', directory, args, igblastInputs, ['airr.tsv'], ['airr.tsv']);
    const output = await directory.getFileHandle('airr.tsv');
    if ((await output.getFile()).size === 0) throw new Error('IgBLAST produced an empty AIRR TSV');
    currentOutput = { directory, name: 'airr.tsv' };
    downloadButton.disabled = false;
    report('Analysis complete. Download the AIRR TSV when ready.');
  } catch (error) {
    await clearDirectory(directory);
    await root.removeEntry(name);
    activeDirectory = null;
    throw error;
  }
}

runButton.addEventListener('click', async () => {
  log.textContent = '';
  setBusy(true);
  try {
    await runPipeline();
  } catch (error) {
    report(`Error: ${error.message || error}`);
  } finally {
    setBusy(false);
  }
});

cancelButton.addEventListener('click', async () => {
  if (activeWorkerCancel) activeWorkerCancel();
});

downloadButton.addEventListener('click', async () => {
  if (!currentOutput) return;
  try {
    const file = await (await currentOutput.directory.getFileHandle(currentOutput.name)).getFile();
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'airr.tsv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    report(`Download failed: ${error.message || error}`);
  }
});

clearButton.addEventListener('click', async () => {
  if (!activeDirectory) {
    report('No temporary run directory to clear.');
    return;
  }
  try {
    await clearDirectory(activeDirectory.directory);
    await activeDirectory.root.removeEntry(activeDirectory.name);
    activeDirectory = null;
    currentOutput = null;
    downloadButton.disabled = true;
    report('Temporary run files cleared.');
    setBusy(false);
  } catch (error) {
    report(`Cleanup failed: ${error.message || error}`);
  }
});

report('Ready. Select the local fixture for development or use live OGRDB on its own origin.');
