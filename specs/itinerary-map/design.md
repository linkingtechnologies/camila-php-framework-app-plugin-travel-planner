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
├───────────────┬───────────────────────────┤
│  Sidebar       │  Map                     │
│  Stops (N)     │  [1]---[2]---[3]         │
│  1. Stop A     │   (numbered markers,     │
│  2. Stop B     │    dashed polyline)      │
│  ...           │  📍 📍 📍                 │
│  POIs (M)      │   (pin markers, NOT      │
│  📍 POI X      │    connected by a line)  │
│  📍 POI Y      │                          │
└───────────────┴───────────────────────────┘
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

Same as before: `latitude`/`longitude` gate inclusion; `check-in-date` is the sort key; `property-name`/`city`/`country`/`accommodation-type`/`address`/`breakfast-included`/`parking-included`/`booking-platform`/`booking-reference`/`notes` feed the marker/sidebar/popup. New: `itinerary` (optional) is read for grouping — see below.

### Points of interest (new)

| Column | Usage |
|---|---|
| `latitude`, `longitude` | Parsed with `Number(...)`; record excluded if either is not finite (same helper as accommodations) |
| `itinerary` | Grouping key, same semantics as on accommodations |
| `planned-date` | Sort key for the POI list (via `Date.parse`); shown in sidebar and popup |
| `name`, `city` | Marker/sidebar/popup label |
| `category` | Popup subtitle |
| `description`, `address` | Popup body |
| `duration`, `price` | Popup lines, shown verbatim (no unit/currency assumptions) |
| `booking-required`, `kid-friendly` | Popup tags via `isTruthyFlag()` (same truthy-string helper as accommodations) |
| `priority` | Popup line, shown verbatim (no assumed value domain — could be text or a number) |
| `linked-accommodation` | Popup line, shown verbatim as free text (not resolved/joined against the accommodations table) |
| `notes` | Popup "Notes" line (reuses the same i18n key as the accommodation popup's Notes line) |
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
