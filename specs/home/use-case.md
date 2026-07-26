# UC-HOME1 — List saved itineraries and jump to the map

## System context

Landing SPA of the **travel-planner** plugin (tab "Home", dashboard id `home`, the plugin's default tab — resolved dynamically by the shared dispatcher as the first `<tab>` in `conf/menu.xml`, not hardcoded). Read-only: lists distinct `itinerary` values from the Accommodations / Points of Interest tables, writes nothing.

## Goal

Let an operator see, at a glance, which itineraries exist, and jump straight to the Itinerary Map tab pre-filtered to one of them — without first landing on Itinerary Map and picking it from its own dropdown.

## Primary Actor

CAMILA WorkTable administrator / developer / trip organizer.

## Stakeholders and interests

| Stakeholder | Interest |
|---|---|
| Trip organizer | Wants a quick way to jump to a specific trip's map without extra clicks |
| Plugin maintainer | Wants a single obvious place, read-only, that cannot be mistaken for a form that mutates data |

## Preconditions

- User is logged into CAMILA WorkTable with access to the travel-planner plugin.

## Postconditions — Success

- Every distinct, non-empty `itinerary` value found across the Accommodations / Points of Interest tables is listed; clicking one navigates to the Itinerary Map tab with that itinerary pre-selected.

## Postconditions — Error / Partial failure

- If the itineraries lookup fails for any reason (table not found, network/API error) or no record has a non-empty `itinerary` value, an empty-state message is shown instead of the list — this is not an error the user needs to act on.

## Main Success Scenario

### Step 1 — Land on the Home tab

1. User opens the "Home" tab (default tab of the plugin).
2. The app resolves the Accommodations table (and, if present, the Points of Interest table) and collects every distinct, non-empty `itinerary` value found across both.
3. While this loads, a progress indicator is shown.

### Step 2 — Jump to an itinerary

1. Once loaded, itineraries are shown as a list of tags.
2. Clicking an itinerary tag navigates (full page load) to the Itinerary Map tab with that itinerary selected.

## Extensions

- **1a.** No table with a `short_title` matching "Accomodation(s)" is found, or the lookup fails → an empty-state message is shown; this is not an error state.
- **1b.** No record in either table has a non-empty `itinerary` value → same empty-state message.
