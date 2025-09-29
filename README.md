# Commerce Control List Explorer

This project provides a React web application and supporting Node.js service for downloading,
parsing, storing, and visualizing the U.S. Commerce Control List (CCL) contained in 15 CFR
§ 774. The backend retrieves full title data from the eCFR API, extracts the ECCN listings
contained in Supplements No. 1, 5, 6, and 7 to Part 774, and caches the processed structure locally
so that multiple historical versions can be browsed offline.

## Features

- Fetch any historical CCL version by date (YYYY-MM-DD) using the public eCFR API.
- Cache each parsed version to a local JSON file for fast reloading.
- Parse and organize ECCNs (Export Control Classification Numbers) with their nested paragraphs,
  notes, and supporting metadata.
- Summaries showing when each version was stored, which supplements were parsed, and how many
  ECCNs were captured.
- Front-end controls to reload cached versions, refresh the latest version, or download new ones on demand.

## ECCN data model

Each cached dataset stores the targeted supplements, the ECCNs they contain, and a hierarchical
representation of every ECCN's subparagraphs. Supplement metadata includes category counts so you
can quickly see which portions of the list are populated in a given version. The client provides a
supplement selector, ECCN filtering, and a nested viewer for drilling into each ECCN's detailed
structure.

## Project structure

```
.
├── client/   # Vite + React front end
├── server/   # Express service responsible for fetching and parsing CCL data
├── data/     # Local cache directory for parsed CCL JSON files (ignored by git)
└── README.md
```

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development servers (runs the Express API on port 4000 and the Vite dev server with proxying):

   ```bash
   npm run dev
   ```

   The React app will be available at `http://localhost:5173`. API requests to `/api/*` are proxied to the Express backend.

3. Build the front end for production:

   ```bash
   npm run build
   ```

   The Express server is configured to serve the compiled assets from `client/dist` when present.

## Data caching

The backend stores parsed versions in `data/ccl-<DATE>.json`. The directory is created automatically
and ignored by git, but a `.gitkeep` file is committed so the folder exists in the repository.

## Environment variables

- `PORT` (optional): override the Express server port (default `4000`).

## License

This project is provided under the MIT License. See [LICENSE](LICENSE) for details.
