# Stage 3: Pyodide reference-preparation proof

**Status: implementation step complete; user review required before the next
step.** This is a bounded proof of browser Python/reference preparation, not
the storage bridge or the application workflow.

## Result

The pinned Pyodide 0.27.7 runtime loaded in a dedicated Web Worker served with
COOP `same-origin` and COEP `require-corp`. It imported and ran
`receptor_utils 0.0.68` at commit
`f6bfb03f00358babc07bf6ec20899e85528887ce`, including the actual
`download_germline_set(..., file_format="MULTI-IGBLAST")` preparation path and
its Biopython, `simple_bio_seq`, and `aux_formats` code. The run produced all
six expected reference artifacts for `9606.IGH_VDJ`: 202 V records, 31 D
records, 7 J records, 202 gapped-V records, plus the `.ndm` and `.aux` files.
The existing small reference fixture was sufficient; no larger user data was
needed.

The browser and native outputs have identical text content after normalizing
Windows CRLF line endings to LF. The `.aux` file is byte-identical; the other
five files differ only in newline encoding. The browser runtime was Pyodide
0.27.7 / CPython 3.12.7, Biopython 1.84, and requests 2.31.0. The native
comparator was Python 3.11.4, Biopython 1.83, and requests 2.34.2.
The browser run used Microsoft Edge 157.0.4341.42 on Windows and Node.js
24.21.0 for the harness.

The browser's synchronous `requests.get` calls are adapted to responses
fetched by browser `fetch` from same-origin `/api_v2/...` paths. This is
necessary because the upstream utility uses synchronous requests, which
cannot directly make its normal HTTP request in Pyodide. The preparation
logic itself is not reimplemented.

## OGRDB origin and isolation findings

The live probe ran in Edge at `https://ogrdb.airr-community.org`, the same
origin the integrated app is expected to use. It fetched the species list,
human set list, set JSON, and gapped/ungapped FASTA from relative
`/api_v2/...` paths; each returned HTTP 200. The set JSON contained 240 allele
descriptions, and each FASTA endpoint returned 240 records. This confirms
same-origin retrieval; CORS is not the expected blocker. Origin includes the
exact scheme, host, and port, so a different scheme or port is a different
origin.

The live OGRDB page currently sends neither COOP nor COEP, so
`crossOriginIsolated` and `SharedArrayBuffer` were unavailable there. A
separate local COEP-isolated harness loaded the OGRDB page's observed
Bootstrap CSS/JS and Bootstrap Icons CSS/font from jsDelivr successfully.
All four observed third-party responses returned HTTP 200 and exposed
`Cross-Origin-Resource-Policy: cross-origin` and
`Access-Control-Allow-Origin: *`; no failed loads or response lacking both
headers were observed. Thus these observed resources did not block the local
COEP `require-corp` test. The live-site probe does not establish that OGRDB
itself can enable COOP/COEP; deployment still needs those headers for
pthread-based builds.

The checked-in OGRDB responses are a small deterministic fixture served on
the harness's own origin at the same relative API paths. They are an offline
test option, not a CORS workaround or evidence of live access. The live-origin
probe is separate.

## Reproduction on Windows

Run these commands from the repository root in CMD. `prepare.cmd` downloads
the pinned Pyodide npm package, checks out the pinned receptor_utils commit,
builds its pure-Python wheel, and downloads Pyodide dependency wheels with
SHA-256 verification against Pyodide's lockfile. The native Python environment
must have the listed packages; the validated native versions are shown above.
Edge is expected at the standard Windows installation path used by the
harness. The validated harness used Node.js 24.21.0.

```cmd
call tools\stage3\prepare.cmd
python -m pip install biopython==1.83 requests==2.34.2
call tools\stage3\run-native.cmd
call tools\stage3\run-browser.cmd
node tools\stage3\check-live-ogrdb.cjs
```

`run-native.cmd` and `run-browser.cmd` use the checked-in fixture and do not
fetch OGRDB. `check-live-ogrdb.cjs` requires network access to the live OGRDB
site. To intentionally refresh the fixture and generate a native result from
the current live API, run this instead of relying on the checked-in capture:

```cmd
python tools\stage3\capture_ogrdb.py --capture
```

That command changes the fixture files and manifest; review those changes
before keeping a refreshed capture. Generated wheels, browser assets, source
checkout, browser/native output, and browser profiles live under
`tools\stage3` and are ignored by Git.

## Captured API fixture

The manifest records capture time, API paths, sizes, response status, and
SHA-256. All five responses returned HTTP 200. The captured reference is
`Homo sapiens`, locus `IGH`, set `IGH_VDJ`, set ID `9606.IGH_VDJ`.

| API path suffix | Fixture file | Bytes | SHA-256 |
|---|---|---:|---|
| `/germline/species` | `response-721605c1a5d215fc.json` | 355 | `81dfbeed061ac3dc95ef77d59a7112681434564f1c39492f0bf278090a4d1413` |
| `/germline/sets/9606` | `response-ee2fe88508aa95fd.json` | 1,095 | `63707ebd2c6b485c3442e427a8f49ffae0545384248fd35913334ed22eec9237` |
| `/germline/set/9606.IGH_VDJ/latest` | `response-2c8279feceee1c91.json` | 1,229,243 | `251c5f13705b74f3bdaf6fc6f593616f433c710a766d8e54f9cbc9c2f1ac95d3` |
| `/germline/set/9606.IGH_VDJ/latest/ungapped_ex` | `response-cfda44853c798859.fasta` | 65,230 | `5beb005256e702a41ef78c359481d645ca7bcf7bb400b598830058aa278bb520` |
| `/germline/set/9606.IGH_VDJ/latest/gapped_ex` | `response-652f27664ae03982.fasta` | 70,192 | `2321eb5b788bf95103a2221eb327ef327c735e3e9427713c71285dcc6df81d9a` |

The source is pinned by commit rather than by a redistributable wheel hash.
The locally built wheel's archive hash may vary with build metadata/timestamps;
the browser runner verified the installed package version, and the source
commit and Pyodide dependency wheel hashes are pinned. The exact dependency
wheel hashes are recorded in the generated
`tools\stage3\assets\pyodide\manifest.json`.

## Scope and review handoff

This step does not implement storage integration, a user-facing UI, NCBI tool
integration, large-file throughput benchmarks, or full workflow error
handling. The live probe establishes current API access and observes the
current OGRDB page headers/resources; it does not prove that the deployed
application will receive the COOP/COEP headers it needs. Newline normalization
is used only for comparing native and browser-generated reference text.

**Review checkpoint:** confirm this reference-preparation and same-origin
network proof before starting the next planned step, the storage bridge.
