# WhatToWatchNext - validation report

**This report covers the updated original `movies.zip` project.** It does not cover
the earlier, incorrect standalone After Credits replacement.

## Executed validation

| Check | Result | Evidence |
| --- | --- | --- |
| JavaScript syntax | Passed for the application modules. | `npm run check` |
| Node unit/regression suite | **50 passed; 0 failed.** | `npm test`; `tests/results/node-tests.txt` |
| Chromium UI/layout suite | **25 passed; 0 failed.** | `tests/results/browser-results.json` and `browser-tests.txt` |
| Responsive viewport cases | 320, 375, 390, 768, 1024 and 1440 CSS pixels wide. | Six independent browser scenarios, including horizontal-overflow and dialog-bound checks. |
| Imported catalogue invariants | 210 recommendations; 148 initially saved; 2,452 ratings; 2,662 unique keys. | Seed invariant test and package checks. |
| Original binary assets | Retained without byte changes. | `tests/results/package-checks.json` |
| Static package/HTTP checks | Runtime assets, MIME types, module paths, local HTML and manifest references, no inline event handlers. | `tests/results/package-checks.json` |

The final rerun reached the runner wall-clock limit after 18 passing scenarios.
The remaining seven were executed in fresh browser instances and passed; the combined
JSON report contains all 25 independently executed results. No missing result was inferred.

The Chromium suite was run on Linux in **in-memory ES module UI harness mode**,
not by loading the normal hosted site. This distinction is important.

## Browser execution boundary

The runner's managed browser policy blocked ordinary page navigation, including
localhost and file URLs. The original Cloudflare API host also could not be reached
from this environment. A local Node server successfully served files to non-browser
HTTP checks, but that is not browser-based integration validation.

The fallback browser host loads the actual shipped HTML structure and CSS into a
Chromium DOM. It executes the actual app/core/API/store/config ES modules through
Blob URLs, rewrites only module imports and `import.meta.url` for that host, and
provides deterministic API fixtures plus a Storage-compatible in-memory adapter.
The fixture responses are explicitly test data and are not shipped as live movie data.

This exercises native DOM events, responsive CSS, dialogs, keyboard behavior,
application routing, API coordination and state transitions. However, it removes the
page CSP to allow Blob modules and cannot verify browser-origin storage or normal
HTTP delivery. In particular, these are **not verified** by that run:

- The deployed CSP, CORS, module delivery and real Cloudflare/TMDB responses.
- Real YouTube playback, real poster loads or up-to-date streaming availability.
- Native browser localStorage persistence/migration and service-worker installation,
  offline reload, update activation or home-screen installation.
- Safari/iOS, Firefox, physical Android/iPhone devices or actual touch keyboards.
- Screen-reader usability, WCAG conformance, Lighthouse metrics or production load.

The viewport results are real Chromium CSS/layout checks, not physical-device tests.
State persistence scenarios reinitialize the application against the same storage
adapter; they are not proof of persistence across a real-origin browser restart.

## Node regression coverage

Identity and safety: movie/TV numeric ID collisions, remakes, Unicode normalization,
the explicit source alias, unsafe URL schemes/hosts, image path validation, malformed
items, immutable sorting and safe route round-trips.

Discovery and availability: correct TV/movie date parameters, nonadjacent decade
selection, future bounds, provider alternatives, streaming/free/ads versus rental/buy,
region isolation, missing provider data versus an empty valid result, conservative
exact candidate selection and all shipped data counts.

API coordination: bounded FIFO work, queued abort, same-view request sharing,
isolation between cancellation scopes, HTTP/JSON errors, timeout, cache expiry and
cache-size limits. All API behavior uses mocked responses.

Personal state: old watchlist migration, preserving recovery keys, persistent removal
of imported defaults, corrupt/blocked storage, ratings/notes, watched overrides,
metadata linking and conflicts, validated all-or-nothing imports, cross-tab merges,
settings, and restoring a portable backup without its seed catalogue.

## Chromium scenarios

There are six viewport scenarios plus nineteen interaction scenarios. They cover
movie/TV discovery parameters, failed-page retry/end-of-list behavior, local pagination,
saved-item removal/reinitialization, literal note text and ratings, typed-ID collisions,
detail/director/TV navigation and Back restoration, stale search responses, hostile
search text, keyboard autocomplete, region/provider mode changes, watchlist visibility,
trailer fallback/close cleanup, exact/ambiguous imports, a 24-title enrichment bound,
filtered nonrepeating picks, corrupt storage, remote failure fallback, confirmed backup
merge/export, dialog focus handling, and cross-tab storage events.

`browser-results.json` names every executed scenario. The suite fails on unexpected
uncaught page errors. This is broad regression coverage, not exhaustive path coverage.

## Screenshot evidence

- `tests/results/personal-picks-1440.png`: actual imported personal recommendations,
  desktop viewport; text covers are the intentional unresolved-metadata fallback.
- `tests/results/personal-picks-390.png`: the same local catalogue, phone-width viewport.
- `tests/results/discovery-desktop-fixtures.png`: the live-discovery interface with
  explicitly artificial movie fixtures; not evidence of a successful live API call.

## Reproduce the tests

```sh
npm run check
npm test
python -m pip install playwright
python -m playwright install chromium
npm start
# In a second terminal, normal-origin fixture suite:
python tests/browser_tests.py
```

In a runner with the same navigation restriction:

```sh
python tests/browser_tests.py --in-memory
```

The default browser suite intercepts external API calls with fixtures even in normal
HTTP mode. A successful fixture run must not be reported as a live-provider test.

## Hosted acceptance pass still needed

After uploading the complete runtime folder, open the actual HTTPS origin on desktop
and a phone. Check movies and TV, genres/providers, a title's cast/director links,
trailer playback/fallback, and a failed-request retry. Compare availability against the
provider before treating it as reliable.

Save a movie and a TV show; reload, reopen the browser, and check notes/ratings and
removal of an imported default. Verify the old site's same-origin watchlist migration
before clearing its storage. Export on one device, import after confirmation on another,
and check both positive saves and removals. Finally verify offline reload after the
worker installs, then deploy a bumped worker cache version and test the update flow.

All known residual validation gaps are stated here rather than reported as passes.
