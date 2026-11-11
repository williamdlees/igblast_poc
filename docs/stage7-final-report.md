# Stage 7: final results and reproducibility

**Status: complete; awaiting user review.** This report consolidates the
feasibility evidence from Stages 1–6a. It documents a working desktop-browser
proof of concept, not a production-ready or installable offline PWA.

## Executive conclusion

The central feasibility question is answered **yes, for a bounded desktop
Chromium proof of concept**: the pinned NCBI `makeblastdb` and `igblastn`
programs ran as WebAssembly in browser workers, Pyodide ran the actual
`receptor_utils` reference-preparation path, browser references matched
native preparation, and the Stage 5 workflow generated AIRR TSV output from
FASTA using OPFS and per-module MEMFS.

This does not establish a production deployment. Live OGRDB API requests
were verified separately from the local-fixture end-to-end app. The current
OGRDB page does not provide the COOP/COEP headers needed for pthreads; the
integrated deployment would require those headers and a fresh audit of every
resource loaded by that page. Large-file I/O was measured as a storage-copy
test, not as 50 MiB IgBLAST annotation. The 10,000-record comparison repeats
only ten sequences and is not representative of arbitrary user data.

The user-directed 250/500 MiB Wasm build completed the 10,000-record test at
eight IgBLAST threads. Its median browser path was 110.440 s versus 27.431 s
native, or 4.026 times slower. This is a result for the tested Windows
machine and fixture, not a general performance or memory guarantee. No
fixed 16 GiB limit or adaptive thread/memory policy was implemented.

## Outcome by stage

| Stage | Result and boundary |
|---|---|
| 1 — static analysis | Identified the FASTA-only build scope, VDB/SRA removal, threading and filesystem risks; see [Stage 1](stage1-static-analysis.md). |
| 2 — native/Wasm build | Built the pinned NCBI tools and ran both in Edge on the small fixture with matching AIRR fields. SRA support and remote Unix service mappers are excluded; see [Stage 2](stage2-build-and-test.md). |
| 3 — Python/reference | Pyodide 0.27.7 ran `receptor_utils` 0.0.68's real preparation path. Native and browser outputs matched after newline normalization. Live same-origin OGRDB API requests returned HTTP 200 in a separate probe; see [Stage 3](stage3-pyodide-reference.md). |
| 4 — storage bridge | Demonstrated OPFS worker handoff and bounded copies to/from Emscripten MEMFS. This generic spike did not itself run NCBI through OPFS; see [Stage 4](stage4-storage-bridge.md). |
| 5 — local workflow | The fixture-backed browser workflow completed Pyodide reference preparation, V/D/J database creation, IgBLAST and user-initiated AIRR TSV download on the 10-record fixture; see [Stage 5](stage5-local-workflow.md). |
| 6 — correctness and I/O | Small-fixture parity, error/responsiveness checks and the 50 MiB storage-copy test are documented. At the original fixed 16 MiB Wasm limit, the planned 10,000-record, one-thread browser run failed with OOM. The user accepted this limitation; see [Stage 6](stage6-correctness-and-io.md). |
| 6a — memory | Native peak memory increased with both sequence count and threads. The later user-requested 250/500 MiB, eight-thread browser comparison succeeded; see [Stage 6a](stage6a-native-memory.md). |

The later eight-thread comparison is not the original Stage 6 one-thread
acceptance test. It used the same generated input and OGRDB-prepared
references for browser and native runs, but a different thread count and
re-linked IgBLAST Wasm artifact. The distinction is preserved in the Stage 6
and Stage 6a reports.

## Reproducible environment and prerequisites

The recorded reference environment is Windows 11 x64 build `10.0.26200`,
AMD Ryzen Threadripper 3970X (32 physical / 64 logical processors), Node.js
24.21.0, Microsoft Edge 157, and Windows PowerShell 5.1. The scripts are
intended to be run from the repository root in **Windows CMD**. Node.js 18+
is stated as the Stage 5 minimum; the reported browser tests used Node.js
24.21.0 and Edge 157.

The project has two distinct Conda environments; do not treat them as
interchangeable:

1. **Stage 2 build tools:** the Windows explicit lockfile
   `tools\stage2\conda-win-64-explicit.txt` pins the build prefix, including
   Python 3.11.18, CMake 4.4.5 and Ninja 1.13.2. The lockfile was created
   with Conda 25.7.0. Create it with:

   ```cmd
   set "STAGE2_TOOLS=D:\copilot-builds\igblast-poc-b12f8502"
   conda create --prefix "%STAGE2_TOOLS%\conda-build" --file tools\stage2\conda-win-64-explicit.txt
   ```

2. **Stage 3 native reference comparator:** the validated environment used
   Python 3.11.4, Biopython 1.83 and requests 2.34.2. Use a separate Conda
   prefix, activate it before running Stage 3 commands, and install those
   exact Python dependencies:

   ```cmd
   conda create --prefix "%STAGE2_TOOLS%\conda-reference" python=3.11.4 pip
   call conda activate "%STAGE2_TOOLS%\conda-reference"
   python -m pip install biopython==1.83 requests==2.34.2
   ```

   Stage 3's browser used Pyodide 0.27.7 / CPython 3.12.7, Biopython 1.84,
   requests 2.31.0, and `receptor_utils` 0.0.68. The browser and native
   package versions are intentionally reported separately.

Reproducing the clean NCBI build additionally requires Emscripten SDK 7.0.0,
Visual Studio 2019 Build Tools and Windows SDK, Git, the host-native
`datatool.exe` 2.25.2 (3,150,336 bytes; SHA-256
`E6BDF58B78FE8B284720D956402C7ECAD395A51F42E3B0B8E1995FAC46CD6B94`), and
SQLite 3.50.4. The SQLite amalgamation archive SHA-256 is
`1d3049dd0f830a025a53105fc79fd2ab9431aea99e137809d064d8ee8356b032`.
The isolated emsdk checkout used commit
`1693ce7359fc9694f198694f902a2cc061239b86`. Exact build commands, compiler
configuration, lockfile, patch and prerequisite setup are in the [Stage 2
build report](stage2-build-and-test.md). Its full reproduction fetches the
pinned sources and dependencies; generated binaries are not checked in.
The expected `datatool.exe` version and hash are recorded, but its official
retrieval URL is not; the exact Visual Studio 2019 Build Tools and Windows
SDK package revisions were also not pinned. These are remaining fresh-build
reproducibility gaps: use the documented hash to verify the bootstrap binary
and do not assume an arbitrary host toolchain is identical.

## Source, fixture and artifact provenance

- NCBI C++ Toolkit source: commit
  `f83dd16a0c30899da66d4f6902b5a9ed36c9d433`; Stage 2 patch SHA-256
  `1A2CB50AC827D8B5DD81DA63BA90E7233A33DD52A21FA703BB51C99CF67F13CD`.
  The resulting programs report `igblastn 1.22.0` and `makeblastdb
  2.17.0+`.
- `receptor_utils`: commit
  `f6bfb03f00358babc07bf6ec20899e85528887ce`, version 0.0.68. The user
  confirmed ownership and authorized use and redistribution of the small
  fixture files.
- OGRDB: Stage 3 exercised live same-origin API endpoints for the human
  `9606.IGH_VDJ` set. Its captured response fixture and hashes are listed in
  the Stage 3 report. Stage 5 and the paired IgBLAST comparisons used those
  prepared fixture artifacts; they did not fetch live OGRDB during each
  benchmark.
- Original Stage 2 browser assets:
  `makeblastdb.js` SHA-256
  `F0F4CFAF838EA8A7150851E3454CAB11B476467D5BC96BB095C8A98FD67A3EF4`,
  `makeblastdb.wasm` SHA-256
  `F25B149679854F84B1AD59E051C1478C45DCD6BB267C0EFEE3F883197AAE8FFB`,
  `igblastn.js` SHA-256
  `B3F7E8A33D7E857C1F3DA9983E09B6A7759CA0FA78A05D7911872885E8DF0246`,
  `igblastn.wasm` SHA-256
  `65158167DF1F0CF111C6A872356390E0F9033B17976AEB4D6242FFDFB4C154D3`.
- The follow-up 250/500 MiB `igblastn` artifacts are local, ignored outputs:
  `igblastn.js` SHA-256
  `C217C8C0B4A4609246DBAD1E94CD4B9F76DD32F0DEC0DA4034A102669C3B1418`,
  `igblastn.wasm` SHA-256
  `EFF8645245100BF3005EA0E53FA2BD23276780BC7E6ED7739D71B3ED388B3B74`.
  They use memory32 with 250 MiB initial memory, growth enabled to 500 MiB,
  and a nine-worker Emscripten pool. The original Wasm assets were preserved
  under `tools\stage6\results\wasm-memory-250m-500m-8threads`; the matching
  build command and run manifest are in the Stage 6a report.
- NCBI source is public domain as described by its repository license, which
  also lists third-party exceptions. No complete redistribution audit of
  every library in the linked dependency closure was performed. Before
  redistributing a bundled application, review the exact dependency licenses
  and preserve required notices.

## Benchmark findings and limitations

- **50 MiB I/O:** five warm/unspecified-cache measurements on one Windows
  machine found median browser OPFS→MEMFS at 55.16 ms, MEMFS→OPFS at
  115.81 ms, and round trip at 157.07 ms. The native stream-copy-plus-fsync
  median was 259.13 ms. This uses synthetic bytes and a Pyodide MEMFS
  transfer, not 50 MiB IgBLAST annotation or the NCBI module's complete
  memory path.
- **10,000 queries:** the exact 5,555,000-byte query repeats the existing
  ten fixture sequences 1,000 times with unique identifiers. With
  `-num_threads 8`, browser median was 110.440 s and native median 27.431 s
  over five pairs. Browser output had 10,000 rows and 96 columns, with zero
  field differences against native. The Edge process group averaged 7.284
  CPU-core equivalents; this includes non-IgBLAST Edge processes. The
  browser assigned nine workers. Timing details and graphs are in Stage 6a.
- **Memory:** the native study's median resident peaks at one thread were
  15.34 MiB / 21.88 MiB / 26.57 MiB for 10 / 1,000 / 10,000 records. At
  1,000 records, medians were 21.88 / 26.16 / 34.99 / 54.42 MiB at 1 / 2 /
  4 / 8 threads. The eight-thread browser test ended with a 250 MiB Wasm
  linear-memory buffer and did not grow it. These are different measurements:
  native process resident memory is not Wasm linear memory, and neither
  measures total browser-process peak memory or available memory on another
  device. The test does not justify a universal threshold or fixed 16 GiB
  cap.
- **Correctness and failure behavior:** field-level comparison passed for
  the matched fixtures and 10,000-query eight-thread run. Invalid FASTA,
  missing assets, HTTP 503 reference retrieval, synthetic quota failure and
  cancellation are covered in Stage 6. Real storage quota exhaustion,
  device-wide memory pressure, and cold-cache behavior were not tested.

## Windows CMD reproduction

The stage reports contain the full commands and exact configuration. From
the repository root, with the appropriate Conda environment active:

```cmd
call tools\stage3\prepare.cmd
python -m pip install biopython==1.83 requests==2.34.2
call tools\stage3\run-native.cmd
call tools\stage3\run-browser.cmd
node tools\stage3\check-live-ogrdb.cjs
```

The first four commands prepare and test the deterministic local reference
fixture; the final command makes a separate live OGRDB network probe. To
exercise the Stage 5 workflow, ensure its prerequisites and verified browser
assets are present, then run:

```cmd
call tools\stage5\serve.cmd
```

Open `http://127.0.0.1:8000/`, run the fixture workflow, download only when
the AIRR TSV is ready, then use **Clear temporary files**. For the 250/500
MiB eight-thread comparison, use the build overrides and benchmark command
in [Stage 6a](stage6a-native-memory.md). The 50 MiB I/O commands are in
[Stage 6](stage6-correctness-and-io.md). These test commands are not a
single all-in-one installer: the clean NCBI build, Pyodide package
preparation and browser run have separate prerequisites.

## Storage cleanup

The app's **Clear temporary files** action removes the active run's OPFS
directory; cancellation and observed failure paths also remove their
temporary run directory. The Stage 4 and Stage 6 harnesses verify their
temporary OPFS directories are removed. OPFS is origin-scoped, so use the
same scheme, host and port when testing and cleaning a local origin. If a
browser is forcibly terminated before cleanup, remove only this app's
leftover origin data using Edge's site-data controls or the browser's
storage inspector; clearing all browser data is not required.

Build products, downloaded Pyodide assets, browser profiles and benchmark
outputs are generated under ignored `tools\stage*` or `bin\` paths and are
not part of the checked-in source. Preserve them if reproducing the recorded
run; remove only identified generated files or run directories when no
longer needed. Do not remove the whole repository or shared toolchain
directory as a cleanup shortcut.

## Feasibility conclusion

The evidence supports continuing with a **desktop Chromium research
prototype** under the tested Windows environment and small-reference
workflow. It does not support a production-readiness claim, a promise of
comparable IgBLAST speed, arbitrary large FASTA capacity, offline
installation, mobile support, broad OGRDB integration, or a hard-coded
memory threshold. The 250/500 MiB result establishes that this particular
10,000-record test can complete on this host; it does not establish the
minimum required memory or how much the rest of the app consumes.

Before a deployment decision, the unresolved items are: site-wide COOP/COEP
configuration and third-party resource compatibility on OGRDB; representative
sequence/reference and lower-memory hardware tests; total browser-process
memory and real quota-pressure behavior; a user-reviewed adaptive thread
policy if desired; and an independent AIRR-schema check, which the user
deferred. No later implementation stage, deployment change, fixed memory
cap, or adaptive fallback was introduced as part of this report.
