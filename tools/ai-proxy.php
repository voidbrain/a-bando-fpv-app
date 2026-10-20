<?php
/**
 * Thin proxy for the editor's AI assistant (for shared PHP hosting).
 *
 * The browser talks to THIS script; the script talks to an OpenAI-compatible chat API (a cloud service, or your home
 * PC's Ollama through a tunnel) and adds the secret key on the server side, so the key never reaches the browser.
 * It also adds CORS for your site only, limits request size, and rate-limits per IP.
 *
 * Install: upload as /ai-proxy.php over HTTPS, fill the settings below. In the app: AI assistant -> "Server / home PC"
 *   address = https://YOUR-DOMAIN/ai-proxy.php    model = (ignored if you set $FORCE_MODEL)
 *   token   = the value of $APP_TOKEN
 */

// --- settings ---------------------------------------------------------------------------------------------
$ALLOWED_ORIGINS = ['https://voidbrain.github.io', 'http://localhost:4200'];
$UPSTREAM        = 'https://api.openai.com/v1/chat/completions'; // or e.g. https://my-pc.tailnet.ts.net/v1/chat/completions
$UPSTREAM_KEY    = '';                                             // the real API key (empty for Ollama)
$APP_TOKEN       = 'change-me-to-a-long-random-string';            // what the app sends as its "token"
$FORCE_MODEL     = '';                                             // e.g. 'gpt-4o-mini': ignore the model the app asks for
$MAX_BODY        = 60000;   // bytes of request
$MAX_TOKENS      = 900;     // cap on the answer length
$PER_MINUTE      = 20;      // requests per IP per minute
$RATE_DIR        = __DIR__ . '/ai-rate';
// ----------------------------------------------------------------------------------------------------------

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
header('Vary: Origin');
if (in_array($origin, $ALLOWED_ORIGINS, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')    { http_response_code(405); exit('POST only'); }
if ($origin !== '' && !in_array($origin, $ALLOWED_ORIGINS, true)) { http_response_code(403); exit('origin not allowed'); }

// bearer token (some hosts hide the Authorization header from PHP: the fallback reads the redirected copy)
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
if (!hash_equals('Bearer ' . $APP_TOKEN, $auth)) { http_response_code(401); exit('bad token'); }

// per-IP rate limit
if (!is_dir($RATE_DIR)) { @mkdir($RATE_DIR, 0755, true); }
$rf = $RATE_DIR . '/' . sha1($_SERVER['REMOTE_ADDR'] ?? '') . '-' . floor(time() / 60);
$n  = (int) @file_get_contents($rf);
if ($n >= $PER_MINUTE) { http_response_code(429); exit('slow down'); }
@file_put_contents($rf, (string) ($n + 1), LOCK_EX);
foreach (glob($RATE_DIR . '/*') ?: [] as $f) { if (filemtime($f) < time() - 180) { @unlink($f); } }

$raw = file_get_contents('php://input') ?: '';
if ($raw === '' || strlen($raw) > $MAX_BODY) { http_response_code(413); exit('bad size'); }
$body = json_decode($raw, true);
if (!is_array($body) || !isset($body['messages']) || !is_array($body['messages'])) { http_response_code(400); exit('bad request'); }

// only pass on what the editor needs
$out = [
    'model'       => $FORCE_MODEL !== '' ? $FORCE_MODEL : (string) ($body['model'] ?? ''),
    'messages'    => $body['messages'],
    'temperature' => min(1.0, (float) ($body['temperature'] ?? 0.1)),
    'max_tokens'  => min($MAX_TOKENS, (int) ($body['max_tokens'] ?? 700)),
    'stream'      => false,
];
if (isset($body['response_format'])) { $out['response_format'] = $body['response_format']; }

@set_time_limit(100);
$ch = curl_init($UPSTREAM);
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($out),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT        => 90,
    CURLOPT_HTTPHEADER     => array_values(array_filter([
        'Content-Type: application/json',
        $UPSTREAM_KEY !== '' ? 'Authorization: Bearer ' . $UPSTREAM_KEY : null,
    ])),
]);
$res  = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

header('Content-Type: application/json; charset=utf-8');
if ($res === false) { http_response_code(502); exit(json_encode(['error' => 'upstream unreachable'])); }
http_response_code($code ?: 502);
echo $res;
