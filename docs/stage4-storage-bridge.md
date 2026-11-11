# Storage bridge spike

**Status: complete.** The Stage 5 workflow subsequently connected the OPFS
boundary to the real browser NCBI workers.

## Selected path

Use the Origin Private File System (OPFS) as the origin-scoped storage layer
for user inputs, generated database files, and outputs. A dedicated worker
owns OPFS synchronous access handles and copies data in bounded 64 KiB chunks
to or from each WebAssembly module's private MEMFS. The worker that runs
`makeblastdb` and the separate worker that runs `igblastn` do not share a
MEMFS; both receive the same OPFS directory handle and copy their required
files into their own module filesystem. The browser's file picker supplies a
`File` for input; the deterministic harness uses the existing query fixture
as a `File`.

The spike uses OPFS handles passed by structured clone to two separate
workers. The consumer worker loads Pyodide 0.27.7 and exercises its
Emscripten MEMFS `open`/`write`/`read`/`unlink` operations, copying the query
and an opaque binary payload from OPFS to MEMFS and a generated output back
to OPFS. This validates the storage boundary and the bounded-copy mechanics
with a real Emscripten MEMFS implementation. Stage 5 later connected the
selected storage boundary to the browser NCBI workflow.

## Verification result

Reproduced in Microsoft Edge 157.0.4341.42 on Windows using Node.js
24.21.0. The isolated localhost page reported `crossOriginIsolated: true`.
All file sizes and SHA-256 values matched across OPFS writes, worker
handoff, MEMFS, and output:

| File | Bytes | SHA-256 |
|---|---:|---|
| Input `query.fasta` | 5,621 | `830dd5f54114719e9156287ec8bd48b2e9584182fda0202dab775e51731cb811` |
| Opaque database payload | 262,144 | `8f2144a274ead978258dbbcc0b62c5b0ee7335eb2bf729fbb5ca4026af0f0a14` |
| Output echo of input | 5,621 | `830dd5f54114719e9156287ec8bd48b2e9584182fda0202dab775e51731cb811` |

The OPFS probe passed chunked writes, random-offset overwrite/read,
truncation, directory-handle handoff between workers, and worker-to-MEMFS /
MEMFS-to-OPFS copies. An intentional open of a missing file surfaced
`NotFoundError`. Cleanup removed the three staged files and temporary
directory; a follow-up lookup confirmed the directory was gone. The
reported storage estimate was 262 bytes used and 10,737,418,502 bytes quota
in the test profile; this estimate is not a reservation or guarantee of
available capacity.

## Reproduction

From the repository root in Windows CMD, with Node.js and Edge installed:

```cmd
node tools\stage4\run-storage-bridge.cjs
```

The runner serves the harness over localhost with COOP/COEP headers and
starts headless Edge. It requires the already prepared Stage 3 Pyodide npm
package at `tools\stage3\node_modules\pyodide`. No new package installation
is needed. Browser results are printed as JSON; the temporary OPFS test
directory is removed on success and the harness attempts cleanup on failure.
The Edge profile under `tools\stage4\results` is generated and ignored.

## Limits and handoff

The database payload is deterministic opaque test bytes, not a real
`makeblastdb` database, and the output is a byte-for-byte test copy, not
IgBLAST output. The Stage 2 harness demonstrated real NCBI module execution
with per-module MEMFS and explicit file handoff. Stage 5 subsequently
connected the local app workflow to OPFS and the real NCBI workers.

This is a correctness spike, not a benchmark: it does not test 50 MiB files,
quota exhaustion, browser eviction, persistence permission, cancellation, or
peak memory. OPFS is quota-managed and may be evicted; callers must report
quota/write failures and clean their own temporary files. The consumer
currently reads small test files into typed arrays for hashing; the harness
does not establish large-file memory bounds.

The user proceeded to connect the local browser workflow after this review
checkpoint. The consolidated feasibility conclusion is in [Stage 7](stage7-final-report.md).
