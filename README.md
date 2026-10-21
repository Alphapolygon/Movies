# WhatToWatchNext - updated movies.zip

This is the upgraded **original WhatToWatchNext application from `movies.zip`**.
It retains live TMDB movie/TV discovery through your existing Cloudflare proxy.
The separate After Credits HTML supplies personal collection data; it is not the
application being shipped or a replacement homepage.

## Start locally

On Windows, extract the ZIP to a folder and double-click **`start.cmd`**, then open
**http://127.0.0.1:8000**. The launcher uses Node when present, or the Windows Python
launcher as a fallback. Keep the terminal open while using the site.

With Node 20 or newer:

```sh
npm start
```

There are no npm dependencies and no build step. `npm install` is not necessary.
A Python alternative, run from this folder, is:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Serve the folder over HTTP; do not double-click `index.html`. The application uses
ES modules and loads its bundled JSON data. The local server binds to the loopback
address, so it is not a phone-accessible network server or a production host.
Use your HTTPS-hosted site to access it from both phone and desktop.

## What is included

| Area | Functionality |
| --- | --- |
| Discover | Live movie/TV browsing, genre/decade/service filters, regional availability, sort order, reliable pagination. |
| Search | Movies, TV shows, actors and directors; keyboard-accessible suggestions and exact person links. |
| Title details | Synopsis, credits, related titles, trailers, IMDb/TMDB links, and subscription/free/ad-supported/rental/purchase options. |
| For you | 210 unique editorial recommendations from the supplied HTML, searchable by title/year/reason/note, with mood and source filters. |
| Watchlist | 148 imported saved titles initially, plus titles you save in this app. Remove entries, set priorities, switch grid/list layouts, or pick an unwatched title. |
| Seen | 2,452 imported ratings, plus watched states and half-star ratings you add here. |
| Personal tools | Notes, priorities, watched/unwatched controls, filtered random picker, and confirmed JSON backup import/export. |
| Interface | Desktop navigation, mobile bottom navigation, responsive cards/dialogs, visible keyboard focus, reduced-motion handling, and no runtime CSS/font/icon CDN. |

The 148 watchlist titles are **a subset of the 210 recommendations**, not another
148 recommendations on top. The source contains 211 recommendation rows: the two
2016 names for *A Silent Voice* are merged into one title. Editorial reasons are
preserved as supplied, not recomputed or presented as algorithmic match scores.

### Posters and live matching

The HTML does not contain TMDB IDs, poster paths, or reliable movie/TV types.
Imported entries therefore start with designed text covers, not guessed posters.
Use **Load posters** to resolve only the currently displayed batch, or open a title
and use **Find on TMDB**. One exact normalized title/year match can be linked
automatically; ambiguous editions require a choice. Movie and TV identities are
kept separate. A failed lookup leaves the imported title and its personal data intact.

Resolution depends on the proxy/API being reachable. The lookup is conservative:
translated titles and different release-year conventions may need manual selection.
No actual poster images are bundled for these imported titles.

## Your saved data

Changes are local to this browser and origin. They are not sent to Letterboxd,
TMDB account endpoints, or a cloud-sync service. Phone and desktop have separate
state: use **Settings & backups -> Export backup / Import backup** to transfer it.

An export includes title records and their saved/watched/rating/priority/note state,
even for the original imported defaults. It can restore that personal state without
the original seed file. Editorial recommendation reasons and curation continue to
come from `data/library.json`; a backup is not a complete replacement for that file.
Import previews are validated before confirmation. A confirmed merge applies the
imported state to matching titles and keeps unrelated existing titles.

On the same origin as the old app, `my_watchlist`, `userRegion`, and
`hide_unavailable` are migrated. Original storage keys are retained as a recovery
copy. An optional older `aftercredits_saved` queue is imported only when it exists
on that same origin. A different port, hostname, protocol, device, or browser does
not automatically share those values. Do not clear the old site's browser data
before exporting or checking migration.

Invalid or blocked browser storage produces a warning rather than stopping the
site. When saving fails, changes are temporary: export a backup before closing.
Cross-tab updates are supported, but this is last-update-based local storage, not a
transactional multi-user database. Keep backups for valuable notes.

## Publish on your existing static host

Upload **the complete runtime folder**, including `js/`, `data/`, `style.css`,
`sw.js`, the manifest, and icon files. Tests and Markdown documentation need not be
published. Relative asset paths support a project subfolder, as used by GitHub Pages.
Do not upload only `index.html`.

The original proxy URL remains configured in `js/config.js`. This package contains
no proxy backend and changes no deployed Cloudflare settings. Your worker must allow
the website origin and the requested TMDB read endpoints. If the proxy URL changes,
update **both** `API_BASE` and the `connect-src` allowlist in `index.html`.
No API token is embedded in this package. Keep upstream credentials on the server.

The original ZIP's `CNAME` contained only whitespace and is omitted. Retain your
host's existing real custom-domain configuration; do not invent a domain value.

**Privacy before publishing:** `data/library.json` contains your imported ratings
and collection. Publishing that file makes those records accessible to visitors.
This is a personal static site, not private account storage. Notes added later stay
in that browser unless exported/shared. Live searches and metadata requests go to
your proxy; posters and trailers contact their respective external services.

### Offline behavior and updates

A service worker is included to cache the application shell and bundled personal
library after a successful installation on HTTPS or localhost. It deliberately does
not cache live API responses or provider availability. Remote posters and trailers
still require their services. The offline installation flow is **not browser-verified
in this delivery**; see `TEST_REPORT.md`.

On each future deployment, increment the `CACHE` version in `sw.js` when changing
runtime assets. The worker does not force an update into a running editing session.
Close all site tabs and reopen after deploying. If diagnosing an old cached build,
remove only the service worker/cache in browser developer tools; do not clear local
storage without first exporting your personal data.

## Development and tests

```sh
npm run check
npm test
```

The zero-dependency Node suite tests identity, validation, API coordination, filtering,
migration, persistence failures, and backup recovery. For browser scenarios:

```sh
python -m pip install playwright
python -m playwright install chromium
# In another terminal: npm start
python tests/browser_tests.py
```

The browser suite uses deterministic API fixtures, not real recommendations or live
TMDB data. `--chromium /path/to/chromium` selects a browser executable. In a locked-down
runner that disallows HTTP navigation, `--in-memory` tests the app's ES modules and
CSS in a DOM harness. **That fallback is the browser mode actually run here**;
it does not verify hosted HTTP, CSP, native browser storage, or service workers.

Read `CODE_REVIEW.md` for original findings and fixes, and `TEST_REPORT.md` for exact
coverage and remaining deployment checks. Screenshots in `tests/results/` include
personal-pick layouts and an explicitly named discovery-fixture screenshot.

## Layout

```text
index.html          Semantic shell, dialogs, CSP, original app branding
style.css           Self-contained responsive design
js/app.js           Views, routing, UI actions and title resolution
js/api.js           Bounded requests, cancellation, cache and errors
js/core.js          Pure identity, validation, URLs, filters and routing
js/store.js         Personal library, legacy migration and portable backups
js/config.js        Existing proxy URL and bounded-work defaults
data/library.json   Imported recommendations, watchlist and ratings
sw.js               Versioned same-origin shell cache
site.webmanifest    Relative install metadata and original icon assets
tools/serve.mjs      Zero-dependency loopback development server
tests/              Node tests and Chromium UI scenarios
```

Movie/TV metadata uses TMDB. Provider information is attributed to JustWatch via
TMDB in the interface. This application is not endorsed or certified by TMDB.
