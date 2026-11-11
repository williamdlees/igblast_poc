self.onmessage = async () => {
  const log = [];
  try {
    importScripts('/tools/stage3/node_modules/pyodide/pyodide.js');
    const pyodide = await loadPyodide({
      indexURL: '/tools/stage3/node_modules/pyodide/',
      stdout: line => log.push(`stdout: ${line}`),
      stderr: line => log.push(`stderr: ${line}`)
    });
    const packageManifestResponse = await fetch('/tools/stage3/assets/pyodide/manifest.json');
    if (!packageManifestResponse.ok) throw new Error('Pinned Pyodide wheel manifest is missing');
    const packageManifest = await packageManifestResponse.json();
    const packageUrls = packageManifest.packages.map(pkg =>
      new URL(`/tools/stage3/assets/pyodide/${pkg.file_name}`, self.location.href).href
    );
    await pyodide.loadPackage(packageUrls);
    const wheel = await fetch('/tools/stage3/assets/receptor_utils-0.0.68-py3-none-any.whl');
    if (!wheel.ok) throw new Error(`receptor_utils wheel: HTTP ${wheel.status}`);
    await wheel.body.cancel();
    const micropip = pyodide.pyimport('micropip');
    await micropip.install(new URL(
      '/tools/stage3/assets/receptor_utils-0.0.68-py3-none-any.whl',
      self.location.href
    ).href);

    const apiBase = '/api_v2';
    const fetchText = async path => {
      const response = await fetch(`${apiBase}${path}`);
      if (!response.ok) throw new Error(`OGRDB fixture ${path}: HTTP ${response.status}`);
      return response.text();
    };
    const species = await fetchText('/germline/species');
    const sets = await fetchText('/germline/sets/9606');
    const setData = JSON.parse(sets);
    const entry = setData.germline_species.find(item =>
      item.locus === 'IGH' && item.germline_set_name === 'IGH_VDJ');
    if (!entry) throw new Error('IGH_VDJ set not found in OGRDB species list');
    const setId = entry.germline_set_id;
    const endpoints = [
      ['/germline/species', species],
      ['/germline/sets/9606', sets],
      [`/germline/set/${setId}/latest`, await fetchText(`/germline/set/${setId}/latest`)],
      [`/germline/set/${setId}/latest/ungapped_ex`,
        await fetchText(`/germline/set/${setId}/latest/ungapped_ex`)],
      [`/germline/set/${setId}/latest/gapped_ex`,
        await fetchText(`/germline/set/${setId}/latest/gapped_ex`)]
    ];
    pyodide.globals.set('_browser_responses_json', JSON.stringify(
      Object.fromEntries(endpoints.map(([path, text]) => [`${apiBase}${path}`, text]))
    ));
    const output = pyodide.runPython(`
import base64
import json
import os
from pathlib import Path
import requests
from importlib.metadata import version
import Bio
import receptor_utils
from scripts.download_germline_set import download_germline_set

_browser_responses = json.loads(_browser_responses_json)

class _BrowserResponse:
    status_code = 200
    headers = {"content-type": "application/json"}

    def __init__(self, path, text):
        self.url = "browser-fetch:" + path
        self.text = text
        self.content = text.encode("utf-8")

    def raise_for_status(self):
        return None

    def json(self):
        return json.loads(self.text)

def _browser_get(url, *args, **kwargs):
    marker = "/api_v2"
    if marker not in url:
        raise RuntimeError(f"Unexpected Python network request: {url}")
    path = marker + url.split(marker, 1)[1]
    try:
        return _BrowserResponse(path, _browser_responses[path])
    except KeyError as error:
        raise RuntimeError(f"Browser did not fetch required OGRDB path: {path}") from error

requests.get = _browser_get
os.chdir("/tmp")
download_germline_set(
    "Homo sapiens",
    "IGH",
    version="latest",
    germline_set_name="IGH_VDJ",
    file_format="MULTI-IGBLAST",
    url="https://ogrdb.airr-community.org/api_v2",
    prefix="Homo_sapiens_IGH_VDJ_",
)

names = [
    "Homo_sapiens_IGH_VDJ_V.fasta",
    "Homo_sapiens_IGH_VDJ_D.fasta",
    "Homo_sapiens_IGH_VDJ_J.fasta",
    "Homo_sapiens_IGH_VDJ_V_gapped.fasta",
    "Homo_sapiens_IGH_VDJ.ndm",
    "Homo_sapiens_IGH_VDJ.aux",
]
artifacts = {
    name: base64.b64encode(Path(name).read_bytes()).decode("ascii")
    for name in names
}
json.dumps({
    "set_id": next(
        x["germline_set_id"]
        for x in json.loads(_browser_responses["/api_v2/germline/sets/9606"])["germline_species"]
        if x.get("locus") == "IGH" and x.get("germline_set_name") == "IGH_VDJ"
    ),
    "python": __import__("sys").version.split()[0],
    "biopython": Bio.__version__,
    "requests": requests.__version__,
    "receptor_utils": version("receptor_utils"),
    "artifacts": artifacts,
})
`);
    self.postMessage({ status: 'complete', result: JSON.parse(output), log });
  } catch (error) {
    self.postMessage({ status: 'error', error: String(error), log });
  }
};
