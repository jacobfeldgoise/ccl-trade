# Commerce Control List Explorer (Client)

This Vite + React application presents the ECCN-focused view of the Commerce Control List data
produced by the backend service. It provides controls for selecting stored CCL versions, switching
between relevant supplements, filtering ECCNs, and drilling into each ECCN's hierarchical
structure.

## Available scripts

All commands should be executed from the repository root:

- `npm run client` – start the Vite development server with hot module replacement.
- `npm run build` – generate a production build of the client.
- `npm run lint --prefix client` – run ESLint using the flat configuration shipped with the project.

## UI highlights

- Supplement selector focused on Supplements No. 1, 5, 6, and 7 to Part 774.
- ECCN list with quick filtering by code or title.
- Detail pane showing ECCN metadata (category, group, contextual breadcrumbs) and a collapsible
  tree of nested paragraphs and notes.
