const tool = new URL(self.location.href).searchParams.get('tool');

if (!['makeblastdb', 'igblastn'].includes(tool)) {
  throw new Error('Unsupported NCBI tool');
}

if (self.name === 'em-pthread') {
  importScripts(`/bin/${tool}.js`);
} else {
  importScripts('/tools/stage5/opfs-memfs-bridge.js');

  self.onmessage = async ({ data }) => {
    const output = [];
    let failed = false;
    try {
      const inputs = {};
      for (const name of data.inputNames) {
        inputs[name] = await OpfsMemfsBridge.readOpfsFile(data.directory, name);
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
              files.push(await OpfsMemfsBridge.persistOutput(FS, data.directory, name));
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
