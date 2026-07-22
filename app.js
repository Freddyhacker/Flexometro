/*
  app.js
  ------
  Todo corre en el navegador: sin red, sin servidor, sin servicios externos.
*/

const UNIT_FACTORS = { mm: 10, cm: 1, m: 0.01, in: 0.393700787 };
const UNIT_CYCLE = ['mm', 'cm', 'm', 'in'];
const SHAPE_LABELS = {
  circulo: 'Círculo', cuadrado: 'Cuadrado', rectangulo: 'Rectángulo',
  triangulo: 'Triángulo', poligono: 'Polígono',
};

// ------------------------------------------------------------------
// Medidas reales a partir de una figura detectada (en píxeles) + escala
// ------------------------------------------------------------------
function computeMeasurements(shape, pxPerCm) {
  const areaCm2 = shape.areaPx / (pxPerCm * pxPerCm);
  const perimetroCm = shape.perimeterPx / pxPerCm;
  const m = { shapeType: shape.shapeType, area_cm2: areaCm2, perimetro_cm: perimetroCm };

  if (shape.shapeType === 'circulo') {
    const diametroPx = (shape.rectW + shape.rectH) / 2;
    const radioCm = (diametroPx / 2) / pxPerCm;
    m.radio_cm = radioCm;
    m.diametro_cm = radioCm * 2;
    m.circunferencia_cm = 2 * Math.PI * radioCm;
  } else if (shape.shapeType === 'cuadrado' || shape.shapeType === 'rectangulo') {
    const wCm = shape.rectW / pxPerCm;
    const hCm = shape.rectH / pxPerCm;
    m.largo_cm = wCm;
    m.ancho_cm = hCm;
    m.diagonal_cm = Math.sqrt(wCm * wCm + hCm * hCm);
  } else {
    m.ancho_aprox_cm = shape.rectW / pxPerCm;
    m.alto_aprox_cm = shape.rectH / pxPerCm;
  }
  return m;
}

function convertMeasurements(m, unit) {
  const f = UNIT_FACTORS[unit];
  const out = { shapeType: m.shapeType };
  for (const [k, v] of Object.entries(m)) {
    if (k === 'shapeType') continue;
    out[k] = k === 'area_cm2' ? v * f * f : v * f;
  }
  return out;
}

const METRIC_LABELS = {
  area_cm2: 'Área', perimetro_cm: 'Perímetro', radio_cm: 'Radio',
  diametro_cm: 'Diámetro', circunferencia_cm: 'Circunferencia',
  largo_cm: 'Largo', ancho_cm: 'Ancho', diagonal_cm: 'Diagonal',
  ancho_aprox_cm: 'Ancho aprox.', alto_aprox_cm: 'Alto aprox.',
};

function mainLabel(m, unit) {
  const f = UNIT_FACTORS[unit];
  if (m.shapeType === 'circulo') return `${SHAPE_LABELS.circulo} D:${(m.diametro_cm * f).toFixed(1)}${unit}`;
  if (m.shapeType === 'cuadrado' || m.shapeType === 'rectangulo')
    return `${SHAPE_LABELS[m.shapeType]} ${(m.largo_cm * f).toFixed(1)}x${(m.ancho_cm * f).toFixed(1)}${unit}`;
  return `${SHAPE_LABELS[m.shapeType] || m.shapeType} P:${(m.perimetro_cm * f).toFixed(1)}${unit}`;
}

function drawShapeOutline(ctx, s) {
  const useRect = (s.shapeType === 'cuadrado' || s.shapeType === 'rectangulo');
  const pts = useRect ? s.corners : s.hull;
  if (!pts || pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
}

function remapShape(s, scale, offsetX, offsetY) {
  const tx = (x) => x * scale + offsetX;
  const ty = (y) => y * scale + offsetY;
  return {
    ...s,
    minX: tx(s.minX), maxX: tx(s.maxX), minY: ty(s.minY), maxY: ty(s.maxY),
    cx: tx(s.cx), cy: ty(s.cy),
    corners: s.corners.map(p => ({ x: tx(p.x), y: ty(p.y) })),
    hull: s.hull.map(p => ({ x: tx(p.x), y: ty(p.y) })),
  };
}

function drawShapeAndLabel(ctx, s, pxPerCm, unit) {
  drawShapeOutline(ctx, s);
  const label = mainLabel(computeMeasurements(s, pxPerCm), unit);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = '#2f6f5e';
  ctx.fillRect(s.minX, Math.max(0, s.minY - 22), tw + 10, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, s.minX + 5, Math.max(16, s.minY - 6));
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ------------------------------------------------------------------
// Herramienta de interacción (calibrar 2 puntos / seleccionar área) —
// UNA sola instancia reutilizada para el canvas #overlay, tanto en modo
// foto como en modo video (baseDrawFn/callbacks se reconfiguran).
// ------------------------------------------------------------------
function makeInteractiveCanvas(canvas) {
  let baseDrawFn = () => {};
  let callbacks = {};
  let mode = 'none'; // 'calibrate' | 'roi' | 'none'
  let calPoints = [];
  let roi = null;
  let dragging = false, dragStart = null, dragCurrent = null;

  function toCanvasCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
  }
  function currentDragRect() {
    const x = Math.min(dragStart.x, dragCurrent.x), y = Math.min(dragStart.y, dragCurrent.y);
    return { x, y, w: Math.abs(dragCurrent.x - dragStart.x), h: Math.abs(dragCurrent.y - dragStart.y) };
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    baseDrawFn(ctx);

    if (calPoints.length) {
      ctx.fillStyle = '#e8622c'; ctx.strokeStyle = '#e8622c'; ctx.lineWidth = 2;
      calPoints.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); });
      if (calPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(calPoints[0].x, calPoints[0].y);
        ctx.lineTo(calPoints[1].x, calPoints[1].y);
        ctx.stroke();
      }
    }
    const rectToShow = dragging ? currentDragRect() : roi;
    if (rectToShow) {
      ctx.setLineDash([7, 5]); ctx.strokeStyle = '#e8622c'; ctx.lineWidth = 2.5;
      ctx.strokeRect(rectToShow.x, rectToShow.y, rectToShow.w, rectToShow.h);
      ctx.setLineDash([]);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'roi') return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true; dragStart = toCanvasCoords(e); dragCurrent = dragStart;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'roi' || !dragging) return;
    dragCurrent = toCanvasCoords(e);
    redraw();
  });
  canvas.addEventListener('pointerup', () => {
    if (mode !== 'roi' || !dragging) return;
    dragging = false;
    const r = currentDragRect();
    if (r.w > 12 && r.h > 12) { roi = r; callbacks.onRoiSet && callbacks.onRoiSet(roi); }
    redraw();
  });
  canvas.addEventListener('click', (e) => {
    if (mode !== 'calibrate') return;
    const p = toCanvasCoords(e);
    if (calPoints.length >= 2) calPoints = [];
    calPoints.push(p);
    redraw();
    if (calPoints.length === 2) {
      const distPx = Math.hypot(calPoints[1].x - calPoints[0].x, calPoints[1].y - calPoints[0].y);
      const calValue = parseFloat(calValueInput.value) || 1;
      const calUnit = calUnitInput.value;
      const pxPerCm = (distPx / calValue) * UNIT_FACTORS[calUnit];
      callbacks.onCalibrated && callbacks.onCalibrated(pxPerCm);
    }
  });

  return {
    setMode(m) { mode = m; },
    setBaseDrawFn(fn) { baseDrawFn = fn; },
    setCallbacks(cb) { callbacks = cb; },
    redraw,
    getRoi() { return roi; },
    clearRoi() { roi = null; callbacks.onRoiSet && callbacks.onRoiSet(null); redraw(); },
    clearCal() { calPoints = []; redraw(); },
  };
}

// ------------------------------------------------------------------
// Referencias DOM
// ------------------------------------------------------------------
const stage = document.getElementById('stage');
const video = document.getElementById('video');
const photoCanvas = document.getElementById('photoCanvas');
const overlay = document.getElementById('overlay');
const emptyHint = document.getElementById('emptyHint');

const btnSettings = document.getElementById('btnSettings');
const calBadge = document.getElementById('calBadge');
const btnCycleUnit = document.getElementById('btnCycleUnit');

const toolsBar = document.getElementById('toolsBar');
const toolHint = document.getElementById('toolHint');
const toolButtons = { none: document.getElementById('toolNone'), calibrate: document.getElementById('toolCalibrate'), roi: document.getElementById('toolRoi') };
const btnClearRoi = document.getElementById('btnClearRoi');

const modeButtons = document.querySelectorAll('.mode-btn');
const fileInput = document.getElementById('fileInput');
const btnPickPhoto = document.getElementById('btnPickPhoto');
const btnStartCam = document.getElementById('btnStartCam');
const btnDetectPhoto = document.getElementById('btnDetectPhoto');

const btnResultsToggle = document.getElementById('btnResultsToggle');
const resultsCount = document.getElementById('resultsCount');
const resultsSheet = document.getElementById('resultsSheet');
const sheetHandle = document.getElementById('sheetHandle');
const resultsSummary = document.getElementById('resultsSummary');
const resultsList = document.getElementById('resultsList');

const settingsBackdrop = document.getElementById('settingsBackdrop');
const settingsPanel = document.getElementById('settingsPanel');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const calValueInput = document.getElementById('calValue');
const calUnitInput = document.getElementById('calUnit');
const outUnitInput = document.getElementById('outUnit');
const targetShapeInput = document.getElementById('targetShape');
const cameraSelect = document.getElementById('cameraSelect');
const manualCalToggle = document.getElementById('manualCalToggle');
const stabToggle = document.getElementById('stabToggle');

const tool = makeInteractiveCanvas(overlay);

function cmPerSquare() {
  return (parseFloat(calValueInput.value) || 1) / UNIT_FACTORS[calUnitInput.value];
}

// ------------------------------------------------------------------
// Resultados (panel deslizable)
// ------------------------------------------------------------------
function renderResults(shapes, pxPerCm, unit) {
  resultsCount.textContent = shapes.length;
  if (!shapes.length || !pxPerCm) {
    resultsSummary.textContent = 'Sin figuras detectadas';
    resultsList.innerHTML = '';
    return;
  }
  resultsSummary.textContent = `${shapes.length} figura(s) detectada(s) — toca para ver detalle`;
  const unitArea = `${unit}²`;
  resultsList.innerHTML = shapes.map((s, i) => {
    const m = computeMeasurements(s, pxPerCm);
    const conv = convertMeasurements(m, unit);
    const metrics = Object.entries(conv).filter(([k]) => k !== 'shapeType').map(([k, v]) => {
      const label = METRIC_LABELS[k] || k;
      const u = k === 'area_cm2' ? unitArea : unit;
      return `<div class="result-metric"><div class="k">${label} (${u})</div><div class="v">${v.toFixed(2)}</div></div>`;
    }).join('');
    return `<div class="result-item">
      <div class="result-head"><span class="idx">#${i + 1}</span> ${SHAPE_LABELS[s.shapeType] || s.shapeType}</div>
      <div class="result-body">${metrics}</div>
    </div>`;
  }).join('');
}

function toggleSheet(forceOpen) {
  const collapsed = resultsSheet.classList.contains('collapsed');
  if (forceOpen === true || (forceOpen === undefined && collapsed)) resultsSheet.classList.remove('collapsed');
  else resultsSheet.classList.add('collapsed');
}
sheetHandle.addEventListener('click', () => toggleSheet());
resultsSummary.addEventListener('click', () => toggleSheet());
btnResultsToggle.addEventListener('click', () => toggleSheet());

// ------------------------------------------------------------------
// Ajustes (panel)
// ------------------------------------------------------------------
function openSettings() { settingsBackdrop.hidden = false; settingsPanel.hidden = false; }
function closeSettings() { settingsBackdrop.hidden = true; settingsPanel.hidden = true; }
btnSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);

function syncUnitButton() { btnCycleUnit.textContent = outUnitInput.value; }
btnCycleUnit.addEventListener('click', () => {
  const idx = UNIT_CYCLE.indexOf(outUnitInput.value);
  outUnitInput.value = UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length];
  syncUnitButton();
});
outUnitInput.addEventListener('change', syncUnitButton);
syncUnitButton();

function setCalBadge(text, ok) {
  calBadge.textContent = text;
  calBadge.classList.toggle('ok', !!ok);
}

// ------------------------------------------------------------------
// Herramientas (calibrar / área)
// ------------------------------------------------------------------
function setActiveTool(name) {
  tool.setMode(name);
  Object.entries(toolButtons).forEach(([k, btn]) => btn.classList.toggle('active', k === name));
  const hints = {
    none: '',
    calibrate: 'Toca 2 puntos de distancia real conocida sobre la imagen.',
    roi: 'Arrastra un rectángulo sobre la zona que quieres analizar.',
  };
  toolHint.textContent = hints[name] || '';
  toolHint.hidden = !hints[name];
}
toolButtons.none.addEventListener('click', () => setActiveTool('none'));
toolButtons.calibrate.addEventListener('click', () => setActiveTool('calibrate'));
toolButtons.roi.addEventListener('click', () => setActiveTool('roi'));
btnClearRoi.addEventListener('click', () => tool.clearRoi());

// ==================================================================
// MODO FOTO
// ==================================================================
const MAX_PHOTO_WIDTH = 1400;
let photoImage = null;
let photoPxPerCm = null;

function drawPhotoBase(ctx) {
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  if (photoImage) ctx.drawImage(photoImage, 0, 0, photoCanvas.width, photoCanvas.height);
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    photoImage = img;
    const scale = img.width > MAX_PHOTO_WIDTH ? MAX_PHOTO_WIDTH / img.width : 1;
    photoCanvas.width = Math.round(img.width * scale);
    photoCanvas.height = Math.round(img.height * scale);
    overlay.width = photoCanvas.width;
    overlay.height = photoCanvas.height;

    emptyHint.classList.add('hidden-hint');
    photoCanvas.hidden = false;
    btnDetectPhoto.hidden = false;
    toolsBar.hidden = false;
    photoPxPerCm = null;

    tool.setBaseDrawFn(drawPhotoBase);
    tool.setCallbacks({
      onCalibrated: (pxPerCm) => {
        photoPxPerCm = pxPerCm;
        manualCalToggle.checked = true;
        setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
    });
    setActiveTool('none');
    tool.redraw();

    // Intento de calibración automática por cuadrícula (una sola vez)
    if (!manualCalToggle.checked) {
      const ctx = photoCanvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, photoCanvas.width, photoCanvas.height);
      const grid = ShapeDetector.detectGridPxPerCm(imgData, cmPerSquare());
      if (grid) {
        photoPxPerCm = grid.pxPerCm;
        setCalBadge(`Auto — ${grid.pxPerCm.toFixed(1)} px/cm (${grid.count} cuadros)`, true);
      } else {
        setCalBadge('Sin cuadrícula — usa 📏 Calibrar', false);
      }
    }
  };
  img.src = URL.createObjectURL(file);
});

btnDetectPhoto.addEventListener('click', () => {
  if (!photoImage) return;
  if (!photoPxPerCm) { alert('Primero calibra: pon una cuadrícula en la foto, o usa "📏 Calibrar" para marcar 2 puntos.'); return; }

  const ctx = photoCanvas.getContext('2d');
  const roi = tool.getRoi();
  const region = roi
    ? { x: Math.round(roi.x), y: Math.round(roi.y), w: Math.round(roi.w), h: Math.round(roi.h) }
    : { x: 0, y: 0, w: photoCanvas.width, h: photoCanvas.height };

  const imageData = ctx.getImageData(region.x, region.y, region.w, region.h);
  const minAreaPx = Math.max(150, region.w * region.h * 0.004);
  let shapes = ShapeDetector.detectShapes(imageData, { targetShape: targetShapeInput.value, minAreaPx });
  shapes = shapes.map(s => remapShape(s, 1, region.x, region.y));

  tool.redraw();
  const octx = overlay.getContext('2d');
  octx.lineWidth = 3; octx.strokeStyle = '#2f6f5e'; octx.font = 'bold 16px monospace';
  shapes.forEach(s => drawShapeAndLabel(octx, s, photoPxPerCm, outUnitInput.value));

  if (!shapes.length) alert('No encontré figuras. Prueba con más contraste, mejor luz, o ajusta el área seleccionada.');
  renderResults(shapes, photoPxPerCm, outUnitInput.value);
  toggleSheet(true);
});

// ==================================================================
// MODO VIDEO
// ==================================================================
let videoPxPerCm = null;
let liveInterval = null;
let videoModeActive = false;
let currentStream = null;
let lastStableShapes = [];
const PROC_WIDTH = 280;
const procCanvas = document.createElement('canvas');

// ------------------------------------------------------------------
// Estabilización LIGERA: en vez de redibujar el video pixel por pixel
// en un canvas cada cuadro (costoso, causaba trabas), se aplica un
// pequeño desplazamiento con CSS `transform` directamente al <video> y
// al overlay — eso lo compone la GPU, prácticamente gratis. El video se
// graba con un ligero zoom de más (margen) para poder desplazarlo sin
// que se vean los bordes.
// ------------------------------------------------------------------
const STAB_ZOOM = 1.08;
const STAB_ALPHA = 0.18;
let stabAnchor = null;   // {x,y} en coords de video crudo, suavizado
let stabShiftPx = { x: 0, y: 0 }; // último desplazamiento aplicado (coords de video crudo)

function applyStabTransform() {
  if (!stabToggle.checked) {
    video.style.transform = '';
    overlay.style.transform = '';
    return;
  }
  const rect = video.getBoundingClientRect();
  if (!rect.width || !video.videoWidth) return;
  const cssScale = rect.width / video.videoWidth;
  const dxCss = clamp(stabShiftPx.x * cssScale, -rect.width * (STAB_ZOOM - 1) / 2, rect.width * (STAB_ZOOM - 1) / 2);
  const dyCss = clamp(stabShiftPx.y * cssScale, -rect.height * (STAB_ZOOM - 1) / 2, rect.height * (STAB_ZOOM - 1) / 2);
  const t = `scale(${STAB_ZOOM}) translate(${(dxCss / STAB_ZOOM).toFixed(2)}px, ${(dyCss / STAB_ZOOM).toFixed(2)}px)`;
  video.style.transform = t;
  overlay.style.transform = t;
}

// A partir de un punto de referencia de ESTE cuadro (centroide de la
// cuadrícula si se detectó, si no la figura más grande), actualiza el
// desplazamiento a aplicar. Si no hay referencia este cuadro, se
// mantiene el último desplazamiento (no se "suelta" de golpe).
function updateStabilization(anchorPoint) {
  if (!stabToggle.checked) return;
  if (!anchorPoint) { applyStabTransform(); return; }
  if (!stabAnchor) stabAnchor = { ...anchorPoint };
  stabShiftPx = { x: stabAnchor.x - anchorPoint.x, y: stabAnchor.y - anchorPoint.y };
  stabAnchor.x += (anchorPoint.x - stabAnchor.x) * STAB_ALPHA;
  stabAnchor.y += (anchorPoint.y - stabAnchor.y) * STAB_ALPHA;
  applyStabTransform();
}

function resetStabilization() {
  stabAnchor = null;
  stabShiftPx = { x: 0, y: 0 };
  video.style.transform = '';
  overlay.style.transform = '';
}

stabToggle.addEventListener('change', resetStabilization);

// ------------------------------------------------------------------
// Calibración por referencia de objeto: cuando la cuadrícula SÍ es
// visible, se recuerda el tamaño en píxeles (en ese instante) de la
// figura detectada más grande junto con el px/cm de la cuadrícula. Si
// luego la cuadrícula deja de verse pero esa misma figura sigue en
// cuadro, se recalcula el px/cm comparando cuánto cambió su tamaño en
// píxeles — así se detecta que la cámara se acercó o alejó sin
// necesitar la cuadrícula todo el tiempo.
// ------------------------------------------------------------------
let refObject = null; // { pxPerCmAtCal, sizeAtCalPx }

function primaryShape(shapes) {
  if (!shapes.length) return null;
  return shapes.reduce((a, b) => (b.areaPx > a.areaPx ? b : a));
}

function drawVideoOverlay(shapes) {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!videoPxPerCm) {
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#e8622c';
    ctx.fillText('Buscando calibración…', 14, 30);
    return;
  }
  ctx.lineWidth = 3; ctx.strokeStyle = '#2f6f5e'; ctx.font = 'bold 16px monospace';
  shapes.forEach(s => drawShapeAndLabel(ctx, s, videoPxPerCm, outUnitInput.value));
}

async function refreshCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    cameraSelect.innerHTML = cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Cámara ' + (i + 1)}</option>`).join('');
  } catch (e) { /* enumerar puede fallar sin permiso previo */ }
}
navigator.mediaDevices?.enumerateDevices && refreshCameraList();

async function startCamera() {
  const selectedId = cameraSelect.value;
  const constraints = selectedId
    ? { video: { deviceId: { exact: selectedId } }, audio: false }
    : { video: { facingMode: { ideal: 'environment' } }, audio: false };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  currentStream = stream;
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  await refreshCameraList();
}

btnStartCam.addEventListener('click', async () => {
  try {
    await startCamera();
    emptyHint.classList.add('hidden-hint');
    video.hidden = false;
    btnStartCam.hidden = true;
    toolsBar.hidden = false;
    videoPxPerCm = null;
    tracks = [];

    tool.setBaseDrawFn(() => drawVideoOverlay(lastStableShapes));
    tool.setCallbacks({
      onCalibrated: (pxPerCm) => {
        videoPxPerCm = pxPerCm;
        manualCalToggle.checked = true;
        setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
    });
    setActiveTool('none');

    videoModeActive = true;
    startLiveLoop();
  } catch (err) {
    alert('No pude activar la cámara: ' + err.message);
  }
});

cameraSelect.addEventListener('change', async () => {
  if (!currentStream) return;
  currentStream.getTracks().forEach(t => t.stop());
  await startCamera();
  videoPxPerCm = null;
  setCalBadge('Cámara cambiada — recalibrando…', false);
});

function captureProc(x, y, w, h, targetWidth) {
  const scale = Math.min(targetWidth / w, 1);
  const pw = Math.max(20, Math.round(w * scale));
  const ph = Math.max(20, Math.round(h * scale));
  procCanvas.width = pw; procCanvas.height = ph;
  const pctx = procCanvas.getContext('2d');
  pctx.drawImage(video, x, y, w, h, 0, 0, pw, ph);
  return { imageData: pctx.getImageData(0, 0, pw, ph), scale, pw, ph };
}

// --------------------------------------------------------------
// Estabilización de MEDIDAS (no de la imagen): seguimiento simple de
// figuras entre cuadros con suavizado exponencial (EMA).
// --------------------------------------------------------------
let tracks = [];
const SMOOTH_ALPHA = 0.35;
const MAX_MISSED_FRAMES = 3;

function updateTracks(rawShapes) {
  const used = new Set();
  tracks.forEach(t => { t.matched = false; });

  rawShapes.forEach(raw => {
    let best = null, bestDist = Infinity;
    tracks.forEach((t, idx) => {
      if (used.has(idx)) return;
      const d = Math.hypot(raw.cx - t.cx, raw.cy - t.cy);
      const threshold = Math.max(t.maxX - t.minX, t.maxY - t.minY) * 0.8 + 30;
      if (d < threshold && d < bestDist) { best = idx; bestDist = d; }
    });

    if (best !== null) {
      const t = tracks[best], a = SMOOTH_ALPHA;
      t.minX = t.minX * (1 - a) + raw.minX * a;
      t.maxX = t.maxX * (1 - a) + raw.maxX * a;
      t.minY = t.minY * (1 - a) + raw.minY * a;
      t.maxY = t.maxY * (1 - a) + raw.maxY * a;
      t.areaPx = t.areaPx * (1 - a) + raw.areaPx * a;
      t.perimeterPx = t.perimeterPx * (1 - a) + raw.perimeterPx * a;
      t.rectW = t.rectW * (1 - a) + raw.rectW * a;
      t.rectH = t.rectH * (1 - a) + raw.rectH * a;
      t.rectAngle = t.rectAngle * (1 - a) + raw.rectAngle * a;
      t.corners = raw.corners; t.hull = raw.hull;
      t.cx = (t.minX + t.maxX) / 2; t.cy = (t.minY + t.maxY) / 2;
      t.missed = 0; t.matched = true;
      if (raw.shapeType !== t.shapeType) {
        if (t.pendingType === raw.shapeType) { t.shapeType = raw.shapeType; t.pendingType = null; }
        else { t.pendingType = raw.shapeType; }
      } else { t.pendingType = null; }
      used.add(best);
    } else {
      tracks.push({ ...raw, missed: 0, matched: true });
    }
  });

  tracks = tracks.filter(t => { if (!t.matched) t.missed++; return t.missed <= MAX_MISSED_FRAMES; });
  return tracks;
}

function startLiveLoop() {
  if (liveInterval) clearInterval(liveInterval);
  tracks = [];
  lastStableShapes = [];
  refObject = null;
  liveInterval = setInterval(() => {
    if (!videoModeActive || video.readyState < 2) return;

    // 1) Detección de figuras SIEMPRE (todo el cuadro, o el área
    //    seleccionada) — no depende de tener calibración todavía, así
    //    ya tenemos la figura de referencia lista para los pasos 2 y 3.
    const roi = tool.getRoi();
    const region = roi
      ? { x: clamp(roi.x, 0, video.videoWidth - 10), y: clamp(roi.y, 0, video.videoHeight - 10), w: Math.max(10, roi.w), h: Math.max(10, roi.h) }
      : { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
    region.w = Math.min(region.w, video.videoWidth - region.x);
    region.h = Math.min(region.h, video.videoHeight - region.y);

    const s = captureProc(region.x, region.y, region.w, region.h, PROC_WIDTH);
    const minAreaPx = Math.max(60, s.pw * s.ph * 0.004);
    let rawShapes = ShapeDetector.detectShapes(s.imageData, { targetShape: targetShapeInput.value, minAreaPx });
    rawShapes = rawShapes.map(sh => remapShape(sh, 1 / s.scale, region.x, region.y));
    lastStableShapes = updateTracks(rawShapes);

    // 2) Calibración: cuadrícula automática > referencia de objeto >
    //    última calibración conocida.
    if (!manualCalToggle.checked) {
      const g = captureProc(0, 0, video.videoWidth, video.videoHeight, 300);
      const grid = ShapeDetector.detectGridPxPerCm(g.imageData, cmPerSquare());
      const primary = primaryShape(lastStableShapes);

      if (grid) {
        videoPxPerCm = grid.pxPerCm;
        setCalBadge(`Auto — ${grid.pxPerCm.toFixed(1)} px/cm (${grid.count} cuadros)`, true);
        if (primary) refObject = { pxPerCmAtCal: grid.pxPerCm, sizeAtCalPx: (primary.rectW + primary.rectH) / 2 };
      } else if (refObject && primary) {
        const currentSize = (primary.rectW + primary.rectH) / 2;
        if (currentSize > 0 && refObject.sizeAtCalPx > 0) {
          videoPxPerCm = refObject.pxPerCmAtCal * (currentSize / refObject.sizeAtCalPx);
          setCalBadge(`Auto (sin ver la cuadrícula) — ${videoPxPerCm.toFixed(1)} px/cm`, true);
        }
      } else if (!videoPxPerCm) {
        setCalBadge('Buscando cuadrícula…', false);
      }
      // si no hay cuadrícula ni referencia pero ya había px/cm previo, se conserva tal cual
    }

    // 3) Estabilización ligera: usamos la figura principal como ancla.
    const anchorShape = primaryShape(lastStableShapes);
    updateStabilization(anchorShape ? { x: anchorShape.cx, y: anchorShape.cy } : null);

    if (!videoPxPerCm) {
      tool.redraw();
      renderResults([], null, outUnitInput.value);
      return;
    }

    tool.redraw();
    renderResults(lastStableShapes, videoPxPerCm, outUnitInput.value);
  }, 280);
}

// ==================================================================
// Cambio de modo (foto / video)
// ==================================================================
modeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    modeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const m = btn.dataset.mode;

    if (m === 'foto') {
      videoModeActive = false;
      resetStabilization();
      video.hidden = true;
      photoCanvas.hidden = !photoImage;
      btnPickPhoto.hidden = false;
      btnStartCam.hidden = true;
      btnDetectPhoto.hidden = !photoImage;
      toolsBar.hidden = !photoImage;
      emptyHint.classList.toggle('hidden-hint', !!photoImage);
      if (photoImage) {
        overlay.width = photoCanvas.width; overlay.height = photoCanvas.height;
        tool.setBaseDrawFn(drawPhotoBase);
        tool.setCallbacks({
          onCalibrated: (pxPerCm) => { photoPxPerCm = pxPerCm; manualCalToggle.checked = true; setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true); },
          onRoiSet: () => {},
        });
        setCalBadge(photoPxPerCm ? `${photoPxPerCm.toFixed(1)} px/cm` : 'Sin calibrar', !!photoPxPerCm);
        tool.redraw();
      }
    } else {
      photoCanvas.hidden = true;
      btnPickPhoto.hidden = true;
      btnDetectPhoto.hidden = true;
      const camActive = !!currentStream;
      video.hidden = !camActive;
      btnStartCam.hidden = camActive;
      toolsBar.hidden = !camActive;
      emptyHint.classList.toggle('hidden-hint', camActive);
      if (camActive) {
        overlay.width = video.videoWidth; overlay.height = video.videoHeight;
        tool.setBaseDrawFn(() => drawVideoOverlay(lastStableShapes));
        tool.setCallbacks({
          onCalibrated: (pxPerCm) => { videoPxPerCm = pxPerCm; manualCalToggle.checked = true; setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true); },
          onRoiSet: () => {},
        });
        setCalBadge(videoPxPerCm ? `${videoPxPerCm.toFixed(1)} px/cm` : 'Buscando calibración…', !!videoPxPerCm);
        videoModeActive = true;
        tool.redraw();
      }
    }
  });
});
