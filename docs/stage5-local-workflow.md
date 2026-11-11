# Stage 5: local browser workflow

**Status: Stage 5 end-to-end browser workflow verified with the four existing
Stage 2 assets. Their SHA-256 values were checked before use; no NCBI source or
toolchain was downloaded or rebuilt.**

## Verification run (2026-11-11)

Environment: Windows, Node.js `v24.21.0`, Microsoft Edge 157
(`Edg/157.0.0.0` user-agent), localhost origin
`http://127.0.0.1:8000/`.

The manually copied Stage 2 artifacts matched the expected SHA-256 values:

| File | SHA-256 |
|---|---|
| `bin\makeblastdb.js` | `F0F4CFAF838EA8A7150851E3454CAB11B476467D5BC96BB095C8A98FD67A3EF4` |
| `bin\makeblastdb.wasm` | `F25B149679854F84B1AD59E051C1478C45DCD6BB267C0EFEE3F883197AAE8FFB` |
| `bin\igblastn.js` | `B3F7E8A33D7E857C1F3DA9983E09B6A7759CA0FA78A05D7911872885E8DF0246` |
| `bin\igblastn.wasm` | `65158167DF1F0CF111C6A872356390E0F9033B17976AEB4D6242FFDFB4C154D3` |

The following syntax checks passed:

```cmd
node --check tools\stage5\app.js
node --check tools\stage5\ncbi-worker.js
node --check tools\stage5\server.cjs
node --check tools\stage3\harness\py-worker.js
```

Starting `node tools\stage5\server.cjs` succeeded and served the app with
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. The root page and
`/api_v2/germline/species` returned HTTP 200. The page reported
`crossOriginIsolated === true`.

The full `tests\fixtures\stage2\query.fasta` (5,621 bytes, 10 records) was run
with the default deterministic OGRDB fixture. The Pyodide worker prepared six
reference artifacts for `9606.IGH_VDJ`. Browser `makeblastdb` completed for
V, D and J, persisting seven database files per segment; browser `igblastn`
completed with exit status 0 and persisted `airr.tsv`.

The output was 35,209 bytes with 96 columns and 10 data rows. All 10
`sequence_id` values matched the query FASTA IDs. Its SHA-256 was
`b2b5ed9f7fe37e6b2b57b9dadad4ce1b2ac4890b5e4d853713a168e6388aea0a`.
The Download AIRR TSV action was clicked. Clear temporary files then removed
the run's OPFS directory; no `igblast-run-*` directories remained and the
download button returned to disabled.

Before the artifacts were copied, a run had visibly failed to load
`/bin/makeblastdb.js` and cleaned up its OPFS directory. After the four
hashes matched, the complete browser workflow passed. Native-output parity,
additional failure-path coverage, and 50 MiB I/O measurements are documented
in Stage 6. Live OGRDB behavior in the integrated deployment remains covered
by the separate Stage 3 verification.

The Stage 5 app connects the reference preparation worker, the NCBI
`makeblastdb` and `igblastn` workers, OPFS staging, and a user-triggered AIRR
TSV download. The implementation is in `tools/stage5`. It is a minimal local
proof of concept, not a production PWA.
The shared OPFS-to-MEMFS and MEMFS-to-OPFS transfer functions are in
`tools\stage5\opfs-memfs-bridge.js`; Stage 6 reuses them for its I/O
measurement.

## Prerequisites

- Microsoft Edge or another desktop Chromium browser with OPFS and
  cross-origin-isolated pthread support.
- Node.js 18 or newer.
- The prepared Stage 3 assets under `tools\stage3`:

  ```cmd
  call tools\stage3\prepare.cmd
  ```

- The pinned Stage 2 `makeblastdb` and `igblastn` WebAssembly outputs and
  their worker assets in the repository's `bin\` directory. The harness
  loads `/bin/makeblastdb.js` and `/bin/igblastn.js`; `locateFile` resolves
  their Wasm and pthread assets from the same directory. Build these from the
  pinned Stage 2 instructions and copy the generated browser artifacts into
  `bin\` without renaming them.

## Run locally

From the repository root in Windows CMD:

```cmd
call tools\stage5\serve.cmd
```

Open `http://127.0.0.1:8000/`. The server sets COOP `same-origin` and COEP
`require-corp`, serves the app and Wasm assets from this repository, and
serves `/api_v2/...` requests from the checked-in OGRDB fixture. No proxy or
cross-origin API access is used for local runs.

Choose a FASTA file or paste FASTA text. The local fixture is selected by
default. Select **Run IgBLAST** to generate references with the Stage 3
Pyodide worker, create V/D/J v4 databases, and run browser `igblastn`.
Temporary inputs, references, database files and the AIRR output are isolated
in a per-run OPFS directory. The app enables **Download AIRR TSV** only after
the tool has produced a nonempty `airr.tsv`; downloading is a separate user
action. **Clear temporary files** removes the run directory. Cancel stops the
active worker and removes that run's temporary files.

**Live OGRDB mode** uses relative `/api_v2` paths and is deliberately
available only when the app is integrated at
`https://ogrdb.airr-community.org`. The local server's fixture mapping is an
offline/deterministic option, not a CORS workaround.

## Current boundaries

- The app is designed to copy OPFS files into each NCBI worker's private
  MEMFS and persist database/output files back to that run's OPFS directory.
  Separate Emscripten modules do not share filesystems.
- The built NCBI artifacts are not checked into the repository. Missing
  artifacts, failed reference retrieval, missing files, nonzero tool status,
  empty output and worker errors are surfaced in the run log.
- Large-file memory use, quota exhaustion, responsive interaction during
  real NCBI workloads, and browser/native parity in this app are Stage 6
  verification work. The workflow currently buffers each required input file
  in JavaScript before writing it to a module's MEMFS; the small-fixture run
  does not establish that this approach is suitable for large references.
- This stage does not add a service worker, installation manifest, result
  visualization, arbitrary germline-set selection, SRA support or AIRR TSV
  schema validation.
