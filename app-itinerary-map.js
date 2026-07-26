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
  setTimeout(initMap, 0);
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
  if (stop.notes) rows.push(`<div><strong>${t("itin.popup.notes")}:</strong> ${stop.notes}</div>`);
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
  if (poi.price) rows.push(`<div><strong>${t("itin.poi.popup.price")}:</strong> ${poi.price}</div>`);
  if (poi.address) rows.push(`<div>${poi.address}</div>`);
  if (poi.description) rows.push(`<div>${poi.description}</div>`);
  const flags = [];
  if (isTruthyFlag(poi["booking-required"])) flags.push(t("itin.poi.popup.bookingRequired"));
  if (isTruthyFlag(poi["kid-friendly"])) flags.push(t("itin.poi.popup.kidFriendly"));
  if (flags.length) rows.push(`<div>${flags.join(" · ")}</div>`);
  if (poi.priority) rows.push(`<div><strong>${t("itin.poi.popup.priority")}:</strong> ${poi.priority}</div>`);
  if (poi["linked-accommodation"]) rows.push(`<div><strong>${t("itin.poi.popup.linkedAccommodation")}:</strong> ${poi["linked-accommodation"]}</div>`);
  if (poi.notes) rows.push(`<div><strong>${t("itin.popup.notes")}:</strong> ${poi.notes}</div>`);
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

  const osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
  leafletMap = L.map(container, { center: [0, 0], zoom: 2, layers: [osmLayer] });

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
          <div class="columns mb-0">
            <div class="column is-4">${Sidebar()}</div>
            <div class="column is-8">
              <div id="itin-map-container" style="height:520px; border-radius:6px; overflow:hidden;"></div>
            </div>
          </div>
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
