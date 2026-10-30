// TinyPS Pro — license gate (free crop / fill / background removal) via Creem.
// Activation/validation go through a Cloudflare Worker proxy that holds the Creem API key
// (Creem has no public client endpoint). Each successful check grants a 14-day offline
// grace window cached in localStorage. Image data never touches the network — only the
// license key and a random device id are sent (via the proxy) to Creem.
'use strict';

// Hosted-checkout URLs for "TinyPS Pro" on Creem.
// lifetime = one-time payment (supports Alipay/WeChat Pay); monthly/yearly =
// subscriptions (cards / Apple Pay / Google Pay).
const PRO_CHECKOUT = {
  lifetime: 'https://www.creem.io/payment/prod_2CoDfdd52jwzLHZwwxFVuR',
  monthly: 'https://www.creem.io/payment/prod_6yMQb80RSMgLisgC5Vf6y',
  yearly: 'https://www.creem.io/payment/prod_61yF5oicQA2QgziFVdWfSW'
};

// License requests go through a server-side proxy holding the Creem API key —
// Creem has no public client endpoint. Two gateways with automatic failover:
// the Cloudflare Worker (fast worldwide) and our own gateway (reachable in
// mainland China, where workers.dev is DNS-poisoned).
const PRO_APIS = [
  'https://tinyps-license.seanleex.workers.dev',
  'https://pic.zxxdb.com'
];
const PRO_TTL = 14 * 864e5;     // offline grace after each successful check
const PRO_RECHECK = 3 * 864e5;  // revalidate at most every 3 days
const PRO_KEY = 'tinyps_pro', DEVICE_KEY = 'tinyps_device';

const pid = id => document.getElementById(id);

let proState = null;
try { proState = JSON.parse(localStorage.getItem(PRO_KEY) || 'null'); } catch (e) { /* ignore */ }

function savePro(s) {
  proState = s;
  try { s ? localStorage.setItem(PRO_KEY, JSON.stringify(s)) : localStorage.removeItem(PRO_KEY); } catch (e) { /* ignore */ }
}
function deviceId() {
  let d = null;
  try { d = localStorage.getItem(DEVICE_KEY); } catch (e) { /* ignore */ }
  if (!d) {
    d = 'tinyps-' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* ignore */ }
  }
  return d;
}
function isPro() { return !!(proState && proState.activated && Date.now() < proState.goodUntil); }
function requirePro() {
  if (isPro()) return true;
  toastMsg('toast.proLocked');
  openProModal();
  return false;
}

function applyProUi() {
  document.body.classList.toggle('pro-on', isPro());
  pid('proBtn').textContent = isPro() ? '✓ Pro' : '✨ Pro';
}
function openProModal() { refreshProModal(); pid('proModal').classList.add('show'); }
function refreshProModal() {
  const st = pid('proStatus');
  if (isPro()) {
    const exp = proState.expiresAt ? ' · ' + t('pro.expires').replace('{d}', new Date(proState.expiresAt).toLocaleDateString()) : '';
    st.textContent = t('pro.on') + exp;
    st.className = 'pro-status ok';
  } else {
    st.textContent = t('pro.off');
    st.className = 'pro-status';
  }
  const ready = !!(PRO_CHECKOUT.lifetime && PRO_CHECKOUT.monthly && PRO_CHECKOUT.yearly);
  pid('proBuyRow').style.display = ready ? 'flex' : 'none';
  pid('proPayNote').style.display = ready ? 'block' : 'none';
  pid('proNotReady').style.display = ready ? 'none' : 'block';
  if (ready) {
    pid('proLifetime').href = PRO_CHECKOUT.lifetime;
    pid('proMonthly').href = PRO_CHECKOUT.monthly;
    pid('proYearly').href = PRO_CHECKOUT.yearly;
  }
  pid('proDeactivateBtn').style.display = proState && proState.activated ? 'block' : 'none';
}

// 400/404 are definitive "bad key" answers (still JSON), anything else is a network fault.
// Responses are Creem LicenseEntity: {status, activation, activation_limit,
// expires_at, instance:{id,status,...}}
async function lsPost(path, body) {
  let lastErr;
  for (const base of PRO_APIS) {
    try {
      const r = await fetch(base + '/v1/licenses/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok && r.status !== 400 && r.status !== 404) throw new Error('network ' + r.status);
      return r.json(); // 400/404 = definitive answer from a reachable gateway
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

async function activatePro() {
  const inp = pid('proKeyInp'), btn = pid('proActivateBtn');
  const key = inp.value.trim();
  if (!key) return;
  btn.disabled = true;
  try {
    const j = await lsPost('activate', { key, instance_name: deviceId() });
    if (j.instance && j.instance.id && j.status !== 'disabled' && j.status !== 'expired') {
      savePro({
        activated: true, key,
        instanceId: j.instance.id,
        goodUntil: Date.now() + PRO_TTL, lastCheck: Date.now(),
        expiresAt: j.expires_at || null
      });
      applyProUi(); refreshProModal();
      toastMsg('pro.on');
    } else {
      toastMsg('pro.invalid');
    }
  } catch (e) {
    toastMsg('pro.error');
  } finally {
    btn.disabled = false;
  }
}

async function deactivatePro() {
  if (proState && proState.key && proState.instanceId) {
    try { await lsPost('deactivate', { key: proState.key, instance_id: proState.instanceId }); } catch (e) { /* free the slot best-effort */ }
  }
  savePro(null);
  applyProUi(); refreshProModal();
}

async function revalidatePro() {
  if (!proState || !proState.activated || !proState.key) return;
  if (Date.now() - (proState.lastCheck || 0) < PRO_RECHECK) return;
  try {
    const j = await lsPost('validate', { key: proState.key, instance_id: proState.instanceId });
    const stillValid = j.status === 'active' &&
      (!j.expires_at || Date.parse(j.expires_at) > Date.now());
    if (stillValid) {
      proState.goodUntil = Date.now() + PRO_TTL;
      proState.lastCheck = Date.now();
      proState.expiresAt = j.expires_at || null;
      savePro(proState);
    } else {
      savePro(null);
      applyProUi(); refreshProModal();
      toastMsg('pro.invalid');
    }
  } catch (e) { /* offline: the grace window keeps Pro alive until it lapses */ }
}

applyProUi();
pid('proBtn').addEventListener('click', openProModal);
pid('proActivateBtn').addEventListener('click', activatePro);
pid('proDeactivateBtn').addEventListener('click', deactivatePro);
setTimeout(revalidatePro, 1500);
