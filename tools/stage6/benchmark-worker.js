importScripts('/tools/stage5/opfs-memfs-bridge.js');
importScripts('/tools/stage3/node_modules/pyodide/pyodide.js');

async function start() {
  const pyodide = await loadPyodide({
    indexURL: '/tools/stage3/node_modules/pyodide/'
  });
  const fs = pyodide.FS;
  fs.mkdir('/work');
  self.postMessage({ type: 'ready', runtime: 'Pyodide Emscripten MEMFS' });

  self.onmessage = async ({ data }) => {
    if (data.type !== 'run') return;
    try {
      const inputStarted = performance.now();
      const bytes = await OpfsMemfsBridge.readOpfsFile(data.directory, 'input.bin');
      const opfsReadMs = performance.now() - inputStarted;

      const memfsStarted = performance.now();
      fs.writeFile('/work/input.bin', bytes);
      const memfsWriteMs = performance.now() - memfsStarted;

      const outputStarted = performance.now();
      const output = await OpfsMemfsBridge.persistOutput(
        fs, data.directory, 'output.bin', '/work/input.bin'
      );
      const outputMs = performance.now() - outputStarted;
      fs.unlink('/work/input.bin');

      self.postMessage({
        type: 'run-result',
        run: data.run,
        bytes: output.size,
        opfsReadMs: Math.round(opfsReadMs * 100) / 100,
        memfsWriteMs: Math.round(memfsWriteMs * 100) / 100,
        opfsToMemfsMs: Math.round((opfsReadMs + memfsWriteMs) * 100) / 100,
        memfsToOpfsMs: Math.round(outputMs * 100) / 100,
        roundTripMs: Math.round((opfsReadMs + memfsWriteMs + outputMs) * 100) / 100
      });
    } catch (error) {
      self.postMessage({ type: 'error', error: `${error.name || 'Error'}: ${error.message || error}` });
    }
  };
}

start().catch(error => {
  self.postMessage({ type: 'error', error: `${error.name || 'Error'}: ${error.message || error}` });
});
