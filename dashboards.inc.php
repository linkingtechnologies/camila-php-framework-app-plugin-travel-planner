<?php
// Dashboard tab dispatch — delegated to the shared camila-core implementation
// so all plugins in this app get the same sanitized routing and cross-plugin
// "<plugin>--<dashboard>" namespacing. See camila/views/plugin_dashboards.inc.php.
$_camilaPluginDir = __DIR__;
require_once(CAMILA_DIR . '/views/plugin_dashboards.inc.php');
