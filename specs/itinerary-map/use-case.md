# UC-ITIN1 — Visualize the accommodation itinerary and points of interest on a map

## System context

Standalone read-only SPA inside the **travel-planner** plugin (tab "ITINERARY MAP"). Reads two WorkTable tables — the one whose `short_title` matches "Accomodations", and (optionally) the one whose `short_title` matches "Points of Interest" — and does not write anything.

## Goal

Let an operator see, at a glance, the sequence of accommodations of a trip plotted on a map and connected in chronological order, together with the points of interest planned for that same trip, so the overall itinerary is visually obvious. When more than one trip ("itinerary") is stored in these tables, let the operator pick which one to view.

## Primary Actor

CAMILA WorkTable administrator / developer / trip organizer.

## Stakeholders and interests

| Stakeholder | Interest |
|---|---|
| Trip organizer | Wants a visual, at-a-glance itinerary instead of reading raw table rows, and a way to keep multiple trips separate |
| Plugin maintainer | Wants a read-only view that cannot corrupt the accommodations/points-of-interest data |

## Preconditions

- User is logged into CAMILA WorkTable with access to the travel-planner plugin.
- A WorkTable table with `short_title` containing "Accomodation(s)" is visible via `GET /tables`, with (at least) columns `property-name`, `city`, `country`, `accommodation-type`, `check-in-date`, `check-out-date`, `latitude`, `longitude`, and optionally `itinerary`.
- Optionally, a WorkTable table with `short_title` containing "Points of Interest" is visible, with (at least) columns `name`, `city`, `category`, `latitude`, `longitude`, and optionally `itinerary`, `planned-date`, `duration`, `price`, `booking-required`, `kid-friendly`, `priority`, `linked-accommodation`, `description`, `address`, `notes`.

## Postconditions — Success

- All accommodation records (for the selected itinerary, if any) with valid latitude/longitude are shown as numbered markers on a map, joined by a line in check-in-date order, plus a matching sidebar list.
- All points-of-interest records (for the selected itinerary, if any) with valid latitude/longitude are shown as a separate set of markers (not connected by the route line), plus a matching sidebar section.

## Postconditions — Error / Partial failure

- If the accommodations table cannot be found, or the initial load fails, an inline error with a retry action is shown and no map is rendered.
- If the points-of-interest table cannot be found, this is **not** an error: accommodations are still shown, with a small non-blocking note that points of interest are unavailable.
- Records (either table) with missing/invalid coordinates are silently excluded from the map, with a non-blocking count shown per table — they are not treated as a load failure.

## Main Success Scenario

### Step 1 — Land on the tab

1. User opens the "ITINERARY MAP" tab.
2. The app resolves the accommodations table (by `short_title`) and, if present, the points-of-interest table (by `short_title`); loads all records from both; keeps only those with valid coordinates.
3. The app collects every distinct, non-empty `itinerary` value found across both tables.

### Step 2 — Pick an itinerary (only if more than one exists)

1. If two or more distinct `itinerary` values were found, a dropdown appears; the first one (alphabetically) is selected by default — unless the tab was opened with an `itinerary` link from the Home tab (see Step 1a), in which case that one is selected instead.
2. If zero or one distinct `itinerary` value was found, no dropdown appears — every loaded record with valid coordinates is shown, matching the pre-multi-itinerary behavior.
3. Changing the dropdown re-filters the already-loaded data (no new network request) and redraws the map.

### Step 1a — Arriving from the Home tab's itineraries list (alternative entry point)

1. User clicks an itinerary tag on the Home tab, landing here via `?dashboard=itinerary-map&itinerary=<name>`.
2. If `<name>` matches one of the itinerary values loaded in Step 1, it is selected instead of the alphabetically-first one.
3. If `<name>` does not match any loaded itinerary (stale link, typo, or an itinerary whose records all lack valid coordinates), the normal default (first one alphabetically, or "show everything" if none) applies silently — this is not an error.

### Step 3 — View the itinerary

1. A map shows one numbered marker per accommodation (numbered in check-in-date order for the selected itinerary) connected by a dashed line.
2. The same map shows one differently-styled (pin-shaped, green) marker per point of interest for the selected itinerary — these are **not** connected by the route line.
3. A sidebar lists accommodations ("Stops") and, below them, points of interest, each row showing its key facts.
4. Clicking a marker's popup, or a sidebar row (either section), centers the map on that item, opens its popup, and highlights its marker; accommodation and point-of-interest highlighting are independent of each other.

## Extensions

- **1a.** No table with a `short_title` matching "Accomodation(s)" is found → inline error, retry button, no map. (This extension does not apply to the points-of-interest table — see Postconditions above.)
- **1b.** Loading the accommodations table's records fails (network/HTTP error) → inline error with the underlying message and a retry button. A failure loading the points-of-interest table after the accommodations table already loaded also surfaces through this same error+retry path (the whole load is one operation).
- **1c.** Some accommodation or point-of-interest records have missing/non-numeric latitude or longitude → those records are excluded from the map and sidebar; a separate non-blocking warning per table states how many were skipped. This is not an error state.
- **1d.** No record at all (either table, for the selected itinerary) has valid coordinates → the map area is not rendered; an empty-state message is shown instead.
- **2a.** A record has no `check-in-date` (accommodations) or `planned-date` (points of interest) → it sorts after all records that do have one (stable relative order among undated records) within its own table's list.
- **2b.** A record has no `itinerary` value (or the field doesn't exist in the table at all) while other records do have one → that record is excluded once a specific itinerary is selected, since it doesn't match any itinerary value. If **no** record anywhere has an `itinerary` value, the field is treated as absent entirely and every record is shown regardless.
