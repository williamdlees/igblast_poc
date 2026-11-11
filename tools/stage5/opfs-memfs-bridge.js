const CHUNK_SIZE = 64 * 1024;

async function readOpfsFile(directory, name) {
  const handle = await directory.getFileHandle(name);
  const size = (await handle.getFile()).size;
  const bytes = new Uint8Array(size);
  const access = await handle.createSyncAccessHandle();
  try {
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const view = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, size));
      let read = 0;
      while (read < view.length) {
        const count = access.read(view.subarray(read), { at: offset + read });
        if (count <= 0) throw new Error(`${name}: unexpected EOF at ${offset + read}`);
        read += count;
      }
    }
  } finally {
    access.close();
  }
  return bytes;
}

async function persistOutput(fs, directory, name, sourcePath = `/work/${name}`) {
  const size = fs.stat(sourcePath).size;
  if (size === 0) throw new Error(`${name}: output file is empty`);
  const source = fs.open(sourcePath, 'r');
  const handle = await directory.getFileHandle(name, { create: true });
  const access = await handle.createSyncAccessHandle();
  const chunk = new Uint8Array(CHUNK_SIZE);
  try {
    access.truncate(0);
    for (let offset = 0; offset < size; offset += CHUNK_SIZE) {
      const length = Math.min(CHUNK_SIZE, size - offset);
      const read = source.stream_ops.read(source, chunk, 0, length, offset);
      if (read !== length) throw new Error(`${name}: short MEMFS read`);
      let written = 0;
      while (written < read) {
        const count = access.write(chunk.subarray(written, read), {
          at: offset + written
        });
        if (count <= 0) throw new Error(`${name}: OPFS write made no progress`);
        written += count;
      }
    }
    access.flush();
    if (access.getSize() !== size) throw new Error(`${name}: OPFS size mismatch`);
    return { name, size };
  } finally {
    fs.close(source);
    access.close();
  }
}

self.OpfsMemfsBridge = { readOpfsFile, persistOutput };
