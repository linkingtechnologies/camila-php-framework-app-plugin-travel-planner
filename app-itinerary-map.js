// app-itinerary-map.js
import { html, render } from "../../../../camila/js/lit-html/lit-html.js";

const root = document.getElementById("app");

if (typeof WorkTableClient !== "function") {
  render(html`<div class="notification is-danger">WorkTableClient not available</div>`, root);
  throw Error("WorkTableClient not available");
}

const client = WorkTableClient(window.APP_CONFIG || {});

const t = (key, ...args) => {
  let s = window.I18N?.[key] ?? key;
  args.forEach(a => { s = s.replace('%s', a); });
  return s;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeApiError(err) {
  const raw = err?.payload ?? err?.response ?? err;
  const message = raw?.message ?? err?.message ?? raw?.error?.message
    ?? (typeof raw === "string" ? raw : "Unknown error");
  return { message };
}

function getRecords(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.records)) return res.records;
  return [];
}

function isTruthyFlag(v) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "si" || s === "sì";
}

function toFiniteNumber(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function byDateKey(key) {
  return (a, b) => {
    const da = Date.parse(a[key] ?? "");
    const db = Date.parse(b[key] ?? "");
    if (Number.isNaN(da) && Number.isNaN(db)) return 0;
    if (Number.isNaN(da)) return 1;
    if (Number.isNaN(db)) return -1;
    return da - db;
  };
}

function resolveTableFromList(tables, regex) {
  const found = tables.find(tbl => regex.test(tbl.short_title || "") || regex.test(tbl.name || ""));
  return found?.name ?? null;
}

// Static ISO 3166-1 alpha-2 code list (there is no `Intl.supportedValuesOf("region")` —
// "region" isn't one of the standardized keys — so the code list itself has to be enumerated
// somewhere; this is that list, not a country-name mapping). Only used to enumerate codes;
// the actual name for each code still comes from Intl.DisplayNames, not from this list.
const ISO_REGION_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ " +
  "BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ " +
  "DE DJ DK DM DO DZ " +
  "EC EE EG EH ER ES ET " +
  "FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY " +
  "HK HM HN HR HT HU " +
  "ID IE IL IM IN IO IQ IR IS IT " +
  "JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ " +
  "LA LB LC LI LK LR LS LT LU LV LY " +
  "MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ " +
  "OM " +
  "PA PE PF PG PH PK PL PM PN PR PS PT PW PY " +
  "QA " +
  "RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ " +
  "TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ " +
  "VA VC VE VG VI VN VU " +
  "WF WS " +
  "YE YT " +
  "ZA ZM ZW"
).split(" ");

// Country name → flag emoji, built once from ISO_REGION_CODES and English display names
// (Intl.DisplayNames). Falls back to no flag (rather than guessing) if the API is
// unavailable or the country string doesn't match a known region name.
let countryCodeByName = null;

function countryFlag(countryName) {
  const name = String(countryName ?? "").trim();
  if (!name) return "";

  if (!countryCodeByName) {
    countryCodeByName = new Map();
    if (typeof Intl !== "undefined" && Intl.DisplayNames) {
      const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
      for (const code of ISO_REGION_CODES) {
        try {
          const label = displayNames.of(code);
          if (label) countryCodeByName.set(label.toLowerCase(), code);
        } catch {
          // Some codes may not resolve in every environment — skip, don't fail the whole map.
        }
      }
    }
  }

  const code = countryCodeByName.get(name.toLowerCase());
  if (!code) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map(ch => 127397 + ch.charCodeAt(0)));
}

// "City, [flag ]Country" — shown first, ahead of the stop's own name (in stopLabel(), and in
// the Markdown/PDF heading construction in buildMarkdown()/buildPdf()).
function stopPlace(stop) {
  return [stop.city, [countryFlag(stop.country), stop.country].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
}

// City/country line, then the accommodation icon + name on its own line below — place first
// since it's what usually matters for getting oriented on a multi-stop trip, name second.
function stopLabel(stop) {
  const place = stopPlace(stop);
  const name = stop["property-name"] || stop.city || "—";
  return html`${place ? html`${place}<br>` : ""}<i class="ri-hotel-line"></i> ${name}`;
}

// ── State ──────────────────────────────────────────────────────────────────

// Optional deep link from the Home tab's itineraries list (?dashboard=itinerary-map&itinerary=...).
// If it doesn't match any itinerary actually loaded, the normal fallback in loadAll() (first
// itinerary alphabetically) applies — same as if nothing had been requested.
const requestedItinerary = new URLSearchParams(location.search).get("itinerary") || "";

const state = {
  loading:            true,
  error:              null,   // string | null

  itineraries:        [],     // distinct, sorted, non-empty "itinerary" values across both tables
  selectedItinerary:  requestedItinerary,  // "" = no itinerary field present anywhere (show everything)

  allAccommodations:  [],     // all accommodation records with valid coords (any itinerary)
  allPois:            [],     // all points-of-interest records with valid coords (any itinerary)

  stops:              [],     // allAccommodations filtered to selectedItinerary, sorted by check-in-date
  pois:               [],     // allPois filtered to selectedItinerary, sorted by planned-date

  skippedCount:       0,      // accommodations excluded for missing/invalid coordinates
  skippedPoiCount:    0,      // points of interest excluded for missing/invalid coordinates
  poiTableMissing:    false,  // true if no points-of-interest table could be resolved (non-blocking)

  activeIndex:        null,   // index into state.stops, for sidebar<->map highlight
  activePoiIndex:      null,   // index into state.pois, for sidebar<->map highlight

  viewMode:           "map",  // "map" | "story" — which alternative view is shown below the toolbar

  pdfExporting:       false,  // true while buildPdf() is running (async: fetches static map images)
  pdfExportError:     null,   // string | null — non-blocking, shown inline in Story view only
};

let cancelled = false;

// ── Leaflet loading (same CDN pattern as segreteria-campo's map-center) ────

async function loadLeaflet() {
  if (window.L) return;
  await new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.3/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.3/dist/leaflet.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ── jsPDF loading (same CDN pattern as loadLeaflet) ─────────────────────────

async function loadJsPdf() {
  if (window.jspdf?.jsPDF) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// ── Data loading ───────────────────────────────────────────────────────────

function applyItineraryFilter() {
  const filterFn = state.itineraries.length > 0
    ? (r => (r.itinerary ?? "") === state.selectedItinerary)
    : (() => true);

  state.stops = state.allAccommodations.filter(filterFn).sort(byDateKey("check-in-date"));
  state.pois  = state.allPois.filter(filterFn).sort(byDateKey("planned-date"));
  state.activeIndex = null;
  state.activePoiIndex = null;
}

function onItineraryChange(value) {
  state.selectedItinerary = value;
  applyItineraryFilter();
  mount();
  if (state.viewMode === "map") setTimeout(initMap, 0);
  else setTimeout(initStoryMaps, 0);
}

function onViewModeChange(mode) {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  mount();
  if (mode === "map") {
    destroyStoryMaps();
    setTimeout(initMap, 0);
  } else {
    setTimeout(initStoryMaps, 0);
  }
}

async function loadAll() {
  state.loading = true;
  state.error = null;
  mount();

  try {
    const tablesRes = await client.tables({ metadata: "1" });
    if (cancelled) return;
    const tables = Array.isArray(tablesRes?.tables) ? tablesRes.tables : [];

    const accTableName = resolveTableFromList(tables, /accom+odation/i);
    if (!accTableName) {
      state.error = t("itin.error.tableNotFound");
      state.loading = false;
      mount();
      return;
    }
    const poiTableName = resolveTableFromList(tables, /points?[\s-]*of[\s-]*interest/i);

    const accRes = await client.table(accTableName).list({ size: 9999 });
    if (cancelled) return;
    const accRecords = getRecords(accRes);

    const allAccommodations = [];
    let skipped = 0;
    for (const r of accRecords) {
      const lat = toFiniteNumber(r.latitude);
      const lng = toFiniteNumber(r.longitude);
      if (lat === null || lng === null) { skipped++; continue; }
      allAccommodations.push({ ...r, __lat: lat, __lng: lng });
    }

    let allPois = [];
    let skippedPoi = 0;
    state.poiTableMissing = !poiTableName;
    if (poiTableName) {
      const poiRes = await client.table(poiTableName).list({ size: 9999 });
      if (cancelled) return;
      const poiRecords = getRecords(poiRes);
      for (const r of poiRecords) {
        const lat = toFiniteNumber(r.latitude);
        const lng = toFiniteNumber(r.longitude);
        if (lat === null || lng === null) { skippedPoi++; continue; }
        allPois.push({ ...r, __lat: lat, __lng: lng });
      }
    }

    const itinerarySet = new Set();
    [...allAccommodations, ...allPois].forEach(r => {
      const v = String(r.itinerary ?? "").trim();
      if (v) itinerarySet.add(v);
    });
    const itineraries = [...itinerarySet].sort((a, b) => a.localeCompare(b));

    state.allAccommodations = allAccommodations;
    state.allPois = allPois;
    state.itineraries = itineraries;
    if (!itineraries.includes(state.selectedItinerary)) {
      state.selectedItinerary = itineraries[0] ?? "";
    }
    state.skippedCount = skipped;
    state.skippedPoiCount = skippedPoi;

    applyItineraryFilter();

    state.loading = false;
    mount();
    setTimeout(initMap, 0);
  } catch (e) {
    if (cancelled) return;
    state.error = t("itin.error.load", normalizeApiError(e).message);
    state.loading = false;
    mount();
  }
}

// ── Map ──────────────────────────────────────────────────────────────────

let leafletMap = null;
let markers = [];
let poiMarkers = [];

function numberedIcon(n, active) {
  const bg = active ? "#ff3860" : "#3273dc";
  return window.L.divIcon({
    className: "itin-marker",
    html: `<div style="background:${bg};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:0.75rem;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function poiIcon(active) {
  const bg = active ? "#ff3860" : "#48c78e";
  return window.L.divIcon({
    className: "itin-poi-marker",
    html: `<div style="background:${bg};width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
      <i class="ri-map-pin-2-fill" style="transform:rotate(45deg);font-size:0.7rem;color:#fff"></i>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
  });
}

function popupHtml(stop) {
  const rows = [];
  const range = [stop["check-in-date"], stop["check-out-date"]].filter(Boolean).join(" &rarr; ");
  if (range) rows.push(`<div>${range}</div>`);
  if (stop.address) rows.push(`<div>${stop.address}</div>`);
  const flags = [];
  if (isTruthyFlag(stop["breakfast-included"])) flags.push(t("itin.popup.breakfast"));
  if (isTruthyFlag(stop["parking-included"])) flags.push(t("itin.popup.parking"));
  if (flags.length) rows.push(`<div>${flags.join(" · ")}</div>`);
  if (stop["booking-platform"] || stop["booking-reference"]) {
    rows.push(`<div><strong>${t("itin.popup.booking")}:</strong> ${[stop["booking-platform"], stop["booking-reference"]].filter(Boolean).join(" — ")}</div>`);
  }
  return `<div style="min-width:180px">
    <strong>${stop["property-name"] || stop.city || "—"}</strong><br>
    <span class="has-text-grey">${[stop["accommodation-type"], stop.city, stop.country].filter(Boolean).join(" · ")}</span>
    ${rows.map(r => r).join("")}
  </div>`;
}

function popupHtmlPoi(poi) {
  const rows = [];
  if (poi["planned-date"]) rows.push(`<div><strong>${t("itin.poi.popup.planned")}:</strong> ${poi["planned-date"]}</div>`);
  if (poi.duration) rows.push(`<div><strong>${t("itin.poi.popup.duration")}:</strong> ${poi.duration}</div>`);
  if (poi.address) rows.push(`<div>${poi.address}</div>`);
  if (poi.description) rows.push(`<div>${poi.description}</div>`);
  const flags = [];
  if (isTruthyFlag(poi["booking-required"])) flags.push(t("itin.poi.popup.bookingRequired"));
  if (isTruthyFlag(poi["kid-friendly"])) flags.push(t("itin.poi.popup.kidFriendly"));
  if (flags.length) rows.push(`<div>${flags.join(" · ")}</div>`);
  if (poi.priority) rows.push(`<div><strong>${t("itin.poi.popup.priority")}:</strong> ${poi.priority}</div>`);
  if (poi["linked-accommodation"]) rows.push(`<div><strong>${t("itin.poi.popup.linkedAccommodation")}:</strong> ${poi["linked-accommodation"]}</div>`);
  return `<div style="min-width:180px">
    <strong>${poi.name || poi.city || "—"}</strong><br>
    <span class="has-text-grey">${[poi.category, poi.city].filter(Boolean).join(" · ")}</span>
    ${rows.map(r => r).join("")}
  </div>`;
}

async function initMap() {
  const container = document.getElementById("itin-map-container");
  if (!container || (state.stops.length === 0 && state.pois.length === 0)) return;

  await loadLeaflet();
  if (cancelled) return;
  const L = window.L;

  if (leafletMap) { leafletMap.remove(); leafletMap = null; markers = []; poiMarkers = []; }

  leafletMap = L.map(container, { center: [0, 0], zoom: 2, layers: [osmTileLayer()] });

  const stopLatlngs = state.stops.map(s => [s.__lat, s.__lng]);
  if (stopLatlngs.length > 1) {
    L.polyline(stopLatlngs, { color: "#3273dc", weight: 3, dashArray: "6,6" }).addTo(leafletMap);
  }

  markers = state.stops.map((stop, i) => {
    const marker = L.marker([stop.__lat, stop.__lng], { icon: numberedIcon(i + 1, false) })
      .addTo(leafletMap)
      .bindPopup(popupHtml(stop));
    marker.on("click", () => { state.activeIndex = i; mount(); refreshIcons(); });
    return marker;
  });

  poiMarkers = state.pois.map((poi, i) => {
    const marker = L.marker([poi.__lat, poi.__lng], { icon: poiIcon(false) })
      .addTo(leafletMap)
      .bindPopup(popupHtmlPoi(poi));
    marker.on("click", () => { state.activePoiIndex = i; mount(); refreshPoiIcons(); });
    return marker;
  });

  const allLatlngs = [...stopLatlngs, ...state.pois.map(p => [p.__lat, p.__lng])];
  const bounds = L.latLngBounds(allLatlngs);
  if (bounds.isValid()) leafletMap.fitBounds(bounds, { padding: [40, 40] });
}

// ── Story view maps (overview + one small map per leg between two consecutive stops) ──

let storyOverviewMap = null;
let storyLegMaps = [];

function osmTileLayer() {
  return window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

function destroyStoryMaps() {
  if (storyOverviewMap) { storyOverviewMap.remove(); storyOverviewMap = null; }
  storyLegMaps.forEach(m => m.remove());
  storyLegMaps = [];
}

async function initStoryMaps() {
  if (state.viewMode !== "story") return;
  destroyStoryMaps();

  await loadLeaflet();
  if (cancelled || state.viewMode !== "story") return;
  const L = window.L;

  const overviewContainer = document.getElementById("story-overview-map");
  if (overviewContainer && (state.stops.length > 0 || state.pois.length > 0)) {
    storyOverviewMap = L.map(overviewContainer, { center: [0, 0], zoom: 2, layers: [osmTileLayer()] });

    const stopLatlngs = state.stops.map(s => [s.__lat, s.__lng]);
    if (stopLatlngs.length > 1) {
      L.polyline(stopLatlngs, { color: "#3273dc", weight: 3, dashArray: "6,6" }).addTo(storyOverviewMap);
    }
    state.stops.forEach((stop, i) => {
      L.marker([stop.__lat, stop.__lng], { icon: numberedIcon(i + 1, false) })
        .addTo(storyOverviewMap)
        .bindPopup(popupHtml(stop));
    });
    state.pois.forEach(poi => {
      L.marker([poi.__lat, poi.__lng], { icon: poiIcon(false) })
        .addTo(storyOverviewMap)
        .bindPopup(popupHtmlPoi(poi));
    });

    const allLatlngs = [...stopLatlngs, ...state.pois.map(p => [p.__lat, p.__lng])];
    const bounds = L.latLngBounds(allLatlngs);
    if (bounds.isValid()) storyOverviewMap.fitBounds(bounds, { padding: [30, 30] });
  }

  // One mini-map per leg (between stop i and stop i+1), showing just that segment plus
  // the points of interest already assigned (via computeStoryGroups) to either endpoint.
  const { groups } = computeStoryGroups();
  groups.forEach((group, i) => {
    if (i >= groups.length - 1) return;
    const container = document.getElementById(`story-leg-map-${i}`);
    if (!container) return;

    const from = group.stop;
    const to = groups[i + 1].stop;
    const legPois = [...group.pois, ...groups[i + 1].pois];

    const legMap = L.map(container, { center: [0, 0], zoom: 2, layers: [osmTileLayer()] });
    storyLegMaps.push(legMap);

    L.polyline([[from.__lat, from.__lng], [to.__lat, to.__lng]], { color: "#3273dc", weight: 3, dashArray: "6,6" }).addTo(legMap);
    L.marker([from.__lat, from.__lng], { icon: numberedIcon(i + 1, false) }).addTo(legMap).bindPopup(popupHtml(from));
    L.marker([to.__lat, to.__lng], { icon: numberedIcon(i + 2, false) }).addTo(legMap).bindPopup(popupHtml(to));
    legPois.forEach(poi => {
      L.marker([poi.__lat, poi.__lng], { icon: poiIcon(false) }).addTo(legMap).bindPopup(popupHtmlPoi(poi));
    });

    const legLatlngs = [[from.__lat, from.__lng], [to.__lat, to.__lng], ...legPois.map(p => [p.__lat, p.__lng])];
    const bounds = L.latLngBounds(legLatlngs);
    if (bounds.isValid()) legMap.fitBounds(bounds, { padding: [30, 30] });
  });
}

function refreshIcons() {
  markers.forEach((marker, i) => marker.setIcon(numberedIcon(i + 1, i === state.activeIndex)));
}

function refreshPoiIcons() {
  poiMarkers.forEach((marker, i) => marker.setIcon(poiIcon(i === state.activePoiIndex)));
}

function focusStop(i) {
  state.activeIndex = i;
  mount();
  refreshIcons();
  const stop = state.stops[i];
  if (leafletMap && stop) {
    leafletMap.setView([stop.__lat, stop.__lng], Math.max(leafletMap.getZoom(), 10));
    markers[i]?.openPopup();
  }
}

function focusPoi(i) {
  state.activePoiIndex = i;
  mount();
  refreshPoiIcons();
  const poi = state.pois[i];
  if (leafletMap && poi) {
    leafletMap.setView([poi.__lat, poi.__lng], Math.max(leafletMap.getZoom(), 10));
    poiMarkers[i]?.openPopup();
  }
}

// ── View ───────────────────────────────────────────────────────────────────

function ItinerarySelector() {
  if (state.itineraries.length <= 1) return "";
  return html`
    <div class="field mb-4">
      <label class="label">${t("itin.selector.label")}</label>
      <div class="control">
        <div class="select">
          <select @change=${e => onItineraryChange(e.target.value)}>
            ${state.itineraries.map(it => html`<option value=${it} ?selected=${state.selectedItinerary === it}>${it}</option>`)}
          </select>
        </div>
      </div>
    </div>
  `;
}

function Sidebar() {
  return html`
    <div class="box" style="max-height:520px; overflow-y:auto;">
      ${state.stops.length > 0 ? html`
        <h4 class="title is-6 mb-3">${t("itin.sidebar.title", state.stops.length)}</h4>
        ${state.stops.map((s, i) => html`
          <div
            class="p-2 mb-1"
            style="cursor:pointer; border-radius:4px; ${i === state.activeIndex ? "background:#eef3fc;" : ""}"
            @click=${() => focusStop(i)}
          >
            <span class="tag is-link is-light mr-2">${i + 1}</span>
            <strong>${s["property-name"] || s.city || "—"}</strong>
            <div class="is-size-7 has-text-grey">
              ${[s.city, s.country].filter(Boolean).join(", ")}
              ${s["check-in-date"] ? html` · ${s["check-in-date"]}` : ""}
            </div>
          </div>
        `)}
      ` : ""}

      ${state.pois.length > 0 ? html`
        <h4 class="title is-6 mb-3 mt-4">${t("itin.poi.sidebar.title", state.pois.length)}</h4>
        ${state.pois.map((p, i) => html`
          <div
            class="p-2 mb-1"
            style="cursor:pointer; border-radius:4px; ${i === state.activePoiIndex ? "background:#eafaf1;" : ""}"
            @click=${() => focusPoi(i)}
          >
            <span class="tag is-success is-light mr-2"><i class="ri-map-pin-2-fill"></i></span>
            <strong>${p.name || p.city || "—"}</strong>
            <div class="is-size-7 has-text-grey">
              ${[p.category, p.city].filter(Boolean).join(", ")}
              ${p["planned-date"] ? html` · ${p["planned-date"]}` : ""}
            </div>
          </div>
        `)}
      ` : ""}
    </div>
  `;
}

function ViewModeToggle() {
  return html`
    <div class="buttons has-addons mb-4">
      <button
        class="button is-small ${state.viewMode === "map" ? "is-link is-selected" : ""}"
        @click=${() => onViewModeChange("map")}
      >
        <span class="icon"><i class="ri-map-2-line"></i></span>
        <span>${t("itin.view.map")}</span>
      </button>
      <button
        class="button is-small ${state.viewMode === "story" ? "is-link is-selected" : ""}"
        @click=${() => onViewModeChange("story")}
      >
        <span class="icon"><i class="ri-book-open-line"></i></span>
        <span>${t("itin.view.story")}</span>
      </button>
    </div>
  `;
}

// Assigns each POI to the stop it belongs to (by linked-accommodation name match, falling
// back to falling within the stop's check-in/check-out range), in stop order. POIs matched
// by neither rule are returned separately rather than silently dropped.
function computeStoryGroups() {
  const assigned = new Set();

  const groups = state.stops.map(stop => {
    const propName = String(stop["property-name"] ?? "").trim().toLowerCase();
    const inDate  = Date.parse(stop["check-in-date"] ?? "");
    const outDate = Date.parse(stop["check-out-date"] ?? "");

    const pois = state.pois.filter((poi, i) => {
      if (assigned.has(i)) return false;
      const linked = String(poi["linked-accommodation"] ?? "").trim().toLowerCase();
      let match = linked !== "" && propName !== "" && linked === propName;
      if (!match && !Number.isNaN(inDate) && !Number.isNaN(outDate)) {
        const poiDate = Date.parse(poi["planned-date"] ?? "");
        match = !Number.isNaN(poiDate) && poiDate >= inDate && poiDate <= outDate;
      }
      if (match) assigned.add(i);
      return match;
    });

    return { stop, pois };
  });

  const leftoverPois = state.pois.filter((_, i) => !assigned.has(i));
  return { groups, leftoverPois };
}

function StoryPoiEntry(poi) {
  const flags = [];
  if (isTruthyFlag(poi["booking-required"])) flags.push(t("itin.poi.popup.bookingRequired"));
  if (isTruthyFlag(poi["kid-friendly"])) flags.push(t("itin.poi.popup.kidFriendly"));

  return html`
    <div class="mb-2">
      <p class="mb-0">
        <span class="tag is-success is-light mr-2"><i class="ri-map-pin-2-fill"></i></span>
        <strong>${poi.name || poi.city || "—"}</strong>
        ${poi["planned-date"] ? html`<span class="has-text-grey is-size-7"> · ${poi["planned-date"]}</span>` : ""}
      </p>
      ${poi.description ? html`<p class="is-size-7 has-text-grey ml-5 mb-0">${poi.description}</p>` : ""}
      ${flags.length ? html`<p class="is-size-7 has-text-grey ml-5 mb-0">${flags.join(" · ")}</p>` : ""}
    </div>
  `;
}

function StoryStopEntry(stop, pois, index) {
  const flags = [];
  if (isTruthyFlag(stop["breakfast-included"])) flags.push(t("itin.popup.breakfast"));
  if (isTruthyFlag(stop["parking-included"])) flags.push(t("itin.popup.parking"));

  return html`
    <div class="box">
      <h4 class="title is-6 mb-1">
        <span class="tag is-link is-light mr-2">${index + 1}</span>
        ${stopLabel(stop)}
      </h4>
      ${stop["accommodation-type"] ? html`<p class="has-text-grey mb-2">${stop["accommodation-type"]}</p>` : ""}

      ${(stop["check-in-date"] || stop["check-out-date"]) ? html`
        <p class="mb-1">
          ${stop["check-in-date"] ? html`<strong>${t("itin.popup.checkin")}:</strong> ${stop["check-in-date"]}` : ""}
          ${stop["check-out-date"] ? html`&nbsp; <strong>${t("itin.popup.checkout")}:</strong> ${stop["check-out-date"]}` : ""}
        </p>
      ` : ""}

      ${stop.address ? html`<p class="mb-1">${stop.address}</p>` : ""}
      ${flags.length ? html`<p class="mb-1">${flags.join(" · ")}</p>` : ""}

      ${(stop["booking-platform"] || stop["booking-reference"]) ? html`
        <p class="mb-1"><strong>${t("itin.popup.booking")}:</strong> ${[stop["booking-platform"], stop["booking-reference"]].filter(Boolean).join(" — ")}</p>
      ` : ""}

      ${pois.length > 0 ? html`
        <div class="mt-3 pl-4" style="border-left: 2px solid #eee;">
          ${pois.map(poi => StoryPoiEntry(poi))}
        </div>
      ` : ""}
    </div>
  `;
}

// Plain-text (Markdown) rendering of the same stop/POI grouping used by StoryView(),
// so the export always matches what is shown on screen.
function buildMarkdown() {
  const { groups, leftoverPois } = computeStoryGroups();
  const lines = [`# ${state.selectedItinerary || t("itin.selector.label")}`, ""];

  const poiLines = (poi) => {
    const out = [`- **${poi.name || poi.city || "—"}**${poi["planned-date"] ? ` (${poi["planned-date"]})` : ""}`];
    if (poi.description) out.push(`  ${poi.description}`);
    const flags = [];
    if (isTruthyFlag(poi["booking-required"])) flags.push(t("itin.poi.popup.bookingRequired"));
    if (isTruthyFlag(poi["kid-friendly"])) flags.push(t("itin.poi.popup.kidFriendly"));
    if (flags.length) out.push(`  ${flags.join(" · ")}`);
    return out;
  };

  groups.forEach(({ stop, pois }, i) => {
    const place = stopPlace(stop);
    lines.push(`## ${i + 1}. ${place || stop["property-name"] || stop.city || "—"}`, "");
    if (place) lines.push(`**${stop["property-name"] || stop.city || "—"}**`, "");
    if (stop["accommodation-type"]) lines.push(`*${stop["accommodation-type"]}*`, "");
    if (stop["check-in-date"]) lines.push(`- **${t("itin.popup.checkin")}:** ${stop["check-in-date"]}`);
    if (stop["check-out-date"]) lines.push(`- **${t("itin.popup.checkout")}:** ${stop["check-out-date"]}`);
    if (stop.address) lines.push(`- ${stop.address}`);
    const flags = [];
    if (isTruthyFlag(stop["breakfast-included"])) flags.push(t("itin.popup.breakfast"));
    if (isTruthyFlag(stop["parking-included"])) flags.push(t("itin.popup.parking"));
    if (flags.length) lines.push(`- ${flags.join(" · ")}`);
    if (stop["booking-platform"] || stop["booking-reference"]) {
      lines.push(`- **${t("itin.popup.booking")}:** ${[stop["booking-platform"], stop["booking-reference"]].filter(Boolean).join(" — ")}`);
    }
    lines.push("");

    pois.forEach(poi => lines.push(...poiLines(poi)));
    if (pois.length > 0) lines.push("");
  });

  if (leftoverPois.length > 0) {
    lines.push(`## ${t("itin.story.otherPois")}`, "");
    leftoverPois.forEach(poi => lines.push(...poiLines(poi)));
    lines.push("");
  }

  return lines.join("\n");
}

function exportFileBaseName() {
  return (state.selectedItinerary || "itinerary")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "itinerary";
}

function exportMarkdown() {
  const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${exportFileBaseName()}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── PDF export (jsPDF + OpenLayers map images) ──────────────────────────────
//
// History of this map-image code, in order:
//  1. Fetched images from the public staticmap.openstreetmap.de service — turned out to be
//     unreachable (verified: even a bare <img src> to it fails), so every PDF export silently
//     produced zero maps (addMapImage()'s failure handling is deliberately non-blocking).
//  2. Hand-rolled: stitched OSM tiles onto a <canvas> ourselves, drawing markers/route/labels
//     manually. Fetched tiles through a server-side proxy (to comply with OSM's tile usage
//     policy — custom User-Agent, shared cache), which then caused its own 502s (no CA bundle
//     configured for curl HTTPS on this local Windows install) — fixed server-side. Then hit a
//     genuine "Out of Memory" browser crash: Web Mercator is undefined at the poles, so a
//     single bad-latitude record made our own tile-bounds math return ±Infinity, turning the
//     tile loop into a true infinite loop (`Infinity <= Infinity` is true in JS).
//  3. Tried screenshotting the *live* Leaflet map instead (closer to "what you see on screen"),
//     via two libraries — both failed on live testing: `leaflet-image`'s callback never fires
//     (effectively abandoned, incompatible with Leaflet 1.9.x); `html2canvas` renders our
//     divIcon markers fine but paints Leaflet's tiles as flat gray (a documented incompatibility
//     with Leaflet's CSS `translate3d`-transformed tile positioning).
//  4. **Current**: OpenLayers, which — unlike Leaflet — renders tiles *and* vector features
//     (markers, route line) onto a single <canvas> as its normal mode of operation, not via
//     DOM/CSS. No screenshot library needed: `renderStaticMapDataUrl()` builds a temporary,
//     off-screen OpenLayers map, waits for it to finish rendering (including all tiles), and
//     reads its own canvas directly. This also drops the hand-rolled Mercator math entirely
//     (`ol.View#fit()` handles fitting the bounding box, and OL's projection code — unlike our
//     one-off version — is production-tested against the pole-latitude edge case), and the
//     server-side tile proxy from step 2 (OpenLayers fetches tiles directly from the browser,
//     same confirmed-CORS-enabled tile.openstreetmap.org host Leaflet already uses).

async function loadOpenLayers() {
  if (window.ol) return;
  await new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/ol@v7.5.2/ol.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/ol@v7.5.2/dist/ol.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Renders a PNG data URL of `markers` (each `{lat, lng, color, number?, zIndex?}`) and, if
// `routePoints` (each `{lat, lng}`) has 2+ entries, a dashed route line connecting them, using
// a temporary off-screen OpenLayers map. `number` (if present) is drawn centered inside the
// marker circle, matching the live map's numbered icons — numbers alone (no name labels
// anywhere, not even on the leg maps that used to show one) are what's legible at any marker
// density; each stop/POI's full name is always in the text right next to the map instead.
async function renderStaticMapDataUrl(markers, routePoints, widthPx, heightPx, scale = 1) {
  const allPoints = [...markers, ...routePoints];
  if (allPoints.length === 0) return null;

  await loadOpenLayers();

  const container = document.createElement("div");
  container.style.cssText = `position:fixed; left:-9999px; top:-9999px; width:${widthPx}px; height:${heightPx}px;`;
  document.body.appendChild(container);

  try {
    const toXY = (p) => ol.proj.fromLonLat([p.lng, p.lat]);
    const features = [];

    if (routePoints.length > 1) {
      const line = new ol.Feature({ geometry: new ol.geom.LineString(routePoints.map(toXY)) });
      // zIndex 1.5: above every POI marker (1.x, see below) but below stop markers (2). Without
      // this the line defaulted to zIndex 0 — below everything — so whenever a POI happened to
      // sit right on (or very near) the route between two stops, the line vanished behind that
      // POI's circle instead of visibly passing through/behind it, making the line look like it
      // connected to the (green) POI rather than continuing on to the (blue) stop.
      line.setStyle(new ol.style.Style({
        zIndex: 1.5,
        stroke: new ol.style.Stroke({ color: "#3273dc", width: 1 * scale, lineDash: [3 * scale, 3 * scale] }),
      }));
      features.push(line);
    }

    markers.forEach(m => {
      const feature = new ol.Feature({ geometry: new ol.geom.Point(toXY(m)) });
      // zIndex is explicit and required here, not cosmetic: OpenLayers does not guarantee
      // vector features render in insertion order (its internal spatial index can visit them
      // in a different order), so two overlapping markers — e.g. a stop and a POI at nearly the
      // same coordinates — could render in either order without this. Found in the field: stop
      // markers were completely invisible on a real export, hidden under POI markers drawn on
      // top of them. `m.zIndex` (2 for stops, 1 for POIs — see the marker objects built in
      // buildPdf()) guarantees stops always render above POIs regardless of draw order.
      feature.setStyle(new ol.style.Style({
        zIndex: m.zIndex ?? 0,
        image: new ol.style.Circle({
          radius: 2.5 * scale,
          fill: new ol.style.Fill({ color: m.color }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 0.4 * scale }),
        }),
        text: m.number == null ? undefined : new ol.style.Text({
          text: String(m.number),
          font: `bold ${3 * scale}px sans-serif`,
          fill: new ol.style.Fill({ color: "#fff" }),
        }),
      }));
      features.push(feature);
    });

    const vectorSource = new ol.source.Vector({ features });

    // Fit the view *before* constructing the Map (rather than the more obvious-looking
    // "construct with a placeholder view, then call view.fit() right after") — found the hard
    // way that the latter is racy: the Map's very first render pass (triggered by construction,
    // showing the placeholder [0,0]/zoom 2 view) can satisfy OL's "rendercomplete" check before
    // the subsequent fit()-triggered render (the one that actually matters) has finished — or
    // even before it's started — so `map.once("rendercomplete", ...)` was firing too early and
    // resolving before the vector layer's route line/markers (added via fit() causing a second,
    // still-pending render) had actually painted. View#fit() works standalone (no map required,
    // just an explicit `size`), so there is only ever one relevant render pass this way.
    const view = new ol.View({ center: [0, 0], zoom: 2 });
    view.fit(vectorSource.getExtent(), { size: [widthPx, heightPx], padding: [30, 30, 30, 30], maxZoom: 17 });

    const map = new ol.Map({
      target: container,
      pixelRatio: scale,
      controls: [],
      interactions: [],
      layers: [
        new ol.layer.Tile({ source: new ol.source.OSM() }),
        new ol.layer.Vector({ source: vectorSource }),
      ],
      view,
    });

    try {
      await new Promise((resolve, reject) => {
        map.once("rendercomplete", resolve);
        setTimeout(() => reject(new Error("OpenLayers map render timed out")), 15000);
      });
      map.renderSync(); // force-flush any paint still pending at the moment rendercomplete fired

      // OpenLayers *can* render each layer (tile, vector) onto its own <canvas> rather than one
      // shared canvas, depending on configuration — grabbing only the first canvas found would
      // silently lose whichever layer wasn't first, so every layer canvas found is composited
      // onto one output canvas, in DOM order.
      //
      // Deliberately NOT applying each canvas's CSS `transform` here, unlike OL's own "export
      // map to PNG" example — found the hard way why that matters. With `pixelRatio: scale`,
      // each layer's actual canvas is rendered at `scale`× physical resolution but has a CSS
      // `transform: scale(1/scale)` applied so it *displays* at the map's logical (CSS) size —
      // e.g. matrix(0.4, 0, 0, 0.4, 0, 0) for scale = 2.5. OL's own recipe applies that same
      // transform when compositing onto an output canvas sized to the *logical* size (matching
      // what's shown on screen). This function's output canvas is intentionally sized to the
      // *physical* (already-scaled) resolution instead (`widthPx * scale`), matching each layer
      // canvas's own actual pixel dimensions exactly — so applying that extra 1/scale shrink on
      // top would draw the full-resolution content into only `1/scale` of the output canvas
      // (e.g. the left 40% of the width, at scale 2.5), leaving the rest blank. Confirmed: this
      // was the actual cause of exported map images visibly not reaching the intended width —
      // not a jsPDF or page-margin issue (verified separately: jsPDF places the image at exactly
      // the requested x/width, byte-for-byte, in the PDF's own content stream).
      const outputCanvas = document.createElement("canvas");
      outputCanvas.width = widthPx * scale;
      outputCanvas.height = heightPx * scale;
      const outputCtx = outputCanvas.getContext("2d");

      map.getViewport().querySelectorAll(".ol-layer canvas, canvas.ol-layer").forEach(layerCanvas => {
        if (layerCanvas.width === 0) return;
        const opacity = layerCanvas.parentNode.style.opacity || layerCanvas.style.opacity;
        outputCtx.globalAlpha = opacity === "" ? 1 : Number(opacity);
        outputCtx.drawImage(layerCanvas, 0, 0);
      });

      outputCtx.globalAlpha = 1;
      return outputCanvas.toDataURL("image/png");
    } finally {
      map.setTarget(null);
    }
  } finally {
    container.remove();
  }
}

async function buildPdf() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  function ensureSpace(height) {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function addText(text, { size = 11, bold = false, gap = 6 } = {}) {
    doc.setFontSize(size);
    doc.setFont(undefined, bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(String(text), contentWidth);
    ensureSpace(lines.length * gap);
    doc.text(lines, margin, y);
    y += lines.length * gap;
  }

  // mm-height a { text, size, gap } part will take once drawn via addText() — used to measure
  // a whole block (heading + its immediate content) *before* drawing any of it, so ensureSpace()
  // can move the entire block to a fresh page together rather than letting it split mid-block
  // and strand the heading alone at the bottom of the previous page.
  function partHeight({ text, size = 11, gap = 6 }) {
    doc.setFontSize(size);
    return doc.splitTextToSize(String(text), contentWidth).length * gap;
  }

  function drawParts(parts) {
    ensureSpace(parts.reduce((sum, p) => sum + partHeight(p), 0));
    parts.forEach(p => addText(p.text, p));
  }

  const MAP_PX_PER_MM = 3.78; // ~96dpi baseline (mm → px)
  const MAP_OVERSAMPLE = 3.5; // renders at 3.5x that resolution — see renderStaticMapDataUrl()

  // Best-effort: render the tile-stitched map image and place it, silently skipping on any
  // failure (e.g. all tile requests failing) rather than aborting the whole export. Map images
  // are sized/placed within the same margin/contentWidth every text element uses, so the page
  // has a consistent side margin throughout.
  async function addMapImage(markers, routePoints, heightMm) {
    if (markers.length === 0 && routePoints.length === 0) return;
    try {
      const dataUrl = await renderStaticMapDataUrl(
        markers, routePoints,
        Math.round(contentWidth * MAP_PX_PER_MM), Math.round(heightMm * MAP_PX_PER_MM),
        MAP_OVERSAMPLE
      );
      if (!dataUrl) return;
      ensureSpace(heightMm + 8);
      doc.addImage(dataUrl, "PNG", margin, y, contentWidth, heightMm);
      // OSM's tile usage policy requires visible attribution wherever the tiles are displayed,
      // printed pages included — the live map gets this "for free" from Leaflet's attribution
      // control, but renderStaticMapDataUrl() disables OL's own control (`controls: []`, so it
      // doesn't end up baked into the composited PNG at some arbitrary corner/size) and nothing
      // was drawing a replacement, so exported map images had no attribution at all. Fixed with
      // a small caption line under every map image (overview and leg maps alike, since both go
      // through this same function). doc.text()'s y is the text BASELINE, not its top — 1mm was
      // too little room for a 6pt font's ascenders (they poked up into the image); 4mm cleared
      // it but left a visibly oversized gap (also found in the field). 2.5mm is the middle
      // ground: still clears the ascenders, without the empty band.
      y += heightMm + 2.5;
      doc.setFontSize(6);
      doc.setFont(undefined, "normal");
      doc.setTextColor(120);
      doc.text("© OpenStreetMap contributors", pageWidth - margin, y, { align: "right" });
      doc.setTextColor(0);
      y += 4;
    } catch {
      // Map image unavailable — the rest of the PDF (text) still builds normally.
    }
  }

  addText(state.selectedItinerary || t("itin.selector.label"), { size: 18, bold: true, gap: 8 });
  y += 6;

  // Stable POI numbering (position in state.pois, already sorted by planned-date), shared by
  // every map image and the text below — the same POI always shows the same number wherever it
  // appears, so a marker on any map can be matched to its entry in the text underneath.
  const poiNumberByRef = new Map(state.pois.map((p, i) => [p, i + 1]));

  // No `label` here (unlike the leg maps below): the overview can have as many markers as
  // there are stops + POIs in the whole itinerary, and place-name text for every one of them
  // overlaps/collides into unreadable clutter (found in the field — labels ran off the right
  // edge and merged into each other). Numbers alone stay legible at any density; each stop's
  // full name is already in its own heading/text section right below the image anyway, and each
  // POI's number matches the one printed next to it in that same text (see poiParts() below).
  await addMapImage(
    [
      ...state.stops.map((s, i) => ({ lat: s.__lat, lng: s.__lng, color: "#3273dc", number: i + 1, zIndex: 2 })),
      // zIndex is unique per POI (1 + a small fraction of its number), not a flat 1 for all of
      // them: two POIs at the same zIndex have no guaranteed draw order between just themselves
      // (OL's spatial index, not insertion order, decides — same class of issue the stop/POI
      // zIndex fix addressed, just one tier down). Whichever one ends up on top always fully
      // hides the other's circle *and* number when zIndex actually differs (verified directly:
      // an isolated two-marker overlap test showed 0 leaked pixels from the covered marker's
      // text) — the fix here is just making sure POI-vs-POI comparisons have a real, stable
      // winner instead of tying at 1 for every POI.
      ...state.pois.map(p => ({ lat: p.__lat, lng: p.__lng, color: "#48c78e", number: poiNumberByRef.get(p), zIndex: 1 + poiNumberByRef.get(p) / 100000 })),
    ],
    state.stops.length > 1 ? state.stops.map(s => ({ lat: s.__lat, lng: s.__lng })) : [],
    70
  );

  const { groups, leftoverPois } = computeStoryGroups();

  const poiParts = (poi) => {
    const parts = [{ text: `${poiNumberByRef.get(poi)}. ${poi.name || poi.city || "—"}${poi["planned-date"] ? ` (${poi["planned-date"]})` : ""}`, size: 10 }];
    if (poi.description) parts.push({ text: poi.description, size: 9 });
    parts[parts.length - 1].gap = 5;
    return parts;
  };

  for (let i = 0; i < groups.length; i++) {
    const { stop, pois } = groups[i];

    const place = stopPlace(stop);
    const parts = [{ text: `${i + 1}. ${place || stop["property-name"] || stop.city || "—"}`, size: 14, bold: true, gap: 7 }];
    if (place) parts.push({ text: stop["property-name"] || stop.city || "—", size: 12, bold: true, gap: 6 });
    if (stop["accommodation-type"]) parts.push({ text: stop["accommodation-type"], size: 10 });

    if (stop["check-in-date"] || stop["check-out-date"]) {
      parts.push({
        text: `${t("itin.popup.checkin")}: ${stop["check-in-date"] || "—"}    ${t("itin.popup.checkout")}: ${stop["check-out-date"] || "—"}`,
      });
    }
    if (stop.address) parts.push({ text: stop.address });

    const flags = [];
    if (isTruthyFlag(stop["breakfast-included"])) flags.push(t("itin.popup.breakfast"));
    if (isTruthyFlag(stop["parking-included"])) flags.push(t("itin.popup.parking"));
    if (flags.length) parts.push({ text: flags.join(" · ") });

    if (stop["booking-platform"] || stop["booking-reference"]) {
      parts.push({ text: `${t("itin.popup.booking")}: ${[stop["booking-platform"], stop["booking-reference"]].filter(Boolean).join(" — ")}` });
    }

    // Only the heading + its immediate details are measured/moved as one "keep together" unit
    // (drawParts) — deliberately *not* the nested POI list appended after it. A stop with many
    // POIs assigned to it (that data-driven, so unbounded) made the whole block, POIs included,
    // exceed a full page's remaining space and get bumped to a fresh page wholesale — leaving
    // most of the *previous* page blank, found in the field on a real export. Only the short,
    // bounded part (heading/type/dates/address/flags/booking) needs the stranding guard from
    // drawParts()'s original fix; each POI entry already gets its own ensureSpace() via addText()
    // and can flow across a page break on its own without looking like a stranded heading.
    drawParts(parts);
    // drawParts() per POI (not addText() per part): each POI's title+description is a small,
    // bounded unit (at most 2 parts) that should never be split by a page break — unlike the
    // stop's own heading+POI-list bug fixed earlier, this doesn't reintroduce that problem
    // because it's scoped to one POI at a time, not the unbounded list of all of them together.
    pois.forEach(poi => drawParts(poiParts(poi)));
    y += 2;

    if (i < groups.length - 1) {
      const to = groups[i + 1].stop;
      await addMapImage(
        [
          { lat: stop.__lat, lng: stop.__lng, color: "#3273dc", number: i + 1, zIndex: 2 },
          { lat: to.__lat, lng: to.__lng, color: "#3273dc", number: i + 2, zIndex: 2 },
          ...[...pois, ...groups[i + 1].pois].map(p => ({ lat: p.__lat, lng: p.__lng, color: "#48c78e", number: poiNumberByRef.get(p), zIndex: 1 + poiNumberByRef.get(p) / 100000 })),
        ],
        [{ lat: stop.__lat, lng: stop.__lng }, { lat: to.__lat, lng: to.__lng }],
        55
      );
    }
    y += 3;
  }

  if (leftoverPois.length > 0) {
    const heading = { text: t("itin.story.otherPois"), size: 13, bold: true, gap: 7 };
    drawParts([heading, ...poiParts(leftoverPois[0])]);
    leftoverPois.slice(1).forEach(poi => drawParts(poiParts(poi)));
  }

  return doc;
}

async function exportPdf() {
  if (state.pdfExporting) return;
  state.pdfExporting = true;
  state.pdfExportError = null;
  mount();

  try {
    await loadJsPdf();
    const doc = await buildPdf();
    doc.save(`${exportFileBaseName()}.pdf`);
  } catch (e) {
    state.pdfExportError = normalizeApiError(e).message;
  }

  state.pdfExporting = false;
  mount();
}

function StoryOverviewBlock() {
  if (state.stops.length === 0 && state.pois.length === 0) return "";
  return html`
    <div class="box mb-4">
      <div id="story-overview-map" style="height:320px; border-radius:6px; overflow:hidden;"></div>
    </div>
  `;
}

function LegMapBlock(from, to, index) {
  return html`
    <div class="box">
      <p class="is-size-7 has-text-grey mb-2">
        ${stopLabel(from)} &rarr; ${stopLabel(to)}
      </p>
      <div id="story-leg-map-${index}" style="height:220px; border-radius:6px; overflow:hidden;"></div>
    </div>
  `;
}

function StoryView() {
  const { groups, leftoverPois } = computeStoryGroups();
  return html`
    <div>
      <div class="mb-2" style="text-align:right">
        <div class="buttons" style="justify-content:flex-end">
          <button class="button is-small is-primary" @click=${exportMarkdown}>
            <span class="icon"><i class="ri-file-download-line"></i></span>
            <span>${t("itin.story.btn.export")}</span>
          </button>
          <button
            class="button is-small is-primary ${state.pdfExporting ? "is-loading" : ""}"
            ?disabled=${state.pdfExporting}
            @click=${exportPdf}
          >
            <span class="icon"><i class="ri-file-pdf-line"></i></span>
            <span>${t("itin.story.btn.exportPdf")}</span>
          </button>
        </div>
      </div>

      ${state.pdfExportError ? html`
        <article class="message is-danger mb-4">
          <div class="message-body">${t("itin.story.error.pdfExport", state.pdfExportError)}</div>
        </article>
      ` : ""}

      ${StoryOverviewBlock()}

      ${groups.map(({ stop, pois }, i) => {
        const nextStop = i < groups.length - 1 ? groups[i + 1].stop : null;
        return html`
          <div class="columns mb-4">
            <div class="column ${nextStop ? "is-7" : "is-12"}">${StoryStopEntry(stop, pois, i)}</div>
            ${nextStop ? html`<div class="column is-5">${LegMapBlock(stop, nextStop, i)}</div>` : ""}
          </div>
        `;
      })}

      ${leftoverPois.length > 0 ? html`
        <div class="box">
          <h4 class="title is-6 mb-3">${t("itin.story.otherPois")}</h4>
          ${leftoverPois.map(poi => StoryPoiEntry(poi))}
        </div>
      ` : ""}
    </div>
  `;
}

function App() {
  return html`
    <div class="container pt-0 pb-4">
      <div class="box spa-title-box">
        ${state.error ? html`
          <article class="message is-danger mb-0">
            <div class="message-body">
              ${state.error}
              <div class="mt-2">
                <button class="button is-small is-danger is-light" @click=${loadAll}>${t("itin.btn.retry")}</button>
              </div>
            </div>
          </article>
        ` : ""}

        ${state.loading ? html`<progress class="progress is-small is-primary" style="max-width:300px"></progress>` : ""}

        ${!state.loading && !state.error ? ItinerarySelector() : ""}

        ${!state.loading && !state.error && state.skippedCount > 0 ? html`
          <article class="message is-warning mb-4">
            <div class="message-body">${t("itin.warn.skipped", state.skippedCount)}</div>
          </article>
        ` : ""}

        ${!state.loading && !state.error && state.skippedPoiCount > 0 ? html`
          <article class="message is-warning mb-4">
            <div class="message-body">${t("itin.warn.skippedPoi", state.skippedPoiCount)}</div>
          </article>
        ` : ""}

        ${!state.loading && !state.error && state.poiTableMissing ? html`
          <p class="has-text-grey is-size-7 mb-4">${t("itin.poi.notFound")}</p>
        ` : ""}

        ${!state.loading && !state.error && state.stops.length === 0 && state.pois.length === 0 ? html`
          <p class="has-text-grey">${t("itin.empty")}</p>
        ` : ""}

        ${!state.loading && !state.error && (state.stops.length > 0 || state.pois.length > 0) ? html`
          ${ViewModeToggle()}

          ${state.viewMode === "map" ? html`
            <div class="columns mb-0">
              <div class="column is-4">${Sidebar()}</div>
              <div class="column is-8">
                <div id="itin-map-container" style="height:520px; border-radius:6px; overflow:hidden;"></div>
              </div>
            </div>
          ` : ""}

          ${state.viewMode === "story" ? StoryView() : ""}
        ` : ""}
      </div>
    </div>
  `;
}

function mount() {
  render(App(), root);
}

mount();
loadAll();
