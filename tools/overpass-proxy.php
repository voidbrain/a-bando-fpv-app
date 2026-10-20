<?php
/**
 * Caching CORS proxy for the OpenStreetMap Overpass API (for shared PHP hosting).
 *
 * Why: the public Overpass servers are often busy (HTTP 429/500) and answer without CORS headers, which a browser
 * reports as "not allowed by Access-Control-Allow-Origin". This script asks them from the server side, keeps every
 * answer on disk for a week (so re-generating the same area never hits Overpass again) and adds the CORS header
 * for your site only.
 *
 * Install: upload as /overpass-proxy.php (any folder of your hosting, HTTPS). In the app: Bandos -> Area ->
 * "Data server…" -> https://YOUR-DOMAIN/overpass-proxy.php
 */

// --- settings -----------------------------------------------------------------------------------------------
$ALLOWED_ORIGINS = ['https://voidbrain.github.io', 'http://localhost:4200'];
$UPSTREAMS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
];
$CACHE_DIR = __DIR__ . '/overpass-cache';
$TTL       = 7 * 24 * 3600;   // seconds a cached answer stays valid
$MAX_QUERY = 6000;            // bytes: a Overpass query of this app is ~600
// -------------------------------------------------------------------------------------------------------------

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Vary: Origin');
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')    { http_response_code(405); exit('POST only'); }
if ($origin !== '' && !in_array($origin, $ALLOWED_ORIGINS, true)) { http_response_code(403); exit('origin not allowed'); }

$q = $_POST['data'] ?? '';
if ($q === '') { // raw body, with or without the "data=" prefix
    $raw = file_get_contents('php://input') ?: '';
    $q = strpos($raw, 'data=') === 0 ? urldecode(substr($raw, 5)) : $raw;
}
if ($q === '' || strlen($q) > $MAX_QUERY || strpos(ltrim($q), '[out:json]') !== 0) {
    http_response_code(400);
    exit('bad query');
}

header('Content-Type: application/json; charset=utf-8');
if (!is_dir($CACHE_DIR)) { @mkdir($CACHE_DIR, 0755, true); }
$file = $CACHE_DIR . '/' . sha1($q) . '.json';

if (is_file($file) && time() - filemtime($file) < $TTL) {
    header('X-Cache: HIT');
    readfile($file);
    exit;
}

@set_time_limit(75);
$last = 502;
foreach ($UPSTREAMS as $url) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => 'data=' . rawurlencode($q),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT        => 28,
        CURLOPT_USERAGENT      => 'a-bando-fpv-app proxy (+https://github.com/voidbrain/a-bando-fpv-app)',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body !== false && $code === 200 && json_decode($body) !== null) {
        @file_put_contents($file, $body, LOCK_EX);
        header('X-Cache: MISS');
        echo $body;
        exit;
    }
    $last = $code ?: 502;
}

// every upstream failed: serve a stale cached answer if there is one, otherwise say so
if (is_file($file)) { header('X-Cache: STALE'); readfile($file); exit; }
http_response_code($last >= 400 ? $last : 502);
echo json_encode(['error' => 'all Overpass servers failed']);
