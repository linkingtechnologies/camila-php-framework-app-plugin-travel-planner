<?php
// Itinerary Map dashboard — ai-toolbox plugin
// Manual mount pattern (see AGENTS.md): APP_CONFIG / I18N must be injected before the module loads.
// NOTE: local translations array must NOT be named $i18n (see AGENTS.md "Naming warning" —
// this file is require()'d at global scope and would overwrite camila's own global $i18n).

global $_CAMILA;

if (!function_exists('ai_load_lang')) {
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
}

$camilaUI = new CamilaUserInterface();
$scheme   = $camilaUI->isHttps() ? 'https' : 'http';
$host     = $_SERVER['HTTP_HOST'];
$config   = [
    'baseUrl'           => $scheme . '://' . $host . '/app/' . CAMILA_APP_DIR . '/cf_api.php',
    'apiKeyHeaderName'  => 'Authorization',
    'apiKeyHeaderValue' => 'PHPSESSID',
];

$lang       = ai_load_lang(__DIR__ . '/lang', $_CAMILA['lang'] ?? 'en');
$pluginI18n = [
    'itin.error.tableNotFound'   => $lang['itin.error.tableNotFound'] ?? '',
    'itin.error.load'            => $lang['itin.error.load'] ?? '',
    'itin.btn.retry'             => $lang['itin.btn.retry'] ?? '',
    'itin.warn.skipped'          => $lang['itin.warn.skipped'] ?? '',
    'itin.empty'                 => $lang['itin.empty'] ?? '',
    'itin.sidebar.title'         => $lang['itin.sidebar.title'] ?? '',
    'itin.popup.checkin'         => $lang['itin.popup.checkin'] ?? '',
    'itin.popup.checkout'        => $lang['itin.popup.checkout'] ?? '',
    'itin.popup.breakfast'       => $lang['itin.popup.breakfast'] ?? '',
    'itin.popup.parking'         => $lang['itin.popup.parking'] ?? '',
    'itin.popup.booking'         => $lang['itin.popup.booking'] ?? '',
    'itin.popup.notes'           => $lang['itin.popup.notes'] ?? '',
    'itin.selector.label'        => $lang['itin.selector.label'] ?? '',
    'itin.warn.skippedPoi'       => $lang['itin.warn.skippedPoi'] ?? '',
    'itin.poi.notFound'          => $lang['itin.poi.notFound'] ?? '',
    'itin.poi.sidebar.title'     => $lang['itin.poi.sidebar.title'] ?? '',
    'itin.poi.popup.planned'     => $lang['itin.poi.popup.planned'] ?? '',
    'itin.poi.popup.duration'    => $lang['itin.poi.popup.duration'] ?? '',
    'itin.poi.popup.price'       => $lang['itin.poi.popup.price'] ?? '',
    'itin.poi.popup.bookingRequired'      => $lang['itin.poi.popup.bookingRequired'] ?? '',
    'itin.poi.popup.kidFriendly'          => $lang['itin.poi.popup.kidFriendly'] ?? '',
    'itin.poi.popup.priority'             => $lang['itin.poi.popup.priority'] ?? '',
    'itin.poi.popup.linkedAccommodation'  => $lang['itin.poi.popup.linkedAccommodation'] ?? '',
];

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
$_CAMILA['page']->camila_add_js("<link href=\"plugins/ai-toolbox/app.css\" rel=\"stylesheet\">\n");
$itinScriptVersion = @filemtime(__DIR__ . '/app-itinerary-map.js');
$itinVerSuffix     = $itinScriptVersion ? ('?v=' . $itinScriptVersion) : '';
$_CAMILA['page']->camila_add_js('<script type="module" src="./plugins/ai-toolbox/app-itinerary-map.js' . $itinVerSuffix . '"></script>');
