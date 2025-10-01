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
- Front-end controls to re-parse all stored XML, download & parse specific versions, and redownload stale
  raw XML snapshots when they are more than a month old.

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
├── data/
│   ├── raw/     # Raw XML snapshots downloaded from the eCFR
│   └── parsed/  # Parsed JSON datasets generated from the XML snapshots
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

The backend persists two artifacts for each stored date:

- `data/raw/ccl-<DATE>.xml`: the unmodified XML snapshot returned by the eCFR API.
- `data/parsed/ccl-<DATE>.json`: the parsed dataset consumed by the client application.

Both directories are committed to the repository so that deployments start with a known dataset and do
not require the client to download large XML payloads. The settings page in the UI can re-parse the stored
XML, download additional versions, and redownload XML snapshots that are more than 30 days old.

> **Note:** The repository includes a sample dataset for `2024-01-01` generated from a minimal XML snapshot
> so the application can demonstrate the new storage flow without requiring immediate network access. Run
> the settings page actions or call `loadVersion` on the server to populate additional dates from the live
> eCFR service.

## Environment variables

- `PORT` (optional): override the Express server port (default `4000`).

## License

This project is provided under the MIT License. See [LICENSE](LICENSE) for details.
