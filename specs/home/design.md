# Home — design

## Structure

Single view, no wizard steps.

```
┌──────────────────────────────────────────┐
│  spa-title-box (attached to tab bar)     │
│  Itineraries                             │
│  (loading progress, initial load only)   │
│  [ Roma 2026 ] [ Tour Scozia ] [ ... ]    │  ← tags, each links to
│  (or: empty-state message)               │     ?dashboard=itinerary-map&itinerary=<name>
└──────────────────────────────────────────┘
```

## State shape

```js
const state = {
  loading:     true,
  itineraries: [],  // distinct, sorted, non-empty "itinerary" values across Accommodations + POI tables
};
```

## Tables involved

| Operation | WorkTable table |
|---|---|
| Resolve both table names | `client.tables({ metadata: "1" })` — same resolution rule as Itinerary Map |
| Distinct itinerary values | `client.table(<resolved accommodations name>).distinct("itinerary")`, and, if resolved, `client.table(<resolved POI name>).distinct("itinerary")` |

Table names are resolved with the same case-insensitive `short_title` regexes as Itinerary Map (`/accom+odation/i`, `/points?[\s-]*of[\s-]*interest/i`), duplicated locally rather than shared — consistent with "explicit over generic" and the small size of the helper.

`distinct()` is used instead of `list()` deliberately: Home only needs the set of itinerary names, not full records, so it avoids loading (and geocoding) every accommodation/POI row just to render a launcher list.

## Payload

No mutation, ever. Two read-only calls at most (accommodations + POI distinct), merged into a single sorted `Set` of non-empty, trimmed values — same merge/sort logic as Itinerary Map's `itinerarySet`.

## Classification logic

Not applicable.

## Other technical notes

- **Lookup failure is non-blocking**: any error (table not found, network) is swallowed and treated as an empty result (`state.itineraries = []`), per the "safe conservative defaults" in AGENTS.md ("empty catalog if distinct lookup fails"). There is no dedicated error/retry UI — the empty-state message covers both "genuinely no itineraries" and "lookup failed" identically, since neither requires user action.
- **Navigation to Itinerary Map is a plain `<a href="...">`** (full page reload), not a JS click handler — consistent with AGENTS.md's "prefer full reload over complex history manipulation" and with how `menu.xml` tab links already work. The link is `?dashboard=itinerary-map&itinerary=<encodeURIComponent(name)>`.
- **Known divergence**: this list comes from raw `distinct()` values, regardless of whether any record for that itinerary has valid coordinates. Itinerary Map's own dropdown only ever contains itineraries that have at least one record (accommodation or POI) with valid lat/lng. So an itinerary could theoretically appear here but show an empty map after navigating — Itinerary Map's existing fallback (select the first available itinerary if the requested one isn't in its own list) handles this gracefully rather than erroring. See `specs/itinerary-map/design.md` "Other technical notes".
- **No WorkTableClient mutation calls anywhere in this view** — only `client.tables()` and `client.table(...).distinct(...)`.
