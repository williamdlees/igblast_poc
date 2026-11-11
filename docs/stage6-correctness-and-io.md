# Stage 6: correctness and I/O verification

**Status: complete with a documented limitation, at the user's direction.**
The Stage 5 workflow matches native output on the 10-query fixture. In the
original Stage 6 test, the 10,000-sequence browser run aborted with
`NCBI tool abort: OOM` under the copied module's fixed 16 MiB memory limit,
so no paired speed result was available then. The later user-requested
250/500 MiB, eight-thread comparison is reported separately in [Stage
6a](stage6a-native-memory.md); it does not meet the original one-thread
comparison conditions.

No NCBI source or toolchain was downloaded, cloned, or rebuilt. The existing
browser assets were reverified before testing:

| File | SHA-256 |
|---|---|
| `bin\makeblastdb.js` | `F0F4CFAF838EA8A7150851E3454CAB11B476467D5BC96BB095C8A98FD67A3EF4` |
| `bin\makeblastdb.wasm` | `F25B149679854F84B1AD59E051C1478C45DCD6BB267C0EFEE3F883197AAE8FFB` |
| `bin\igblastn.js` | `B3F7E8A33D7E857C1F3DA9983E09B6A7759CA0FA78A05D7911872885E8DF0246` |
| `bin\igblastn.wasm` | `65158167DF1F0CF111C6A872356390E0F9033B17976AEB4D6242FFDFB4C154D3` |

## Matching browser/native fixture comparison

The user supplied `build-stage2-native\native-airr.tsv`, the prior Stage 2
native output. Its SHA-256 was verified as
`69FF62403B7F9948DFF01BB50A0C78DBF09316B05D76B1B0888410510AE49D00`
before the file was read or compared. It was not regenerated in Stage 6;
the matching native executables were not used or rebuilt.

The native recipe in `tools\stage2\harness\run-native.cmd` and browser recipe
in `tools\stage2\harness\index.html` use the same Stage 2 inputs:
`query.fasta`, `V-matched.fasta`, `D.fasta`, `J.fasta`,
`Homo_sapiens_IGH.ndm`, and `Homo_sapiens_IGH.aux`. Both build V/D/J
databases as nucleotide, BLAST v4 databases with parsed sequence IDs. Both
run IgBLAST with `-organism human -domain_system imgt -ig_seqtype Ig
-outfmt 19 -num_threads 1` and the same V/D/J database arguments. The
pinned Stage 2 tool versions are BLAST 2.17.0+ and IgBLAST 1.22.0, as
recorded in [Stage 2 results](stage2-build-and-test.md).

The browser harness was rerun using the existing verified WebAssembly
assets, then the existing comparison script compared its fresh
`browser-airr.tsv` against the verified native file. It reported 10 rows,
96 columns, and `differences: []` across all fields. Representative calls
were `IGHV1-8*01`, `IGHD3-10*01`, and `IGHJ4*02`. The browser file is 35,209
bytes (`b0d0dc10e1fefa8f326d92d9d685aa557776932cabac8652d7a91f669634ec70`);
the native file is 35,220 bytes. The browser TSV has 11 LF line endings and
the native TSV has 11 CRLF line endings, accounting for the 11-byte size
difference; parsed column names and all field values match.

Reproduce the browser run and comparison from the repository root in Windows
CMD. The first command runs only the browser harness and uses the existing
Stage 2 assets; it does not build NCBI or regenerate the native baseline.

```cmd
node tools\stage2\harness\run.cjs
node tools\stage2\harness\compare.cjs build-stage2-native\native-airr.tsv browser-airr.tsv
```

## Browser correctness and responsiveness

The 10-query `tests\fixtures\stage2\query.fasta` was run through the current
Stage 5 app in Edge 157. The six OGRDB fixture artifacts were prepared;
browser `makeblastdb` completed for V, D, and J; and browser `igblastn`
completed with exit status 0. The output was 35,209 bytes, 10 rows and 96
columns, with SHA-256
`b2b5ed9f7fe37e6b2b57b9dadad4ce1b2ac4890b5e4d853713a168e6388aea0a`.
All 10 query IDs were present. Representative first-row calls were
`IGHV1-8*01`, `IGHD3-10*01`, and `IGHJ4*02`; the next two rows included
`IGHV3-21*01` / `IGHD6-19*01` / `IGHJ5*02` and `IGHV2-5*02` /
`IGHD6-25*01` / `IGHJ2*01`. This hash matches the Stage 5 run. Stage 5 used
OGRDB-prepared reference artifacts, so this output is reported separately
rather than compared to the Stage 2 native baseline.

A 100 ms main-thread heartbeat advanced 93 ticks during the roughly 9.33
second pipeline run. This confirms the page event loop continued to run for
this small fixture; it is not a general latency or responsiveness guarantee.

Failure checks:

| Case | Observed result |
|---|---|
| Invalid FASTA (`>invalid` with `ZZZZZZZZZZ`) | IgBLAST warned `Sequence contains no data`; the app reported `output persistence: airr.tsv: output file is empty`, kept Download disabled, and removed the failed run directory. |
| Failed OGRDB fixture request | A local test server returned HTTP 503 for `/api_v2/germline/species`. The app displayed `Error: Error: OGRDB fixture /germline/species: HTTP 503`, kept Download disabled, re-enabled Run, and removed the failed run directory. |
| Missing Wasm JS asset | Before the user copied the Stage 2 assets, `/bin/makeblastdb.js` failed to load and the app cleaned up the run directory. The assets are present now; they were not moved or renamed to repeat this test. |
| Quota exhaustion | Injecting a `QuotaExceededError` from `navigator.storage.getDirectory()` produced a visible `Error: synthetic quota exhaustion`; Download remained disabled. This simulated an error and did not exhaust real storage. |
| Cancellation | Cancelling while reference preparation was active produced `Error: Run cancelled`, left Download disabled, re-enabled Run, and removed the run directory. |
| Live OGRDB on localhost | The app refused live mode with its same-origin deployment guard and directed local development to the fixture. This is expected; localhost is not the OGRDB origin. The Stage 3 live API checks are recorded separately. |

The 503 check can be repeated from Windows CMD with the local failure-injection
server, then by opening `http://127.0.0.1:8001/` and running the small fixture:

```cmd
set "PORT=8001"
set "OGRDB_FAIL_PATH=/api_v2/germline/species"
node tools\stage5\server.cjs
```

For the cancellation case, start a valid fixture run and click **Cancel**
while the worker is active. The quota case was injected in the browser page
before clicking Run:

```javascript
navigator.storage.getDirectory = async () => {
  throw new DOMException("synthetic quota exhaustion", "QuotaExceededError");
};
document.getElementById("run").click();
```

## 50 MiB I/O measurements

The benchmark uses a deterministic synthetic 50 MiB payload, not additional
biological data. Its SHA-256 is
`3a7aef326b898081e6fb7b9599db2618b4f5e5301b64078f0f4e1f5382f634b9`.
The browser worker uses the same `readOpfsFile` and `persistOutput` functions
as the Stage 5 NCBI worker, plus `FS.writeFile` against Pyodide's Emscripten
MEMFS. Using Pyodide MEMFS isolates the OPFS/MEMFS transfer from the cost of
annotating a 50 MiB sequence; it does not establish IgBLAST runtime memory
use or throughput at that size. The native comparator is a 64 KiB
`createReadStream`/`createWriteStream` copy on the same D: volume, followed
by `fsync`. Both source and output hashes matched.

Environment: Windows 11 build `10.0.26200`, Edge `157.0.0.0` (headless),
Node `v24.21.0`, AMD Ryzen Threadripper 3970X, 64 logical CPUs, and about
64 GiB RAM. The Edge profile and native input/output were under
`tools\stage6\results` on D:, so both paths used the same volume. Input
generation and hashing were outside the timed intervals. Hashing read the
input before timing, and no OS cache flush was performed; results therefore
represent warm/unspecified cache conditions, not cold-cache performance.
The browser run removed and verified removal of its temporary OPFS directory.

| Browser run | OPFS read (ms) | MEMFS write (ms) | OPFS→MEMFS (ms) | MEMFS→OPFS (ms) | Round trip (ms) |
|---:|---:|---:|---:|---:|---:|
| 1 | 43.83 | 12.41 | 56.24 | 97.17 | 153.41 |
| 2 | 30.19 | 9.25 | 39.44 | 117.63 | 157.07 |
| 3 | 37.63 | 17.52 | 55.16 | 100.31 | 155.47 |
| 4 | 31.79 | 11.98 | 43.76 | 115.81 | 159.57 |
| 5 | 26.29 | 58.18 | 84.47 | 205.03 | 289.50 |

| Native stream-copy run | Elapsed (ms) |
|---:|---:|
| 1 | 305.32 |
| 2 | 259.13 |
| 3 | 262.50 |
| 4 | 253.47 |
| 5 | 252.76 |

| Path | Median elapsed | Throughput using 50 MiB payload |
|---|---:|---:|
| Browser OPFS→MEMFS | 55.16 ms | 906.45 MiB/s |
| Browser MEMFS→OPFS | 115.81 ms | 431.74 MiB/s |
| Browser round trip | 157.07 ms | 318.33 MiB/s |
| Native streamed file copy + `fsync` | 259.13 ms | 192.95 MiB/s |

For this one run, the browser round trip took 0.606× the native median time
(1.65× the measured throughput). The five browser runs varied substantially,
especially the last; these are indicative observations, not a stable
performance claim. Browser and native filesystem APIs also differ, and the
browser MEMFS was Pyodide rather than the NCBI module's runtime.

Reproduce the two measured paths from the repository root in Windows CMD:

```cmd
node tools\stage6\benchmark-native.cjs 50 5
node tools\stage6\run-browser.cjs
```

The scripts write ignored JSON summaries and temporary files under
`tools\stage6\results`. Browser timing excludes Edge startup, Pyodide
initialization, payload generation, and hashing.

## Stage 5 OGRDB/native parity and requested 10,000-sequence speed test

The Stage 5 OGRDB/native comparison was run through the local browser harness
on the 10-record fixture. Pyodide prepared the six local OGRDB fixture
artifacts, browser `makeblastdb` generated V/D/J v4 databases, and browser
`igblastn` emitted 10 rows and 96 columns. Native `makeblastdb` and `igblastn`
then ran with those same prepared V/D/J FASTAs, `.ndm`, `.aux`, and the same
options. The comparison reported `differences: []`; the browser output hash
was `b2b5ed9f7fe37e6b2b57b9dadad4ce1b2ac4890b5e4d853713a168e6388aea0a`,
matching the recorded Stage 5 output. The generated native versions were
makeblastdb 2.17.0+ and igblastn 1.22.0. This closes the small-fixture
Stage 5 parity criterion; the supplied Stage 2 native TSV was not used.
The single-run timer values were 1,481.26 ms in Edge and 333.77 ms natively;
these are recorded only as incidental timings from the parity check, not as
a performance comparison or speedup claim. The reproducible result and both
TSVs are under
`tools\stage6\results\igblast-speed-20261111T174904196Z\`.

The speed comparison remains incomplete. The test input repeats each of the
10 records in `tests\fixtures\stage2\query.fasta` 1,000 times, preserving each
sequence and adding a unique repeat prefix to its identifier. Reference
preparation and database creation are excluded from timing. Each timed
invocation starts immediately before launching the native executable or a
fresh browser worker and ends when the AIRR output is complete; this includes
process/module startup, input/database loading, annotation, and output
writing. Both runs use the same query, OGRDB-prepared reference artifacts,
BLAST v4 database settings, IgBLAST arguments, and one thread. Five paired
runs alternate execution order; report each duration and the median,
alongside 10,000-row and AIRR-field parity. These measurements are distinct
from the 50 MiB I/O benchmark.

The browser timer spans worker creation through MEMFS-to-OPFS output
persistence; the native timer spans process creation through output-file
completion. Thus both measure end-to-end tool invocations, including their
runtime startup and file-transfer/read costs, rather than isolated CPU time.
The speed run used Edge 157 on Windows 11 build `10.0.26200`, on the same
Threadripper 3970X host documented for the I/O measurements.

The generated FASTA has 10,000 unique identifiers, is 5,555,000 bytes, and
has SHA-256
`10ac9a2f9344e716a564d08a9d0304ac3d39221c7df3b8b3132ae487261e95da`.
The browser harness completed reference preparation and database creation,
then the first 10,000-query `igblastn` invocation aborted with
`NCBI tool abort: OOM`. The checked-in `igblastn.js` fixes both initial and
maximum linear memory at 16,777,216 bytes. Consequently no browser timing,
10,000-row parity, or paired speed ratio was produced.

The five native-only runs used the same generated query, OGRDB references,
database settings, and one-thread IgBLAST options. Their elapsed times were
170,173.91, 168,112.92, 172,293.41, 179,930.17, and 183,922.60 ms; median
172,293.41 ms (172.29 s). The final output is 10,000 rows and 96 columns,
with 10,000 unique sequence IDs and representative calls `IGHV1-8*01`,
`IGHD3-10*01`, and `IGHJ4*02`. The output SHA-256 is
`3242EE2DE2ED4CE67F260E27AACD5C646DF9E5184A3999DB32BE363AFEFC66E1`.
Native timings include process startup, database/query reads, annotation, and
output writing. They are an unpaired native baseline, not a native-versus-
browser speed result. Outputs and the native timing manifest are under
`tools\stage6\results\igblast-native-only-20261111T174944415Z\`.

Reproduce the deterministic input and tests from Windows CMD:

```cmd
node tools\stage6\generate-10k-fasta.cjs
node tools\stage6\benchmark-igblast.cjs --small-parity
node tools\stage6\benchmark-igblast.cjs
```

The generator writes `tools\stage6\results\query-10000.fasta` and a JSON
manifest with the record count and SHA-256. No additional biological input
data is needed. The full command currently fails at the Wasm OOM described
above. Native-only diagnostics can be reproduced against a completed browser
artifact directory:

```cmd
node tools\stage6\benchmark-igblast.cjs --native-only tools\stage6\results\igblast-speed-20261111T174346358Z\browser-artifacts
```

## Native runtime and reference provenance

The current worktree's `build-stage2-native` directory contains only
`native-airr.tsv`. The user copied `bin\makeblastdb.exe` and
`bin\igblastn.exe` into this worktree; both report the pinned versions and
both successfully executed the small Stage 5 parity run. No adjacent DLLs
were present. `tools\stage2\harness\run-native.cmd` expects these executables
in the repository's top-level `bin\` directory; the Wasm `.js` and `.wasm`
files remain beside them. No files from another worktree were inspected or
used.

No reference artifacts need to be copied: the checked-in OGRDB response
fixtures, pinned Pyodide runtime, receptor_utils wheel, and package manifest
are present in this worktree and can reproduce the Stage 5 references. The
Stage 5 worker emits six artifacts:

- `Homo_sapiens_IGH_VDJ_V.fasta`
- `Homo_sapiens_IGH_VDJ_D.fasta`
- `Homo_sapiens_IGH_VDJ_J.fasta`
- `Homo_sapiens_IGH_VDJ_V_gapped.fasta`
- `Homo_sapiens_IGH_VDJ.ndm`
- `Homo_sapiens_IGH_VDJ.aux`

For the current Stage 5 IgBLAST invocation, the native comparison used the
existing `tests\fixtures\stage2\query.fasta` plus the V, D, and J FASTAs,
`.ndm`, and `.aux` artifacts above. `V_gapped.fasta` is prepared by Stage 5
but is not passed to its current makeblastdb/igblastn commands. The native
run built fresh V/D/J nucleotide BLAST v4 databases with
`-parse_seqids`, copy the V database files to
`internal_data\human\human_V*`, and run the same IgBLAST options as Stage 5
(`-organism human -domain_system imgt -ig_seqtype Ig -outfmt 19
-num_threads 1`). The previous Stage 2 `native-airr.tsv` must not be used
for this comparison.

No NCBI source or toolchain was downloaded, cloned, rebuilt, or accessed
through the previously denied external build path for the original Stage 6
run. Independent AIRR-schema validation remains deferred as directed; 50 MiB
annotation, real storage-quota exhaustion, and cold-cache behavior were not
measured. The Stage 7 consolidation is in [the final report](stage7-final-report.md).
