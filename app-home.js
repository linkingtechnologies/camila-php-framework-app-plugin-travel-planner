// app-home.js
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

// ── Helpers (same resolution rules as app-itinerary-map.js) ────────────────

function getRecords(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.records)) return res.records;
  return [];
}

function resolveTableFromList(tables, regex) {
  const found = tables.find(tbl => regex.test(tbl.short_title || "") || regex.test(tbl.name || ""));
  return found?.name ?? null;
}

const state = {
  loading:     true,
  itineraries: [],  // distinct, sorted, non-empty "itinerary" values across Accommodations + POI tables
};

// ── Itineraries summary (non-blocking: empty list on any failure) ─────────

async function loadItineraries() {
  try {
    const tablesRes = await client.tables({ metadata: "1" });
    const tables = Array.isArray(tablesRes?.tables) ? tablesRes.tables : [];

    const accTableName = resolveTableFromList(tables, /accom+odation/i);
    const poiTableName = resolveTableFromList(tables, /points?[\s-]*of[\s-]*interest/i);

    const itinerarySet = new Set();
    for (const tableName of [accTableName, poiTableName]) {
      if (!tableName) continue;
      const res = await client.table(tableName).distinct("itinerary");
      for (const r of getRecords(res)) {
        const v = String(r.itinerary ?? "").trim();
        if (v) itinerarySet.add(v);
      }
    }

    state.itineraries = [...itinerarySet].sort((a, b) => a.localeCompare(b));
  } catch {
    state.itineraries = []; // non-blocking: falls through to the empty state
  }
  state.loading = false;
  mount();
}

function App() {
  return html`
    <div class="container pt-0 pb-4">
      <div class="box spa-title-box">
        <h4 class="title is-6 mb-3">${t("home.itineraries.title")}</h4>

        ${state.loading ? html`<progress class="progress is-small is-primary" style="max-width:300px"></progress>` : ""}

        ${!state.loading && state.itineraries.length === 0 ? html`
          <p class="has-text-grey">${t("home.itineraries.empty")}</p>
        ` : ""}

        ${!state.loading && state.itineraries.length > 0 ? html`
          <div class="tags">
            ${state.itineraries.map(name => html`
              <a class="tag is-link is-light mb-0" href=${"?dashboard=itinerary-map&itinerary=" + encodeURIComponent(name)}>${name}</a>
            `)}
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
loadItineraries();
