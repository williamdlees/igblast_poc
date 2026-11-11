# IgBLAST browser proof of concept

## Goal and decisions

Demonstrate the README's proposed client-side architecture with one complete, locally runnable browser workflow: obtain an OGRDB human IGH reference set, prepare its IgBLAST databases, annotate a FASTA file, and export AIRR rearrangement data. All analysis must run in the browser, not in a local or remote compute service. Target desktop Chromium on Windows first; a static localhost server is acceptable.

The PoC should establish whether NCBI's actual `makeblastdb` and `igblastn`, and useful `receptor_utils` functionality, run in that environment. Their compatibility is an unproven, high-risk hypothesis, not a feature already available. Export standard AIRR TSV, rather than the CSV mentioned in the README. Measure large-file I/O at 50 MiB against a native baseline and report ratios; no fixed performance pass threshold has been selected.

The requested repository `PLAN.md` should be created from this approved plan when implementation begins. While planning, this document resides in the session workspace and no repository files are changed.

## Toolchain choices

### NCBI C++ to WebAssembly

| Choice | Benefits | Tradeoffs |
| --- | --- | --- |
| **Emscripten (`emcc`/`em++`, Clang/LLVM targeting browser Wasm)** | Browser runtime, C/C++ and POSIX compatibility layer, filesystem support, CMake integration; closest fit for the actual executables. | NCBI toolkit and its dependencies may require substantial porting; platform calls, memory-mapped files, threading, LMDB and filesystem behavior must be investigated, not assumed to work. |
| Native Clang/MSVC/GCC | Established native builds and a useful baseline. | Cannot run directly inside a browser; not evidence the PWA is feasible. |
| WASI SDK/other Wasm toolchains | Standards-oriented portable modules. | Browser integration and POSIX/filesystem shims would need more custom work; not clearly easier for this toolkit. |

**Recommendation:** use a pinned Emscripten SDK and the NCBI toolkit's CMake-based build, limited to the required targets and their dependencies. First prove native builds or obtain matching native binaries as a correctness baseline. Then port `makeblastdb` and `igblastn` individually, recording exact source revisions, tool versions, build flags, patches, licenses and blockers. Do not treat successful compilation as proof of browser execution. Determine whether database format 4 or 5 is supported by the selected toolkit and exercise compatible database production and consumption end to end; do not silently substitute incompatible formats.

The two initial stages below take precedence over all Python, storage-integration and application work. Native reference execution is part of the second stage, not a prerequisite to the static analysis. Each stage ends in an explicit user go/no-go decision; passing a technical check does not authorize proceeding through the review.

Start with one compute worker and single-threaded execution if supported. If the toolkit requires threads, investigate an Emscripten pthread build, worker pool, `SharedArrayBuffer` and COOP/COEP localhost headers. Threaded and non-threaded builds are separate variants, and cross-origin isolation may complicate OGRDB access and package loading. Explicitly surface any unported operating-system or library features. A native executable, remote backend or unrelated reimplementation is a diagnostic fallback only, never a successful browser PoC.

### Python

| Choice | Benefits | Tradeoffs |
| --- | --- | --- |
| **Pyodide (CPython compiled to Wasm)** | Runs Python and compatible scientific packages in the browser; directly tests the README requirement. | Larger assets and separate runtime/filesystem; platform-specific wheels and network behavior require checking. |
| Native Conda CPython | Straightforward setup and useful native comparator. | Cannot demonstrate Python imports or execution within the browser. |
| JavaScript reimplementation / other browser Python runtimes | Potentially smaller or simpler in limited cases. | Reimplementation does not demonstrate `receptor_utils`; other runtimes have less direct compatibility with its dependencies. |

**Recommendation:** pin a compatible Pyodide distribution and package versions, test `receptor_utils`, its BioPython dependency and the actual reference-preparation code in a dedicated worker. Its package declares `biopython` and `requests`, and `download_germline_set` uses synchronous `requests`: a successful import alone does not establish that its network call works in a browser. Test compatibility explicitly. If necessary, fetch OGRDB data with browser `fetch`/Pyodide `pyfetch`, then pass responses into the relevant Python preparation functions using a small documented adapter; demonstrate actual useful `receptor_utils` execution and preserve output parity. Check OGRDB CORS in Chromium; if unavailable, report the live-fetch blocker and permit explicit local import of a previously downloaded reference fixture for the remaining browser stages. Do not claim that fixture fallback proves live OGRDB access. No server-side analysis or proxy is implied.

Conda-managed native Python may be used for development/baseline tooling only. Ask the user which Conda environment to use if an appropriate environment or additional Python tools are needed.

## Architecture choices

| Choice | Benefits | Tradeoffs |
| --- | --- | --- |
| **Small static HTML/TypeScript or JavaScript page plus Web Workers** | Minimal moving parts; native browser APIs and visible end-to-end behavior; a static localhost server provides the required origin. | Explicit lifecycle, error handling and runtime integration must be implemented. |
| React/Vue/Svelte with a build tool | Useful for a larger interactive application. | Framework and bundler overhead is not needed to answer the present feasibility questions. |
| Native desktop wrapper or local analysis service | Easier native tools, filesystem and threading. | Changes the deployment model and does not prove browser/PWA feasibility. |

**Recommendation:** use a minimal static page, avoiding a UI framework unless the build integration genuinely requires one. The UI provides a FASTA file chooser and paste field, a fixed human IGH reference action, run button, status/error output and a result download. Runtime assets are served locally. Run analysis in a worker to keep the UI responsive; orchestrate the separate Python and Emscripten modules, their inputs, files and errors explicitly. Sequence data stays local; only the selected reference is requested from OGRDB. This is a local browser application, not an installed/offline-ready production PWA: service worker, installation, responsive polish, rich visualization, multiple species/custom references and remote deployment are out of scope.

Workflow:

1. Select or paste FASTA; reject empty or malformed input with an actionable error.
2. Obtain the fixed human IGH OGRDB set; prepare V/D/J FASTA plus `.ndm` and `.aux` with useful `receptor_utils` code. Record reference ID/version. If live retrieval fails, show the error and allow an explicitly selected local fixture.
3. Execute browser-compiled `makeblastdb` for V, D and J, with verified command-line options and filesystem outputs. Make the resulting databases and auxiliary files available to browser-compiled `igblastn`.
4. Execute `igblastn` with the selected reference, matching domain settings, query and required `IGDATA` setup; use direct `-outfmt 19` AIRR output. Capture nonzero exits, stderr and missing outputs.
5. Export the resulting `.tsv`; validate its AIRR schema and compare representative annotations to a matching native run, not merely file existence. The linked walkthrough uses format 7 plus Change-O, whereas format 19 is the simpler direct AIRR path; verify any substantive differences instead of calling them identical.

## Data management and throughput

| Option | Benefits | Limitations |
| --- | --- | --- |
| **Origin Private File System (OPFS), accessed in a worker** | Origin-scoped persistent files and synchronous worker access handles suitable for large or random I/O. | Quota/eviction and browser support; Emscripten does not automatically mount OPFS. Integration with synchronous C++ file operations and both tool modules must be proven. |
| Emscripten MEMFS | Simplest for early smoke tests. | Volatile and memory-backed; large files and multiple copies can exhaust memory. |
| Emscripten WORKERFS | Read-only `File`/`Blob` access without copying the entire input into memory. | Worker-only, read-only; outputs and database files need a separate writable backend. |
| IDBFS/IndexedDB | Browser persistence and an established Emscripten adapter. | Synchronization and memory overhead may be substantial for large files; benchmark rather than assume throughput. |
| User-granted File System Access API | Direct user selection and save-as behavior in Chromium. | User gestures, permissions and browser portability; not a transparent writable filesystem for C++ without an adapter. |

**Recommendation:** prototype WORKERFS for read-only FASTA input and a proven worker-compatible OPFS-backed filesystem adapter for database and output files. First build a small spike to verify create/open/read/write/seek/rename/delete, random access, errors and visibility between the Python, `makeblastdb` and `igblastn` runtimes; choose and document a supported Emscripten backend or implement a narrowly scoped bridge only if needed. OPFS alone is not a POSIX mount, and separate module instances do not automatically share filesystems. If the bridge is not viable, use MEMFS/IDBFS as an explicit measured fallback and report its limitations rather than claiming OPFS-backed performance.

Stream/copy in bounded chunks where the chosen backend permits it; avoid converting whole files to strings or repeatedly duplicating buffers. Check estimated quota before large writes, handle quota/storage failures and partial files, close handles, and provide cleanup for this app's own scratch data. Keep reference/database caches keyed by exact version and tool settings; never silently reuse stale data. Save/export requires user action. The 50 MiB throughput benchmark is separate from the small correctness fixture and must measure import and export paths, not just memory copies.

## Initial risk-reduction stages and review gates

After the plan is approved, create repository `PLAN.md` from it. The work then begins with these two stages; neither includes Python/Pyodide integration, the final application UI, production storage integration or large-file benchmarking.

### Stage 1: static analysis of NCBI tools

This stage is investigation only: inspect upstream source and build definitions without compiling or modifying NCBI code. Record an immutable toolkit revision and identify the corresponding releases of both executables. Retain source file paths and line references for each finding; distinguish confirmed evidence from hypotheses that require a build or runtime test.

1. Locate the actual `makeblastdb` and `igblastn` entry points, application and CMake project files, command-line argument definitions, and the sources implementing database creation, query processing and AIRR output. Trace the relevant paths for nucleotide V/D/J databases, `.aux`/`.ndm` custom data and `-outfmt 19`, not unrelated toolkit applications.
2. Build a transitive dependency inventory for each target: toolkit libraries, C/C++ runtime and third-party libraries; required versus optional components; build-system generators, tools and generated configuration files. Use build metadata and source declarations to identify the likely target closure and unresolved dependencies. Do not claim a complete configured link graph without a build.
3. Inventory the actual file and runtime requirements along those paths: database v4/v5 readers and writers and any LMDB dependency, random access, memory mapping and file locking; directory and path operations, environment variables, standard streams, temporary files, file size and 32-bit Wasm memory assumptions. Check whether each requirement is mandatory for the selected workflow or avoidable by an explicit supported configuration.
4. Trace threading and synchronization, process creation, signals, sockets/networking, platform-specific APIs, system calls and compiler/platform conditionals. Assess whether each relevant use can run in Emscripten, be disabled without changing the intended analysis, or requires a specific code/dependency change. Identify COOP/COEP and worker implications if threads are required.
5. Examine each build dependency for an Emscripten-compatible implementation, toolchain configuration and license/distribution constraints. Identify likely build-system changes, patches or replacement backends, including effects on correctness and compatibility between `makeblastdb` and `igblastn`. Do not presume that a v4 choice removes every incompatible dependency without evidence.
6. Produce a dependency and risk matrix per executable: source/line, required workflow, suspected issue, evidence, proposed mitigation, change location, verification needed, impact and confidence. Rank blockers and open questions; present viable alternatives and any material scope change rather than silently weakening the goal.
7. Propose a concrete standalone build/test sequence, including pinned tools, minimum fixture and native comparator requirements. Identify environment/tool prerequisites; ask the user which Conda environment to use if one or additional Python tools are needed.

**Go/no-go review 1:** present the inventory, ranked risks, proposed code changes and remaining unknowns to the user. **Go** means the user explicitly authorizes proceeding to the standalone build; **no-go** means stop and preserve the findings. Incomplete evidence or a potentially major upstream rewrite must be called out, not treated as an automatic pass. No Stage 2 compilation or code modification begins before the user's decision.

### Stage 2: standalone compilation and test

The goal is to compile and exercise both real NCBI tools as browser-executed WebAssembly, independent of the eventual app, Pyodide, OGRDB networking and persistent storage. A minimal test harness and localhost static server are permitted. A native run is a comparator, not a substitute for browser execution.

Stage 2 is explicitly FASTA-only. SRA input is out of scope, and porting VDB must not be considered. Because the current `igblastn` target declares VDB and references SRA types, investigate and make the narrowly scoped build and source changes needed to remove those dependencies while preserving FASTA analysis. Verify whether VDB is required elsewhere in the resulting target closure; if it cannot be removed without a larger change, stop and report the blocker rather than porting it.

1. Based on the approved Stage 1 findings, pin the NCBI revision, Emscripten SDK, build tools and transitive dependencies; record host/browser details, licenses, exact configuration and reproducible Windows CMD instructions. Use the user's identified Conda environment if required.
2. Prepare small, provenance-documented input and reference fixtures: query FASTA, V/D/J reference FASTAs and required `.aux`/`.ndm` files, with exact versions and a permitted redistribution or user-provided path. Use existing prepared files; do not build the Python/OGRDB stage as a prerequisite.
3. Establish matching native `makeblastdb` and `igblastn` runs using the same toolkit version, options and fixture. Record commands, versions, exit status, database format, output and representative expected annotations. Build native tools or obtain demonstrably matching binaries; identify any mismatch.
4. Configure the smallest practical Emscripten build closure without VDB or SRA support. Compile and link `makeblastdb`, then `igblastn`; classify configuration, dependency, compilation and linking failures. Apply only necessary, documented changes, including the FASTA-only changes needed to eliminate VDB; preserve a patch list and explicitly record the removed SRA capability and other behavior-affecting deviations. Verify real artifact provenance rather than a stub or reimplementation.
5. In a minimal Chromium worker harness, provide the tiny files through a suitable filesystem such as MEMFS. Start each real module, capture stdout/stderr and exit status, and verify failures are visible. Make the three generated databases accessible to the separate `igblastn` module through an explicit handoff; ensure no module filesystem sharing is assumed.
6. Run browser `makeblastdb` for V/D/J and run browser `igblastn` with the resulting databases, `.aux`/`.ndm`, required environment/settings and `-outfmt 19`. Verify output is valid AIRR TSV and compare query IDs, row counts and representative annotations against native, explaining ordering or metadata differences. Exercise at least one invalid input and missing-file error.
7. Publish the exact commands, build logs or concise reproducible failure evidence, patch inventory, test fixture provenance, browser/native comparison, limitations and unresolved risks. Report explicitly if only one tool compiles or if successful linking does not lead to successful execution. A Node-only or native-only run is diagnostic evidence, not a browser success.

**Go/no-go review 2:** present the reproducible build and runtime results, correctness comparison, patches and residual risks to the user. **Go** requires explicit user authorization before later PoC work. A technical recommendation to proceed requires both actual Wasm tools to run in Chromium together on the fixture and produce a comparable AIRR result; if this fails, recommend no-go or present a clearly described revised approach for user decision. Never silently replace the tools or shift analysis to a backend.

## Subsequent implementation todos

Only after both user review gates:

1. **Prove the Python/reference stage.** Load Pyodide and required packages in a worker; import and execute useful `receptor_utils` preparation code, verify artifacts against native reference generation, and test browser OGRDB CORS/network behavior with explicit fixture fallback.
2. **Validate the storage bridge.** Spike and select a worker-compatible input, database and output storage path; verify all required file operations, cross-runtime handoff, data integrity, cleanup and errors before relying on it in the workflow.
3. **Connect the local browser workflow.** Implement the minimal static UI, workers and local serving instructions; wire reference preparation, V/D/J database creation, annotation and user-initiated AIRR TSV export. Provide explicit diagnostics and a local fixture path for a CORS failure.
4. **Verify correctness and measure I/O.** Compare browser output with the matching native baseline on the same fixtures, validate AIRR TSV, exercise failure cases and responsive UI, then benchmark 50 MiB import/export against native file copying on the same machine and report methodology and results.
5. **Document results and limitations.** Provide reproducible Windows CMD instructions, exact prerequisites and Conda environment requirement, source/build/version and asset provenance, benchmark observations, failure modes, storage cleanup and explicit feasibility conclusions.

## Verification and acceptance

- On desktop Chromium on Windows via localhost, a user can select or paste a valid small FASTA, acquire the fixed reference or explicitly choose a local fixture, and receive a nonempty AIRR TSV generated by the actual browser-executed NCBI tools.
- Record whether live OGRDB retrieval works separately from the fallback. Run real `receptor_utils` reference processing in Pyodide; verify V/D/J sequences and auxiliary files against the pinned native reference.
- Match query IDs, row counts, relevant AIRR fields and representative annotations against native `igblastn` using identical source/reference/settings, allowing only explained nondeterministic metadata or ordering. Check AIRR-required columns with a suitable validator.
- Verify invalid FASTA, failed reference retrieval, missing asset, tool failure, insufficient quota and cancellation/cleanup produce visible errors without a false success. Check that the page remains responsive while workers run.
- Measure a 50 MiB input and output using the actual browser storage path, and equivalent native streaming reads/writes on the same disk and machine. Report bytes, elapsed time, MiB/s, browser/native ratios, browser/tool versions, hardware and warm/cold cache conditions; repeat and report individual or median measurements. Exclude generation/setup time and do not conflate copy throughput with annotation speed.
- If any critical stage is blocked, report its exact failure, attempted alternatives and what was independently demonstrated; do not label a partial pipeline as complete.

## References

- [Project README](README.md) and [receptor_utils IgBLAST walkthrough](https://williamdlees.github.io/receptor_utils/_build/html/airrc_sets_with_igblast.html)
- [NCBI C++ toolkit CMake configuration](https://ncbi.github.io/cxx-toolkit/pages/ch_cmconfig)
- [Emscripten filesystem backends](https://emscripten.org/docs/api_reference/Filesystem-API.html) and [pthreads](https://emscripten.org/docs/porting/pthreads.html)
- [Pyodide HTTP limitations](https://pyodide.org/en/stable/usage/api/python-api/http.html) and [receptor_utils dependency declarations](https://github.com/williamdlees/receptor_utils/blob/main/setup.cfg)
- [OPFS documentation](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) and [storage estimates](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate)
- [AIRR TSV direct IgBLAST example](https://docs.airr-community.org/en/v1.3.0/examples/datarep_cmd_example.html)
