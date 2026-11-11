# Stage 2: FASTA-only build investigation

**Status: complete.** A clean native and WebAssembly build of the pinned,
patched source completed, and the browser-worker fixture output matched the
native result. The user authorized continuing to subsequent stages. The
fixture owner confirmed authorization to use and redistribute the
receptor_utils fixtures. Independent AIRR-schema validation remains deferred
at the user's direction. The final feasibility summary is in [Stage 7](stage7-final-report.md).

## Location and toolchain

- The isolated build area is `D:\copilot-builds\igblast-poc-b12f8502`; the
  application worktree remains on D:. Temporary build files are directed to
  the build area's `temp` directory.
- NCBI C++ Toolkit source is pinned to commit
  `f83dd16a0c30899da66d4f6902b5a9ed36c9d433`. Clean patched source worktrees
  are `repro-source` and `repro-native-source` in the isolated build area;
  the reviewable patch is `patches/ncbi-stage2.patch`.
- Emscripten SDK 7.0.0, Conda Python 3.11.18, CMake 4.4.5, and Ninja 1.13.2
  are isolated in the build area. The emsdk bootstrap repository is pinned to
  `1693ce7359fc9694f198694f902a2cc061239b86`; its Clang reports
  `24.0.0git` at LLVM revision `84ba7b37f02df5a5567e31a1bcfa0f607e578f12`.
  The relocated Emscripten toolchain compiled and ran a small Node smoke test;
  this was not an NCBI or browser test.
- SQLite 3.50.4 was built for the native and WebAssembly configurations.
  The source archive came from
  `https://www.sqlite.org/2025/sqlite-amalgamation-3500400.zip`; its SHA-256
  is `1d3049dd0f830a025a53105fc79fd2ab9431aea99e137809d064d8ee8356b032`.

## Reproducible build and test results

- The clean native build completed all 1,340 Ninja steps using the
  Emscripten-bundled `clang-cl`, Visual Studio 2019 Build Tools/Windows SDK,
  and explicit C++20 mode. It produced `makeblastdb` 2.17.0+ and `igblastn`
  1.22.0. Direct MSVC 19.29 compilation had failed in compile-time
  regular-expression code, so `clang-cl` is the tested native compiler.
- The clean pthread-enabled WebAssembly build completed all 1,338 Ninja
  steps, also with explicit C++20 mode, producing `makeblastdb.js` and
  `igblastn.js`. SQLite 3.50.4 was rebuilt successfully for both native and
  WebAssembly configurations by `build-sqlite.cmd`. The pinned NCBI targets
  configure and link without VDB; a host-native NCBI `datatool` is used only
  for generating source files.
- Experimental portability changes include disabling PCRE JIT for
  Emscripten, using portable zlib rather than the x86/ARM-specific Cloudflare
  variant, and narrowly scoped header and type fixes. SRA support was removed
  from this experiment; VDB is not being ported.
- A small pthread-enabled WebAssembly program successfully caught and
  rethrew a C++ exception under Node with `-fexceptions`. The NCBI build is
  configured with exception handling enabled and a four-thread worker pool;
  the clean browser test below exercises the NCBI runtime, but does not
  separately force an exception through every browser code path.
- The first WebAssembly links failed on `res_query` and the System V calls
  `shmget`, `shmat`, `shmdt`, `shmctl`, `semget`, `semop`, and `semctl`
  (`wasm-link-all-errors.log`). These are Unix service-discovery dependencies,
  not VDB. An Emscripten-specific experiment excludes the Unix LBSM and LBDNS
  mappers from dispatch and uses the toolkit's existing non-Unix host-info
  fallback; it does not pretend those services are available. Both programs
  subsequently linked (`wasm-exclude-mappers.log`). Remote service discovery
  through those mappers is therefore unavailable in this experiment.
- In Microsoft Edge 157.0.4341.42 on Windows, a local cross-origin-isolated
  worker harness executed browser `makeblastdb` on the V/D/J fixtures and
  explicitly transferred the resulting v4 databases between module instances.
  Browser `igblastn` returned zero and produced 10 AIRR TSV data rows. The
  internal `human_V` annotation database was constructed from the same
  matched V fixture as the custom domain metadata; this is a fixture-specific
  choice, not a validation of an official human internal database.
  The checked-in harness is in `tools/stage2/harness`; the repeatable browser
  log and native/browser output are `browser-stage2.log` and
  `browser-airr.tsv` at the repository root (generated files are ignored).
  The matching native build returned the same 10 query IDs, 96 columns, and
  values in every reported field. Representative calls were `IGHV1-8*01`,
  `IGHD3-10*01`, and `IGHJ4*02`. The comparison is fixture-specific and is not
  an independent check for AIRR-C departures; the user deferred that check
  to a later stage.
- With the complete IgBLAST options and a missing query file, the browser
  tool exited 1 and reported the inaccessible file. A query containing only
  invalid residues instead produced warnings, including "Sequence contains
  no data", but exited 0. Callers must inspect warnings and output as well as
  the exit code; input validation remains necessary.
- The native `clang-cl` build targets SSE4.2 after checking that this host
  supports it. Its binaries should not be assumed to run on older CPUs.
- In the initial exploratory build, native and WebAssembly configurations
  briefly generated source files concurrently in one source tree. The final
  clean-build recipe uses separate pinned worktrees to avoid that conflict.
- The pinned test fixture contains 205 V FASTA records, of which 198 have
  matching domain metadata. The test-specific `V-matched.fasta` contains those
  198 records; this filtering is not a claim that the original inputs were a
  matched reference set. The source fixture is from
  `williamdlees/receptor_utils` commit
  `f6bfb03f00358babc07bf6ec20899e85528887ce`. The fixture owner has confirmed
  authorization to use and redistribute these files.

## Reproducing the build and browser comparison

The repository includes the experimental NCBI patch, fixture data, Conda
explicit package list, CMake build scripts, browser harness, and native
comparison script. Generated build and result files are ignored by Git. The
following Windows CMD commands use the isolated toolchain on D:; replace the
toolchain path as needed. They clone the pinned NCBI source and apply the
reviewable patch in separate clean source worktrees. Run the scripts
sequentially: NCBI CMake writes generated configuration directories
(`check`, `inc`, `status`, `testing`) and target outputs (`bin`, `lib`) under
the repository root.

```cmd
set "STAGE2_TOOLS=D:\copilot-builds\igblast-poc-b12f8502"
if not exist "%STAGE2_TOOLS%" mkdir "%STAGE2_TOOLS%"
git clone https://github.com/emscripten-core/emsdk.git "%STAGE2_TOOLS%\emsdk"
git -C "%STAGE2_TOOLS%\emsdk" checkout --detach 1693ce7359fc9694f198694f902a2cc061239b86
call "%STAGE2_TOOLS%\emsdk\emsdk.bat" install 7.0.0
call "%STAGE2_TOOLS%\emsdk\emsdk.bat" activate 7.0.0
conda create --prefix "%STAGE2_TOOLS%\conda-build" --file tools\stage2\conda-win-64-explicit.txt
curl -L https://www.sqlite.org/2025/sqlite-amalgamation-3500400.zip -o "%STAGE2_TOOLS%\sqlite-amalgamation-3500400.zip"
certutil -hashfile "%STAGE2_TOOLS%\sqlite-amalgamation-3500400.zip" SHA256
mkdir "%STAGE2_TOOLS%\sqlite-3.50.4"
tar -xf "%STAGE2_TOOLS%\sqlite-amalgamation-3500400.zip" -C "%STAGE2_TOOLS%\sqlite-3.50.4"
call tools\stage2\build-sqlite.cmd
git clone https://github.com/ncbi/ncbi-cxx-toolkit-public.git "%STAGE2_TOOLS%\repro-source"
git -C "%STAGE2_TOOLS%\repro-source" checkout --detach f83dd16a0c30899da66d4f6902b5a9ed36c9d433
git -C "%STAGE2_TOOLS%\repro-source" apply "%CD%\patches\ncbi-stage2.patch"
git -C "%STAGE2_TOOLS%\repro-source" worktree add --detach "%STAGE2_TOOLS%\repro-native-source" f83dd16a0c30899da66d4f6902b5a9ed36c9d433
git -C "%STAGE2_TOOLS%\repro-native-source" apply "%CD%\patches\ncbi-stage2.patch"
set "STAGE2_CLEAN_BUILD=1"
set "NCBI_SOURCE=%STAGE2_TOOLS%\repro-native-source"
call tools\stage2\build-native.cmd
set "NCBI_SOURCE=%STAGE2_TOOLS%\repro-source"
call tools\stage2\build-wasm.cmd
call tools\stage2\harness\run-browser.cmd
```

Verify that `certutil` reports the SQLite archive SHA-256 recorded above.
`build-sqlite.cmd` creates native and WebAssembly static libraries with
thread-safe SQLite and column metadata enabled. `build-wasm.cmd` uses
Emscripten 7.0.0, Node 24.19.0, CMake/Ninja from the locked Conda prefix,
SQLite amalgamation 3.50.4, and the host `datatool.exe`.
`build-native.cmd` uses the same pinned/patched source in a separate worktree,
the Emscripten-bundled `clang-cl`, and Visual Studio 2019 Build Tools/Windows
SDK; set `VSROOT` if installed elsewhere. The SQLite archive URL and SHA-256
are recorded above. `conda-win-64-explicit.txt` pins the Conda package URLs;
the Emscripten SDK, Visual Studio Build Tools, and Edge are external
prerequisites and are not installed by that lockfile.

The NCBI CMake generation step also needs a host-native `datatool.exe`. The
tested bootstrap is version 2.25.2, 3,150,336 bytes, SHA-256
`E6BDF58B78FE8B284720D956402C7ECAD395A51F42E3B0B8E1995FAC46CD6B94`;
place it at `%STAGE2_TOOLS%\host-tools\datatool.exe` or set `NCBI_DATATOOL`
to its path. This bootstrap binary is an explicit prerequisite, not built by
the WebAssembly configuration.

Set `STAGE2_JOBS` to control parallel compilation; the scripts default to 4.
The clean verification used 8 jobs on the 32-core host.
`build-wasm.cmd` also accepts `STAGE2_BUILD_DIR` (default
`%STAGE2_REPO%\build-wasm-pthreads`), `STAGE2_WASM_TARGETS` (default
`makeblastdb igblastn`) and `STAGE2_WASM_LINK_FLAGS` (default
`-pthread -fexceptions -sPTHREAD_POOL_SIZE=4 -Wl,--error-limit=0`) for
target-specific experiments. These overrides leave the default Stage 2
configuration unchanged.

`run-browser.cmd` starts local HTTP serving with COOP/COEP headers, runs the
test in headless Edge using a dedicated profile, writes `browser-airr.tsv`,
then invokes the native comparator. The comparison rejects missing/duplicate
IDs, changed columns, row-count mismatches, and any per-field differences.
The runner records expected error/warning cases as test results; an `error`
page state or browser/process failure returns a non-zero status.

The compile uses C++ `-pthread -fexceptions` and linker
`-pthread -fexceptions -sPTHREAD_POOL_SIZE=4`; both configurations explicitly
select C++20, required by the pinned NCBI source. Memory is fixed at 16 MiB in
this experiment and is not established to be adequate for larger inputs.
`NCBI_COMPILER_FLAGS_SSE` is empty for WebAssembly, and
`NCBI_COMPONENT_LocalZCF_DISABLED=ON`. The patch SHA-256 is
`1A2CB50AC827D8B5DD81DA63BA90E7233A33DD52A21FA703BB51C99CF67F13CD`.

The patch removes the IgBLAST SRA input branch and VDB target requirement,
disables PCRE JIT under Emscripten, excludes the Unix service mappers there,
selects an appropriate non-ELF linker path, and includes narrowly scoped
header, integer-type and native-Clang compatibility fixes. It does not port
VDB. The linked targets still include LMDB; the test uses v4 databases.
`conda-win-64-explicit.txt` pins the isolated Conda package URLs. The recipe
above was executed successfully from pinned, separately patched source trees
and clean target builds. Emscripten, Visual Studio Build Tools, Edge, and the
host `datatool.exe` remain explicit external prerequisites; their required
versions and, for `datatool.exe`, its checksum are documented above.

Fixture SHA-256 values:

| File | SHA-256 |
|---|---|
| `V-matched.fasta` | `182fc7eb00186422594c94526b3a22dd4c4f803e405596107937858eaa263e08` |
| `D.fasta` | `feb6d3024a80bea5b0b80a9214ad37a2e770cbed387219a721ed284a82faa636` |
| `J.fasta` | `b62cb2b6ee1a8986beb2d75035d432f4f81ad894df0bf15811ffcb917df9321b` |
| `query.fasta` | `830dd5f54114719e9156287ec8bd48b2e9584182fda0202dab775e51731cb811` |
| `Homo_sapiens_IGH.ndm` | `60ff8b2b2dcf878baabb89b39492af53a2e7466eabe4fb97ede54612b9fa4d69` |
| `Homo_sapiens_IGH.aux` | `76b8bcf11c7e42bb0752221c9e630dd0379c56297398a5e3e81fd5227c7342ec` |

## Fixture provenance

The test inputs are derived from files in
[`williamdlees/receptor_utils`](https://github.com/williamdlees/receptor_utils)
at commit `f6bfb03f00358babc07bf6ec20899e85528887ce`. The reference sequence
files and IgBLAST annotation files match files in that repository; the query
is the first 10 records from its `HD13M.fasta` walkthrough example, and
`V-matched.fasta` is a filtered subset of its V reference. The user has
confirmed they are the author and owner of receptor_utils and authorizes use
and redistribution of these fixtures. No fixture-rights blocker remains.

## Review

The central Stage 2 feasibility check succeeded on the small fixture: the
reproducibly built NCBI programs ran in browser workers and matched native
output. Later stages added Python reference preparation, persistent storage,
the local app workflow, failure checks, and I/O/memory measurements. The
clean source/build reproduction and these later results do not demonstrate
production readiness; remaining limits are summarized in [Stage 7](stage7-final-report.md).
