const CHUNK_SIZE = 64 * 1024;
const tool = new URL(self.location.href).searchParams.get('tool');

if (!['makeblastdb', 'igblastn'].includes(tool)) {
  throw new Error('Unsupported NCBI tool');
}

if (self.name === 'em-pthread') {
  importScripts(`/bin/${tool}.js`);
} else {
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

  async function persistOutput(directory, name) {
    const sourcePath = `/work/${name}`;
    const size = FS.stat(sourcePath).size;
    if (size === 0) throw new Error(`${name}: output file is empty`);
    const source = FS.open(sourcePath, 'r');
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
      FS.close(source);
      access.close();
    }
  }

  self.onmessage = async ({ data }) => {
    const output = [];
    let failed = false;
    try {
      const inputs = {};
      for (const name of data.inputNames) {
        inputs[name] = await readOpfsFile(data.directory, name);
      }
      self.Module = {
        arguments: data.args,
        locateFile: name => `/bin/${name}`,
        print: line => output.push(`stdout: ${line}`),
        printErr: line => output.push(`stderr: ${line}`),
        preRun: [() => {
          FS.mkdir('/work');
          FS.chdir('/work');
          for (const [name, bytes] of Object.entries(inputs)) {
            FS.writeFile(name, bytes);
          }
          if (tool === 'igblastn' && inputs['V.nin']) {
            FS.mkdir('/work/internal_data');
            FS.mkdir('/work/internal_data/human');
            for (const name of Object.keys(inputs)) {
              if (name.startsWith('V.')) {
                FS.writeFile(`internal_data/human/human_V${name.slice(1)}`, inputs[name]);
              }
            }
          }
          for (const name of Object.keys(inputs)) delete inputs[name];
        }],
        postRun: [() => {
          if (failed) return;
          (async () => {
            const names = FS.readdir('/work').filter(name => {
              if (name === '.' || name === '..' || !FS.isFile(FS.stat(`/work/${name}`).mode)) {
                return false;
              }
              return data.outputNames.some(prefix => name.startsWith(prefix));
            });
            if (!names.length) throw new Error('The NCBI tool produced no expected output files');
            const files = [];
            for (const name of names) {
              files.push(await persistOutput(data.directory, name));
            }
            self.postMessage({
              status: EXITSTATUS,
              output,
              files
            });
          })().catch(error => {
            failed = true;
            self.postMessage({ error: `output persistence: ${error.message}`, output });
          });
        }],
        onAbort: reason => {
          failed = true;
          self.postMessage({ error: `NCBI tool abort: ${reason}`, output });
        }
      };
      importScripts(`/bin/${tool}.js`);
    } catch (error) {
      failed = true;
      self.postMessage({ error: `${error.name || 'Error'}: ${error.message || error}`, output });
    }
  };
}
