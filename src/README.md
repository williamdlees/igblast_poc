# Application source

Keep browser UI and orchestration code here. As the workflow is implemented,
separate worker entry points, workflow coordination, reference handling,
storage adapters and IgBLAST-specific code into `workers/`, `workflow/`,
`references/`, `storage/` and `igblast/` respectively. Keep the application
independent of the archived Stage 5 harness in `research/tools/stage5/`.

The current `main.js` is only an application-shell entry point; no analysis
workflow or offline service worker is implemented yet.
