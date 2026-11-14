# IgBLAST browser proof of concept

## Current status

Stages 1–7 document a bounded feasibility proof for running the real NCBI
`makeblastdb` and `igblastn` programs, Pyodide reference preparation, and an
OPFS-backed workflow in desktop Chromium on Windows. The local fixture
workflow completes and produces AIRR TSV output. See the [Stage 7 final
report](research/docs/stage7-final-report.md) and its linked stage reports for
reproducible commands, versions, measurements, and limitations.

This repository is **not a production-ready, installable or offline PWA**.
The application scaffold is in `public/` and `src/`; the completed research
archive is in `research/`. The Stage 5 workflow remains available there as
reproducibility evidence and is not the new app implementation.
The tested 10,000-sequence browser run used repeated copies of a 10-sequence
fixture and was about four times slower than a matching native run. Live
OGRDB API access was tested separately; the end-to-end app uses a local
fixture. A deployed pthread build also requires COOP/COEP headers and
validation of third-party resources. Browser memory availability and a
general large-input limit have not been established.
The fixture-backed workflow refers to the archived Stage 5 harness; the new
app scaffold does not yet run analysis.

## Rationale

The purpose of this project is to create a proof of concept for a Progressive Web App (PWA) that leverages IgBLAST for immunoglobulin sequence analysis. This app aims to provide a user-friendly interface for researchers to input sequences, perform IgBLAST analysis, and visualize the results efficiently within a web application.

The app will be hosted by the OGRDB server at https://ogrdb.airr-community.org and will be accessible at https://ogrdb.airr-community.org/igblast. It will be built in this repo and the final package will be copied to the server for deployment.

## Repository layout

- `public/` contains the browser entry point and PWA metadata.
- `src/` is the application source; worker, workflow, reference, storage and
  IgBLAST modules belong in their respective subdirectories as they are
  developed.
- `tests/`, `scripts/` and `docs/` are reserved for app-specific tests,
  development tooling and documentation.
- `research/` preserves the completed investigation, fixtures, patches and
  runnable stage harnesses. See the [final report](research/docs/stage7-final-report.md).

Run the app shell locally with `npm run dev`; it serves at
`http://127.0.0.1:8080/` by default. The end-to-end analysis workflow is not
yet connected to this new scaffold.

## Envisaged features in the final app

These are product goals, not all implemented features of this PoC.

- Input immunoglobulin sequences through a web interface: either pasting into a text box or uploading a FASTA file.
- Select a reference database for the IgBLAST analysis or provide their own reference sequences
- Perform IgBLAST analysis on the submitted sequences.
- Visualize the analysis results in an intuitive and interactive manner.
- Download analysis results as AIRR TSV in the PoC; the original CSV goal is not implemented.
- Support for offline usage as a PWA.
- Responsive design for use on various devices, including desktops, tablets, and smartphones.
- The app should be capable of handling large files (e.g. several 10s of MBs) and i/o should have comparable throughput to that of a desktop app
- Limitations of the user's computer are understood and accepted.

## Workflow

The workflow is as outlined in [this walkthrough](https://williamdlees.github.io/receptor_utils/_build/html/airrc_sets_with_igblast.html#airrc-sets-with-igblast). Docker/Singularity is not required however: the tools should be compiled and available within the PWA app itself.

Specific steps:

- input immunoglobulin sequences through the web interface, either by pasting into a text box or uploading a FASTA file.
- download a selected germline reference set from OGRDB using receptor_utils download_germline_set utility or associated OGRDB API. 
- make the required reference set databases using the NIH tool makeblastdb
- annotate the input sequences using the NIH IgBLAST tool with the prepared reference databases.
- download the analysis results in AIRR-C csv format.

## Aims for this proof of concept

Demonstrate the feasibility of the PWA app by creating a minimal working prototype. Specific aims:
- Verify that the NIH makeblastdb and igblast tools can be successfully compiled and executed within the PWA environment.
- Ensure that input and output operations can be performed efficiently within the PWA environment.
- Confirm that python libraries such as receptor_utils can be successfully imported and utilized within the PWA environment.

## Resources

- [IgBLAST Documentation](https://www.ncbi.nlm.nih.gov/igblast/)
- [NIH Github Repository](https://github.com/ncbi/ncbi-cxx-toolkit-public)
- [receptor_utils Documentation](https://williamdlees.github.io/receptor_utils/)
- [receptor_utils GitHub Repository](https://github.com/williamdlees/receptor_utils)
- [OGRDB API Documentation](https://ogrdb.airr-community.org/api/)

