# CAMILA WorkTable Plugin — SPA Development Guide

## Purpose

This directory is the **travel-planner** plugin — a scaffold for building lightweight Single Page Applications on the CAMILA WorkTable platform.

The plugin is part of the **CAMILA WorkTable** ecosystem:

- **Framework**: [camila-php-framework](https://github.com/linkingtechnologies/camila-php-framework) — PHP backend providing the WorkTable REST API, authentication, and table management.
- **Plugin**: this directory, containing SPAs and their PHP mount files.

SPAs run entirely in the browser and communicate with the backend exclusively via `WorkTableClient`, which wraps the CAMILA WorkTable REST API.

AI agents working in this repository must generate and modify SPA modules that are deterministic, state-safe, backward-compatible, and easy to review.

The primary goal is to build administrative tools without introducing unnecessary framework complexity or speculative architecture.

---

## SPA Specifications

Each SPA has a dedicated specification directory under `specs/`. Read the relevant spec before modifying a SPA.

Each spec directory contains:
- `use-case.md` — expected behavior (the "what"): goal, actors, main scenario, alternative flows in Cockburn style
- `design.md` — technical decisions (the "how"): state shape, tables involved, merge logic, payload

If implementation and specification disagree, report the discrepancy. Do not silently change behavior.

---

## Specification Style

### use-case.md — the "what"

Cockburn-style use case with the following sections, in order:

1. **ID** — short code (UC-XXX) and one-line description
2. **System context** — where this SPA fits in the workflow (skip if standalone)
3. **Goal** — one paragraph, user-facing outcome
4. **Primary Actor** — who operates it
5. **Stakeholders and interests** — table: stakeholder | interest
6. **Preconditions** — bullet list
7. **Postconditions — Success** — what is true after success
8. **Postconditions — Error / Partial failure** — what happens on failure
9. **Status classification** *(if applicable)* — table mapping data conditions to UI labels
10. **Main Success Scenario** — one sub-section per wizard step or view, with numbered steps
11. **Extensions** — coded as `Na.` (step N, alternative a): empty states, API errors, validation failures, partial failures

Rules:
- Steps describe observable behavior, not implementation details
- Do not mention lit-html, state variables, or JS internals
- Do mention WorkTable table names, field names, and business rules
- Keep each step to one sentence where possible

### design.md — the "how"

Technical reference for implementors:

1. **Structure** — wizard steps or views with ASCII flow diagram
2. **State shape** — full JS object with all keys and types/defaults
3. **Tables involved** — table: operation | WorkTable table name
4. **Merge logic** *(if applicable)* — merge key, priority rules, field resolution strategy
5. **Payload** — exact field names and values written to each table
6. **Classification logic** *(if applicable)* — code-level rules for categorizing records
7. **Other technical notes** — loading strategy, draft editing pattern, sequence API, non-obvious guards

Rules:
- Use code blocks for state shape, payload examples, and classification logic
- Use tables for tables involved
- Note divergences from the patterns documented in this AGENTS.md

---

## Core Principles

### 1. Deterministic behavior

Generated code must behave predictably across reloads, repeated operations, pagination changes, filtering, sorting, and editing flows.

Avoid hidden state transitions and implicit side effects.

### 2. State safety

State must be explicit and reset when the active context changes.

Examples of context changes:
- selected table / tab / record / organization / event
- editor mode
- wizard step

Do not reuse stale drafts or stale API responses across contexts.

### 3. Backward compatibility

Prefer additive changes.

Do not rename existing state keys, API fields, table names, or DOM assumptions unless explicitly instructed.

Do not remove existing behavior without a matching specification change.

### 4. No speculative refactors

Do not rewrite working code for style, abstraction, or framework preference.

Only refactor when required by the requested behavior or when explicitly instructed.

### 5. Explicit over generic

Prefer explicit mappings and configuration objects over generic magic:
- explicit table names
- explicit field lists
- explicit label overrides
- explicit filterable columns
- explicit derived-field rules

---

# Frontend Runtime

## Rendering

Use `lit-html` templates.

Do not introduce React, Vue, Angular, Svelte, Solid, Alpine, JSX build steps, or virtual DOM frameworks.

Templates should be pure functions of state wherever possible.

## lit-html — `<select>` with dynamic value

The `.value` binding on a `<select>` **is unreliable** in lit-html when options are dynamic or loaded asynchronously. The browser applies `.value` only if the matching option already exists in the DOM; if options arrive later (e.g. after an API call), the select silently falls back to the first element.

**Rule:** always use `?selected` on every `<option>`.

```js
// WRONG
html`<select .value=${current}>
  ${opts.map(o => html`<option value=${o}>${o}</option>`)}
</select>`

// CORRECT
html`<select @change=${e => onChange(e.target.value)}>
  ${opts.map(o => html`<option value=${o} ?selected=${current === o}>${o}</option>`)}
</select>`
```

This rule applies to all `<select>` elements whose value or options depend on async state.

## Styling

Use:
- Bulma CSS
- Remix Icons (`ri-*` classes)

Do not introduce additional UI frameworks unless explicitly requested.

## Admin page layout pattern

Admin dashboard SPAs must follow the visual pattern of `/cf_app.php?admin&dashboard=users`, adapted for this plugin as follows: **do not render a separate page-title box.** The tab bar above the SPA already names the page (e.g. "HOME", "ITINERARY MAP"); repeating that text in an `<h3>` right below it is redundant, and looks especially odd once the first box is visually attached to the tab bar (see `.spa-title-box` below). Go straight into the toolbar/first content box instead:

```
<div class="container pt-0 pb-4">                        ← no side padding: content touches
                                                             the tab bar's left/right edges
  <div class="box spa-title-box"> ... first content ... </div>   ← spa-title-box: squared top
                                                                     corners + blue top border,
                                                                     touches the tab bar above

<div class="level mb-3">                                 ← toolbar row
  <div class="level-left"> ... </div>                    ← search / info (optional)
  <div class="level-right">
    <button class="button is-primary is-small">          ← primary action
      <span class="icon"><i class="ri-*-line"></i></span>
      <span>Label</span>
    </button>
  </div>
</div>

<!-- inline error (no section/container wrapper) -->
<article class="message is-danger">
  <div class="message-body">...</div>
</article>

<!-- inline non-blocking warning -->
<article class="message is-warning">
  <div class="message-body">...</div>
</article>

<!-- loading bar (initial load only) -->
<progress class="progress is-small is-primary"></progress>

<table class="table is-fullwidth is-striped is-hoverable">
  ...
</table>
```

Rules:
- No separate page-title box (see above) — the toolbar (or first content box) is always rendered (button is disabled, not hidden, when inactive)
- Errors and warnings appear inline between the toolbar and the table — no `section`/`container` wrappers
- Progress bar appears only during the initial data load, not during per-row operations
- Per-row progress: `<progress class="progress is-small" style="max-width:160px">` inside the cell
- Result tags: `<span class="tag is-light is-success">` / `<span class="tag is-light is-danger">`
- Warning tags (non-blocking data alerts): `<span class="tag is-warning is-light">`

## Layout

Use responsive, non-fragile layouts.

Prefer:
- `flex-wrap`
- `min-width: 0`
- Bulma utility classes
- compact forms and tables for administrative screens

Avoid fixed widths unless needed for compact action columns.

## Module loading

SPA modules may be dynamically imported.

When the existing application uses cache-busting imports, preserve that behavior:

```js
import(`./views/my-module/step${n}.js?v=${VERSION}`)
```

`VERSION` must come from `window.APP_CONFIG?.version` with `Date.now()` as fallback:

```js
const VERSION = window.APP_CONFIG?.version || Date.now();
```

Do not introduce a bundler requirement unless explicitly requested.

---

# SPA Entry Points

Each SPA lives in a single `app-<name>.js` file at the plugin root.

An entry point must:

1. Import `html` and `render` from `lit-html`
2. Define `VERSION` via `APP_CONFIG` or `Date.now()`
3. Obtain `root` via `document.getElementById("app")`
4. Initialize `client` via `WorkTableClient(window.APP_CONFIG || {})`
5. Define only the state properties the SPA actually uses
6. Call `mount()` (or `render(App(), root)`) to start rendering

Single-view SPAs must not carry unused `step`, `org`, or wizard state.

Wizard SPAs must guard each step transition: if required preceding state is missing, redirect back to step 1.

---

# PHP Mount Files

Each SPA requires a PHP mount file (`<name>.inc.php`) and a thin dashboard wrapper (`dashboard-<id>.inc.php`).

## Manual mount pattern

Use the manual mount pattern (not `mountMiniApp`) when the SPA needs `window.APP_CONFIG` or `window.I18N` injected before the module loads:

**Naming warning:** never name the local translations array `$i18n`. Dashboard mount files are `require()`'d at global scope (`cf_app.php` → `header.php`/`views/cf_app.inc.php` → `dashboards.inc.php` → `dashboard-<id>.inc.php`), so a top-level `$i18n = [...]` here becomes a real PHP global and overwrites camila's own `global $i18n` (a `CamilaTranslator` instance set in `camila_hawhaw.php`, used by TinyButStrong's `onshow` auto-merge to render the header's logout/preferences links). That collision breaks the top menu with a TBS error ("item 'getTranslation(...)' is not an existing key in the array") because TBS then finds a plain array instead of the expected object. Use `$pluginI18n` (or any non-colliding name) instead.

```php
<?php
global $_CAMILA;

$camilaUI = new CamilaUserInterface();
$scheme   = $camilaUI->isHttps() ? 'https' : 'http';
$host     = $_SERVER['HTTP_HOST'];
$config   = [
    'baseUrl'           => $scheme . '://' . $host . '/app/' . CAMILA_APP_DIR . '/cf_api.php',
    'apiKeyHeaderName'  => 'Authorization',
    'apiKeyHeaderValue' => 'PHPSESSID',
];

$pluginI18n = [/* ... keys loaded from plugin lang file ... */];

$refrCode  = "<script src='../../camila/js/worktable-client.js'></script>";
$refrCode .= "<script>window.APP_CONFIG = " . json_encode($config, JSON_UNESCAPED_SLASHES) . "</script>";
$refrCode .= "<script>window.I18N = "       . json_encode($pluginI18n, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "</script>";
$_CAMILA['page']->add_raw(new HAW_raw(HAW_HTML, $refrCode));

$html = <<<HTML
<div id="app"></div>
<script nomodule>
  document.body.innerHTML = `<section class="section"><div class="container">
    <article class="message is-danger">
      <div class="message-header"><p>Browser not supported</p></div>
      <div class="message-body">This application requires a modern browser (Chrome or Edge).</div>
    </article></div></section>`;
</script>
HTML;

$_CAMILA['page']->add_raw(new HAW_raw(HAW_HTML, $html));
$_CAMILA['page']->camila_add_js("<link href=\"plugins/travel-planner/app.css\" rel=\"stylesheet\">\n");
$_CAMILA['page']->camila_add_js('<script type="module" src="./plugins/travel-planner/app-<name>.js"></script>');
?>
```

## Plugin lang loading

Plugin-specific i18n keys live in `lang/{lang}.lang.php`. Load them with a helper function — do not use `camila_get_translation()` for plugin keys:

```php
function ai_load_lang(string $langDir, string $lang): array {
    $file = $langDir . '/' . $lang . '.lang.php';
    if (!is_file($file)) $file = $langDir . '/en.lang.php';
    if (!is_file($file)) return [];
    $map = [];
    foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (ltrim($line)[0] === '/') continue;
        $parts = explode(' = ', $line, 2);
        if (count($parts) === 2) $map[trim($parts[0])] = trim($parts[1]);
    }
    return $map;
}

$lang       = ai_load_lang(__DIR__ . '/lang', $_CAMILA['lang'] ?? 'en');
$pluginI18n = [
    'key' => $lang['plugin.key'] ?? '',
    // ...
];
```

Do not name this array `$i18n` — see the naming warning in "Manual mount pattern" above.

Lang file format (`lang/en.lang.php`):

```
// English — travel-planner plugin
plugin.page.title = My Page Title
plugin.btn.save   = Save
plugin.error      = Error
```

Rules:
- Line comments start with `//`
- Key/value separator is ` = ` (space-equals-space)
- Fallback is always `en.lang.php`
- Pass `%s` placeholders in values; replace with positional args in JS via `t(key, value)`

## JS i18n helper

```js
const t = (key, ...args) => {
  let s = window.I18N?.[key] ?? key;
  args.forEach(a => { s = s.replace('%s', a); });
  return s;
};
```

---

# Navigation

Navigation is manual and state-driven.

Allowed patterns:
- wizard-style `state.step`
- tab-based `state.activeTab`
- explicit `goTo(step)`
- full reload when browser history consistency is at risk

Avoid introducing a router framework.

Prefer full reload over complex history manipulation when consistency matters.

---

# Data Access

All data access must use `WorkTableClient`.

## Table-bound operations

```js
client.table(tableName).list(query)
client.table(tableName).read(id)
client.table(tableName).create(payload)
client.table(tableName).update(id, payload)
client.table(tableName).remove(id)
client.table(tableName).describe(query)
client.table(tableName).permissions(query)
client.table(tableName).distinct(column, query)
```

## Public operations

```js
client.list(tableName, query)
client.read(tableName, id)
client.create(tableName, payload)
client.update(tableName, id, payload)
client.remove(tableName, id)
client.describe(tableName, query)
client.permissions(tableName, query)
client.distinct(tableName, column, query)
client.filter(column, operator, ...values)
client.negate(operator)
```

## Tables enumeration

```js
// List all visible tables (plain list)
client.tables()

// With metadata (id + short_title per table)
client.tables({ metadata: "1" })

// With metadata and record count
client.tables({ metadata: "1", count: "1" })
// Response: { tables: [{ name, id, short_title, count }] }
```

## Import

```js
// Import an example file into a worktable (server-side file path)
client.importTable(name, filepath)
// name:     DB table name (e.g. "sc_worktable29")
// filepath: path relative to CAMILA_APP_PATH
// Response: { status, imported, failed, total }
```

## Custom plugin endpoints

```js
// Call any plugin-specific endpoint with auth applied
client.call(method, path, body, query)
// method: "GET"|"POST"|"PUT"|"DELETE"|"PATCH"
// path:   e.g. "/travel-planner/my-endpoint"
// body:   optional JSON object
// query:  optional plain object → query string
```

Do not introduce alternative API clients or abstraction layers unless explicitly requested.

### Implementing a custom plugin endpoint (PHP side)

`client.call()` reaches `api/handlers.inc.php`, which is `require`-d by `Tqdev\PhpCrudApi\CamilaPluginController` (in `camila/api.include.php`) on every API request. That file must **`return` an array** mapping `'METHOD /path'` (relative — no `/travel-planner` prefix) to a callable:

```php
<?php
return [
    'GET /my-endpoint' => function ($params, $body, $segments) {
        // $params: query string params, $body: decoded JSON body (array|null), $segments: URL path segments
        return ['ok' => true];               // 200, JSON-encoded
    },
    'POST /my-endpoint' => function ($params, $body, $segments) {
        return ['__status' => 400, 'error' => 'bad_request']; // '__status' sets the HTTP status and is stripped from the payload
    },
];
```

A file that does not `return` an array (e.g. a bare procedural script with `if ($method === ...) { echo ...; exit; }`) is silently ignored — its routes are never registered, and any request to them fails with `Route '...' not found`. There is no `$method`/`$path` global available to this file; use the route array keys and the callable arguments instead.

---

# WorkTable Query Rules

## Listing records

```js
client.table(tableName).list({
  include,    // string | string[]  — fields to return
  exclude,    // string | string[]  — fields to exclude
  filters,    // Array              — AND filters (see §Filtering)
  orFilters,  // Object             — OR filters (see §Filtering)
  order,      // Array              — sorting (see §Sorting)
  size,       // number             — max rows (no pagination)
  page,       // number | number[]  — pagination (see §Pagination)
})
```

### include / exclude

```js
client.table("items").list({ include: ["name", "status", "created_at"] })
client.table("items").list({ exclude: ["large_blob_field"] })
```

### size

Use `size` only when pagination is not needed:

```js
client.table("catalogs").list({ size: 9999 })  // all records
client.table("settings").list({ size: 1 })     // just 1 record
```

## Sorting

Server-side sorting via `order` parameter. Format: array of `[field, direction]`:

```js
order: [["created_at", "desc"]]
order: [["last_name", "asc"], ["first_name", "asc"]]
```

Directions: `"asc"` | `"desc"`

If server-side sorting is unavailable, sort client-side with a stable sort using the original index as tiebreaker.

## Filtering

Build filters with `client.filter(column, operator, value)` → `[column, operator, value]`.

Pass filters as array to the `filters` parameter (logical AND):

```js
client.table("items").list({
  filters: [client.filter("status", "eq", "active")]
})
```

**Important:** always use `filters: [...]` — the `filter: { field: value }` syntax is silently ignored.

### Confirmed operators

| Operator | Meaning |
|---|---|
| `eq` | equals |
| `neq` | not equals (`negate("eq")`) |
| `cs` | contains string (case-sensitive) |
| `gt` | greater than |
| `lt` | less than |

To negate: `client.negate("eq")` → `"neq"`

### OR filters

```js
orFilters: {
  filter1: ["status", "eq", "active"],
  filter2: ["status", "eq", "pending"],
}
```

## Pagination

```js
page: [1, 50]   // page 1, 50 records per page → ?page=1,50
page: 2         // page number only
```

Expected paginated response:

```json
{ "records": [...], "results": 150 }
```

Normalize always:

```js
function getRecords(res) {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.records)) return res.records;
  return [];
}
```

## Distinct values

```js
client.table("items").distinct("category", { include: "category,label" })
```

Use `distinct()` for deduplicated single-column values. Use `list()` with `include` and `size` when you need to join multiple fields or sources.

When merging from multiple sources, deduplicate with a `Map` keyed on a stable composite key:

```js
const map = new Map();
for (const row of rows) {
  const key = [norm(row.a), norm(row.b)].join("|");
  if (!map.has(key)) map.set(key, row);
}
```

## Parallel loading with partial fallback

```js
const results = await Promise.allSettled([
  withRetry(() => loadFromTableA(client)),
  withRetry(() => loadFromTableB(client))
]);

const dataA = results[0].status === "fulfilled" ? results[0].value : [];
const dataB = results[1].status === "fulfilled" ? results[1].value : [];

const failures = results.filter(r => r.status === "rejected");
if (failures.length) error = normalizeApiError(failures[0].reason);
```

## Permissions

```json
{ "table": "items", "id": "1", "can": { "create": true, "read": true, "update": true, "delete": true } }
```

If the permissions request fails, enter read-only mode. Create, edit, and delete actions must be disabled or hidden in read-only mode.

---

# Error Handling

Every API operation must handle failure: show an error message, avoid corrupting state, keep the UI usable.

## Error normalization

```js
function normalizeApiError(err) {
  const raw = err?.payload ?? err?.response ?? err;
  const status  = raw?.status ?? raw?.statusCode ?? err?.status ?? err?.statusCode;
  const code    = raw?.code ?? err?.code ?? raw?.error?.code;
  const message = raw?.message ?? err?.message ?? raw?.error?.message
    ?? (typeof raw === "string" ? raw : "Unknown error");

  let kind = "unknown";
  if (status === 401 || status === 403) kind = "auth";
  else if (status === 404)              kind = "not_found";
  else if (status === 429)              kind = "rate_limit";
  else if (status >= 500)               kind = "server";
  else if (code === "ETIMEDOUT" || code === "ECONNABORTED") kind = "timeout";
  else if (code === "ENETUNREACH" || code === "ECONNRESET") kind = "network";

  return { status, code, message, kind, raw };
}
```

```js
function userFriendlyErrorText(e) {
  switch (e.kind) {
    case "auth":       return "Session expired or insufficient permissions.";
    case "rate_limit": return "Too many requests. Please wait and try again.";
    case "timeout":
    case "network":    return "Connection problem. Check your network.";
    case "server":     return "Server error. Please try again later.";
    case "not_found":  return "Resource not found.";
    default:           return "An error occurred.";
  }
}
```

Always show a retry button alongside error messages in load contexts.

## Retry with exponential backoff

```js
const sleep = ms => new Promise(r => setTimeout(r, ms));

function shouldRetry(e) {
  return ["network", "timeout", "server", "rate_limit"].includes(e.kind);
}

async function withRetry(fn, { retries = 2, baseDelay = 400 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = normalizeApiError(err);
      if (attempt === retries || !shouldRetry(last)) throw last;
      await sleep(baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 150));
    }
  }
  throw last;
}
```

Do not retry `auth` or `not_found` errors.

---

# Async Render Safety

When an async load is in-flight and the user navigates away or changes context, avoid re-rendering into a stale root.

Use a `cancelled` flag:

```js
let cancelled = false;

async function load() {
  // ...
  if (!cancelled) rerender();
}

// on context change or cleanup:
cancelled = true;
```

---

# State Management

Use plain JavaScript state objects. Do not introduce Redux, Zustand, MobX, Pinia, or external state machines.

## State shape

Define only the state properties the SPA actually uses. Preserve existing shape across modifications. Prefer additive properties:

```js
state.step1 ||= {};
state.step2 ||= {};
```

## Context reset

Reset state when context changes:
- changing tab resets pagination page
- changing filter resets pagination page
- changing editor record resets draft
- saving a record invalidates list cache

## Draft editing

Editors must use a draft object separate from the persisted base row:

```js
state.editor.baseRow
state.editor.draftRow
```

Do not mutate persisted rows directly while editing.

---

# UI Behavior

## Lists

List pages must support: loading state, empty state, error state, pagination, sorting, filtering, permission-aware actions.

Filters and pagination controls must remain visible even when no records are returned.

## Tables

Administrative tables should be compact. Recommended Bulma classes:

```html
<table class="table is-small is-narrow is-fullwidth is-hoverable is-striped">
```

Use icons consistently:
- edit: `ri-pencil-line`
- delete: `ri-delete-bin-6-line`
- add: `ri-add-line`
- save: `ri-save-line`
- back: `ri-arrow-left-line`
- upload/import: `ri-upload-2-line`
- read-only: `ri-lock-line`

## Forms

Forms must use controlled values. Each visible field must read from state and write back to state. Do not rely on uncontrolled DOM state.

## Derived fields

Derived fields must be explicit and kept synchronized before save. If a selected value is no longer in the catalog, render it as out-of-list rather than dropping it silently.

---

# CRUD Rules

## Create

1. Initialize a clean draft
2. Populate required derived fields
3. Call `create(payload)`
4. Invalidate affected list cache
5. Navigate back or refresh deterministically

## Update

1. Load the record by id
2. Create a draft copy
3. Save only after explicit user action
4. Call `update(id, payload)`
5. Invalidate affected list cache

## Delete

1. Require explicit confirmation
2. Call `remove(id)`
3. Refresh or invalidate the list
4. Handle empty page after deletion

Do not perform optimistic deletion.

---

# Security and Safety

Do not bypass permission checks in the frontend.

Frontend permissions are a UX guard only. Backend authorization remains authoritative.

Do not expose secrets or API keys in generated code.

---

# Specification-Driven Development

Read the relevant spec before modifying a SPA.

```text
AGENTS.md
specs/
  <spa-id>/
    use-case.md
    design.md
```

If implementation and specification disagree, report the discrepancy. Do not silently change behavior.

---

# Testing Expectations

For each generated or modified SPA page, verify:

- initial load
- empty list
- paginated list
- sorting / filtering
- create / update / delete permission
- read-only fallback
- create / edit / delete flow
- API failure handling
- retry behavior
- derived field synchronization
- async render safety (no stale re-render after navigation)

---

# Code Style

Prefer readable, explicit code. Avoid excessive abstraction.

Use small helper functions for:
- response normalization (`getRecords`)
- error normalization (`normalizeApiError`)
- user-facing error text (`userFriendlyErrorText`)
- retry logic (`withRetry`)
- i18n (`t`)
- pagination state
- stable sorting
- field derivation

Keep helper behavior deterministic.

---

# Unknowns

Do not invent missing behavior.

If something is unknown:
- mark it as unknown in the specification
- ask for clarification when necessary
- otherwise implement the safest conservative behavior

Safe conservative defaults:
- read-only if permissions are unknown
- empty catalog if distinct lookup fails
- no mutation if record id is missing
- no destructive action without confirmation

---

# Non Goals

Do not introduce without explicit instruction:
- frontend framework migrations
- global state managers
- optimistic sync
- speculative server validation
- hidden API conventions
- unrelated UI redesigns
- large-scale rewrites
