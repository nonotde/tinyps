// TinyPS — main editor logic.
// Fully client-side pipeline: decode → resize → center-crop → rotate/flip →
// filter → watermark → encode (JPEG/PNG/WebP via canvas, BMP/GIF via encoders.js)
// with optional target-size binary search. Nothing ever leaves the browser.
'use strict';

const $ = id => document.getElementById(id);
const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

const state = { images: [], activeIdx: 0, selLayer: -1, cropAR: null, canvasAuto: true, theme: 'dark', busy: false };

// ===== element refs =====
const langSelect = $('langSelect');
const fileInput = $('fileInput'), previewBody = $('previewBody');
const qSlider = $('qSlider'), qVal = $('qVal');
const losslessToggle = $('losslessToggle'), stripMeta = $('stripMeta');
const wInp = $('wInp'), hInp = $('hInp'), lockBtn = $('lockBtn'), xInp = $('xInp'), yInp = $('yInp');
const cWInp = $('cWInp'), cHInp = $('cHInp'), cLockBtn = $('cLockBtn');
const filterSel = $('filterSel'), filterAmt = $('filterAmt'), filterAmtWrap = $('filterAmtWrap'), filterAmtVal = $('filterAmtVal');
const fillBtn = $('fillBtn'), fillPickBtn = $('fillPickBtn'), fillOpacity = $('fillOpacity'), fillColor = $('fillColor'), fillColorMode = $('fillColorMode'), fillMosaicMode = $('fillMosaicMode');
const fmtSelect = $('fmtSelect');
const wmText = $('wmText'), wmColor = $('wmColor'), wmSize = $('wmSize'), wmAddBtn = $('wmAddBtn');
const targetSizeOn = $('targetSizeOn'), targetSizeInp = $('targetSizeInp');
const downloadBtn = $('downloadBtn');
const copyBtn = $('copyBtn'), base64Btn = $('base64Btn'), downloadAllBtn = $('downloadAllBtn');
const placeholder = $('placeholder');
const singleView = $('singleView');
const singleCanvas = $('singleCanvas');
const singleCtx = singleCanvas.getContext('2d');
const undoBtn = $('undoBtn'), redoBtn = $('redoBtn'), resetBtn = $('resetBtn');
const batchStrip = $('batchStrip');
const fName = $('fName'), origSizeEl = $('origSize'), outSizeEl = $('outSize'), savingBadge = $('savingBadge'), dimsDisplay = $('dimsDisplay');
const toast = $('toast'), themeBtn = $('themeBtn'), infoBtn = $('infoBtn');

// ===== helpers =====
let toastTimer;
function toastMsg(m) {
  const txt = LOCALE[currentLang] && LOCALE[currentLang][m] ? t(m) : m;
  toast.textContent = txt;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
function fmtSize(b) {
  if (!b || b === 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(s.length - 1, Math.floor(Math.log(b) / Math.log(k)));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
}
function saveBlob(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(link.href), 30000);
}
let drawSeq = 0;
/** Paint a source (canvas/img) onto the visible preview canvas; stale draws are dropped. */
function drawDisplay(source) {
  const seq = ++drawSeq;
  const w = source.naturalWidth || source.width, h = source.naturalHeight || source.height;
  if (!w || !h) return;
  singleCanvas.width = w; singleCanvas.height = h;
  singleCtx.drawImage(source, 0, 0);
  if (seq !== drawSeq) return; // superseded while decoding
  applyViewTransform(); // new content/dims → re-fit the zoomed view
}

// ===== preview zoom & pan (VIEW only — the rendered content is never touched) =====
const viewZoomSlider = $('viewZoomSlider'), viewZoomInp = $('viewZoomInp');
let viewZoom = 1;                 // 1 = default fit (same look as before the slider existed)
let viewPan = { x: 0, y: 0 };     // CSS-pixel offset from the centred position, clamped to bounds
/** Size the preview canvas to fitScale × zoom and translate it by the (clamped) pan.
 *  When the zoomed canvas fits inside the viewport the clamp range is 0, so
 *  dragging has no effect — panning only exists once content overflows. */
function applyViewTransform() {
  const c = singleCanvas;
  if (!c.width || !c.height) return;
  const vw = singleView.clientWidth, vh = singleView.clientHeight;
  if (!vw || !vh) return;
  const base = Math.min(1, vw / c.width, vh / c.height);
  const dw = c.width * base * viewZoom, dh = c.height * base * viewZoom;
  c.style.maxWidth = 'none'; c.style.maxHeight = 'none'; // sizing is fully ours now
  c.style.width = Math.round(dw) + 'px';
  c.style.height = Math.round(dh) + 'px';
  const mx = Math.max(0, Math.floor((dw - vw) / 2)), my = Math.max(0, Math.floor((dh - vh) / 2));
  viewPan.x = Math.max(-mx, Math.min(mx, viewPan.x));
  viewPan.y = Math.max(-my, Math.min(my, viewPan.y));
  c.style.transform = 'translate(' + Math.round(viewPan.x) + 'px,' + Math.round(viewPan.y) + 'px)';
}
/** Slider 0..100 is geometric: 50 → 100%, 100 → 800%, 0 → 12.5%. */
const sliderToZoom = v => Math.pow(8, (v - 50) / 50);
const zoomToSlider = z => 50 + 50 * Math.log(z) / Math.log(8);
function setViewZoom(z, fromSlider) {
  viewZoom = Math.max(0.05, Math.min(8, z));
  if (!fromSlider) viewZoomSlider.value = Math.round(zoomToSlider(viewZoom));
  const pct = viewZoom * 100;
  viewZoomInp.value = pct >= 20 ? Math.round(pct) : Math.round(pct * 10) / 10;
  applyViewTransform();
}
viewZoomSlider.addEventListener('input', () => { cancelCropSession(); setViewZoom(sliderToZoom(parseFloat(viewZoomSlider.value)), true); });
viewZoomInp.addEventListener('input', () => {
  const v = parseFloat(viewZoomInp.value);
  if (v > 0) { cancelCropSession(); setViewZoom(v / 100); }
});
window.addEventListener('resize', applyViewTransform);
function drawDisplayFromURL(url) {
  const seq = ++drawSeq;
  loadImg(url).then(img => { if (seq === drawSeq) drawDisplay(img); }).catch(() => {});
}
const EXT_OF = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/gif': 'gif' };
function getActive() { return state.images[state.activeIdx] || null; }
function getAspectRatio() { const a = getActive(); return a ? a.origW / a.origH : 1; }
function setBusy(b) {
  state.busy = b;
}

// ===== sidebar tabs =====
document.querySelectorAll('.stab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    $('tab' + btn.dataset.stab.charAt(0).toUpperCase() + btn.dataset.stab.slice(1)).classList.add('active');
  });
});

// ===== Edit-tab panel reorder (↑/↓ at the right of each panel title) =====
function syncPanelMoveButtons() {
  const panels = document.querySelectorAll('#tabEdit .panel:not([data-pin])'); // the upload panel is pinned
  panels.forEach((p, i) => {
    p.querySelector('.panel-move-up').disabled = i === 0;
    p.querySelector('.panel-move-down').disabled = i === panels.length - 1;
  });
}
document.querySelectorAll('#tabEdit .panel:not([data-pin])').forEach(p => {
  const box = document.createElement('div');
  box.className = 'panel-move';
  const mk = cls => { const b = document.createElement('button'); b.className = cls; b.type = 'button'; return b; };
  const up = mk('panel-move-up'); up.textContent = '↑';
  const down = mk('panel-move-down'); down.textContent = '↓';
  up.addEventListener('click', () => {
    const prev = p.previousElementSibling;
    if (prev && prev.classList.contains('panel') && !prev.dataset.pin) { p.parentNode.insertBefore(p, prev); syncPanelMoveButtons(); }
  });
  down.addEventListener('click', () => {
    const next = p.nextElementSibling;
    if (next && next.classList.contains('panel') && !next.dataset.pin) { p.parentNode.insertBefore(next, p); syncPanelMoveButtons(); }
  });
  box.appendChild(up); box.appendChild(down);
  p.appendChild(box);
});
syncPanelMoveButtons();

// ===== theme =====
function applyTheme(th) {
  state.theme = th === 'light' ? 'light' : 'dark';
  document.documentElement.classList.toggle('light', state.theme === 'light');
  themeBtn.textContent = state.theme === 'dark' ? '🌙' : '☀️';
}
themeBtn.addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  try { localStorage.setItem('tinyps_theme', state.theme); } catch (e) { /* ignore */ }
});

// ===== language =====
langSelect.addEventListener('change', () => setLang(langSelect.value));

// ===== upload (whole preview area is the drop zone) + image drag-to-move =====
// (page-switch helpers below)
const dropZone = $('dropZone');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) intakeFiles(e.dataTransfer.files);
});
previewBody.addEventListener('dragover', e => { e.preventDefault(); previewBody.classList.add('dragover'); });
previewBody.addEventListener('dragleave', () => previewBody.classList.remove('dragover'));
previewBody.addEventListener('drop', e => {
  e.preventDefault();
  previewBody.classList.remove('dragover');
  if (e.dataTransfer.files.length) intakeFiles(e.dataTransfer.files);
});
fileInput.addEventListener('change', () => { if (fileInput.files.length) { intakeFiles(fileInput.files); fileInput.value = ''; } });

// Preview drag: MOVE the selected layer (or the base image) whenever its size
// differs from the canvas — smaller (point 2) or larger (point 3, export stays
// canvas-sized) — with X/Y tracking the drag live. When the content exactly
// fills the canvas there is nothing to move (point 1), or when it is locked:
// the drag pans the zoomed view instead.
let viewDrag = null; // {x, y, moved, pan, px0, py0, dx0, dy0, layer, raf}
previewBody.addEventListener('pointerdown', e => {
  if (fillPicking) { if (e.button === 0) endFillPick(); return; }
  if (cropSession) return; // crop selection in progress
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const a = getActive();
  if (!a || placeholder.style.display !== 'none') return;
  const tgt = selTarget(a);
  const nat = naturalOutputDims(a);
  const cv = canvasTargetDims(nat);
  const cw = tgt.layer ? tgt.layer.w : nat.cw;
  const ch = tgt.layer ? tgt.layer.h : nat.ch;
  const fills = cw === cv.canvasW && ch === cv.canvasH;
  viewDrag = {
    x: e.clientX, y: e.clientY, moved: false, raf: 0,
    pan: fills || tgt.locked, // same-size or locked content: pan the view instead
    px0: viewPan.x, py0: viewPan.y,
    dx0: tgt.layer ? tgt.layer.dx : a.dx, dy0: tgt.layer ? tgt.layer.dy : a.dy,
    layer: tgt.layer || null
  };
  try { previewBody.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
previewBody.addEventListener('pointermove', e => {
  if (fillPicking) { sampleFillPick(e); return; }
  if (!viewDrag) return;
  if (!viewDrag.moved) {
    if (Math.hypot(e.clientX - viewDrag.x, e.clientY - viewDrag.y) < 3) return; // treat as click
    viewDrag.moved = true;
    previewBody.classList.add('dragging-image');
    stopFillFlashIf(viewDrag.layer);
  }
  if (viewDrag.pan) {
    viewPan.x = viewDrag.px0 + (e.clientX - viewDrag.x);
    viewPan.y = viewDrag.py0 + (e.clientY - viewDrag.y);
    applyViewTransform(); // clamps to bounds — no-op when the canvas fits the viewport
    return;
  }
  const rect = singleCanvas.getBoundingClientRect();
  const scale = rect.width / singleCanvas.width || 1;
  const ndx = Math.round(viewDrag.dx0 + (e.clientX - viewDrag.x) / scale);
  const ndy = Math.round(viewDrag.dy0 + (e.clientY - viewDrag.y) / scale);
  if (viewDrag.layer) { viewDrag.layer.dx = ndx; viewDrag.layer.dy = ndy; }
  else { const a = getActive(); if (a) { a.dx = ndx; a.dy = ndy; } }
  if (!viewDrag.raf) {
    viewDrag.raf = requestAnimationFrame(() => {
      if (!viewDrag) return;
      viewDrag.raf = 0;
      const cur = getActive();
      if (cur) {
        try { drawDisplay(renderCanvas(cur)); } catch (err) { /* live preview best-effort */ }
        syncPosInputs(cur);
      }
    });
  }
});
function endViewDrag() {
  if (!viewDrag) return;
  const moved = viewDrag.moved, pan = viewDrag.pan, dragLayer = viewDrag.layer;
  if (viewDrag.raf) cancelAnimationFrame(viewDrag.raf);
  viewDrag = null;
  previewBody.classList.remove('dragging-image');
  if (moved && !pan) { commitHistory('drag'); processImage(); if (dragLayer) noteFillGeom(dragLayer, getActive()); }
}
previewBody.addEventListener('pointerup', endViewDrag);
previewBody.addEventListener('pointercancel', endViewDrag);

async function buildImageEntry(blob, name) {
  if (blob.type && !blob.type.startsWith('image/')) return null;
  const dataUrl = await blobToDataURL(blob);
  const img = await loadImg(dataUrl);
  return {
    blob, name: name || blob.name || 'image', size: blob.size, type: blob.type || 'image/png',
    img, origImg: img, dataUrl, rot: 0, flipH: false, flipV: false, dx: 0, dy: 0,
    cropAR: null, freeRect: null,
    canvasW: null, canvasH: null, canvasAuto: true, // custom canvas persists per page
    resizeW: null, resizeH: null,                   // image W/H persists per page
    set: null,                                      // per-page panel settings
    layers: [], baseVisible: true, baseLocked: false, // overlay layers (max 2; +base = 3)
    origW: img.naturalWidth, origH: img.naturalHeight,
    processedBlob: null, processedURL: null, empty: false
  };
}

async function addImageBlob(blob, name) {
  const entry = await buildImageEntry(blob, name);
  if (entry) state.images.push(entry);
  return entry;
}

/** Replace an empty page's content with a real image (keeps its position in the strip). */
async function fillPage(page, file) {
  const entry = await buildImageEntry(file, file.name || 'image');
  if (!entry) return;
  const idx = state.images.indexOf(page);
  if (idx < 0) return;
  state.images[idx] = entry;
  state.activeIdx = idx;
  renderBatchStrip();
  loadActiveImage();
}

/** New empty page: a fully transparent 1000×500 image (shows as checkerboard). */
async function createEmptyPage() {
  const c = document.createElement('canvas');
  c.width = 1000; c.height = 500;
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const entry = await buildImageEntry(blob, 'page-' + (state.images.length + 1) + '.png');
  if (!entry) return;
  entry.empty = true;
  state.images.push(entry);
  state.activeIdx = state.images.length - 1;
  renderBatchStrip();
  loadActiveImage();
}

/** If the active page is empty, the first file fills it; the rest become new pages. */
async function intakeFiles(files) {
  const arr = [...files];
  const a = getActive();
  if (a && a.empty && arr.length) {
    const first = arr.shift();
    await fillPage(a, first);
  }
  if (arr.length) await handleFiles(arr);
}

async function handleFiles(files) {
  const firstNew = state.images.length;
  let added = 0;
  for (const file of files) {
    try { if (await addImageBlob(file)) added++; } catch (e) { console.error(e); }
  }
  if (added) {
    state.activeIdx = firstNew;
    renderBatchStrip();
    loadActiveImage();
  }
}

// paste: onto an image page it becomes a new layer; otherwise fills/adds a page.
// also accepts the data-URL text written by the copy fallback.
document.addEventListener('paste', e => {
  let files = [...(e.clipboardData ? e.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
  if (!files.length && e.clipboardData) {
    const txt = e.clipboardData.getData('text/plain') || '';
    if (txt.startsWith('data:image/')) {
      const mime = txt.slice(5, txt.indexOf(';'));
      const bin = atob(txt.slice(txt.indexOf(',') + 1));
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      files = [new File([u8], 'clipboard.png', { type: mime })];
    }
  }
  if (!files.length) return;
  e.preventDefault();
  const a = getActive();
  if (a && !a.empty) {
    addLayerFromBlob(a, files[0]).then(ok => { toastMsg(ok ? 'toast.pasted' : 'toast.maxLayers'); });
    if (files.length > 1) handleFiles(files.slice(1));
  } else {
    intakeFiles(files).then(() => toastMsg('toast.pasted'));
  }
});

// image passed via ?src= (from the context menu; fetched with plain CORS —
// servers that send no CORS headers will fail with toast.fetchFail)
async function intakeFromURL(url) {
  try {
    const resp = await fetch(url, { mode: 'cors' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    if (!blob.type.startsWith('image/')) throw new Error('not an image');
    let name = 'image';
    try {
      const u = new URL(url, location.href);
      name = decodeURIComponent(u.pathname.split('/').pop()) || 'image';
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) name += '.' + (EXT_OF[blob.type] || 'png');
    } catch (e) { /* data: URL etc. */ }
    await handleFiles([new File([blob], name, { type: blob.type })]);
  } catch (err) {
    console.error(err);
    toastMsg('toast.fetchFail');
  }
}

// ===== pages strip (always visible; "✕" closes all, "+" appends an empty page) =====
let addPageBtnEl = null, closeAllBtnEl = null;
function getAddPageBtn() {
  if (!addPageBtnEl) {
    addPageBtnEl = document.createElement('button');
    addPageBtnEl.className = 'add-page-btn';
    addPageBtnEl.textContent = '+';
    addPageBtnEl.setAttribute('data-i18n-title', 'btn.newPage');
    addPageBtnEl.title = t('btn.newPage');
    addPageBtnEl.addEventListener('click', createEmptyPage);
  }
  return addPageBtnEl;
}
function getCloseAllBtn() {
  if (!closeAllBtnEl) {
    closeAllBtnEl = document.createElement('button');
    closeAllBtnEl.className = 'close-all-btn';
    closeAllBtnEl.textContent = '✕';
    closeAllBtnEl.setAttribute('data-i18n-title', 'btn.closeAll');
    closeAllBtnEl.title = t('btn.closeAll');
    closeAllBtnEl.addEventListener('click', closeAllPages);
  }
  return closeAllBtnEl;
}
/** Close every open page (releases their blobs and resets the workspace). */
function closeAllPages() {
  if (!state.images.length) return;
  cancelCropSession();
  hideCtxMenu();
  for (const a of state.images) {
    if (a.processedURL) URL.revokeObjectURL(a.processedURL);
  }
  state.images = [];
  state.activeIdx = 0;
  state.selLayer = -1;
  state.cropAR = null;
  state.freeRect = null;
  lastActiveEntry = null;
  resetUI();
  toastMsg('toast.allClosed');
}
function renderBatchStrip() {
  batchStrip.style.display = 'flex';
  batchStrip.innerHTML = '';
  batchStrip.appendChild(getCloseAllBtn()); // fixed ✕ at the far left
  getCloseAllBtn().disabled = state.images.length === 0;
  state.images.forEach((imgData, i) => {
    const div = document.createElement('div');
    div.className = 'batch-thumb' + (i === state.activeIdx ? ' active' : '');
    const el = document.createElement('img');
    el.src = imgData.dataUrl;
    el.alt = '';
    div.appendChild(el);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = 'Remove';
    del.addEventListener('click', e => { e.stopPropagation(); removeImage(i); });
    div.appendChild(del);
    div.addEventListener('click', () => { if (state.activeIdx !== i) { state.activeIdx = i; renderBatchStrip(); loadActiveImage(); } });
    batchStrip.appendChild(div);
  });
  batchStrip.appendChild(getAddPageBtn()); // "+" always to the right of all pages
  downloadAllBtn.disabled = state.images.length < 2;
}

function removeImage(idx) {
  const a = state.images[idx];
  if (a && a.processedURL) URL.revokeObjectURL(a.processedURL);
  state.images.splice(idx, 1);
  if (state.activeIdx >= state.images.length) state.activeIdx = Math.max(0, state.images.length - 1);
  if (state.images.length) { renderBatchStrip(); loadActiveImage(); } else resetUI();
}

function resetUI() {
  endFillPick();
  endSizeEdit();
  viewPan = { x: 0, y: 0 };
  placeholder.style.display = 'block';
  singleView.style.display = 'none';
  previewBody.classList.remove('has-image', 'dragging-image');
  renderLayerList();
  renderBatchStrip(); // keeps the "+" page button visible
  downloadBtn.disabled = true; copyBtn.disabled = true; base64Btn.disabled = true; downloadAllBtn.disabled = true;
  undoBtn.disabled = true; redoBtn.disabled = true; resetBtn.disabled = true;
  fName.textContent = '—'; origSizeEl.textContent = '—'; outSizeEl.textContent = '—'; dimsDisplay.textContent = '—';
  savingBadge.textContent = '—'; savingBadge.className = 'saving';
  $('viewInfo').textContent = t('view.noImage');
}

let lastActiveEntry = null; // page we're switching away from (its live settings get saved)

function loadActiveImage() {
  const a = getActive();
  endFillPick();
  endSizeEdit();
  cancelCropSession();
  viewPan = { x: 0, y: 0 }; // zoom level persists across pages, panning resets
  // save the outgoing page's panel settings, then restore the incoming page's
  if (lastActiveEntry && lastActiveEntry !== a && state.images.includes(lastActiveEntry)) {
    lastActiveEntry.set = captureSettings();
  }
  lastActiveEntry = a;
  if (!a) return resetUI();
  if (a.set) {
    applySettings(a.set);
  } else {
    a.set = captureSettings(); // new pages inherit current settings…
    // …except the output format: it defaults to the loaded image's own type
    if (a.type && [...fmtSelect.options].some(o => o.value === a.type)) a.set.fmt = a.type;
    applySettings(a.set);
  }
  state.selLayer = -1;
  renderLayerList();
  placeholder.style.display = 'none';
  singleView.style.display = 'flex';
  previewBody.classList.add('has-image');
  fName.textContent = a.name;
  origSizeEl.textContent = fmtSize(a.size);
  $('viewInfo').textContent = a.name + ' — ' + fmtSize(a.size);
  wInp.value = a.resizeW != null ? a.resizeW : a.origW;
  hInp.value = a.resizeH != null ? a.resizeH : a.origH;
  // crop state is per-page: restore this page's crop so X/Y stays consistent
  state.cropAR = a.cropAR || null;
  state.freeRect = a.freeRect ? { ...a.freeRect } : null;
  document.querySelectorAll('#cropPresets .btn').forEach(b =>
    b.classList.toggle('on', b.dataset.ar !== 'free' && state.cropAR !== null && parseAR(b.dataset.ar) === state.cropAR));
  const nat = naturalOutputDims(a);
  if (a.canvasAuto === false && a.canvasW != null) {
    // the user set a custom canvas for this page — keep it
    state.canvasAuto = false;
    cWInp.value = a.canvasW; cHInp.value = a.canvasH;
  } else {
    state.canvasAuto = true;
    cWInp.value = nat.cw; cHInp.value = nat.ch; // auto canvas follows the (cropped) natural size
  }
  dimsDisplay.textContent = cWInp.value + ' × ' + cHInp.value;
  syncPosInputs(a);
  if (a.processedBlob) {
    drawDisplayFromURL(a.processedURL);
    outSizeEl.textContent = fmtSize(a.processedBlob.size);
    downloadBtn.disabled = false; copyBtn.disabled = false; base64Btn.disabled = false;
  } else {
    drawDisplayFromURL(a.dataUrl);
    outSizeEl.textContent = '—';
    savingBadge.textContent = '—'; savingBadge.className = 'saving';
    downloadBtn.disabled = true; copyBtn.disabled = true; base64Btn.disabled = true;
  }
  resetHistory();
  processImage();
}

// ===== undo / redo / reset (10-step history) =====
const MAX_HISTORY = 10;
let histStates = [];      // committed snapshots; index 0 = state when image was loaded
let histPointer = -1;

/** Per-page panel settings (filter/quality/watermark/format/...). */
function captureSettings() {
  return {
    quality: qSlider.value, lossless: losslessToggle.checked, stripMeta: stripMeta.checked,
    lock: lockBtn.classList.contains('on'), canvasLock: cLockBtn.classList.contains('on'),
    filter: filterSel.value, filterAmt: filterAmt.value,
    fillOp: fillOpacity.value, fillClr: fillColor.value,
    wmText: wmText.value, wmColor: wmColor.value, wmSize: wmSize.value,
    fmt: fmtSelect.value,
    targetOn: targetSizeOn.checked, targetKB: targetSizeInp.value
  };
}
function applySettings(s) {
  qSlider.value = s.quality; qVal.textContent = s.quality + '%';
  losslessToggle.checked = s.lossless; stripMeta.checked = s.stripMeta;
  lockBtn.classList.toggle('on', s.lock);
  cLockBtn.classList.toggle('on', s.canvasLock);
  filterSel.value = s.filter;
  filterAmtWrap.style.display = ['brightness', 'contrast', 'blur', 'saturate'].includes(s.filter) ? 'block' : 'none';
  filterAmt.value = s.filterAmt; filterAmtVal.textContent = s.filterAmt + '%';
  fillOpacity.value = s.fillOp != null ? s.fillOp : '100';
  fillColor.value = s.fillClr || '#ffffff';
  wmText.value = s.wmText != null ? s.wmText : wmText.value;
  wmColor.value = s.wmColor || '#808080';
  wmSize.value = s.wmSize || '36';
  fmtSelect.value = s.fmt;
  targetSizeOn.checked = s.targetOn; targetSizeInp.disabled = !s.targetOn; targetSizeInp.value = s.targetKB;
  syncQualityAvail();
}

function captureSnapshot() {
  const a = getActive();
  const snap = Object.assign({
    rot: a ? a.rot : 0, flipH: a ? a.flipH : false, flipV: a ? a.flipV : false,
    dx: a ? a.dx : 0, dy: a ? a.dy : 0,
    // base resize must come from the entry — the inputs may show the selected LAYER's size
    resizeW: a ? (a.resizeW != null ? a.resizeW : String(a.origW)) : wInp.value,
    resizeH: a ? (a.resizeH != null ? a.resizeH : String(a.origH)) : hInp.value,
    canvasW: cWInp.value, canvasH: cHInp.value,
    canvasAuto: state.canvasAuto,
    cropAR: state.cropAR, freeRect: state.freeRect ? { ...state.freeRect } : null,
    baseVisible: a ? a.baseVisible !== false : true,
    baseLocked: a ? a.baseLocked === true : false,
    imgRev: a ? (a.imgRev || 0) : 0, // pixel-only edits (e.g. bg removal) bump this so history sees them
    layers: a ? a.layers.map(l => ({ name: l.name, dx: l.dx, dy: l.dy, w: l.w, h: l.h, visible: l.visible !== false, locked: l.locked === true, mosaic: l.mosaic === true, fillClr: l.fillClr, fillOp: l.fillOp })) : []
  }, captureSettings());
  snap._json = JSON.stringify(snap);
  if (a) { // image refs (not serialized) so undo can restore layer stacks & merges
    snap._layerImgs = a.layers.map(l => l.img);
    snap._baseImg = a.img;
    snap._origW = a.origW; snap._origH = a.origH;
  }
  return snap;
}

function applySnapshot(s) {
  const a = getActive();
  if (a) {
    a.rot = s.rot; a.flipH = s.flipH; a.flipV = s.flipV; a.dx = s.dx; a.dy = s.dy; a.resizeW = s.resizeW; a.resizeH = s.resizeH;
    a.baseVisible = s.baseVisible !== false; a.baseLocked = s.baseLocked === true;
    a.layers = (s.layers || []).map((m, i) => {
      if (m.mosaic) return { ...m, img: null, mosaic: true }; // no pixel ref needed
      const img = s._layerImgs && s._layerImgs[i];
      if (!img) return null;
      return { ...m, img, w: m.w || (img.naturalWidth || img.width), h: m.h || (img.naturalHeight || img.height) };
    }).filter(Boolean);
    if (s._baseImg) { a.img = s._baseImg; a.origW = s._origW; a.origH = s._origH; a.imgRev = s.imgRev || 0; }
    state.selLayer = -1;
    renderLayerList();
  }
  wInp.value = s.resizeW; hInp.value = s.resizeH;
  cWInp.value = s.canvasW; cHInp.value = s.canvasH;
  state.canvasAuto = !!s.canvasAuto;
  state.cropAR = s.cropAR; state.freeRect = s.freeRect ? { ...s.freeRect } : null;
  const aa = getActive();
  if (aa) { aa.cropAR = s.cropAR; aa.freeRect = s.freeRect ? { ...s.freeRect } : null; }
  cancelCropSession();
  document.querySelectorAll('#cropPresets .btn').forEach(b =>
    b.classList.toggle('on', b.dataset.ar !== 'free' && state.cropAR !== null && parseAR(b.dataset.ar) === state.cropAR));
  applySettings(s);
  syncCanvasEntry(getActive());
  syncPosInputs(getActive());
  lastCommit = { time: 0, source: null };
}

function parseAR(str) {
  const [x, y] = String(str).split('/');
  return y ? parseFloat(x) / parseFloat(y) : parseFloat(x);
}

function resetHistory() {
  histStates = [captureSnapshot()];
  histPointer = 0;
  updateHistoryButtons();
}

/** Commit the current state after a user edit (dedupes no-ops, drops redo branch).
 *  Back-to-back commits from different controls within 100ms (e.g. W then H set
 *  together) coalesce into one step; anything slower stays its own step. The
 *  window must stay well below the 250ms process debounce so separate edits
 *  can never be mistaken for one. */
let lastCommit = { time: 0, source: null };
function commitHistory(source) {
  if (!getActive() || histPointer < 0) return;
  const snap = captureSnapshot();
  if (snap._json === histStates[histPointer]._json) return; // nothing actually changed
  const now = Date.now();
  const coalesce = source && lastCommit.source && source !== lastCommit.source && (now - lastCommit.time) < 100;
  if (coalesce) {
    histStates[histPointer] = snap; // merge into the step opened moments ago
  } else {
    histStates = histStates.slice(0, histPointer + 1);
    histStates.push(snap);
    histPointer = histStates.length - 1;
    // keep the initial state (index 0) and at most 10 newer steps
    if (histStates.length > MAX_HISTORY + 1) { histStates.splice(1, 1); histPointer--; }
  }
  lastCommit = { time: now, source: source || null };
  updateHistoryButtons();
}

function doUndo() {
  if (!getActive() || histPointer <= 0 || state.busy) return;
  histPointer--;
  applySnapshot(histStates[histPointer]);
  updateHistoryButtons();
  processImage();
}
function doRedo() {
  if (!getActive() || histPointer >= histStates.length - 1 || state.busy) return;
  histPointer++;
  applySnapshot(histStates[histPointer]);
  updateHistoryButtons();
  processImage();
}
function doReset() {
  const a = getActive();
  if (!a || state.busy) return;
  // restore the page to its just-loaded geometry (panel settings from the S0 snapshot)
  const s = Object.assign({}, histStates[0] || captureSnapshot(), {
    rot: 0, flipH: false, flipV: false, dx: 0, dy: 0,
    cropAR: null, freeRect: null,
    resizeW: String(a.origW), resizeH: String(a.origH),
    canvasW: String(a.origW), canvasH: String(a.origH), canvasAuto: true
  });
  histPointer = 0;
  applySnapshot(s);
  updateHistoryButtons();
  processImage();
}
function updateHistoryButtons() {
  undoBtn.disabled = !getActive() || histPointer <= 0;
  redoBtn.disabled = !getActive() || histPointer >= histStates.length - 1;
  resetBtn.disabled = !getActive();
}
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
resetBtn.addEventListener('click', doReset);
// every settled change inside the sidebar commits a history step
// (change covers selects/toggles and released sliders / blurred inputs;
//  click actions commit explicitly in their handlers)
document.addEventListener('change', e => {
  const id = e.target.id;
  // fill panel tweaks only live-update the pending rectangle — they never commit
  if (id !== 'fileInput' && id !== 'fillOpacity' && id !== 'fillColor' && e.target.closest('.sidebar')) commitHistory(id);
});

// ===== crop presets =====
document.querySelectorAll('#cropPresets .btn').forEach(btn => {
  if (btn.dataset.ar === 'free') return; // handled separately (interactive session)
  btn.addEventListener('click', () => {
    const a = getActive(); if (!a) return;
    cancelCropSession();
    document.querySelectorAll('#cropPresets .btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    state.cropAR = parseAR(btn.dataset.ar);
    state.freeRect = null;
    a.cropAR = state.cropAR; a.freeRect = null;
    if (state.canvasAuto) {
      const nat = naturalOutputDims(a);
      cWInp.value = nat.cw; cHInp.value = nat.ch;
      syncCanvasEntry(a);
      syncPosInputs(a);
    }
    commitHistory('cropPreset');
    processImage();
  });
});

// ===== free crop (interactive selection) =====
let cropSession = null; // {overlay, box, disp:{x,y,w,h}, scale, boundW, boundH}

function startCropSession() {
  const a = getActive();
  if (!a || cropSession) return;
  const cr = singleCanvas.getBoundingClientRect();
  const wr = singleView.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'crop-overlay';
  overlay.style.left = (cr.x - wr.x) + 'px';
  overlay.style.top = (cr.y - wr.y) + 'px';
  overlay.style.width = cr.width + 'px';
  overlay.style.height = cr.height + 'px';
  const box = document.createElement('div');
  box.className = 'crop-box';
  overlay.appendChild(box);
  const handles = {};
  for (const c of ['nw', 'ne', 'sw', 'se']) {
    const h = document.createElement('div');
    h.className = 'crop-handle ' + c;
    h.dataset.corner = c;
    box.appendChild(h);
    handles[c] = h;
  }
  singleView.appendChild(overlay);
  const bw = cr.width, bh = cr.height;
  // initial window: full canvas if a free crop is already committed, else centered 80%
  const disp = state.freeRect
    ? { x: 0, y: 0, w: bw, h: bh }
    : { x: bw * 0.1, y: bh * 0.1, w: bw * 0.8, h: bh * 0.8 };
  cropSession = { overlay, box, disp, scale: cr.width / singleCanvas.width, boundW: bw, boundH: bh };
  updateCropBox();
  box.addEventListener('pointerdown', onCropHandleDown);
}
function updateCropBox() {
  const { box, disp } = cropSession;
  box.style.left = disp.x + 'px';
  box.style.top = disp.y + 'px';
  box.style.width = disp.w + 'px';
  box.style.height = disp.h + 'px';
}
function onCropHandleDown(e) {
  if (!cropSession || !e.target.dataset.corner) return;
  e.preventDefault();
  e.stopPropagation();
  const corner = e.target.dataset.corner;
  // cursor start vs box start must be tracked separately (no key collisions)
  const start = {
    cx: e.clientX, cy: e.clientY,
    bx: cropSession.disp.x, by: cropSession.disp.y,
    bw: cropSession.disp.w, bh: cropSession.disp.h
  };
  const move = ev => {
    const dx = ev.clientX - start.cx, dy = ev.clientY - start.cy;
    let x = start.bx, y = start.by, w = start.bw, h = start.bh;
    if (corner === 'se') { w = start.bw + dx; h = start.bh + dy; }
    else if (corner === 'nw') { x = start.bx + dx; y = start.by + dy; w = start.bw - dx; h = start.bh - dy; }
    else if (corner === 'ne') { y = start.by + dy; w = start.bw + dx; h = start.bh - dy; }
    else { x = start.bx + dx; w = start.bw - dx; h = start.bh + dy; } // sw
    // clamp within the canvas, keep a minimum size
    const S = cropSession;
    x = Math.max(0, Math.min(x, S.boundW - 16));
    y = Math.max(0, Math.min(y, S.boundH - 16));
    w = Math.max(16, Math.min(w, S.boundW - x));
    h = Math.max(16, Math.min(h, S.boundH - y));
    S.disp = { x, y, w, h };
    updateCropBox();
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}
function commitCropSession() {
  if (!cropSession) return;
  const a = getActive();
  const rect = cropSession.disp;
  const scale = cropSession.scale;
  endCropSession();
  if (!a) return;
  // display → canvas coords, then → geometry-relative (invert the placement)
  const nat = naturalOutputDims(a);
  const cvd = canvasTargetDims(nat);
  const px = Math.round((cvd.canvasW - nat.cw) / 2) + (a.dx || 0);
  const py = Math.round((cvd.canvasH - nat.ch) / 2) + (a.dy || 0);
  const frOld = state.freeRect;
  state.freeRect = {
    x: Math.round(rect.x / scale) - px + (frOld ? frOld.x : 0),
    y: Math.round(rect.y / scale) - py + (frOld ? frOld.y : 0),
    w: Math.round(rect.w / scale),
    h: Math.round(rect.h / scale)
  };
  state.cropAR = null;
  a.cropAR = null; a.freeRect = { ...state.freeRect };
  a.dx = 0; a.dy = 0;
  state.canvasAuto = true;
  const natNew = naturalOutputDims(a);
  cWInp.value = natNew.cw; cHInp.value = natNew.ch;
  syncCanvasEntry(a);
  document.querySelectorAll('#cropPresets .btn').forEach(b => b.classList.remove('on'));
  syncPosInputs(a);
  commitHistory('freeCrop');
  processImage();
}
function cancelCropSession() {
  if (!cropSession) return;
  endCropSession();
}
function endCropSession() {
  if (!cropSession) return;
  cropSession.overlay.remove();
  cropSession = null;
  $('freeCropBtn').classList.remove('on');
}
$('freeCropBtn').addEventListener('click', () => {
  if (!requirePro()) return;
  const a = getActive(); if (!a) return;
  if (cropSession) { cancelCropSession(); return; }
  document.querySelectorAll('#cropPresets .btn').forEach(b => b.classList.remove('on'));
  $('freeCropBtn').classList.add('on');
  state.cropAR = null; a.cropAR = null;
  startCropSession();
});

// ===== fill (a colored rectangle on its own layer — move/resize it like any layer) =====
function fillStyle(opacityVal, colorVal) {
  const n = parseInt(colorVal.slice(1), 16) || 0;
  const op = Math.max(0, Math.min(100, parseInt(opacityVal, 10) || 0));
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + (op / 100) + ')';
}
// eyedropper: hover samples the pixel colour into the panel; left-click locks it
let fillPicking = false;
function startFillPick() {
  const a = getActive();
  if (!a || placeholder.style.display !== 'none') return;
  cancelCropSession();
  fillPicking = true;
  fillPickBtn.classList.add('on');
  previewBody.classList.add('fill-picking');
}
function endFillPick() {
  if (!fillPicking) return;
  fillPicking = false;
  fillPickBtn.classList.remove('on');
  previewBody.classList.remove('fill-picking');
}
function sampleFillPick(e) {
  const r = singleCanvas.getBoundingClientRect();
  const scale = r.width / singleCanvas.width || 1;
  const x = Math.floor((e.clientX - r.x) / scale);
  const y = Math.floor((e.clientY - r.y) / scale);
  if (x < 0 || y < 0 || x >= singleCanvas.width || y >= singleCanvas.height) return;
  const d = singleCtx.getImageData(x, y, 1, 1).data;
  fillColor.value = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
  fillColor.dispatchEvent(new Event('input', { bubbles: true })); // also repaints a selected fill layer
}
fillPickBtn.addEventListener('click', () => { if (!requirePro()) return; fillPicking ? endFillPick() : startFillPick(); });

fillBtn.addEventListener('click', () => {
  if (!requirePro()) return;
  const a = getActive();
  if (!a || placeholder.style.display !== 'none') return;
  endFillPick();
  cancelCropSession();
  const cv = canvasTargetDims(naturalOutputDims(a));
  // start identical to the previous fill block: this page's remembered rect
  // (kept up to date on every edit), else the centered 200² default
  const d = a.lastFillRect || { dx: Math.round((cv.canvasW - 200) / 2), dy: Math.round((cv.canvasH - 200) / 2), w: 200, h: 200 };
  if (fillMosaicMode.checked) {
    // mosaic layer: no pixels of its own — the render loop pixelates whatever is under it
    a.layers.push({
      img: null, mosaic: true, name: t('ctrl.fillMosaic'),
      dx: d.dx, dy: d.dy, w: d.w, h: d.h, visible: true, locked: false,
      fillOp: fillOpacity.value
    });
  } else {
    const img = document.createElement('canvas');
    img.width = d.w; img.height = d.h;
    const g = img.getContext('2d', { willReadFrequently: true });
    g.fillStyle = fillStyle(fillOpacity.value, fillColor.value);
    g.fillRect(0, 0, d.w, d.h);
    a.layers.push({
      img, name: fillColor.value,
      dx: d.dx, dy: d.dy, w: d.w, h: d.h, visible: true, locked: false,
      fillClr: fillColor.value, fillOp: fillOpacity.value
    });
  }
  a.lastFillRect = { dx: d.dx, dy: d.dy, w: d.w, h: d.h };
  state.selLayer = a.layers.length - 1;
  renderLayerList();
  syncPosInputs(a); // 调整图片尺寸 now shows the rectangle's position and size
  commitHistory('fillLayer');
  processImage();
  flashFillLayer(a.layers[state.selLayer]);
  checkLayerMemory();
});
// color/opacity tweaks repaint the selected fill layer live
function repaintSelectedFillLayer() {
  const a = getActive();
  const l = a && a.layers[state.selLayer];
  if (!l) return;
  stopFillFlashIf(l);
  if (l.mosaic) { l.fillOp = fillOpacity.value; debounceProcess(); return; } // opacity applies at draw time
  if (!l.fillClr) return;
  const g = l.img.getContext('2d');
  g.clearRect(0, 0, l.img.width, l.img.height);
  g.fillStyle = fillStyle(fillOpacity.value, fillColor.value);
  g.fillRect(0, 0, l.img.width, l.img.height);
  l.fillClr = fillColor.value; l.fillOp = fillOpacity.value; l.name = fillColor.value;
  renderLayerList();
  debounceProcess();
}
fillOpacity.addEventListener('input', repaintSelectedFillLayer);
fillColor.addEventListener('input', repaintSelectedFillLayer);

// ===== background removal (u2netp salient-object segmentation, 100% on-device) =====
// The model (~4.7MB, Apache-2.0) and the ONNX Runtime WASM files ship inside the
// extension (vendor/); nothing is downloaded and no image ever leaves the machine.
// The runtime JS + WASM are lazy-loaded on first use so editor startup is unchanged.
const bgrmBtn = $('bgrmBtn');
let bgrmSession = null, bgrmBusy = false;
function loadOrtRuntime() {
  if (window.ort) return Promise.resolve(window.ort);
  if (!loadOrtRuntime.p) {
    loadOrtRuntime.p = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/ort.wasm.min.js', location.href).href;
      s.onload = () => res(window.ort);
      s.onerror = () => { loadOrtRuntime.p = null; rej(new Error('ORT load failed')); };
      document.head.appendChild(s);
    });
  }
  return loadOrtRuntime.p;
}
async function getBgrmSession() {
  if (bgrmSession) return bgrmSession;
  const ort = await loadOrtRuntime();
  ort.env.wasm.numThreads = 1; // extension pages are not cross-origin isolated
  ort.env.wasm.wasmPaths = new URL('../vendor/', location.href).href;
  const buf = await (await fetch(new URL('../vendor/u2netp.onnx', location.href))).arrayBuffer();
  bgrmSession = await ort.InferenceSession.create(buf, { executionProvider: ['wasm'] });
  return bgrmSession;
}
async function removeBackground() {
  const a = getActive();
  if (!a || placeholder.style.display !== 'none' || bgrmBusy || state.busy) return;
  bgrmBusy = true;
  bgrmBtn.disabled = true;
  const origLabel = bgrmBtn.textContent;
  bgrmBtn.textContent = t('bg.working');
  try {
    const sess = await getBgrmSession();
    // ---- preprocess: 320² RGB, ImageNet normalisation, NCHW float32 ----
    const N = 320, CH = N * N;
    const src = document.createElement('canvas');
    src.width = N; src.height = N;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(a.img, 0, 0, N, N);
    const px = sctx.getImageData(0, 0, N, N).data;
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    const data = new Float32Array(3 * CH);
    for (let i = 0; i < CH; i++) {
      data[i]         = (px[i * 4] / 255 - mean[0]) / std[0];
      data[CH + i]    = (px[i * 4 + 1] / 255 - mean[1]) / std[1];
      data[2 * CH + i] = (px[i * 4 + 2] / 255 - mean[2]) / std[2];
    }
    const feeds = {};
    feeds[sess.inputNames[0]] = new window.ort.Tensor('float32', data, [1, 3, N, N]);
    const out = (await sess.run(feeds))[sess.outputNames[0]].data;
    // ---- min-max normalise the saliency map, gentle contrast for tighter edges ----
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < CH; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const k = mx > mn ? 1 / (mx - mn) : 0;
    const m = document.createElement('canvas');
    m.width = N; m.height = N;
    const mctx = m.getContext('2d');
    const id = mctx.createImageData(N, N);
    for (let i = 0; i < CH; i++) {
      let v = (out[i] - mn) * k;
      v = Math.max(0, Math.min(1, (v - 0.5) * 1.6 + 0.5));
      id.data[i * 4 + 3] = Math.round(v * 255);
    }
    mctx.putImageData(id, 0, 0);
    // ---- upscale the mask to the ORIGINAL resolution (bilinear) and bake as alpha ----
    const W = a.origW, H = a.origH;
    const big = document.createElement('canvas');
    big.width = W; big.height = H;
    const bctx = big.getContext('2d', { willReadFrequently: true });
    bctx.imageSmoothingEnabled = true;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(m, 0, 0, W, H);
    const result = document.createElement('canvas');
    result.width = W; result.height = H;
    const rctx = result.getContext('2d', { willReadFrequently: true });
    rctx.drawImage(a.img, 0, 0);
    const maskD = bctx.getImageData(0, 0, W, H).data;
    const imgD = rctx.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) imgD.data[i * 4 + 3] = maskD[i * 4 + 3];
    rctx.putImageData(imgD, 0, 0);
    // same mechanism as merge: geometry (resize/crop/rotate) keeps applying on top
    a.img = result;
    a.imgRev = (a.imgRev || 0) + 1; // bytes-only change: bump so the history dedup sees it
    commitHistory('bgRemove');
    processImage();
    toastMsg('toast.bgrmDone');
  } catch (err) {
    console.error(err);
    toastMsg('toast.bgrmFail');
  } finally {
    bgrmBusy = false;
    bgrmBtn.disabled = false;
    bgrmBtn.textContent = origLabel;
  }
}
bgrmBtn.addEventListener('click', () => { if (requirePro()) removeBackground(); });

// ===== fill-layer flash locator: orange dashed border until the block is touched =====
let fillFlash = null; // { box, layer, raf }
function stopFillFlash() {
  if (!fillFlash) return;
  cancelAnimationFrame(fillFlash.raf);
  if (fillFlash.box.parentNode) fillFlash.box.remove();
  fillFlash = null;
}
function stopFillFlashIf(l) { if (fillFlash && l && fillFlash.layer === l) stopFillFlash(); }
function flashFillLayer(layer) {
  stopFillFlash();
  if (!layer) return;
  const box = document.createElement('div');
  box.className = 'fill-flash-box';
  singleView.appendChild(box);
  const start = performance.now();
  fillFlash = { box, layer, raf: 0 };
  const tick = () => {
    const a = getActive();
    if (!fillFlash || !a || a.layers.indexOf(layer) < 0) { stopFillFlash(); return; }
    const el = performance.now() - start;
    if (el > 5000) { stopFillFlash(); return; } // give up after 5s of no interaction
    const cr = singleCanvas.getBoundingClientRect(), wr = singleView.getBoundingClientRect();
    const sc = cr.width / singleCanvas.width || 1;
    box.style.left = (cr.x - wr.x + layer.dx * sc) + 'px';
    box.style.top = (cr.y - wr.y + layer.dy * sc) + 'px';
    box.style.width = Math.max(8, layer.w * sc) + 'px';
    box.style.height = Math.max(8, layer.h * sc) + 'px';
    box.style.opacity = (0.35 + 0.65 * Math.abs(Math.sin(el / 220))).toFixed(2);
    fillFlash.raf = requestAnimationFrame(tick);
  };
  fillFlash.raf = requestAnimationFrame(tick);
}

// ===== rotate / flip =====
document.querySelectorAll('[data-rot]').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = getActive(); if (!a) return;
    // rotate the drag offset and free-crop rect with the content (y-down canvas, CW)
    const deg = parseInt(btn.dataset.rot, 10);
    if (deg === 90) { const { dx, dy } = a; a.dx = -dy; a.dy = dx; }
    else if (deg === 180) { a.dx = -a.dx; a.dy = -a.dy; }
    else if (deg === 270) { const { dx, dy } = a; a.dx = dy; a.dy = -dx; }
    // rotate layers with the canvas (bake the turn into each layer image)
    const cvd0 = canvasTargetDims(naturalOutputDims(a));
    for (const l of a.layers) bakeLayerTransform(l, 'rot', deg, cvd0.canvasW, cvd0.canvasH);
    if (state.freeRect) {
      const g = geometryDims(a); // pre-rotation geometry size
      const f = state.freeRect;
      if (deg === 90) state.freeRect = { x: g.ch - f.y - f.h, y: f.x, w: f.h, h: f.w };
      else if (deg === 180) state.freeRect = { x: g.cw - f.x - f.w, y: g.ch - f.y - f.h, w: f.w, h: f.h };
      else if (deg === 270) state.freeRect = { x: f.y, y: g.cw - f.x - f.w, w: f.h, h: f.w };
      a.freeRect = { ...state.freeRect };
    }
    // the canvas rotates WITH the image: auto mode follows the swapped natural
    // dims; a custom canvas swaps its own dims — the image keeps its exact
    // relative placement and can never fall out of the canvas on rotation
    if (state.canvasAuto) {
      const nat = naturalOutputDims(a);
      cWInp.value = deg % 180 ? nat.ch : nat.cw;
      cHInp.value = deg % 180 ? nat.cw : nat.ch;
      syncCanvasEntry(a);
    } else if (deg % 180) {
      const w = cWInp.value;
      cWInp.value = cHInp.value; cHInp.value = w;
      syncCanvasEntry(a);
    }
    a.rot = (a.rot + deg) % 360;
    syncPosInputs(a);
    commitHistory('rotate');
    processImage();
  });
});
document.querySelectorAll('[data-flip]').forEach(btn => {
  btn.addEventListener('click', () => {
    const a = getActive(); if (!a) return;
    if (btn.dataset.flip === 'h') { a.flipH = !a.flipH; a.dx = -a.dx; }
    else { a.flipV = !a.flipV; a.dy = -a.dy; }
    const cvdF = canvasTargetDims(naturalOutputDims(a));
    for (const l of a.layers) bakeLayerTransform(l, btn.dataset.flip === 'h' ? 'fliph' : 'flipv', 0, cvdF.canvasW, cvdF.canvasH);
    if (state.freeRect) {
      const g = geometryDims(a);
      const f = state.freeRect;
      state.freeRect = btn.dataset.flip === 'h'
        ? { x: g.cw - f.x - f.w, y: f.y, w: f.w, h: f.h }
        : { x: f.x, y: g.ch - f.y - f.h, w: f.w, h: f.h };
      a.freeRect = { ...state.freeRect };
    }
    syncPosInputs(a);
    commitHistory('flip');
    processImage();
  });
});

// ===== controls =====
qSlider.addEventListener('input', () => {
  qVal.textContent = qSlider.value + '%';
  if (losslessToggle.checked) { // quality and lossless are exclusive — touching the slider wins
    losslessToggle.checked = false;
    losslessToggle.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (getActive()) debounceProcess();
});
losslessToggle.addEventListener('change', () => { if (getActive()) debounceProcess(); });
stripMeta.addEventListener('change', () => { if (getActive()) debounceProcess(); });
// X/Y position inputs: act on the selected layer (canvas coords) or the base image
xInp.addEventListener('input', () => {
  const a = getActive(); if (!a || xInp.value === '') return;
  const v = parseInt(xInp.value, 10);
  if (isNaN(v)) return;
  const tgt = selTarget(a);
  if (tgt.locked) { syncPosInputs(a); return; }
  if (tgt.layer) { tgt.layer.dx = v; noteFillGeom(tgt.layer, a); stopFillFlashIf(tgt.layer); debounceProcess(); return; }
  const nat = naturalOutputDims(a);
  const cv = canvasTargetDims(nat);
  a.dx = v - Math.round((cv.canvasW - nat.cw) / 2);
  debounceProcess();
});
yInp.addEventListener('input', () => {
  const a = getActive(); if (!a || yInp.value === '') return;
  const v = parseInt(yInp.value, 10);
  if (isNaN(v)) return;
  const tgt = selTarget(a);
  if (tgt.locked) { syncPosInputs(a); return; }
  if (tgt.layer) { tgt.layer.dy = v; noteFillGeom(tgt.layer, a); stopFillFlashIf(tgt.layer); debounceProcess(); return; }
  const nat = naturalOutputDims(a);
  const cv = canvasTargetDims(nat);
  a.dy = v - Math.round((cv.canvasH - nat.ch) / 2);
  debounceProcess();
});
// W/H size inputs: resize the selected layer, or the base image when no layer is selected
/** Typing into W/H fires `input` per keystroke. If each keystroke rescaled the
 *  already-rescaled state, the aspect would compound and degenerate (a 790×1277
 *  crop typed to H=1000 collapses to 1000×1000). So every edit derives from a
 *  pristine snapshot taken when typing STARTED. */
let sizeEdit = null;
function beginSizeEdit(a) {
  if (sizeEdit && sizeEdit.a === a) return;
  const tgt = selTarget(a);
  sizeEdit = {
    a,
    layer: tgt.layer || null,
    nat: { ...naturalOutputDims(a) },
    rz: baseResizeDims(a),
    fr: state.freeRect ? { ...state.freeRect } : null,
    lw: tgt.layer ? tgt.layer.w : 0,
    lh: tgt.layer ? tgt.layer.h : 0,
  };
}
function endSizeEdit() { sizeEdit = null; }
/** Abandoned edit (field left empty on blur): restore the dims captured when
 *  typing started — intermediate keystrokes never survive as a real resize. */
function revertSizeEdit(a) {
  const B = sizeEdit;
  if (B.fr) { state.freeRect = { ...B.fr }; a.freeRect = { ...B.fr }; }
  if (B.rz.rw === a.origW && B.rz.rh === a.origH) { a.resizeW = null; a.resizeH = null; }
  else { a.resizeW = String(B.rz.rw); a.resizeH = String(B.rz.rh); }
  const l = selTarget(a).layer;
  if (l && B.layer === l) { l.w = B.lw; l.h = B.lh; }
  syncPosInputs(a);
  if (state.canvasAuto) {
    const nat = naturalOutputDims(a);
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    syncCanvasEntry(a);
  }
  debounceProcess();
}
/** Real typing focuses the field first, so a session is already open; programmatic
 *  `input` events (no focus) get a single-shot snapshot instead of a stale one. */
function withSizeEdit(a, fn) {
  const oneShot = !sizeEdit;
  if (oneShot) beginSizeEdit(a);
  fn(sizeEdit);
  if (oneShot) endSizeEdit();
  const tgt = selTarget(a);
  if (tgt.layer) { noteFillGeom(tgt.layer, a); stopFillFlashIf(tgt.layer); }
}
[wInp, hInp].forEach(el => {
  el.addEventListener('focus', () => { const a = getActive(); if (a) beginSizeEdit(a); });
  el.addEventListener('blur', ev => {
    // keep the session while tabbing between W and H; end it when focus leaves both
    if (ev.relatedTarget !== wInp && ev.relatedTarget !== hInp) {
      const a = getActive();
      if (a && !(parseInt(el.value, 10) > 0)) {
        if (sizeEdit && sizeEdit.a === a) revertSizeEdit(a); // field left empty: undo this edit
        else syncPosInputs(a);
      }
      endSizeEdit();
    }
  });
});

/** Base W/H edit while ANY crop is committed (free rect or preset): the inputs
 *  size the CROPPED result; the pristine baseline (B) supplies the crop rect and
 *  pre-crop resize, scaled together — the content neither shifts nor squashes. */
function resizeCroppedBase(a, B, lead) {
  const nat0 = B.nat;
  let tw = parseInt(wInp.value, 10), th = parseInt(hInp.value, 10);
  const edited = lead === 'w' ? tw : th;
  if (!(edited > 0)) return; // edited field cleared mid-typing: wait for a number
  tw = tw > 0 ? tw : nat0.cw;
  th = th > 0 ? th : nat0.ch;
  const pinnedAR = !!state.cropAR; // preset crop: the output ratio is inherently fixed
  if (pinnedAR || lockBtn.classList.contains('on')) {
    if (lead === 'w') th = Math.max(1, Math.round(tw * nat0.ch / nat0.cw));
    else tw = Math.max(1, Math.round(th * nat0.cw / nat0.ch));
  }
  const kx = tw / nat0.cw, ky = th / nat0.ch;
  if (B.fr) {
    state.freeRect = {
      x: Math.max(0, Math.round(B.fr.x * kx)),
      y: Math.max(0, Math.round(B.fr.y * ky)),
      w: Math.max(1, Math.round(B.fr.w * kx)),
      h: Math.max(1, Math.round(B.fr.h * ky)),
    };
    a.freeRect = { ...state.freeRect };
  }
  a.resizeW = String(Math.max(1, Math.round(B.rz.rw * kx)));
  a.resizeH = String(Math.max(1, Math.round(B.rz.rh * ky)));
  wInp.value = tw; hInp.value = th;
  if (state.canvasAuto) {
    const nat = naturalOutputDims(a);
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    syncCanvasEntry(a);
  }
  debounceProcess();
}
wInp.addEventListener('input', () => {
  const a = getActive();
  if (!a) return;
  const tgt = selTarget(a);
  if (tgt.layer) { // layer branch: W/H size the LAYER, base and canvas untouched
    if (tgt.locked) { syncPosInputs(a); return; }
    withSizeEdit(a, B => {
      const l = tgt.layer;
      l.w = Math.max(1, parseInt(wInp.value, 10) || l.w);
      if (lockBtn.classList.contains('on')) {
        // keep the ratio the layer HAD when typing started (a resized fill layer
        // keeps its own shape instead of snapping back to its square source)
        const ar = B.lw > 0 && B.lh > 0 ? B.lw / B.lh
          : (l.img.naturalWidth || l.img.width) / (l.img.naturalHeight || l.img.height);
        l.h = Math.max(1, Math.round(l.w / ar));
        hInp.value = l.h;
      }
    });
    debounceProcess();
    return;
  }
  if (state.freeRect || state.cropAR) { withSizeEdit(a, B => resizeCroppedBase(a, B, 'w')); return; }
  if (lockBtn.classList.contains('on') && wInp.value) hInp.value = Math.max(1, Math.round(parseInt(wInp.value, 10) / getAspectRatio()));
  a.resizeW = wInp.value; a.resizeH = hInp.value;
  if (state.canvasAuto) { // untouched canvas follows the image size
    const nat = naturalOutputDims(a);
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    syncCanvasEntry(a);
  }
  debounceProcess();
});
hInp.addEventListener('input', () => {
  const a = getActive();
  if (!a) return;
  const tgt = selTarget(a);
  if (tgt.layer) {
    if (tgt.locked) { syncPosInputs(a); return; }
    withSizeEdit(a, B => {
      const l = tgt.layer;
      l.h = Math.max(1, parseInt(hInp.value, 10) || l.h);
      if (lockBtn.classList.contains('on')) {
        const ar = B.lw > 0 && B.lh > 0 ? B.lw / B.lh
          : (l.img.naturalWidth || l.img.width) / (l.img.naturalHeight || l.img.height);
        l.w = Math.max(1, Math.round(l.h * ar));
        wInp.value = l.w;
      }
    });
    debounceProcess();
    return;
  }
  if (state.freeRect || state.cropAR) { withSizeEdit(a, B => resizeCroppedBase(a, B, 'h')); return; }
  if (lockBtn.classList.contains('on') && hInp.value) wInp.value = Math.max(1, Math.round(parseInt(hInp.value, 10) * getAspectRatio()));
  a.resizeW = wInp.value; a.resizeH = hInp.value;
  if (state.canvasAuto) {
    const nat = naturalOutputDims(a);
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    syncCanvasEntry(a);
  }
  debounceProcess();
});
lockBtn.addEventListener('click', () => { lockBtn.classList.toggle('on'); endSizeEdit(); });
cWInp.addEventListener('input', () => {
  const a = getActive();
  if (cLockBtn.classList.contains('on') && cWInp.value) cHInp.value = Math.max(1, Math.round(parseInt(cWInp.value, 10) / getAspectRatio()));
  if (a) {
    const nat = naturalOutputDims(a);
    state.canvasAuto = parseInt(cWInp.value, 10) === nat.cw && parseInt(cHInp.value, 10) === nat.ch;
    syncCanvasEntry(a);
    syncPosInputs(a);
    debounceProcess();
  }
});
cHInp.addEventListener('input', () => {
  const a = getActive();
  if (cLockBtn.classList.contains('on') && cHInp.value) cWInp.value = Math.max(1, Math.round(parseInt(cHInp.value, 10) * getAspectRatio()));
  if (a) {
    const nat = naturalOutputDims(a);
    state.canvasAuto = parseInt(cWInp.value, 10) === nat.cw && parseInt(cHInp.value, 10) === nat.ch;
    syncCanvasEntry(a);
    syncPosInputs(a);
    debounceProcess();
  }
});
cLockBtn.addEventListener('click', () => cLockBtn.classList.toggle('on'));
$('cFitBtn').addEventListener('click', () => {
  const a = getActive(); if (!a || state.busy) return;
  const nat = naturalOutputDims(a);
  const vis = (a.layers || []).filter(l => l.visible !== false);
  const fr = state.freeRect;
  // base box as it lands on the canvas (same placement math as renderCanvas)
  const baseBox = () => ({
    x: Math.round(((parseInt(cWInp.value, 10) || nat.cw) - nat.cw) / 2) + (a.dx || 0) - (fr ? fr.x : 0),
    y: Math.round(((parseInt(cHInp.value, 10) || nat.ch) - nat.ch) / 2) + (a.dy || 0) - (fr ? fr.y : 0),
    w: nat.cw, h: nat.ch,
  });
  if (!vis.length) {
    // single-image case unchanged: canvas follows the image, base at (0,0)
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    state.canvasAuto = true;
    syncCanvasEntry(a);
    a.dx = 0; a.dy = 0;
    syncPosInputs(a);
    commitHistory('fitCanvas');
    processImage();
    return;
  }
  // with visible layers: fit to the UNION of all visible content (widest/tallest
  // extents), then translate everything so the union's top-left sits at (0,0)
  const boxes = vis.map(l => ({ x: l.dx, y: l.dy, w: l.w, h: l.h }));
  if (a.baseVisible !== false || !boxes.length) boxes.push(baseBox());
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  const W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);
  for (const l of vis) { l.dx -= minX; l.dy -= minY; }
  if (a.baseVisible !== false) { // keep the base's on-canvas position, re-expressed for the new canvas
    const b = baseBox();
    a.dx = b.x - minX - Math.round((W - nat.cw) / 2) + (fr ? fr.x : 0);
    a.dy = b.y - minY - Math.round((H - nat.ch) / 2) + (fr ? fr.y : 0);
  }
  cWInp.value = W; cHInp.value = H;
  state.canvasAuto = false; // compositing: canvas no longer follows the base alone
  syncCanvasEntry(a);
  syncPosInputs(a);
  commitHistory('fitCanvas');
  processImage();
});
fmtSelect.addEventListener('change', () => {
  syncQualityAvail();
  if (getActive()) debounceProcess();
});
/** Quality applies to lossy formats only — PNG/BMP/GIF ignore it entirely. */
function syncQualityAvail() {
  const na = ['image/png', 'image/bmp', 'image/gif'].includes(fmtSelect.value);
  qSlider.disabled = na;
  qSlider.title = na ? t('hint.losslessFmt') : '';
}
filterSel.addEventListener('change', () => {
  filterAmtWrap.style.display = ['brightness', 'contrast', 'blur', 'saturate'].includes(filterSel.value) ? 'block' : 'none';
  if (getActive()) debounceProcess();
});
filterAmt.addEventListener('input', () => { filterAmtVal.textContent = filterAmt.value + '%'; if (getActive() && filterSel.value !== 'none') debounceProcess(); });
// ===== watermark → text layers (one per click, draggable like any other layer) =====
/** Rasterise text with the current colour/size into a layer canvas, centred on the canvas. */
function makeTextLayer(txt, color, size, a) {
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '600 ' + size + 'px ' + FONT_STACK;
  const w = Math.max(1, Math.ceil(probe.measureText(txt).width) + 8);
  const h = Math.ceil(size * 1.35);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.font = '600 ' + size + 'px ' + FONT_STACK;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(txt, 4, h / 2);
  const cv = canvasTargetDims(naturalOutputDims(a));
  return {
    img: c, name: txt.length > 16 ? txt.slice(0, 16) + '…' : txt,
    text: txt, textClr: color, textSize: size,
    dx: Math.round((cv.canvasW - w) / 2), dy: Math.round((cv.canvasH - h) / 2),
    w, h, visible: true, locked: false
  };
}
wmAddBtn.addEventListener('click', () => {
  const a = getActive();
  if (!a || placeholder.style.display !== 'none') return;
  cancelCropSession();
  a.layers.push(makeTextLayer(
    wmText.value.trim() || wmText.placeholder || 'text',
    wmColor.value,
    Math.max(8, Math.min(200, parseInt(wmSize.value, 10) || 36)),
    a
  ));
  state.selLayer = a.layers.length - 1;
  renderLayerList();
  syncPosInputs(a); // 调整图片尺寸 shows the text's position and size
  commitHistory('textLayer');
  processImage();
  checkLayerMemory();
});
// text/colour/size edits repaint the SELECTED text layer in place
function repaintSelectedTextLayer() {
  const a = getActive();
  const l = a && a.layers[state.selLayer];
  if (!l || !l.text) return;
  const nl = makeTextLayer(
    wmText.value.trim() || l.text,
    wmColor.value,
    Math.max(8, Math.min(200, parseInt(wmSize.value, 10) || l.textSize)),
    a
  );
  l.img = nl.img; l.w = nl.w; l.h = nl.h;
  l.text = nl.text; l.textClr = nl.textClr; l.textSize = nl.textSize; l.name = nl.name;
  renderLayerList();
  debounceProcess();
}
wmText.addEventListener('input', repaintSelectedTextLayer);
wmColor.addEventListener('input', repaintSelectedTextLayer);
wmSize.addEventListener('input', repaintSelectedTextLayer);
targetSizeOn.addEventListener('change', () => { targetSizeInp.disabled = !targetSizeOn.checked; if (getActive()) debounceProcess(); });
targetSizeInp.addEventListener('input', () => { if (getActive()) debounceProcess(); });

// ===== processing =====
let processTimer;
function debounceProcess() { clearTimeout(processTimer); processTimer = setTimeout(processImage, 250); }

/** The base image's resize dims — read from the ENTRY, never from the W/H inputs
 *  (those show the selected LAYER's size when a layer is selected). */
function baseResizeDims(a) {
  let rw = a.resizeW != null ? parseInt(a.resizeW, 10) : a.origW;
  let rh = a.resizeH != null ? parseInt(a.resizeH, 10) : a.origH;
  if (!rw && rh) rw = Math.round(rh * getAspectRatioFor(a));
  if (rw && !rh) rh = Math.round(rw / getAspectRatioFor(a));
  return { rw: Math.max(1, Math.min(10000, rw || 1)), rh: Math.max(1, Math.min(10000, rh || 1)) };
}

/** Geometry dims (image only): resize → aspect center-crop → rotation swap. */
function geometryDims(a) {
  const rz = baseResizeDims(a);
  const rw = rz.rw, rh = rz.rh;
  let cropW = rw, cropH = rh;
  if (state.cropAR) {
    const ar = state.cropAR;
    if (rw / rh > ar) { cropW = Math.round(rh * ar); }
    else { cropH = Math.round(rw / ar); }
  }
  const needsSwap = a.rot % 180 !== 0;
  return { cw: needsSwap ? cropH : cropW, ch: needsSwap ? cropW : cropH };
}

/** Mosaic fill layer: pixelate whatever is under it on the canvas, sampled at
 *  draw time — moving/resizing the rectangle re-censors the right content.
 *  ~12px cells; opacity (fillOp) still applies for subtle censoring. */
function drawMosaicLayer(ctx, l) {
  const sx = Math.max(0, Math.round(l.dx)), sy = Math.max(0, Math.round(l.dy));
  const sw = Math.min(ctx.canvas.width, Math.round(l.dx + l.w)) - sx;
  const sh = Math.min(ctx.canvas.height, Math.round(l.dy + l.h)) - sy;
  if (sw <= 0 || sh <= 0) return;
  const CELL = 12;
  const bw = Math.max(1, Math.round(sw / CELL)), bh = Math.max(1, Math.round(sh / CELL));
  const t = document.createElement('canvas');
  t.width = bw; t.height = bh;
  t.getContext('2d').drawImage(ctx.canvas, sx, sy, sw, sh, 0, 0, bw, bh); // downscale = average
  const op = Math.max(0, Math.min(100, parseInt(l.fillOp, 10) || 100)) / 100;
  ctx.save();
  if (op < 1) ctx.globalAlpha = op;
  ctx.imageSmoothingEnabled = false; // upscale without smoothing = hard blocks
  ctx.drawImage(t, 0, 0, bw, bh, sx, sy, sw, sh);
  ctx.restore();
}

/** Natural output dims: geometry → free-crop rect (if committed). */
function naturalOutputDims(a) {  const g = geometryDims(a);
  if (state.freeRect) return { cw: state.freeRect.w, ch: state.freeRect.h };
  return g;
}

/** Final canvas dims from the canvas panel inputs (fallback: natural output). */
function canvasTargetDims(nat) {
  return {
    canvasW: Math.max(1, Math.min(10000, parseInt(cWInp.value, 10) || nat.cw)),
    canvasH: Math.max(1, Math.min(10000, parseInt(cHInp.value, 10) || nat.ch))
  };
}

/** Sync the X/Y and W/H inputs with the selected layer (or base image). */
function syncPosInputs(a) {
  if (!a) return;
  const tgt = selTarget(a);
  if (tgt.layer) {
    xInp.value = tgt.layer.dx; yInp.value = tgt.layer.dy;
    wInp.value = tgt.layer.w; hInp.value = tgt.layer.h; // W/H show the LAYER size
    return;
  }
  const nat = naturalOutputDims(a);
  const cv = canvasTargetDims(nat);
  xInp.value = Math.round((cv.canvasW - nat.cw) / 2) + a.dx;
  yInp.value = Math.round((cv.canvasH - nat.ch) / 2) + a.dy;
  if (state.freeRect || state.cropAR) { // a crop is committed: W/H show the cropped result
    wInp.value = nat.cw; hInp.value = nat.ch;
  } else {
    wInp.value = a.resizeW != null ? a.resizeW : a.origW;
    hInp.value = a.resizeH != null ? a.resizeH : a.origH;
  }
}

/** Persist the live canvas settings onto the page entry (null = auto-follow). */
function syncCanvasEntry(a) {
  if (!a) return;
  a.canvasAuto = state.canvasAuto;
  if (state.canvasAuto) { a.canvasW = null; a.canvasH = null; }
  else { a.canvasW = cWInp.value; a.canvasH = cHInp.value; }
}

/** Stage 1 of renderCanvas on its own canvas: the base image with resize →
 *  aspect-crop → rotate/flip baked in (used by render and by layer duplication). */
function baseGeoCanvas(a) {
  const rz = baseResizeDims(a);
  const rw = rz.rw, rh = rz.rh;
  let cropX = 0, cropY = 0, cropW = rw, cropH = rh;
  if (state.cropAR) {
    const ar = state.cropAR;
    if (rw / rh > ar) { cropW = Math.round(rh * ar); cropX = Math.round((rw - cropW) / 2); }
    else { cropH = Math.round(rw / ar); cropY = Math.round((rh - cropH) / 2); }
  }
  const needsSwap = a.rot % 180 !== 0;
  const gw = needsSwap ? cropH : cropW;
  const gh = needsSwap ? cropW : cropH;
  const geo = document.createElement('canvas');
  geo.width = gw; geo.height = gh;
  const gctx = geo.getContext('2d');
  // map the crop rect back into source pixels (resize is applied while drawing)
  const sx = rw / a.origW, sy = rh / a.origH;
  const srcX = cropX / sx, srcY = cropY / sy, srcW = cropW / sx, srcH = cropH / sy;
  gctx.save();
  gctx.translate(gw / 2, gh / 2);
  gctx.rotate(a.rot * Math.PI / 180);
  gctx.scale(a.flipH ? -1 : 1, a.flipV ? -1 : 1);
  gctx.drawImage(a.img, srcX, srcY, srcW, srcH, -cropW / 2, -cropH / 2, cropW, cropH);
  gctx.restore();
  return geo;
}

/** Full render: geometry (resize → aspect-crop → rotate/flip) → free-crop rect → canvas placement → filter → watermark. */
function renderCanvas(a, opts) {
  opts = opts || {};
  const filter = opts.filter !== undefined ? opts.filter : filterSel.value;
  const fAmt = parseInt(filterAmt.value, 10) / 100;
  const outFmt = fmtSelect.value;

  // ---- stage 1: geometry canvas ----
  const geo = baseGeoCanvas(a);

  // ---- stage 2+3: free-crop window → canvas placement ----
  const nat = naturalOutputDims(a);
  const cv = canvasTargetDims(nat);
  const canvasW = cv.canvasW, canvasH = cv.canvasH;
  const fr = state.freeRect;
  const drawX = Math.round((canvasW - nat.cw) / 2) + (a.dx || 0) - (fr ? fr.x : 0);
  const drawY = Math.round((canvasH - nat.ch) / 2) + (a.dy || 0) - (fr ? fr.y : 0);

  const canvas = document.createElement('canvas');
  canvas.width = canvasW; canvas.height = canvasH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const opaque = outFmt === 'image/bmp' || outFmt === 'image/jpeg'; // no alpha channel
  if (opaque) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvasW, canvasH);
  }

  if (a.baseVisible === false) {
    // base layer hidden — draw overlays only
  } else if (['brightness', 'contrast', 'blur', 'saturate'].includes(filter)) {
    const fmap = { brightness: 'brightness(' + fAmt + ')', contrast: 'contrast(' + fAmt + ')', blur: 'blur(' + (fAmt * 4) + 'px)', saturate: 'saturate(' + fAmt + ')' };
    ctx.filter = fmap[filter];
    ctx.drawImage(geo, drawX, drawY);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(geo, drawX, drawY);
    if (['grayscale', 'sepia', 'invert'].includes(filter)) {
      const id = ctx.getImageData(0, 0, canvasW, canvasH);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (filter === 'grayscale') { const gr = 0.299 * r + 0.587 * g + 0.114 * b; d[i] = d[i + 1] = d[i + 2] = gr; }
        else if (filter === 'sepia') {
          d[i] = Math.min(255, r * .393 + g * .769 + b * .189);
          d[i + 1] = Math.min(255, r * .349 + g * .686 + b * .168);
          d[i + 2] = Math.min(255, r * .272 + g * .534 + b * .131);
        } else { d[i] = 255 - r; d[i + 1] = 255 - g; d[i + 2] = 255 - b; }
      }
      ctx.putImageData(id, 0, 0);
    }
  }

  // overlay layers (drawn above the filtered base, below the watermark)
  if (a.layers) for (const l of a.layers) {
    if (l.visible === false) continue;
    if (l.mosaic) { drawMosaicLayer(ctx, l); continue; } // pixelates whatever is under it, live
    ctx.drawImage(l.img, l.dx, l.dy, l.w, l.h);
  }

  return canvas;
}
function getAspectRatioFor(a) { return a.origW / a.origH; }

function canvasToBlob(canvas, mime, q) {
  return new Promise((res, rej) => {
    try { canvas.toBlob(b => b ? res(b) : rej(new Error('encode failed: ' + mime)), mime, q); }
    catch (e) { rej(e); }
  });
}

async function encodeCanvas(canvas, mime, q) {
  if (mime === 'image/bmp') return encodeBMP(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
  if (mime === 'image/gif') return encodeGIF(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height));
  try {
    return await canvasToBlob(canvas, mime, q);
  } catch (e) {
    return canvasToBlob(canvas, 'image/png'); // browser can't encode this type
  }
}

/** Encode with optional binary search on quality to fit a byte budget (lossy formats only). */
/** TRUE lossless: with 无损 on and no pixel/container change (same format, no
 *  geometry/canvas/layer/filter/watermark edits, no size target) the ORIGINAL
 *  file bytes are passed through untouched — quality 100 re-encoding would
 *  still be a lossy generation for JPEG/WebP. */
function canLosslessPassthrough(a) {
  if (!losslessToggle.checked || !a || !a.blob) return false;
  if (a.img !== a.origImg) return false; // merged/flattened base — original bytes are stale
  if (fmtSelect.value !== (a.type || '')) return false;
  if (targetSizeOn.checked) return false;
  if (a.rot || a.flipH || a.flipV || a.dx || a.dy) return false;
  if (a.cropAR || a.freeRect) return false;
  if (a.resizeW != null && parseInt(a.resizeW, 10) !== a.origW) return false;
  if (a.resizeH != null && parseInt(a.resizeH, 10) !== a.origH) return false;
  if (a.canvasAuto === false) return false;
  if (a.layers && a.layers.length) return false;
  if (a.baseVisible === false) return false;
  if (filterSel.value !== 'none') return false;
  return true;
}
/** Drop JPEG metadata segments (APPn/COM), keep every pixel bit.
 *  APP2 (ICC colour profile) is kept — removing it would change colours. */
function stripJpegMeta(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return bytes;
  const out = [0xFF, 0xD8];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xFF) break;
    const marker = bytes[i + 1];
    if (marker === 0xDA) { // SOS: keep it plus all entropy data verbatim
      const len = dv.getUint16(i + 2);
      for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
      return new Uint8Array(out);
    }
    const len = dv.getUint16(i + 2);
    const isMeta = (marker >= 0xE0 && marker <= 0xEF) || marker === 0xFE;
    if (!isMeta || marker === 0xE2) for (let k = 0; k < 2 + len; k++) out.push(bytes[i + k]);
    i += 2 + len;
  }
  if (i < bytes.length) for (let k = i; k < bytes.length; k++) out.push(bytes[k]);
  return new Uint8Array(out);
}
/** Drop PNG metadata chunks (EXIF/text/time); chunks are self-delimiting. */
function stripPngMeta(bytes) {
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  for (let k = 0; k < 8; k++) if (bytes[k] !== sig[k]) return bytes;
  const out = [...sig];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len = dv.getUint32(i);
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const total = 12 + len;
    if (i + total > bytes.length) break;
    if (!['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'].includes(type)) {
      for (let k = 0; k < total; k++) out.push(bytes[i + k]);
    }
    i += total;
    if (type === 'IEND') break;
  }
  return new Uint8Array(out);
}

async function encodeFinal(canvas, a) {
  const mime = fmtSelect.value;
  if (canLosslessPassthrough(a)) {
    if (!stripMeta.checked) return a.blob; // bit-identical bytes
    const bytes = new Uint8Array(await a.blob.arrayBuffer()); // strip metadata without re-encoding
    if (mime === 'image/jpeg') return new Blob([stripJpegMeta(bytes)], { type: mime });
    if (mime === 'image/png') return new Blob([stripPngMeta(bytes)], { type: mime });
    // other formats: metadata surgery unsupported → fall through to re-encode
  }
  const q = losslessToggle.checked ? 1 : parseInt(qSlider.value, 10) / 100;
  let blob = await encodeCanvas(canvas, mime, mime === 'image/png' ? undefined : q);

  if (targetSizeOn.checked && (mime === 'image/jpeg' || mime === 'image/webp')) {
    const targetBytes = (parseInt(targetSizeInp.value, 10) || 0) * 1024;
    if (targetBytes > 0) {
      let lo = 1, hi = 100, best = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const b = await canvasToBlob(canvas, mime, mid / 100);
        if (b.size <= targetBytes) { best = b; lo = mid + 1; } else { hi = mid - 1; }
      }
      if (best) blob = best;
    }
  }
  return blob;
}

async function processImage() {
  const a = getActive();
  if (!a) return;
  if (state.busy) { debounceProcess(); return; }
  setBusy(true);
  try {
    const canvas = renderCanvas(a);
    const blob = await encodeFinal(canvas, a);
    if (getActive() !== a) return; // switched away while encoding
    if (a.processedURL) URL.revokeObjectURL(a.processedURL);
    a.processedBlob = blob;
    a.processedURL = URL.createObjectURL(blob);
    drawDisplay(canvas); // instant unencoded preview; replaced by the decoded blob below
    drawDisplayFromURL(a.processedURL); // seq-guarded: a late decode can't clobber a newer render
    outSizeEl.textContent = fmtSize(blob.size);
    const saving = a.size - blob.size;
    const pct = (Math.abs(saving / a.size) * 100).toFixed(1);
    if (saving === 0 || pct === '0.0') { savingBadge.textContent = '0%'; savingBadge.className = 'saving'; } // lossless passthrough
    else if (saving > 0) { savingBadge.textContent = '-' + pct + '%'; savingBadge.className = 'saving pos'; }
    else { savingBadge.textContent = '+' + pct + '%'; savingBadge.className = 'saving neg'; }
    dimsDisplay.textContent = canvas.width + ' × ' + canvas.height;
    downloadBtn.disabled = false; copyBtn.disabled = false; base64Btn.disabled = false;
  } catch (err) {
    console.error(err);
    toastMsg(t('toast.error') + (err && err.message ? err.message : ''));
  } finally {
    setBusy(false); // must release even on early return (page switched mid-encode)
  }
}

// ===== download =====
/** Compact local timestamp: YYYYMMDD-HHmmss */
function fileTimestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// ===== layers (Photoshop-style, max 3 per page: base + 2 overlays) =====
// ===== layers: unlimited, with memory accounting =====
// MEM is a global so tests can lower the threshold (MEM.warnMB = 1).
const MEM = { warnMB: 400, warned: 0 };
function estimateMemoryMB() {
  let bytes = 0;
  for (const pg of state.images) {
    if (pg.img) bytes += ((pg.img.naturalWidth || pg.img.width) * (pg.img.naturalHeight || pg.img.height)) * 4;
    for (const l of pg.layers) {
      if (l.img) bytes += ((l.img.naturalWidth || l.img.width) * (l.img.naturalHeight || l.img.height)) * 4;
    }
  }
  return bytes / 1048576;
}
function checkLayerMemory() {
  const m = estimateMemoryMB();
  if (m >= MEM.warnMB * 1.5 && MEM.warned < 2) { MEM.warned = 2; toastMsg('toast.memHigh'); }
  else if (m >= MEM.warnMB && MEM.warned < 1) { MEM.warned = 1; toastMsg('toast.memHigh'); }
  else if (m < MEM.warnMB * 0.7) MEM.warned = 0; // hysteresis
  return m;
}
/** Remember the rect of a fill layer so the next fill starts identical. */
function noteFillGeom(l, a) {
  if (l && (l.fillClr || l.mosaic)) {
    a = a || getActive();
    if (a) a.lastFillRect = { dx: l.dx, dy: l.dy, w: l.w, h: l.h };
  }
}
function layerW(l) { return l.img.naturalWidth || l.img.width; }
function layerH(l) { return l.img.naturalHeight || l.img.height; }

/** What the position inputs / drag currently act on (base or a layer). */
function selTarget(a) {
  a = a || getActive();
  if (!a) return null;
  if (state.selLayer >= 0 && a.layers[state.selLayer]) {
    const l = a.layers[state.selLayer];
    return { layer: l, locked: l.locked || !l.visible };
  }
  return { layer: null, locked: a.baseLocked || !a.baseVisible };
}

function renderLayerList() {
  const list = $('layerList');
  if (!list) return;
  list.innerHTML = '';
  const a = getActive();
  if (!a) return;
  const mkRow = (isBase, idx) => {
    const l = isBase ? null : a.layers[idx];
    const name = isBase ? (a.empty ? t('layer.base') : a.name) : l.name;
    const visible = isBase ? a.baseVisible !== false : l.visible;
    const locked = isBase ? a.baseLocked === true : l.locked;
    const selected = isBase ? state.selLayer === -1 : state.selLayer === idx;
    const row = document.createElement('div');
    row.className = 'layer-row' + (selected ? ' selected' : '') + ((locked || !visible) ? ' muted' : '');
    row.title = name;

    const lockB = document.createElement('button');
    lockB.className = 'lyr-ico';
    lockB.textContent = locked ? '🔒' : '🔓';
    lockB.addEventListener('click', e => { e.stopPropagation(); toggleLayerLock(isBase, idx); });
    row.appendChild(lockB);

    const eyeB = document.createElement('button');
    eyeB.className = 'lyr-ico';
    eyeB.textContent = visible ? '👁' : '🚫';
    eyeB.addEventListener('click', e => { e.stopPropagation(); toggleLayerEye(isBase, idx); });
    row.appendChild(eyeB);

    const nm = document.createElement('span');
    nm.className = 'lyr-name';
    nm.textContent = name;
    row.appendChild(nm);

    if (!isBase) {
      const upB = document.createElement('button');
      upB.className = 'lyr-ico';
      upB.textContent = '↑';
      upB.disabled = idx === a.layers.length - 1; // already the top layer
      upB.addEventListener('click', e => { e.stopPropagation(); moveLayer(idx, 1); });
      row.appendChild(upB);

      const downB = document.createElement('button');
      downB.className = 'lyr-ico';
      downB.textContent = '↓';
      downB.disabled = idx === 0; // already the bottom overlay
      downB.addEventListener('click', e => { e.stopPropagation(); moveLayer(idx, -1); });
      row.appendChild(downB);

      const delB = document.createElement('button');
      delB.className = 'lyr-ico';
      delB.textContent = '🗑';
      delB.addEventListener('click', e => { e.stopPropagation(); deleteLayer(idx); });
      row.appendChild(delB);
    }
    row.addEventListener('click', () => {
      if (locked || !visible) return; // locked/hidden layers cannot be selected
      state.selLayer = isBase ? -1 : idx;
      renderLayerList();
      syncPosInputs(a);
    });
    list.appendChild(row);
  };
  for (let i = a.layers.length - 1; i >= 0; i--) mkRow(false, i); // top layer first
  mkRow(true, -1);                                                // base at the bottom
}

function toggleLayerLock(isBase, idx) {
  const a = getActive(); if (!a) return;
  if (isBase) a.baseLocked = !a.baseLocked;
  else {
    a.layers[idx].locked = !a.layers[idx].locked;
    if (a.layers[idx].locked && state.selLayer === idx) state.selLayer = -1;
  }
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerLock');
}
function toggleLayerEye(isBase, idx) {
  const a = getActive(); if (!a) return;
  if (isBase) a.baseVisible = a.baseVisible === false; // flip
  else {
    a.layers[idx].visible = !a.layers[idx].visible;
    if (!a.layers[idx].visible && state.selLayer === idx) state.selLayer = -1;
  }
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerEye');
  processImage();
}
function moveLayer(idx, dir) {
  const a = getActive(); if (!a) return;
  const j = idx + dir;
  if (j < 0 || j >= a.layers.length) return;
  const t = a.layers[idx]; a.layers[idx] = a.layers[j]; a.layers[j] = t;
  if (state.selLayer === idx) state.selLayer = j;
  else if (state.selLayer === j) state.selLayer = idx;
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerOrder');
  processImage();
}

function deleteLayer(idx) {
  const a = getActive(); if (!a) return;
  a.layers.splice(idx, 1);
  if (state.selLayer === idx) state.selLayer = -1;
  else if (state.selLayer > idx) state.selLayer--;
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerDel');
  processImage();
}

/** Paste an image as a new overlay layer on the current page. */
async function addLayerFromBlob(a, file) {
  if (!file || (file.type && !file.type.startsWith('image/'))) return false;
  const dataUrl = await blobToDataURL(file);
  const img = await loadImg(dataUrl);
  a.layers.push({ img, name: file.name || ('layer-' + (a.layers.length + 1)), dx: 0, dy: 0,
                  w: img.naturalWidth || img.width, h: img.naturalHeight || img.height,
                  visible: true, locked: false });
  state.selLayer = a.layers.length - 1; // auto-select the new layer
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerAdd');
  processImage();
  checkLayerMemory();
  return true;
}

/** Bake a rotation/flip into a layer at its current display size and reposition it. */
function bakeLayerTransform(l, kind, deg, cvW, cvH) {
  if (l.img) { // mosaic layers have no pixels — only their box transforms
    const c = document.createElement('canvas');
    if (kind === 'rot' && deg % 180) { c.width = l.h; c.height = l.w; } else { c.width = l.w; c.height = l.h; }
    const cx = c.getContext('2d');
    cx.translate(c.width / 2, c.height / 2);
    if (kind === 'rot') cx.rotate(deg * Math.PI / 180);
    else if (kind === 'fliph') cx.scale(-1, 1);
    else cx.scale(1, -1);
    cx.drawImage(l.img, -l.w / 2, -l.h / 2, l.w, l.h);
    l.img = c;
  }
  // reposition (rect transform, y-down CW rotation) and swap the box on 90/270
  if (kind === 'rot') {
    if (deg === 90) { const nx = cvH - l.dy - l.h; l.dy = l.dx; l.dx = nx; const t = l.w; l.w = l.h; l.h = t; }
    else if (deg === 180) { l.dx = cvW - l.dx - l.w; l.dy = cvH - l.dy - l.h; }
    else if (deg === 270) { const ny = cvW - l.dx - l.w; l.dx = l.dy; l.dy = ny; const t = l.w; l.w = l.h; l.h = t; }
  } else if (kind === 'fliph') l.dx = cvW - l.dx - l.w;
  else l.dy = cvH - l.dy - l.h;
}

$('mergeBtn').addEventListener('click', async () => {
  const a = getActive();
  if (!a || state.busy) return;
  if (!a.layers.length) { toastMsg('toast.noLayers'); return; }
  setBusy(true);
  try {
    const memBefore = estimateMemoryMB(); // before layers are cleared/baked
    const canvas = renderCanvas(a, { filter: 'none' }); // geometry + layers only
    const img = await loadImg(canvas.toDataURL('image/png'));
    a.img = img;
    a.origW = canvas.width; a.origH = canvas.height;
    a.rot = 0; a.flipH = a.flipV = false; a.dx = a.dy = 0;
    a.cropAR = null; a.freeRect = null; state.cropAR = null; state.freeRect = null;
    a.resizeW = a.resizeH = null; a.canvasW = a.canvasH = null; a.canvasAuto = true;
    a.layers = []; state.selLayer = -1;
    wInp.value = a.origW; hInp.value = a.origH;
    const nat = naturalOutputDims(a);
    cWInp.value = nat.cw; cHInp.value = nat.ch;
    renderLayerList();
    syncPosInputs(a);
    commitHistory('merge');
    processImage();
    const freedMB = Math.max(0, memBefore - estimateMemoryMB());
    if (freedMB >= 1) toastMsg(t('toast.memFreed').replace('{n}', Math.round(freedMB)));
    checkLayerMemory();
  } catch (err) {
    console.error(err);
    toastMsg(t('toast.error') + (err && err.message ? err.message : ''));
  } finally {
    setBusy(false);
  }
});

/** Duplicate the selected layer — or, with the base selected, the base image
 *  with its current geometry baked in — as a new layer directly above it. */
$('dupBtn').addEventListener('click', () => {
  const a = getActive();
  if (!a || a.empty || !a.img) { toastMsg('toast.noImage'); return; }
  const idx = state.selLayer;
  if (idx >= 0 && a.layers[idx]) {
    const src = a.layers[idx];
    // img is shared by reference — layers replace it (bake/repaint), never mutate it in place
    a.layers.splice(idx + 1, 0, { ...src, name: t('layer.dupName').replace('{n}', src.name) });
    state.selLayer = idx + 1;
  } else {
    // base selected → its current look (resize/crop/rotate/flip) becomes a movable layer
    const geo = baseGeoCanvas(a);
    const nat = naturalOutputDims(a);
    const cv = canvasTargetDims(nat);
    const fr = state.freeRect;
    a.layers.push({
      img: geo, name: t('layer.dupName').replace('{n}', a.name || t('layer.base')),
      dx: Math.round((cv.canvasW - nat.cw) / 2) + (a.dx || 0) - (fr ? fr.x : 0),
      dy: Math.round((cv.canvasH - nat.ch) / 2) + (a.dy || 0) - (fr ? fr.y : 0),
      w: geo.width, h: geo.height, visible: true, locked: false
    });
    state.selLayer = a.layers.length - 1;
  }
  renderLayerList();
  syncPosInputs(a);
  commitHistory('layerDup');
  processImage();
  checkLayerMemory();
});

downloadBtn.addEventListener('click', () => {
  const a = getActive();
  if (!a || !a.processedBlob) return;
  const ext = EXT_OF[a.processedBlob.type] || 'img';
  const base = a.name.replace(/\.[^.]+$/, '') || 'image';
  saveBlob(a.processedBlob, base + '-' + fileTimestamp() + '.' + ext);
  toastMsg('toast.downloaded');
});

// ===== copy to clipboard (image; converted to PNG — the only format clipboards accept) =====
async function doCopyImage() {
  const a = getActive();
  if (!a) return;
  try {
    // always render fresh: the processed blob can be stale while a debounced reprocess is pending
    const blob = await canvasToBlob(renderCanvas(a), 'image/png');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toastMsg('toast.copied');
  } catch (e) {
    try {
      // fallback: stash as a data-URL text (the paste handler understands this format)
      await navigator.clipboard.writeText(await blobToDataURL(await canvasToBlob(renderCanvas(a), 'image/png')));
      toastMsg('toast.copied');
    } catch (e2) { toastMsg('toast.copyNotSupported'); }
  }
}
copyBtn.addEventListener('click', doCopyImage);

// right-click "copy image" menu on the preview (pages with an image only)
let ctxMenu = null;
function hideCtxMenu() {
  if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; }
}
previewBody.addEventListener('contextmenu', e => {
  const a = getActive();
  if (!a || a.empty) return;
  e.preventDefault();
  hideCtxMenu();
  ctxMenu = document.createElement('div');
  ctxMenu.className = 'ctx-menu';
  const btn = document.createElement('button');
  btn.textContent = t('btn.copyImage');
  btn.addEventListener('click', () => { hideCtxMenu(); doCopyImage(); });
  ctxMenu.appendChild(btn);
  document.body.appendChild(ctxMenu);
  ctxMenu.style.left = Math.min(e.clientX, window.innerWidth - 170) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, window.innerHeight - 60) + 'px';
});
document.addEventListener('click', e => {
  if (ctxMenu && !ctxMenu.contains(e.target)) hideCtxMenu();
});

// ===== base64 =====
base64Btn.addEventListener('click', () => {
  const a = getActive();
  if (!a || !a.processedBlob) return;
  blobToDataURL(a.processedBlob).then(url => { $('b64Output').value = url; openModal('b64Modal'); });
});
$('copyB64Btn').addEventListener('click', async () => {
  const ta = $('b64Output');
  ta.select();
  try { await navigator.clipboard.writeText(ta.value); toastMsg('toast.copiedB64'); }
  catch (e) { toastMsg('toast.copyNotSupported'); }
});

// ===== batch zip (processes every image with current settings) =====
downloadAllBtn.addEventListener('click', async () => {
  if (state.images.length < 2 || state.busy) return;
  setBusy(true);
  downloadAllBtn.disabled = true;
  try {
    // the render pipeline reads live controls; snapshot them so each page is
    // encoded with ITS OWN canvas/settings, then restore afterwards
    const act = getActive();
    if (act) act.set = captureSettings(); // fold unsaved live edits of the active page in first
    const saved = captureSnapshot();
    const fmtAll = fmtSelect.value; // what the format select shows right now
    const entries = [];
    const used = new Set();
    try {
      for (let i = 0; i < state.images.length; i++) {
        const a = state.images[i];
        applySettings(a.set || captureSettings());
        fmtSelect.value = fmtAll; // the whole batch is encoded in the currently selected format
        state.cropAR = a.cropAR || null;
        state.freeRect = a.freeRect ? { ...a.freeRect } : null;
        if (a.canvasAuto === false && a.canvasW != null) {
          state.canvasAuto = false;
          cWInp.value = a.canvasW; cHInp.value = a.canvasH;
        } else {
          state.canvasAuto = true;
          const nat = naturalOutputDims(a);
          cWInp.value = nat.cw; cHInp.value = nat.ch;
        }
        const blob = await encodeFinal(renderCanvas(a), a);
        const ext = EXT_OF[blob.type] || 'img';
        let name = (a.name.replace(/\.[^.]+$/, '') || 'image_' + (i + 1)) + '_optimized.' + ext;
        let n = 2;
        while (used.has(name)) name = a.name.replace(/\.[^.]+$/, '') + '_optimized_' + (n++) + '.' + ext;
        used.add(name);
        entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    } finally {
      applySnapshot(saved); // put the live context of the active page back
    }
    const zip = await createZip(entries);
    saveBlob(zip, 'TinyPS_batch.zip');
    toastMsg('toast.batchStarted');
  } catch (err) {
    console.error(err);
    toastMsg(t('toast.error') + (err && err.message ? err.message : ''));
  }
  setBusy(false);
  downloadAllBtn.disabled = state.images.length < 2;
});

// ===== image info =====
infoBtn.addEventListener('click', () => {
  const a = getActive();
  if (!a) return toastMsg('toast.noImage');
  $('iiName').textContent = a.name;
  $('iiFormat').textContent = a.type || '—';
  $('iiDims').textContent = a.origW + ' × ' + a.origH;
  $('iiSize').textContent = fmtSize(a.size);
  $('iiOutSize').textContent = a.processedBlob ? fmtSize(a.processedBlob.size) : '—';
  const s = a.size - (a.processedBlob ? a.processedBlob.size : 0);
  $('iiComp').textContent = a.processedBlob
    ? (s >= 0 ? '-' : '+') + Math.abs((s / a.size) * 100).toFixed(1) + '%' : '—';
  openModal('imgInfoModal');
});


// ===== modals =====
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
document.querySelectorAll('[data-close]').forEach(btn =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); });
});

// ===== keyboard =====
document.addEventListener('keydown', e => {
  // free-crop session owns Enter/Esc
  if (cropSession) {
    if (e.key === 'Enter') { e.preventDefault(); commitCropSession(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cancelCropSession(); return; }
  }
  if (e.key === 'Escape') {
    hideCtxMenu();
    document.querySelectorAll('.modal-overlay.show').forEach(el => el.classList.remove('show'));
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    e.shiftKey ? doRedo() : doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
    e.preventDefault();
    doRedo();
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
    const a = getActive();
    if (a && !a.empty && a.processedBlob) { e.preventDefault(); doCopyImage(); }
    return; // otherwise keep native text copy
  }
  if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!downloadBtn.disabled) downloadBtn.click(); }
  if (e.code === 'KeyR' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doReset(); }
  if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); infoBtn.click(); }
  if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); themeBtn.click(); }
  if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    const idx = (LANGS.indexOf(currentLang) + 1) % LANGS.length;
    langSelect.value = LANGS[idx];
    setLang(LANGS[idx]);
  }
});

// ===== init =====
(function init() {
  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('tinyps_theme') || 'dark'; } catch (e) { /* ignore */ }
  applyTheme(savedTheme);

  let savedLang = 'en';
  try { savedLang = localStorage.getItem('tinyps_lang') || 'en'; } catch (e) { /* ignore */ }
  if (!LOCALE[savedLang]) savedLang = 'en';
  langSelect.value = savedLang;
  setLang(savedLang, true);
  // viewInfo shows dynamic file info — stop the i18n pass from overwriting it
  $('viewInfo').removeAttribute('data-i18n');

  resetUI();

  const src = new URLSearchParams(location.search).get('src');
  if (src) intakeFromURL(src);
})();
