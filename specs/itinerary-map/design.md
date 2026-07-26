# Itinerary Map — design

## Structure

Single view, no wizard steps.

```
┌──────────────────────────────────────────┐
│  spa-title-box (attached to tab bar)     │
│  (error + retry)  |  (loading progress)  │
│  [Itinerary ▾]  (only if >1 itinerary)   │
│  (non-blocking "N skipped" warnings)     │
│  (non-blocking "POI table not found")    │
│  [ Map ] [ Story ]  ← view toggle         │
├───────────────┬───────────────────────────┤  Map view (default):
│  Sidebar       │  Map                     │
│  Stops (N)     │  [1]---[2]---[3]         │
│  1. Stop A     │   (numbered markers,     │
│  2. Stop B     │    dashed polyline)      │
│  ...           │  📍 📍 📍                 │
│  POIs (M)      │   (pin markers, NOT      │
│  📍 POI X      │    connected by a line)  │
│  📍 POI Y      │                          │
└───────────────┴───────────────────────────┘

┌──────────────────────────────────────────┐  Story view (alternative):
│                          [Export Markdown]│
│  Overview map (all stops + all POIs)     │
├───────────────────────┬───────────────────┤
│  [1] 🏨 Stop A         │  Stop A → Stop B  │
│      (city, 🇫🇷 country)│  [mini leg map]   │
│      type                │  (2 markers +    │
│      Check-in/out        │   leg's POIs)    │
│      flags / booking     │                  │
│      │ 📍 POI (nested)   │                  │
├───────────────────────┴───────────────────┤
│  [2] 🏨 Stop B — ...  (last stop: full     │
│      ...               width, no leg map)  │
│  Other points of interest (unmatched)    │
│      📍 POI                               │
└──────────────────────────────────────────┘
```

## State shape

```js
const state = {
  loading:            true,
  error:              null,   // string | null

  itineraries:        [],     // distinct, sorted, non-empty "itinerary" values across both tables
  selectedItinerary:  requestedItinerary,  // seeded from ?itinerary= (see "Deep link from Home" below); "" = none requested / no itinerary field present anywhere (show everything)

  allAccommodations:  [],     // all accommodation records with valid coords (any itinerary)
  allPois:            [],     // all points-of-interest records with valid coords (any itinerary)

  stops:              [],     // allAccommodations filtered to selectedItinerary, sorted by check-in-date
  pois:               [],     // allPois filtered to selectedItinerary, sorted by planned-date

  skippedCount:       0,      // accommodations excluded for missing/invalid coordinates (global, not per-itinerary)
  skippedPoiCount:    0,      // points of interest excluded for missing/invalid coordinates (global)
  poiTableMissing:    false,  // true if no points-of-interest table could be resolved (non-blocking)

  activeIndex:        null,   // index into state.stops, for sidebar<->map highlight
  activePoiIndex:      null,  // index into state.pois, for sidebar<->map highlight

  viewMode:           "map",  // "map" | "story" — which alternative view is shown below the toolbar
};
```

Each entry in `stops`/`pois` (and their `all*` counterparts) is the raw WorkTable record plus two derived numeric fields: `__lat`, `__lng` (parsed once at load time).

`skippedCount`/`skippedPoiCount` are computed once across **all** loaded records (before itinerary filtering), not recomputed per itinerary — switching itineraries does not change these counts, since they describe data-quality issues in the source tables, not the current view.

## Tables involved

| Operation | WorkTable table |
|---|---|
| Resolve both table names | `client.tables({ metadata: "1" })` — single call, matched twice against the returned list |
| List accommodation records | `client.table(<resolved accommodations name>).list({ size: 9999 })` |
| List point-of-interest records | `client.table(<resolved POI name>).list({ size: 9999 })` — only if a POI table was resolved |

Both table names are resolved at runtime from `client.tables()` metadata (`short_title`, case-insensitive regex), never hardcoded — same rationale as before: avoids coupling to the underlying DB table identifier. Regexes:

```js
/accom+odation/i                        // matches "Accomodations" and "Accommodations"
/points?[\s-]*of[\s-]*interest/i        // matches "Point(s) of Interest", "points-of-interest", etc.
```

The points-of-interest table is **optional**: if not found, `state.poiTableMissing = true`, `allPois = []`, and the rest of the view behaves exactly as before points-of-interest support existed. Only the accommodations table is required (its absence is a blocking error, per UC-ITIN1 extension 1a).

## Payload / column usage

### Accommodations (unchanged from the original single-itinerary version)

`latitude`/`longitude` gate inclusion; `check-in-date` is the sort key; `property-name`/`city`/`country`/`accommodation-type`/`address`/`breakfast-included`/`parking-included`/`booking-platform`/`booking-reference` feed the marker/sidebar/popup/Story card. `itinerary` (optional) is read for grouping — see below. `notes` is **not used** (deliberately removed — see "Notes removed" below).

### Points of interest (new)

| Column | Usage |
|---|---|
| `latitude`, `longitude` | Parsed with `Number(...)`; record excluded if either is not finite (same helper as accommodations) |
| `itinerary` | Grouping key, same semantics as on accommodations |
| `planned-date` | Sort key for the POI list (via `Date.parse`); shown in sidebar and popup |
| `name`, `city` | Marker/sidebar/popup label |
| `category` | Popup subtitle |
| `description`, `address` | Popup body |
| `duration` | Popup line, shown verbatim (no unit assumptions) |
| `price` | Not used (deliberately excluded from popup, Story view, and Markdown export — no cost/price display anywhere in this SPA) |
| `booking-required`, `kid-friendly` | Popup tags via `isTruthyFlag()` (same truthy-string helper as accommodations) |
| `priority` | Popup line, shown verbatim (no assumed value domain — could be text or a number) |
| `linked-accommodation` | Popup line, shown verbatim as free text (not resolved/joined against the accommodations table); also the primary POI-to-stop matching key in Story view (see below) |
| `notes` | Not used (deliberately removed — see "Notes removed" below) |
| `id`, `id2` | Not used |

### Itinerary grouping (both tables)

`itinerary` is read as a plain string, trimmed; empty/missing values are not counted as a distinct itinerary. `state.itineraries` is the union of distinct non-empty values from both tables, sorted alphabetically (`localeCompare`). If `state.itineraries` is empty (column absent or empty on every record, in both tables), every loaded record is shown — the feature is fully backward compatible with a table that has no `itinerary` column at all.

No data is ever written back — this SPA only calls `client.tables()` and `client.table(...).list(...)` (on up to two tables).

## Classification logic

Not applicable (no status/classification derivation). The one categorical distinction — accommodation vs. point of interest — is expressed purely through marker shape/color and separate sidebar sections, not through any computed status.

## Other technical notes

- **Single load, client-side re-filter on itinerary change**: `loadAll()` fetches *all* records from both tables once (regardless of itinerary) and computes `state.itineraries` from that full set. Switching the itinerary dropdown (`onItineraryChange`) only re-runs `applyItineraryFilter()` (a pure in-memory filter + sort) and re-renders/re-initializes the map — it does not re-call the WorkTable API. This keeps itinerary switching instant and avoids the "async render safety" concerns a second network round-trip would introduce.
- **Map library**: unchanged — Leaflet 1.9.3 via CDN, see previous revision of this doc / AGENTS.md precedent.
- **Two marker styles**: accommodations use the existing numbered circular `divIcon` (blue, red when active). Points of interest use a new teardrop/pin-shaped `divIcon` (green, red when active) with a Remix Icon glyph (`ri-map-pin-2-fill`) inside — built with the classic CSS trick `border-radius:50% 50% 50% 0; transform:rotate(-45deg)` (and the inner icon counter-rotated) rather than an image asset, consistent with "no new asset pipeline" for this plugin.
- **POIs are not part of the polyline**: only `state.stops` coordinates feed `L.polyline(...)` (and only when there are 2+ stops, to avoid drawing a degenerate single-point "line"). POI markers are added independently. This was a deliberate choice (see UC-ITIN1) to avoid conflating "where you sleep" (a chronological route) with "things to do" (which may cluster on the same day/city and aren't naturally a single ordered path).
- **`fitBounds` covers both layers**: the map's initial bounds are computed from the union of accommodation and POI coordinates, so both layers are visible on load even if one is empty.
- **Independent highlight state**: `state.activeIndex` (accommodations) and `state.activePoiIndex` (points of interest) are separate — selecting a stop does not affect POI marker styling and vice versa. `refreshIcons()`/`refreshPoiIcons()` are two small, separate functions rather than one parameterized one, matching the "explicit over generic" guidance for this plugin.
- **`<select>` for the itinerary dropdown**: follows the AGENTS.md rule for dynamic `<select>` — every `<option>` uses `?selected=${...}`, never a `.value` binding on the `<select>` itself, since the option list is populated asynchronously after load.
- **Deep link from Home**: `state.selectedItinerary` is seeded at module load from `new URLSearchParams(location.search).get("itinerary") || ""` (see `app-home.js`'s itineraries box, which links to `?dashboard=itinerary-map&itinerary=<name>`). No extra branching was needed: `loadAll()`'s existing fallback — `if (!itineraries.includes(state.selectedItinerary)) state.selectedItinerary = itineraries[0] ?? ""` — already covers both "requested name matches a loaded itinerary" (kept as-is) and "doesn't match / nothing requested" (falls back to first alphabetically, or `""` if the itinerary set is empty).
- **Map re-init**: unchanged — `initMap()` still fully removes and recreates the Leaflet map instance on every load/itinerary-change, rather than diffing markers in place.
- **Async render safety**: unchanged — the module-level `cancelled` flag pattern from AGENTS.md, checked after each `await` inside `loadAll()`.

## Story view

An alternative to the map, added as a `state.viewMode` toggle ("map" | "story") rather than a separate SPA/tab — it reuses `state.stops`/`state.pois` (already loaded and itinerary-filtered) with no extra network calls. Only Map view renders `#itin-map-container` and calls `initMap()`; switching back to Map from Story re-calls `initMap()` (guarded, same as `onItineraryChange`), since the container element is removed from the DOM (and the Leaflet instance with it) while Story is shown.

### POI-to-stop assignment (`computeStoryGroups()`)

Pure function of `state.stops`/`state.pois`, recomputed on every render (small datasets, no memoization needed). For each stop, in chronological order:

1. A POI matches if its `linked-accommodation` (trimmed, case-insensitive) equals the stop's `property-name`.
2. Otherwise, a POI matches if its `planned-date` falls within the stop's `check-in-date`/`check-out-date` range (inclusive). Skipped if the stop lacks a parseable check-in *and* check-out date.
3. Each POI is assigned to at most one stop, in stop order (first match wins) — a `Set` of matched POI indices prevents a POI from being listed twice.
4. POIs matched by neither rule (for any stop) are collected separately (`leftoverPois`) and rendered under "Other points of interest" — per UC-ITIN1 extension 4a, never silently dropped.

This assignment is **display-only**: it does not change `state.pois`, the map's POI markers, or the sidebar — those remain independent of Story view's grouping.

### Rendering

- `StoryStopEntry(stop, pois, index)` — one card per stop, numbered the same as the map's markers (`index + 1`), reusing the same fields as `popupHtml()` (name/place label, type, dates, flags, booking) but as lit-html (not the raw HTML string `popupHtml()` needs for Leaflet's `bindPopup`).
- `StoryPoiEntry(poi)` — one entry per POI, reusing the same fields as `popupHtmlPoi()` (name, planned date, description, booking-required/kid-friendly flags), nested under its assigned stop or under "Other points of interest".
- Both **revive** the `itin.popup.checkin`/`itin.popup.checkout` i18n keys, which existed since the original single-itinerary version but had no caller (the map popup only ever showed the check-in/check-out range without labels).
- New i18n keys: `itin.view.map`, `itin.view.story` (toggle button labels), `itin.story.otherPois` (trailing section heading), `itin.story.btn.export` (Markdown export button).

### Stop label: place, then name (`stopLabel()`)

Every stop reference in Story view (card heading, leg-map caption) puts city/country **first**, then the accommodation's own name on the line below — place is what usually matters for getting oriented on a multi-stop trip, the property name is secondary:

```
City, 🇫🇷 Country
🏨 <property-name or city>
```

- `stopPlace(stop)` builds `"City, [flag ]Country"` (omits either part if empty) — shared by `stopLabel()` and the Markdown/PDF heading construction below.
- `stopLabel(stop)` — lit-html version, used in `StoryStopEntry()` and `LegMapBlock()`: `${place}<br>` followed by a leading `ri-hotel-line` icon + name (place line omitted entirely if `stopPlace()` is empty).
- **Markdown/PDF headings build the same two lines directly** rather than through a shared text-producing function: a `stopLabelText()` combining both into one string existed in an earlier revision, but a single-line heading can't represent "place, then name on its own line" in either Markdown (a `##` heading is one line; embedding a raw newline would prematurely end it) or the PDF (`parts` entries are already discrete lines, no need to force two lines into one string). Both `buildMarkdown()` and `buildPdf()` now push `stopPlace(stop) || <name>` as the heading, then (only if `place` was non-empty, i.e. there's actually a second thing to say) `<name>` again as its own bold line right below.
- The accommodation-type line under the heading no longer repeats city/country (that's now in the heading) — it shows only `accommodation-type`, omitted entirely if empty.

### Country flag (`countryFlag()`)

Resolves a country **name** (as stored in the `country` column, e.g. `"France"`) to its flag emoji, with **no hardcoded name→flag table**:

1. Enumerates a static `ISO_REGION_CODES` list of ISO 3166-1 alpha-2 codes. Note: `Intl.supportedValuesOf("region")` does **not** exist — `"region"` is not one of the standardized keys (`calendar`, `collation`, `currency`, `numberingSystem`, `timeZone`, `unit`); an earlier revision of this code assumed otherwise and threw `RangeError: Invalid key: region` at runtime. The static code list is the workaround — it's a list of *codes* (stable, ISO-standard, low-maintenance), not a hand-written name→flag mapping.
2. Resolves each code's English display *name* via `Intl.DisplayNames(["en"], { type: "region" })` (this part of `Intl` is standard and does work) — wrapped in try/catch per code since not every code is guaranteed to resolve in every environment.
3. Builds a `name → code` `Map` once (module-level cache), matched case-insensitively against `stop.country`.
4. Converts the resolved 2-letter code to its flag emoji via Unicode Regional Indicator Symbols (`code point 127397 + charCode`).

If `Intl.DisplayNames` is unavailable, or the country string doesn't match a recognized English region name, returns `""` (no flag) — a deliberate "safe conservative default" (never guess/show a wrong flag) rather than a best-effort heuristic.

### Notes removed

`stop.notes`/`poi.notes` are **not read or displayed anywhere** in this SPA (map popups, Story view, Markdown export) — removed after a real record's free-text Notes field turned out to contain cost/booking-status information (e.g. `"Free cancellation, Confirmed, EUR 475"`) that shouldn't be surfaced on the map/story views. Since Notes is unstructured free text, selectively stripping only the cost-looking part was rejected as fragile string-parsing; the whole field was dropped instead. The `itin.popup.notes` i18n key was removed as it became unused. If Notes needs to come back later, the right fix for cost-specific data is editing the source record, not re-introducing blanket Notes display.

### Story view maps (overview + one mini-map per leg)

Two more Leaflet layers are added to Story view, both reusing already-loaded, itinerary-filtered `state.stops`/`state.pois` (no extra network calls):

- **Overview map** (`StoryOverviewBlock()` / `#story-overview-map`, full width, top of Story view): same content as the Map view's map (all stops numbered + polyline, all POIs), without the sidebar.
- **One mini-map per leg** (`LegMapBlock()` / `#story-leg-map-{i}`, one per pair of consecutive stops, `groups.length - 1` total): shows only that leg's two stop markers (numbered `i+1`/`i+2`) connected by a line, plus the points of interest already assigned (via `computeStoryGroups()`) to **either** endpoint stop — i.e. `[...groups[i].pois, ...groups[i+1].pois]`, not a separate date-window rule. POIs in "Other points of interest" (unmatched to any stop) never appear on a leg map.
- **Layout**: each stop's card and its following leg's mini-map are placed side by side in a Bulma `columns` row (`is-7`/`is-5`) rather than stacked — the last stop (no following leg) takes the full row width (`is-12`).
- **Lifecycle**: `initStoryMaps()` builds the overview map and all leg maps (guarded by `state.viewMode === "story"`, called via `setTimeout(..., 0)` after `mount()` so containers exist); `destroyStoryMaps()` removes the overview map instance and all leg map instances, tracked in `storyOverviewMap` / `storyLegMaps[]`. Called symmetrically to the single map's `leafletMap`: destroyed+rebuilt on itinerary change (while in Story mode) and on toggling away from Story to Map.
- `osmTileLayer()` factors out the OSM tile layer definition (previously duplicated inline in `initMap()`), now shared by the main map, the overview map, and every leg map.
- The Markdown export does **not** include these maps (or any image) — `buildMarkdown()` remains text-only. The PDF export (below) does embed map images; Markdown was deliberately left as-is (see "Unknowns").

## PDF export (jsPDF + OpenLayers map images)

A second export button, next to "Export Markdown", builds a multi-page PDF with `jsPDF` (loaded from CDN on first use, same lazy-load pattern as Leaflet — see `loadJsPdf()`). Unlike the Markdown export, this one **does** include map images, rendered via a temporary off-screen OpenLayers map (`renderStaticMapDataUrl()`, `loadOpenLayers()` — OpenLayers loaded from CDN, `ol@7.5.2`).

### History — four attempts, in order

1. **Public static-map service**: fetched images from `staticmap.openstreetmap.de`. Turned out to be unreachable — verified directly (a bare `<img src>` to it fails to load). Since `addMapImage()`'s failure handling is deliberately silent (a missing map image must not block the rest of the PDF), this produced a PDF with all text but zero maps and no visible error.
2. **Hand-rolled canvas tile-stitcher**: fetched OSM tiles (`tile.openstreetmap.org`, confirmed CORS-enabled) through a server-side proxy+cache in `api/handlers.inc.php` (per OSM's tile usage policy — custom User-Agent, shared cache) and stitched them onto a `<canvas>` by hand, with our own Web Mercator projection math (`lonToTileX`/`latToTileY`), zoom-fit loop, and manually-drawn markers/route/labels. Two bugs found in the field here:
   - The proxy's `curl_exec()` failed server-side (`502`), most likely `SSL certificate problem: unable to get local issuer certificate` — a common local-Windows-PHP issue with no CA bundle configured. Fixed in place at the time (shorter timeouts, SSL verification disabled for this specific low-sensitivity public resource, real `curl_error()` surfaced in the response) — now moot, since step 4 removed the proxy entirely.
   - **Critical**: Web Mercator is undefined at the poles (`Math.tan()`/`Math.cos()` → ±Infinity as latitude → ±90°). A single bad-latitude record made our own `latToTileY()` return `±Infinity`, which turned the tile-bounds loop into a **true infinite loop** (`for (let ty = Infinity; ty <= Infinity; ty++)` — `Infinity <= Infinity` is `true` in JS, and `Infinity + 1 === Infinity`), exhausting memory until the browser tab crashed ("Out of Memory"). This is exactly the class of bug a hand-rolled projection is prone to and a mature mapping library (step 4) has already had to solve properly.
3. **Screenshot the live Leaflet map**: tried two screenshot libraries, both failed on live testing before any code was written against them — `leaflet-image`'s callback never fires (effectively abandoned, incompatible with Leaflet 1.9.x); `html2canvas` renders our `divIcon` markers correctly but paints Leaflet's tiles as flat gray (confirmed via pixel sampling: tiles fully loaded, `crossOrigin` set correctly, still blank — a documented incompatibility between html2canvas and Leaflet's CSS `translate3d`-transformed tile positioning).
4. **Current: OpenLayers**. Unlike Leaflet, OpenLayers renders both tiles *and* vector features (markers, route line) onto a `<canvas>` as its normal mode of operation, not via DOM/CSS — so no screenshot library is needed at all, and the pole-latitude bug class from step 2 doesn't apply (OL's projection code is production-tested). `renderStaticMapDataUrl()` builds a temporary, off-screen (`position:fixed; left:-9999px`) OpenLayers map per image, waits for `rendercomplete`, composites the layer canvas(es) (see below), and disposes both the map (`map.setTarget(null)`) and the off-screen container afterward. The server-side tile proxy from step 2 was removed along with it — OL fetches tiles directly from the browser, same confirmed-CORS-enabled `tile.openstreetmap.org` host Leaflet already uses.
   - **Bug found in the field**: the route line (and, on the overview map, effectively everything drawn by the vector layer) didn't appear. Root cause, found by isolating each step live in a browser rather than guessing: the map was constructed with a placeholder view (`center:[0,0], zoom:2`) and `view.fit(extent, ...)` was called *after* construction — a common-looking pattern that is racy in OL. The Map's first render pass (triggered by construction, showing the placeholder view) can satisfy `rendercomplete`'s "nothing pending" check before the second, `fit()`-triggered render (the one that actually matters, and that's still in flight) has painted — so `map.once("rendercomplete", ...)` was resolving too early, before the vector layer had drawn anything meaningful. Confirmed harness-side: an isolated test using the exact same construct-then-fit order rendered both the route line and markers correctly when triggered via an explicit `map.renderSync()` (which forces an immediate synchronous paint, bypassing the event entirely) — proving the *drawing* code itself was correct and the bug was specifically in the render-completion signal's timing.
   - **Fix**: fit the view *before* constructing the Map — `ol.View#fit()` works standalone (it just needs an explicit `size` when the view isn't yet attached to a map) — so there is only ever one relevant render pass, eliminating the race. As a second, independent safety net, `map.renderSync()` is called once more immediately after `rendercomplete` fires, forcing a final synchronous flush of anything still pending at that instant.

### Current implementation notes

- **No hand-rolled projection math**: `ol.View#fit(extent, {size, padding, maxZoom})` handles fitting the bounding box to the image size — the same job the old `lonToTileX`/`latToTileY`/zoom-fit-loop did by hand, now delegated entirely to OL.
- **Canvas compositing, not a single `querySelector`**: OpenLayers can render each layer (tile, vector) onto its own `<canvas>` rather than one shared canvas, depending on configuration. `renderStaticMapDataUrl()` follows OL's own documented "export map to PNG" pattern in spirit: iterate every `.ol-layer canvas`/`canvas.ol-layer` element found in DOM order, and composite each one (respecting CSS opacity) onto a single output canvas via `drawImage`, rather than assuming a single canvas always exists.
  - **Critical bug found in the field — map images visibly not reaching their intended width**: OL's own recipe *also* applies each layer canvas's CSS `transform` (e.g. `matrix(0.4, 0, 0, 0.4, 0, 0)`) before drawing it, because that recipe composites onto an output canvas sized to the map's *logical* (CSS/on-screen) size — and with `pixelRatio` above 1, each layer's actual canvas is rendered at `pixelRatio`× physical resolution with exactly that inverse-scale transform applied via CSS, so it *displays* at the logical size despite having more pixels. This function's output canvas is deliberately sized to the *physical* (already `scale`×) resolution instead, matching each layer canvas's actual pixel dimensions 1:1 — so applying that extra `1/scale` shrink on top (as an early revision did, copying the recipe verbatim) drew the full-resolution content into only `1/scale` of the output canvas (e.g. the left ~40% of the width at `scale = 2.5`), leaving the rest transparent — rendered as blank white space once embedded in the PDF. Confirmed both ends: a targeted test showed the layer canvas's `style.transform` really was `matrix(0.4, 0, 0, 0.4, …)`; a raw byte-level inspection of a generated PDF's own content stream (its image placement `cm` matrix) confirmed `doc.addImage()` itself was *always* placing the image at the full requested width — ruling out jsPDF/page-margin as the cause before looking elsewhere. **Fix**: don't apply `canvas.style.transform` at all when compositing — draw each layer canvas at 1:1 into the physically-sized output canvas.
- **`pixelRatio: scale`** on the `ol.Map` constructor is OL's built-in equivalent of the old manual oversampling (rendering at `scale`× the canvas resolution while keeping the same logical size) — same reason as before (a 1× render looked blurry once placed in the PDF at typical image sizes), just using the library's own mechanism instead of hand-doubling `widthPx`/`heightPx`. `MAP_OVERSAMPLE` is `3.5` (raised from an initial `2.5` on request, for a sharper image).
- **Route line**: `routePoints` (ordered `{lat, lng}`, no color) becomes an `ol.geom.LineString` styled with a dashed blue stroke, matching the live map's polyline. Overview passes all of `state.stops` in order (only when there are 2+, same guard as the live map); each leg map passes just its two stop endpoints.
- **Markers are numbered circles, no name labels anywhere**: each marker (`{lat, lng, color, number?, zIndex?}`) is a single `ol.style.Style` with an `ol.style.Circle` image (radius `2.5 * scale`, white `0.75 * scale` stroke) and, if `number` is set, a centered `ol.style.Text` (bold, white, `4 * scale`px) showing that number. Shrunk three times on request against a real densely-packed itinerary: `10`/`2`/`11px` → `6`/`1.5`/`8px` ("still huge") → `3.5`/`1`/`5px` ("a bit smaller still") → `2.5`/`0.75`/`4px`. Name labels (a separate `Text` style with a white pill background, positioned beside the marker) existed in an earlier revision but were removed entirely (see below) — every marker everywhere is numbers-only now; full names are always in the text next to the map instead, never on the map image itself.
- **Route line is thinner and finer-dashed than the live map's**: `width: 1 * scale`, `lineDash: [3 * scale, 3 * scale]` (down from `3`/`6,6`) — the live Leaflet map's own polyline is comparatively bolder because it has far fewer competing elements on screen; on a small static export image dense with numbered circles, the original weight visually overpowered everything else.
- **Stop numbers** are the stop's 1-based position among `state.stops` (`i + 1`), same as the live map. **POI numbers** (`poiNumberByRef`, a `Map` from POI object → 1-based index built once from `state.pois`, already sorted by `planned-date`) are new: every POI gets a stable number, the *same* one wherever that POI appears — any map image, or the text list underneath (`poiParts()` prints `"<number>. <name>"` instead of a plain bullet). This lets a marker on any map be matched to its entry in the text below it. Stop numbers and POI numbers are independent sequences (both can be "3", say) — never ambiguous, since color (blue vs green) always distinguishes which sequence a given circle belongs to.
- **Name labels (`marker.label`) — added, then removed entirely**: originally added because OSM's baked-in tile labels only appear above certain zoom thresholds (country ~2-5, city ~6-9, town ~10-12, village ~13+), so a leg connecting two far-apart stops can end up with no OSM place labels at all at the zoom needed to fit both (verified: a real 114km leg picks zoom 9, where a small commune has no OSM label).
  - **Bug found in the field — overview map only, at first**: with many stops/POIs, the overview's labels ran off the image's right edge and overlapped each other into unreadable jumbled text (looked, at a glance, like markers had the wrong color, since a small numbered circle sitting right next to a different-colored marker's overlapping label reads as a single confusing blob). Verified the *color* assignment itself was correct via an isolated test (a blue numbered marker and a green unlabeled marker, sampled independently, matched their intended hex colors exactly) — the actual problem was label density/overflow, not miscolored markers. First fix: dropped `label` from the overview only (kept on leg maps, which only ever have 2 stops + that leg's POIs). Then POIs on the overview got `number` instead, to avoid leaving them as anonymous dots (`poiNumberByRef`, above).
  - **Second bug, on leg maps specifically**: even with only 2 stops, a stop's label text visibly collided with nearby POI numbers once the map was wide enough to show several POIs close together (a real export showed a stop's full name overlapping "11" through "15"). Given the crowding problem showed up even at leg-map density, labels were dropped from stops too (on request) — no marker on any map carries a name anymore, on either the overview or the leg maps.
- **`marker.zIndex` (2 for stops, 1 for POIs) — required, not cosmetic**: a real export showed **zero visible stop markers** on the overview, despite the route line (which only draws between stops) clearly being present — the stop circles were there but completely hidden under POI circles rendered on top of them at nearly the same coordinates. Root cause: OpenLayers vector layers do **not** guarantee features render in insertion order — its internal spatial index can visit overlapping features in either order, so "stops added to the array first" was never a real guarantee of draw order. `ol.style.Style#zIndex` is OL's actual, documented mechanism for controlling this, and now sets it explicitly on every marker's style — stops always render above POIs, regardless of how OL's spatial index happens to traverse them.
- **Map images bleed to the full page width** (`0` to `pageWidth` in `doc.addImage()`, using `pageWidth` — not `contentWidth` — to size the rendered image itself too), unlike every text element in this document (which stays within `margin`/`contentWidth`). Requested directly: more width means bigger, less-crowded markers, which matters more here than a consistent side margin.
- **`buildPdf()`** produces the `jsPDF` document: itinerary title, an overview map image (all stops + all POIs — both numbered, connected by the route line, no names), then per stop (in the same order/grouping as `computeStoryGroups()`) — name/place label, type, dates, flags, booking, nested numbered POIs — followed by that leg's map image (two connected, numbered stop markers + that leg's numbered POIs — no names on either). Text content mirrors `buildMarkdown()`'s wording and field selection (no Notes, no price — see above; note `buildMarkdown()` itself was **not** changed to add POI numbers — this numbering scheme exists specifically to compensate for the PDF's map images, which the Markdown export doesn't have); the stop heading is built the same place-then-name, two-line way in both (see "Stop label" above).
- **Page-break handling**: `ensureSpace(height)` adds a new page whenever the next block wouldn't fit above the bottom margin. Each stop's heading and its immediate content (type, dates, address, flags, booking, nested POIs) are built as a `{ text, size, bold, gap }` array (`parts`) *before* anything is drawn; `drawParts(parts)` measures the whole array's total height via `partHeight()` (which re-derives `doc.splitTextToSize()`'s line count at each part's font size — jsPDF's wrapping is a function of the currently-set font/size) and calls `ensureSpace()` **once** for that total, then draws every part. This moves the whole block to a fresh page together when it doesn't fit, rather than breaking mid-block and stranding the heading alone at the bottom of the previous page (a bug found in the field — a lone `ensureSpace(10)` before the heading only guaranteed the heading itself had room, not what followed it). The "Other points of interest" heading gets the same treatment, paired with its first entry.
- **Failure handling**: a map that can't be rendered (OL's `rendercomplete` never fires within 15s, or throws) is skipped by `addMapImage()`'s try/catch — the surrounding text still builds; only a total failure to produce/save the whole PDF sets `state.pdfExportError`.
- **State**: `state.pdfExporting` (drives the button's `is-loading`/`disabled` state) and `state.pdfExportError` (inline danger message on total failure, e.g. `loadJsPdf()`/`loadOpenLayers()`'s CDN script failing to load).
- **New i18n keys**: `itin.story.btn.exportPdf`, `itin.story.error.pdfExport`.
- **Verification caveat**: this was tested by directly exercising both candidate screenshot libraries (step 3) live in a browser before writing any implementation against them — but OpenLayers' tile-loading/render pipeline could only be partially verified in that same sandboxed tool (its automation harness keeps pages permanently `document.hidden`, which prevents OL's tile network requests from ever firing — confirmed zero tile requests were attempted, even via `map.renderSync()`; vector-layer rendering, not gated the same way, did verify correctly — 240/900 sampled marker pixels matched the expected color). Real confirmation of the *full* tile+marker composite happens in an actual visible browser tab, same as every other fix in this file's history.

## Unknowns

- **Map representation in the Markdown export**: still undecided (the PDF export above resolved this question for PDF specifically, via `renderStaticMapDataUrl()` — but Markdown was left untouched). Options remain on the table for Markdown/HTML: (a) plain links to an external map service, (b) embedding the same OpenLayers-rendered PNG as a base64 `data:` URI (reusing `renderStaticMapDataUrl()`, self-contained but larger file, and not all Markdown viewers render data URIs), or (c) switching the export format to self-contained HTML (data-URI images render reliably in any browser, unlike in Markdown viewers). Do not assume one over another until the user decides.
