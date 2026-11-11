const CHUNK_SIZE = 64 * 1024;

function hex(bytes) {
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function digest(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function writeAll(access, bytes, offset) {
  let written = 0;
  while (written < bytes.length) {
    const count = access.write(bytes.subarray(written), { at: offset + written });
    if (count <= 0) throw new Error(`OPFS write made no progress at ${offset + written}`);
    written += count;
  }
  return written;
}

function readAll(access, bytes, offset) {
  let read = 0;
  while (read < bytes.length) {
    const count = access.read(bytes.subarray(read), { at: offset + read });
    if (count <= 0) throw new Error(`Unexpected EOF at ${offset + read}`);
    read += count;
  }
  return read;
}

async function storeStream(directory, name, stream, expectedSize) {
  const file = await directory.getFileHandle(name, { create: true });
  const access = await file.createSyncAccessHandle();
  let offset = 0;
  try {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      offset += writeAll(access, value, offset);
    }
    access.flush();
    if (access.getSize() !== expectedSize || offset !== expectedSize) {
      throw new Error(`${name}: wrote ${offset}, expected ${expectedSize} bytes`);
    }
    const stored = new Uint8Array(expectedSize);
    if (stored.length) readAll(access, stored, 0);
    return { size: expectedSize, sha256: await digest(stored) };
  } finally {
    access.close();
  }
}

async function prepare({ directory, inputFile, database, expectedDatabaseSha256 }) {
  const input = await storeStream(directory, inputFile.name, inputFile.stream(), inputFile.size);
  const dbHandle = await directory.getFileHandle('reference-db.bin', { create: true });
  const dbAccess = await dbHandle.createSyncAccessHandle();
  const databaseSha256 = await digest(database);
  if (databaseSha256 !== expectedDatabaseSha256) {
    throw new Error('Database test payload changed before OPFS write');
  }
  try {
    for (let offset = 0; offset < database.length; offset += CHUNK_SIZE) {
      const chunk = database.subarray(offset, Math.min(offset + CHUNK_SIZE, database.length));
      writeAll(dbAccess, chunk, offset);
    }
    dbAccess.flush();
  } finally {
    dbAccess.close();
  }
  const databaseFile = await dbHandle.getFile();
  const storedDatabase = {
    size: databaseFile.size,
    sha256: await digest(await databaseFile.arrayBuffer())
  };
  if (storedDatabase.sha256 !== expectedDatabaseSha256) {
    throw new Error('Database payload integrity check failed after OPFS write');
  }

  const probeHandle = await directory.getFileHandle('random-access-probe', { create: true });
  const probeAccess = await probeHandle.createSyncAccessHandle();
  let randomAccessPassed = false;
  let truncatePassed = false;
  try {
    writeAll(probeAccess, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), 0);
    writeAll(probeAccess, new Uint8Array([90, 91]), 3);
    const patched = new Uint8Array(8);
    readAll(probeAccess, patched, 0);
    randomAccessPassed = patched.join(',') === '0,1,2,90,91,5,6,7';
    probeAccess.truncate(5);
    truncatePassed = probeAccess.getSize() === 5;
    if (!randomAccessPassed || !truncatePassed) {
      throw new Error('OPFS seek/overwrite/truncate probe failed');
    }
  } finally {
    probeAccess.close();
    await directory.removeEntry('random-access-probe');
  }

  let missingFileError = '';
  try {
    await directory.getFileHandle('missing-file', { create: false });
  } catch (error) {
    if (error.name !== 'NotFoundError') throw error;
    missingFileError = error.name;
  }
  if (missingFileError !== 'NotFoundError') {
    throw new Error('Missing-file failure was not surfaced as NotFoundError');
  }

  return {
    runId: directory.name.replace('igblast-storage-spike-', ''),
    input,
    database: storedDatabase,
    fileOperations: {
      chunkedWrite: true,
      randomAccessOverwrite: randomAccessPassed,
      truncate: truncatePassed,
      missingFile: missingFileError
    },
    missingFileError
  };
}

async function copyOpfsToMemfs(fileHandle, path, size, fs) {
  const access = await fileHandle.createSyncAccessHandle();
  const stream = fs.open(path, 'w+');
  const chunk = new Uint8Array(CHUNK_SIZE);
  try {
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      readAll(access, chunk.subarray(0, length), offset);
      const written = fs.write(stream, chunk, 0, length, offset);
      if (written !== length) throw new Error(`${path}: MEMFS short write`);
    }
  } finally {
    fs.close(stream);
    access.close();
  }
  const bytes = fs.readFile(path);
  if (bytes.length !== size) throw new Error(`${path}: MEMFS size mismatch`);
  return bytes;
}

function copyMemfsFile(fs, sourcePath, targetPath, size) {
  const source = fs.open(sourcePath, 'r');
  const target = fs.open(targetPath, 'w+');
  const chunk = new Uint8Array(CHUNK_SIZE);
  try {
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      const read = source.stream_ops.read(source, chunk, 0, length, offset);
      if (read !== length) throw new Error(`${sourcePath}: MEMFS short read`);
      const written = fs.write(target, chunk, 0, read, offset);
      if (written !== read) throw new Error(`${targetPath}: MEMFS short write`);
    }
  } finally {
    fs.close(source);
    fs.close(target);
  }
}

function copyMemfsToOpfs(fs, sourcePath, outputAccess, size) {
  const source = fs.open(sourcePath, 'r');
  const chunk = new Uint8Array(CHUNK_SIZE);
  try {
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      const read = source.stream_ops.read(source, chunk, 0, length, offset);
      if (read !== length) throw new Error(`${sourcePath}: MEMFS short read`);
      writeAll(outputAccess, chunk.subarray(0, read), offset);
    }
  } finally {
    fs.close(source);
  }
}

async function consume({
  directory,
  inputName,
  databaseName,
  expectedInputSha256,
  expectedDatabaseSha256
}) {
  importScripts('/tools/stage3/node_modules/pyodide/pyodide.js');
  const pyodide = await loadPyodide({
    indexURL: '/tools/stage3/node_modules/pyodide/'
  });
  const fs = pyodide.FS;
  fs.mkdir('/work');

  const inputHandle = await directory.getFileHandle(inputName);
  const databaseHandle = await directory.getFileHandle(databaseName);
  const inputSize = (await inputHandle.getFile()).size;
  const databaseSize = (await databaseHandle.getFile()).size;
  const inputBytes = await copyOpfsToMemfs(inputHandle, '/work/query.fasta', inputSize, fs);
  const databaseBytes = await copyOpfsToMemfs(
    databaseHandle, '/work/reference-db.bin', databaseSize, fs
  );
  const inputSha256 = await digest(inputBytes);
  const databaseSha256 = await digest(databaseBytes);
  if (inputSha256 !== expectedInputSha256 ||
      databaseSha256 !== expectedDatabaseSha256) {
    throw new Error('OPFS-to-Wasm-memory handoff failed its SHA-256 integrity check');
  }

  copyMemfsFile(fs, '/work/query.fasta', '/work/run-output.bin', inputSize);
  const outputHandle = await directory.getFileHandle('run-output.bin', { create: true });
  const outputAccess = await outputHandle.createSyncAccessHandle();
  try {
    copyMemfsToOpfs(fs, '/work/run-output.bin', outputAccess, inputSize);
    outputAccess.flush();
  } finally {
    outputAccess.close();
  }
  const outputAccessForCheck = await outputHandle.createSyncAccessHandle();
  const outputBytes = new Uint8Array(inputSize);
  try {
    if (outputBytes.length) readAll(outputAccessForCheck, outputBytes, 0);
  } finally {
    outputAccessForCheck.close();
  }
  const outputSha256 = await digest(outputBytes);
  const output = {
    size: outputBytes.length,
    sha256: outputSha256,
    matchesInput: outputSha256 === inputSha256
  };
  const handoff = {
    workerReceivedDirectoryHandle: directory.kind === 'directory',
    inputSize,
    inputSha256,
    databaseSize,
    databaseSha256,
    runtime: 'Pyodide 0.27.7 Emscripten MEMFS'
  };
  fs.unlink('/work/query.fasta');
  fs.unlink('/work/reference-db.bin');
  fs.unlink('/work/run-output.bin');
  fs.rmdir('/work');
  if (!handoff.workerReceivedDirectoryHandle || !output.matchesInput) {
    throw new Error('Cross-worker OPFS handoff or output integrity check failed');
  }
  return { handoff, output };
}

async function cleanup({ directory }) {
  let removed = 0;
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file') continue;
    await directory.removeEntry(name);
    removed++;
  }
  return { filesRemoved: removed };
}

self.onmessage = async ({ data }) => {
  try {
    let result;
    if (data.operation === 'prepare') result = await prepare(data);
    else if (data.operation === 'consume') result = await consume(data);
    else if (data.operation === 'cleanup') result = await cleanup(data);
    else throw new Error(`Unknown operation: ${data.operation}`);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: `${error.name || 'Error'}: ${error.message || error}` });
  }
};
