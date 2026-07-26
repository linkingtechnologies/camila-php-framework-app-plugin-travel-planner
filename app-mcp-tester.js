// app-mcp-tester.js
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

// ── State ──────────────────────────────────────────────────────────────────

const initialResults = {
  connected:       false,
  error:           null,   // { step: 'validate'|'initialize'|'tools', message }
  sessionId:       null,
  serverInfo:      null,   // { name, version }
  protocolVersion: null,
  tools:           null,   // array | null
};

const state = {
  url:        window.APP_CONFIG?.mcpDefaultUrl || "",
  authHeader: "",
  connecting: false,
  ...initialResults,
};

let cancelled = false;

// ── Helpers ────────────────────────────────────────────────────────────────

function normalizeApiError(err) {
  const raw = err?.payload ?? err?.response ?? err;
  const status  = raw?.status ?? raw?.statusCode ?? err?.status ?? err?.statusCode;
  const message = raw?.message ?? err?.message ?? raw?.error?.message
    ?? (typeof raw === "string" ? raw : "Unknown error");
  return { status, message };
}

function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

async function callProxy(url, authHeader, sessionId, payload) {
  const res = await client.call("POST", "/ai-toolbox/mcp-proxy", { url, authHeader, sessionId, payload });
  return res;
}

// ── Actions ────────────────────────────────────────────────────────────────

function resetResults() {
  Object.assign(state, initialResults);
}

function onFieldInput(key, value) {
  state[key] = value;
  cancelled = true; // invalidate any in-flight sequence for the previous inputs
  resetResults();
  mount();
}

async function connect() {
  const url = state.url.trim();
  if (!isValidUrl(url)) {
    resetResults();
    state.error = { step: "validate", message: t("mcp.error.invalidUrl") };
    mount();
    return;
  }

  cancelled = false;
  const myRun = () => cancelled;

  resetResults();
  state.connecting = true;
  mount();

  const authHeader = state.authHeader.trim();

  try {
    // 1) initialize
    const initRes = await callProxy(url, authHeader, null, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "ai-toolbox-mcp-tester", version: "1.0.0" },
      },
    });
    if (myRun()) return;

    if (initRes?.body?.error) {
      state.error = { step: "initialize", message: `${initRes.body.error.message ?? "Unknown error"}${initRes.body.error.code != null ? ` (code ${initRes.body.error.code})` : ""}` };
      state.connecting = false;
      mount();
      return;
    }
    if (!initRes?.body?.result) {
      state.error = { step: "initialize", message: initRes?.raw ?? "Empty response" };
      state.connecting = false;
      mount();
      return;
    }

    const sessionId = initRes.sessionId || null;
    state.sessionId       = sessionId;
    state.serverInfo       = initRes.body.result.serverInfo ?? null;
    state.protocolVersion = initRes.body.result.protocolVersion ?? null;

    // 2) notifications/initialized — fire and forget
    await callProxy(url, authHeader, sessionId, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    if (myRun()) return;

    // 3) tools/list
    const toolsRes = await callProxy(url, authHeader, sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    if (myRun()) return;

    if (toolsRes?.body?.error) {
      state.error = { step: "tools", message: `${toolsRes.body.error.message ?? "Unknown error"}${toolsRes.body.error.code != null ? ` (code ${toolsRes.body.error.code})` : ""}` };
      state.connecting = false;
      mount();
      return;
    }

    state.tools     = toolsRes?.body?.result?.tools ?? [];
    state.connected = true;
    state.connecting = false;
    mount();
  } catch (e) {
    if (myRun()) return;
    const norm = normalizeApiError(e);
    state.error = { step: state.serverInfo ? "tools" : "initialize", message: norm.message };
    state.connecting = false;
    mount();
  }
}

// ── View ───────────────────────────────────────────────────────────────────

function ServerInfoBox() {
  if (!state.serverInfo && !state.protocolVersion) return "";
  return html`
    <div class="box mb-4">
      <h4 class="title is-6 mb-2">${t("mcp.serverInfo.title")}</h4>
      <table class="table is-small is-narrow is-fullwidth">
        <tbody>
          <tr><th>${t("mcp.serverInfo.name")}</th><td>${state.serverInfo?.name ?? "—"}</td></tr>
          <tr><th>${t("mcp.serverInfo.version")}</th><td>${state.serverInfo?.version ?? "—"}</td></tr>
          <tr><th>${t("mcp.serverInfo.protocol")}</th><td>${state.protocolVersion ?? "—"}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

function ToolsList() {
  if (state.tools === null) return "";
  return html`
    <div class="box">
      <h4 class="title is-6 mb-3">${t("mcp.tools.title", state.tools.length)}</h4>
      ${state.tools.length === 0
        ? html`<p class="has-text-grey">${t("mcp.tools.empty")}</p>`
        : state.tools.map(tool => html`
            <div class="mb-4">
              <p><strong>${tool.name}</strong></p>
              ${tool.description ? html`<p class="has-text-grey">${tool.description}</p>` : ""}
              ${tool.inputSchema ? html`
                <details>
                  <summary>${t("mcp.tools.inputSchema")}</summary>
                  <pre style="white-space:pre-wrap; word-break:break-word;">${JSON.stringify(tool.inputSchema, null, 2)}</pre>
                </details>
              ` : ""}
            </div>
          `)}
    </div>
  `;
}

function App() {
  return html`
    <div class="container pt-0 pb-4">
        <div class="box mb-4 spa-title-box">
          <div class="field">
            <label class="label">${t("mcp.field.url")}</label>
            <div class="control">
              <input
                class="input"
                type="text"
                .value=${state.url}
                placeholder=${t("mcp.field.url.placeholder")}
                @input=${e => onFieldInput("url", e.target.value)}
              />
            </div>
          </div>
          <div class="field">
            <label class="label">${t("mcp.field.authHeader")}</label>
            <div class="control">
              <input
                class="input"
                type="text"
                .value=${state.authHeader}
                placeholder=${t("mcp.field.authHeader.placeholder")}
                @input=${e => onFieldInput("authHeader", e.target.value)}
              />
            </div>
          </div>
          <div class="field">
            <div class="control">
              <button
                class="button is-primary ${state.connecting ? "is-loading" : ""}"
                ?disabled=${state.connecting}
                @click=${connect}
              >
                <span class="icon"><i class="ri-plug-line"></i></span>
                <span>${state.connecting ? t("mcp.btn.connecting") : t("mcp.btn.connect")}</span>
              </button>
            </div>
          </div>
        </div>

        ${state.error ? html`
          <article class="message is-danger mb-4">
            <div class="message-body">
              ${state.error.step === "initialize" ? t("mcp.error.step.initialize", state.error.message)
                : state.error.step === "tools" ? t("mcp.error.step.tools", state.error.message)
                : state.error.message}
            </div>
          </article>
        ` : ""}

      ${ServerInfoBox()}
      ${ToolsList()}
    </div>
  `;
}

function mount() {
  render(App(), root);
}

mount();
