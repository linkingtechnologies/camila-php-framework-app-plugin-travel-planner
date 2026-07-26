<?php
$camilaUI = new CamilaUserInterface();
$_CAMILA['page']->camila_export_enabled = false;
$_isTotemUser = strncasecmp($_CAMILA['user'] ?? '', 'totem', 5) === 0;
$_menuXml = CAMILA_HOMEDIR.'/plugins/'.basename(dirname(__FILE__)).'/conf/menu.xml';
$_pluginBase = 'plugins/'.basename(dirname(__FILE__));
if (isset($_REQUEST['dashboard'])) {
    if (!$_isTotemUser) $currentTab = $camilaUI->printHomeMenu($_menuXml);
    require($_pluginBase . '/dashboard-' . $_REQUEST['dashboard'] . '.inc.php');
} else {
    $defaultId = 'm0';
    if (!$_isTotemUser) $currentTab = $camilaUI->printHomeMenu($_menuXml, $defaultId);
    require($_pluginBase . '/dashboard-' . $defaultId . '.inc.php');
}
