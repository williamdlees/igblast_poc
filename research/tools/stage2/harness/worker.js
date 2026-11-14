const tool = new URL(self.location.href).searchParams.get('tool');
if (!['makeblastdb', 'igblastn'].includes(tool)) {
  throw new Error('Unsupported tool');
}

if (self.name === 'em-pthread') {
  importScripts(`/bin/${tool}.js`);
} else {
  self.onmessage = ({ data }) => {
    const output = [];
    self.Module = {
      arguments: data.args,
      locateFile: name => `/bin/${name}`,
      print: line => output.push(`stdout: ${line}`),
      printErr: line => output.push(`stderr: ${line}`),
      preRun: [() => {
        FS.mkdir('/work');
        FS.chdir('/work');
        for (const [name, bytes] of Object.entries(data.files)) {
          FS.writeFile(name, bytes);
        }
        if (tool === 'igblastn' && data.files['V.nin']) {
          FS.mkdir('/work/internal_data');
          FS.mkdir('/work/internal_data/human');
          for (const name of Object.keys(data.files)) {
            if (name.startsWith('V.')) {
              FS.writeFile(`internal_data/human/human_V${name.slice(1)}`, data.files[name]);
            }
          }
        }
      }],
      postRun: [() => {
        const files = {};
        for (const name of FS.readdir('/work')) {
          if (name !== '.' && name !== '..' && FS.isFile(FS.stat(name).mode)) {
            files[name] = FS.readFile(name);
          }
        }
        self.postMessage({ status: EXITSTATUS, output, files });
      }],
      onAbort: reason => self.postMessage({ error: `abort: ${reason}`, output })
    };
    importScripts(`/bin/${tool}.js`);
  };
}
