<?php
/**
 * travel-planner — Plugin API handlers
 * Base path: /app/{CAMILA_APP_DIR}/cf_api.php/travel-planner
 *
 * CONTRACT (see Tqdev\PhpCrudApi\CamilaPluginController in camila/api.include.php):
 * this file is `require`-d by the framework and must `return` an array mapping
 * 'METHOD /path' (relative to the plugin prefix — WITHOUT the leading /travel-planner)
 * to a callable: function(array $params, ?array $body, array $segments): array
 *   - $params   query string params
 *   - $body     JSON request body already decoded to an associative array (or null)
 *   - $segments full URL path segments
 * The returned array is JSON-encoded as the response body (HTTP 200) unless it
 * contains an '__status' key, which is used as the HTTP status and stripped
 * from the payload before encoding.
 *
 * ENDPOINTS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * GET /travel-planner/status                                           [PRIVATE]
 *   Simple liveness check. Returns: {status: "ok"}
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A GET /tile OSM tile proxy+cache lived here briefly, for the PDF export's map
 * images. Removed along with the hand-rolled canvas tile-stitcher it fed: the PDF
 * export now uses OpenLayers (see app-itinerary-map.js's renderStaticMapDataUrl()),
 * which fetches tiles directly from the browser via tile.openstreetmap.org — the
 * same confirmed-CORS-enabled host the live Leaflet map already uses directly, no
 * server involvement needed.
 */

return [

    // GET /travel-planner/status
    'GET /status' => function ($params, $body, $segments) {
        return ['status' => 'ok'];
    },

];
