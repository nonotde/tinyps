// TinyPS Pro — license proxy for Cloudflare Workers (free tier is plenty).
// Creem's license API requires the merchant API key, which must never ship in
// client code, so this worker holds it server-side (Workers secret
// CREEM_API_KEY) and forwards exactly three whitelisted operations:
//   POST {PRO_API}/v1/licenses/activate   {key, instance_name}
//   POST {PRO_API}/v1/licenses/validate   {key, instance_id}
//   POST {PRO_API}/v1/licenses/deactivate {key, instance_id}
// Deploy: create a Worker, paste this file, add secret CREEM_API_KEY
// (Dashboard → Workers → Settings → Variables → Encrypt), then put the
// worker URL into extension/editor/pro.js (PRO_API).

const ALLOWED = new Set(['activate', 'validate', 'deactivate']);
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const path = new URL(request.url).pathname;
    if (path.startsWith('/v1/trial/')) {
      const tAction = path.split('/').pop();
      if (request.method === 'POST' && (tAction === 'start' || tAction === 'check')) {
        return trialHandler(request, env, tAction);
      }
      return json({ error: 'not found' }, 404);
    }

    const action = path.split('/').pop();
    if (request.method !== 'POST' || !ALLOWED.has(action)) return json({ error: 'not found' }, 404);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }

    // strict field whitelist — forward nothing else to Creem
    const fwd = {};
    for (const f of ['key', 'instance_id', 'instance_name']) {
      if (typeof body[f] === 'string' && body[f].length > 0 && body[f].length <= 128) fwd[f] = body[f];
    }
    if (!fwd.key) return json({ error: 'missing key' }, 400);

    let r;
    try {
      r = await fetch('https://api.creem.io/v1/licenses/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': env.CREEM_API_KEY },
        body: JSON.stringify(fwd)
      });
    } catch (e) {
      return json({ error: 'upstream unreachable' }, 502);
    }
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });
  }
};
// ─────────────────────────────────────────────────────────────────────────────
// 3-day trial (2026-11): server is the clock authority. KV namespace binding
// "TRIAL_KV" is required (Dashboard → Workers → Settings → Bindings → KV).
//   POST /v1/trial/start {deviceId, fingerprint}   → {firstUseAt, expireAt, now}  (idempotent)
//   POST /v1/trial/check {deviceId, fingerprint}   → {ok, firstUseAt, expireAt, now, daysLeft}
// Anti-abuse: per-IP rate limit (60/h) + loose fingerprint pins the trial to
// the machine, so wiping local storage does NOT reset it.
const TRIAL_DAYS_MS = 3 * 864e5;
const trialRL = new Map(); // ip → {count, windowStart}

function rlAllow(ip) {
  const now = Date.now(), W = 36e5, MAX = 60;
  let e = trialRL.get(ip);
  if (!e || now - e.windowStart > W) { e = { count: 0, windowStart: now }; trialRL.set(ip, e); }
  if (++e.count > MAX) return false;
  if (trialRL.size > 5000) trialRL.clear(); // crude memory guard
  return true;
}

function norm(v, max) {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

async function trialHandler(request, env, action) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rlAllow(ip)) return json({ error: 'rate limited' }, 429);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'invalid body' }, 400); }
  const deviceId = norm(body.deviceId, 64), fingerprint = norm(body.fingerprint, 128);
  if (!deviceId || !fingerprint) return json({ error: 'deviceId/fingerprint required' }, 400);

  const kv = env.TRIAL_KV;
  if (!kv) return json({ error: 'trial storage unavailable' }, 500);

  const k = 'fp:' + fingerprint;
  const existing = await kv.get(k);
  let rec;
  if (existing) {
    try { rec = JSON.parse(existing); } catch (e) { rec = null; }
  }
  if (!rec) {
    rec = { firstUseAt: Date.now(), deviceId };
    await kv.put(k, JSON.stringify(rec)); // first writer wins; duplicates resolve below
  }
  const expireAt = rec.firstUseAt + TRIAL_DAYS_MS;
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((expireAt - now) / 864e5));
  if (action === 'start') return json({ firstUseAt: rec.firstUseAt, expireAt, now });
  return json({ ok: now < expireAt, firstUseAt: rec.firstUseAt, expireAt, now, daysLeft });
}
