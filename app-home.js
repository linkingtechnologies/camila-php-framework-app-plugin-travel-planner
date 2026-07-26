// app-home.js
import { html, render } from "../../../../camila/js/lit-html/lit-html.js";

const root = document.getElementById("app");

if (typeof WorkTableClient !== "function") {
  render(html`<div class="notification is-danger">WorkTableClient not available</div>`, root);
  throw Error("WorkTableClient not available");
}

// Unused here (this view is pure display of server-injected config), kept for
// consistency with the SPA entry point contract in AGENTS.md.
WorkTableClient(window.APP_CONFIG || {});

const t = (key, ...args) => {
  let s = window.I18N?.[key] ?? key;
  args.forEach(a => { s = s.replace('%s', a); });
  return s;
};

const state = {
  mcpUrl:     window.APP_CONFIG?.mcpDefaultUrl || "",
  copyStatus: null, // null | 'copied' | 'error'
};

let copyStatusTimer = null;

async function copyMcpUrl() {
  clearTimeout(copyStatusTimer);
  try {
    await navigator.clipboard.writeText(state.mcpUrl);
    state.copyStatus = "copied";
  } catch {
    state.copyStatus = "error";
  }
  mount();
  copyStatusTimer = setTimeout(() => {
    state.copyStatus = null;
    mount();
  }, 2000);
}

function App() {
  return html`
    <div class="container pt-0 pb-4">
        <div class="box spa-title-box">
          <label class="label">${t("home.mcpEndpoint.label")}</label>
          <div class="field has-addons">
            <div class="control is-expanded">
              <input class="input" type="text" readonly .value=${state.mcpUrl} @click=${e => e.target.select()} />
            </div>
            <div class="control">
              <button class="button is-primary" @click=${copyMcpUrl}>
                <span class="icon"><i class="ri-clipboard-line"></i></span>
                <span>${t("home.mcpEndpoint.btn.copy")}</span>
              </button>
            </div>
          </div>
          ${state.copyStatus === "copied" ? html`<p class="help is-success">${t("home.mcpEndpoint.copied")}</p>` : ""}
          ${state.copyStatus === "error" ? html`<p class="help is-danger">${t("home.mcpEndpoint.copyError")}</p>` : ""}
        </div>
      </div>
  `;
}

function mount() {
  render(App(), root);
}

mount();
