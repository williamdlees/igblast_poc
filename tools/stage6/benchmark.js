const MIB = 1024 * 1024;
const SIZE = 50 * MIB;
const REPEATS = 5;
const result = document.getElementById('result');
document.body.dataset.status = 'running';

function digest(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then(hash =>
    [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('')
  );
}

function waitForWorker(worker, type, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const finish = callback => value => {
      clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      callback(value);
    };
    const succeed = finish(resolve);
    const fail = finish(reject);
    const timeout = setTimeout(() => fail(new Error(`Worker ${type} timed out`)), timeoutMs);
    const onMessage = ({ data }) => {
      if (data.type === 'error') {
        fail(new Error(data.error));
      } else if (data.type === type) {
        succeed(data);
      }
    };
    const onError = event => fail(new Error(event.message || `Worker ${type} failed`));
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError, { once: true });
  });
}

async function createInput(directory) {
  const handle = await directory.getFileHandle('input.bin', { create: true });
  const writable = await handle.createWritable();
  const chunkSize = MIB;
  try {
    for (let offset = 0; offset < SIZE; offset += chunkSize) {
      const length = Math.min(chunkSize, SIZE - offset);
      const chunk = new Uint8Array(length);
      for (let i = 0; i < length; i++) chunk[i] = (offset + i) % 251;
      await writable.write(chunk);
    }
  } finally {
    await writable.close();
  }
}

(async () => {
  let temporaryName;
  let worker;
  let summary;
  let failure;
  let temporaryDirectoryRemoved = false;
  try {
    if (!crossOriginIsolated) throw new Error('Cross-origin isolation is unavailable');
    if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable');
    const root = await navigator.storage.getDirectory();
    temporaryName = `igblast-stage6-${crypto.randomUUID()}`;
    const directory = await root.getDirectoryHandle(temporaryName, { create: true });
    const estimate = await navigator.storage.estimate();
    await createInput(directory);
    const sourceFile = await (await directory.getFileHandle('input.bin')).getFile();
    if (sourceFile.size !== SIZE) throw new Error(`Input size ${sourceFile.size}, expected ${SIZE}`);
    const expectedSha256 = await digest(await sourceFile.arrayBuffer());

    worker = new Worker('/tools/stage6/benchmark-worker.js');
    const ready = waitForWorker(worker, 'ready', 60000);
    const workerStartedAt = performance.now();
    const runtime = await ready;
    const initializationMs = performance.now() - workerStartedAt;
    const measurements = [];
    for (let i = 0; i < REPEATS; i++) {
      const response = waitForWorker(worker, 'run-result');
      worker.postMessage({ type: 'run', run: i + 1, directory });
      measurements.push(await response);
    }

    const outputFile = await (await directory.getFileHandle('output.bin')).getFile();
    const outputSha256 = await digest(await outputFile.arrayBuffer());
    if (outputFile.size !== SIZE || outputSha256 !== expectedSha256) {
      throw new Error('OPFS/MEMFS round-trip failed size or SHA-256 verification');
    }

    summary = {
      browser: navigator.userAgent,
      crossOriginIsolated,
      sizeBytes: SIZE,
      sizeMiB: SIZE / MIB,
      repeats: REPEATS,
      chunkSizeBytes: 64 * 1024,
      storageEstimate: { usage: estimate.usage, quota: estimate.quota },
      inputSha256: expectedSha256,
      outputSha256,
      roundTripMatches: true,
      memfsRuntime: runtime.runtime,
      memfsRuntimeInitializationMs: Math.round(initializationMs * 100) / 100,
      measurements
    };
  } catch (error) {
    failure = error.message || String(error);
  } finally {
    if (worker) worker.terminate();
    if (temporaryName) {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(temporaryName, { recursive: true });
        try {
          await root.getDirectoryHandle(temporaryName);
          failure = `${failure ? `${failure}; ` : ''}temporary OPFS directory remains after cleanup`;
        } catch (error) {
          if (error.name !== 'NotFoundError') {
            failure = `${failure ? `${failure}; ` : ''}cleanup verification failed: ${error.message}`;
          } else {
            temporaryDirectoryRemoved = true;
          }
        }
      } catch (error) {
        failure = `${failure ? `${failure}; ` : ''}cleanup failed: ${error.message}`;
      }
    }
  }
  if (summary) summary.cleanup = { temporaryDirectoryRemoved };
  result.textContent = JSON.stringify(failure ? { error: failure } : summary, null, 2);
  document.body.dataset.status = failure ? 'error' : 'complete';
})();
