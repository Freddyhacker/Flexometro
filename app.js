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

// Objetos con medida real conocida, usados como referencia de calibración
// alternativa a la cuadrícula (no todos tienen una cuadrícula a mano).
const REFERENCE_OBJECTS = {
  tarjeta: { kind: 'rect', wMm: 85.6, hMm: 54 },
  a4: { kind: 'rect', wMm: 210, hMm: 297 },
  carta: { kind: 'rect', wMm: 215.9, hMm: 279.4 },
  moneda1: { kind: 'circle', diameterMm: 24 },
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

function mainLabel(m, unit) {
  const f = UNIT_FACTORS[unit];
  if (m.shapeType === 'circulo') return `${SHAPE_LABELS.circulo} D:${(m.diametro_cm * f).toFixed(1)}${unit}`;
  if (m.shapeType === 'cuadrado' || m.shapeType === 'rectangulo')
    return `${SHAPE_LABELS[m.shapeType]} ${(m.largo_cm * f).toFixed(1)}x${(m.ancho_cm * f).toFixed(1)}${unit}`;
  return `${SHAPE_LABELS[m.shapeType] || m.shapeType} P:${(m.perimetro_cm * f).toFixed(1)}${unit}`;
}

function drawShapeOutline(ctx, s, highlight) {
  const useRect = (s.shapeType === 'cuadrado' || s.shapeType === 'rectangulo');
  const pts = useRect ? s.corners : s.hull;
  if (!pts || pts.length < 3) return;
  ctx.lineWidth = highlight ? 4 : 3;
  ctx.strokeStyle = highlight ? '#e8622c' : '#2f6f5e';
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

function drawShapeAndLabel(ctx, s, pxPerCm, unit, highlight) {
  drawShapeOutline(ctx, s, highlight);
  const label = mainLabel(computeMeasurements(s, pxPerCm), unit);
  ctx.font = 'bold 16px monospace';
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = highlight ? '#e8622c' : '#2f6f5e';
  ctx.fillRect(s.minX, Math.max(0, s.minY - 22), tw + 10, 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, s.minX + 5, Math.max(16, s.minY - 6));
}

function hitTestShapes(shapes, x, y) {
  let best = null, bestArea = Infinity;
  shapes.forEach(s => {
    if (x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY && s.areaPx < bestArea) {
      bestArea = s.areaPx; best = s;
    }
  });
  return best;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ------------------------------------------------------------------
// Calibración por objeto de referencia: busca, entre las figuras YA
// detectadas, la que mejor coincide con el tipo/proporciones del objeto
// elegido (tarjeta, hoja, moneda...) y calibra a partir de su tamaño
// real conocido. No necesita una cuadrícula impresa.
// ------------------------------------------------------------------
function detectReferenceCalibration(shapes, refKey) {
  const ref = REFERENCE_OBJECTS[refKey];
  if (!ref || !shapes.length) return null;

  if (ref.kind === 'circle') {
    const circles = shapes.filter(s => s.shapeType === 'circulo');
    if (!circles.length) return null;
    const c = circles.reduce((a, b) => (b.areaPx > a.areaPx ? b : a));
    const diameterPx = (c.rectW + c.rectH) / 2;
    return { pxPerCm: diameterPx / (ref.diameterMm / 10), matched: c };
  }

  const rects = shapes.filter(s => s.shapeType === 'rectangulo' || s.shapeType === 'cuadrado');
  if (!rects.length) return null;
  const targetAspect = Math.max(ref.wMm, ref.hMm) / Math.min(ref.wMm, ref.hMm);
  let best = null, bestDiff = Infinity;
  rects.forEach(r => {
    const aspect = Math.max(r.rectW, r.rectH) / Math.max(1, Math.min(r.rectW, r.rectH));
    const diff = Math.abs(aspect - targetAspect) / targetAspect;
    if (diff < bestDiff) { bestDiff = diff; best = r; }
  });
  if (!best || bestDiff > 0.25) return null; // tolerancia de proporción (~25%)
  const realLongMm = Math.max(ref.wMm, ref.hMm);
  return { pxPerCm: best.rectW / (realLongMm / 10), matched: best };
}

// ------------------------------------------------------------------
// Herramienta de interacción (calibrar 2 puntos / seleccionar área /
// tocar para enfocar una figura) — UNA sola instancia reutilizada para
// el canvas #overlay, tanto en modo foto como en modo video.
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
    const p = toCanvasCoords(e);
    if (mode === 'calibrate') {
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
      return;
    }
    if (mode === 'none') {
      callbacks.onFocusTap && callbacks.onFocusTap(p);
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
const btnCameraFab = document.getElementById('btnCameraFab');
const fileInput = document.getElementById('fileInput');
const btnPickPhoto = document.getElementById('btnPickPhoto');
const btnStartCam = document.getElementById('btnStartCam');
const btnDetectPhoto = document.getElementById('btnDetectPhoto');

const btnResultsToggle = document.getElementById('btnResultsToggle');
const resultsCount = document.getElementById('resultsCount');
const focusChip = document.getElementById('focusChip');
const btnClearFocus = document.getElementById('btnClearFocus');

const settingsBackdrop = document.getElementById('settingsBackdrop');
const settingsPanel = document.getElementById('settingsPanel');
const btnCloseSettings = document.getElementById('btnCloseSettings');
const calSourceInput = document.getElementById('calSource');
const gridSection = document.getElementById('gridSection');
const refObjectSection = document.getElementById('refObjectSection');
const refObjectTypeInput = document.getElementById('refObjectType');
const calValueInput = document.getElementById('calValue');
const calUnitInput = document.getElementById('calUnit');
const outUnitInput = document.getElementById('outUnit');
const targetShapeInput = document.getElementById('targetShape');
const maxShapesInput = document.getElementById('maxShapesSelect');
const cameraSelect = document.getElementById('cameraSelect');
const stabToggle = document.getElementById('stabToggle');

const tool = makeInteractiveCanvas(overlay);

function cmPerSquare() {
  return (parseFloat(calValueInput.value) || 1) / UNIT_FACTORS[calUnitInput.value];
}
function maxShapes() { return parseInt(maxShapesInput.value, 10) || 3; }

// ------------------------------------------------------------------
// Contador de resultados + chip de "enfocado"
// ------------------------------------------------------------------
function updateResultsCount(n) { resultsCount.textContent = n; }

let focusedTrackId = null;
let focusedPhotoIndex = null;

function updateFocusChipUI() {
  focusChip.hidden = (focusedTrackId == null && focusedPhotoIndex == null);
}
function clearFocus() {
  focusedTrackId = null;
  focusedPhotoIndex = null;
  updateFocusChipUI();
  tool.redraw();
}
btnClearFocus.addEventListener('click', clearFocus);
btnResultsToggle.addEventListener('click', clearFocus);

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

function syncCalSourceUI() {
  const v = calSourceInput.value;
  gridSection.hidden = v !== 'grid';
  refObjectSection.hidden = v !== 'refobject';
}
calSourceInput.addEventListener('change', () => {
  syncCalSourceUI();
  videoPxPerCm = null;
  photoPxPerCm = null;
  setCalBadge('Cambiaste la fuente de calibración — recalibrando…', false);
});
syncCalSourceUI();

function setCalBadge(text, ok) {
  calBadge.textContent = text;
  calBadge.classList.toggle('ok', !!ok);
}

// ------------------------------------------------------------------
// Herramientas (calibrar / área / ver-enfocar)
// ------------------------------------------------------------------
function setActiveTool(name) {
  tool.setMode(name);
  Object.entries(toolButtons).forEach(([k, btn]) => btn.classList.toggle('active', k === name));
  const hints = {
    none: 'Toca una figura para enfocarla.',
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
let lastPhotoShapes = [];

function drawPhotoBase(ctx) {
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  if (photoImage) ctx.drawImage(photoImage, 0, 0, photoCanvas.width, photoCanvas.height);
}

function renderPhotoShapes() {
  tool.redraw();
  if (!photoPxPerCm || !lastPhotoShapes.length) return;
  const octx = overlay.getContext('2d');
  const shown = focusedPhotoIndex != null && lastPhotoShapes[focusedPhotoIndex]
    ? [lastPhotoShapes[focusedPhotoIndex]]
    : lastPhotoShapes;
  shown.forEach(s => drawShapeAndLabel(octx, s, photoPxPerCm, outUnitInput.value, shown.length === 1 && lastPhotoShapes.length > 1));
  updateResultsCount(lastPhotoShapes.length);
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
    lastPhotoShapes = [];
    focusedPhotoIndex = null;
    updateFocusChipUI();

    tool.setBaseDrawFn(drawPhotoBase);
    tool.setCallbacks({
      onCalibrated: (pxPerCm) => {
        photoPxPerCm = pxPerCm;
        calSourceInput.value = 'manual';
        setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
      onFocusTap: (p) => {
        const hit = hitTestShapes(lastPhotoShapes, p.x, p.y);
        focusedPhotoIndex = hit ? lastPhotoShapes.indexOf(hit) : null;
        updateFocusChipUI();
        renderPhotoShapes();
      },
    });
    setActiveTool('none');
    tool.redraw();

    // Calibración automática (cuadrícula u objeto de referencia) al cargar la foto
    const ctx = photoCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, photoCanvas.width, photoCanvas.height);
    if (calSourceInput.value === 'grid') {
      const grid = ShapeDetector.detectGridPxPerCm(imgData, cmPerSquare());
      if (grid) {
        photoPxPerCm = grid.pxPerCm;
        setCalBadge(`Auto (cuadrícula) — ${grid.pxPerCm.toFixed(1)} px/cm`, true);
      } else {
        setCalBadge('Sin cuadrícula — usa 📏 Calibrar', false);
      }
    } else if (calSourceInput.value === 'refobject') {
      const minAreaPx = Math.max(150, photoCanvas.width * photoCanvas.height * 0.004);
      const probe = ShapeDetector.detectShapes(imgData, { targetShape: 'auto', minAreaPx, maxShapes: 25 });
      const ref = detectReferenceCalibration(probe, refObjectTypeInput.value);
      if (ref) {
        photoPxPerCm = ref.pxPerCm;
        setCalBadge(`Auto (objeto ref.) — ${ref.pxPerCm.toFixed(1)} px/cm`, true);
      } else {
        setCalBadge('No vi el objeto de referencia — usa 📏 Calibrar', false);
      }
    } else {
      setCalBadge('Sin calibrar — usa 📏 Calibrar', false);
    }
  };
  img.src = URL.createObjectURL(file);
});

btnDetectPhoto.addEventListener('click', () => {
  if (!photoImage) return;
  if (!photoPxPerCm) { alert('Primero calibra: pon una cuadrícula/objeto de referencia en la foto, o usa "📏 Calibrar" para marcar 2 puntos.'); return; }

  const ctx = photoCanvas.getContext('2d');
  const roi = tool.getRoi();
  const region = roi
    ? { x: Math.round(roi.x), y: Math.round(roi.y), w: Math.round(roi.w), h: Math.round(roi.h) }
    : { x: 0, y: 0, w: photoCanvas.width, h: photoCanvas.height };

  const imageData = ctx.getImageData(region.x, region.y, region.w, region.h);
  const minAreaPx = Math.max(150, region.w * region.h * 0.004);
  let shapes = ShapeDetector.detectShapes(imageData, { targetShape: targetShapeInput.value, minAreaPx, maxShapes: maxShapes() });
  shapes = shapes.map(s => remapShape(s, 1, region.x, region.y));

  lastPhotoShapes = shapes;
  focusedPhotoIndex = null;
  updateFocusChipUI();

  if (!shapes.length) alert('No encontré figuras. Prueba con más contraste, mejor luz, o ajusta el área seleccionada.');
  renderPhotoShapes();
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
// Estabilización: combina (1) un ancla visual (la figura detectada,
// suavizada entre cuadros) y (2) el giroscopio del celular si está
// disponible, para reaccionar más rápido que solo con visión. Se aplica
// con CSS `transform` directamente al <video> — lo procesa la GPU, no
// se toca ni un píxel del video.
// ------------------------------------------------------------------
const STAB_ZOOM = 1.20; // más recorte = más margen para compensar temblor
const STAB_ALPHA = 0.18;
let stabAnchor = null;
let stabShiftPx = { x: 0, y: 0 };
let gyroShiftPx = { x: 0, y: 0 };
let gyroBaseline = null;
let gyroActive = false;

function onDeviceOrientation(e) {
  if (e.beta == null || e.gamma == null) return;
  if (!gyroBaseline) { gyroBaseline = { beta: e.beta, gamma: e.gamma }; return; }
  const dBeta = e.beta - gyroBaseline.beta;
  const dGamma = e.gamma - gyroBaseline.gamma;
  const assumedFovDeg = 65; // aproximación típica de cámara trasera de celular
  const pxPerDegree = (video.videoWidth || 1280) / assumedFovDeg;
  gyroShiftPx = { x: -dGamma * pxPerDegree, y: dBeta * pxPerDegree };
  applyStabTransform();
}

async function enableGyro() {
  if (gyroActive) return;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission(); // requiere gesto del usuario (iOS)
      if (res !== 'granted') return;
    } else if (typeof DeviceOrientationEvent === 'undefined') {
      return; // no soportado en este navegador/dispositivo
    }
    window.addEventListener('deviceorientation', onDeviceOrientation);
    gyroActive = true;
  } catch (e) { /* sin giroscopio disponible; seguimos solo con estabilización visual */ }
}

function applyStabTransform() {
  if (!stabToggle.checked) { video.style.transform = ''; overlay.style.transform = ''; return; }
  const rect = video.getBoundingClientRect();
  if (!rect.width || !video.videoWidth) return;
  const cssScale = rect.width / video.videoWidth;
  const totalX = stabShiftPx.x + gyroShiftPx.x;
  const totalY = stabShiftPx.y + gyroShiftPx.y;
  const dxCss = clamp(totalX * cssScale, -rect.width * (STAB_ZOOM - 1) / 2, rect.width * (STAB_ZOOM - 1) / 2);
  const dyCss = clamp(totalY * cssScale, -rect.height * (STAB_ZOOM - 1) / 2, rect.height * (STAB_ZOOM - 1) / 2);
  const t = `scale(${STAB_ZOOM}) translate(${(dxCss / STAB_ZOOM).toFixed(2)}px, ${(dyCss / STAB_ZOOM).toFixed(2)}px)`;
  video.style.transform = t;
  overlay.style.transform = t;
}

function updateStabilization(anchorPoint) {
  if (!stabToggle.checked) return;
  if (!anchorPoint) { applyStabTransform(); return; }
  if (!stabAnchor) stabAnchor = { ...anchorPoint };
  stabShiftPx = { x: stabAnchor.x - anchorPoint.x, y: stabAnchor.y - anchorPoint.y };
  stabAnchor.x += (anchorPoint.x - stabAnchor.x) * STAB_ALPHA;
  stabAnchor.y += (anchorPoint.y - stabAnchor.y) * STAB_ALPHA;
  // El giroscopio solo debe compensar el temblor OCURRIDO DESDE esta
  // corrección visual (no acumular desviación indefinidamente).
  gyroBaseline = null;
  gyroShiftPx = { x: 0, y: 0 };
  applyStabTransform();
}

function resetStabilization() {
  stabAnchor = null;
  stabShiftPx = { x: 0, y: 0 };
  gyroShiftPx = { x: 0, y: 0 };
  gyroBaseline = null;
  video.style.transform = '';
  overlay.style.transform = '';
}
stabToggle.addEventListener('change', resetStabilization);

function primaryShape(shapes) {
  if (!shapes.length) return null;
  return shapes.reduce((a, b) => (b.areaPx > a.areaPx ? b : a));
}

function shapesToShow(all) {
  if (focusedTrackId == null) return all;
  const match = all.find(s => s.id === focusedTrackId);
  if (!match) { focusedTrackId = null; updateFocusChipUI(); return all; }
  return [match];
}

function drawVideoOverlay(shapes) {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  updateResultsCount(shapes.length);
  if (!videoPxPerCm) {
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#e8622c';
    ctx.fillText('Buscando calibración…', 14, 30);
    return;
  }
  const shown = shapesToShow(shapes);
  const highlight = shown.length === 1 && shapes.length > 1;
  shown.forEach(s => drawShapeAndLabel(ctx, s, videoPxPerCm, outUnitInput.value, highlight));
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
    focusedTrackId = null;
    updateFocusChipUI();

    tool.setBaseDrawFn(() => drawVideoOverlay(lastStableShapes));
    tool.setCallbacks({
      onCalibrated: (pxPerCm) => {
        videoPxPerCm = pxPerCm;
        calSourceInput.value = 'manual';
        setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
      onFocusTap: (p) => {
        const hit = hitTestShapes(lastStableShapes, p.x, p.y);
        focusedTrackId = hit ? hit.id : null;
        updateFocusChipUI();
        tool.redraw();
      },
    });
    setActiveTool('none');

    videoModeActive = true;
    startLiveLoop();
    enableGyro(); // pedido de permiso (iOS) — se llama tras un gesto del usuario
    btnCameraFab.classList.add('active');
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
// figuras entre cuadros con suavizado exponencial (EMA). Cada figura
// tiene un id persistente (para "tocar y enfocar").
// --------------------------------------------------------------
let tracks = [];
let nextTrackId = 1;
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
      tracks.push({ ...raw, id: nextTrackId++, missed: 0, matched: true });
    }
  });

  tracks = tracks.filter(t => { if (!t.matched) t.missed++; return t.missed <= MAX_MISSED_FRAMES; });
  return tracks;
}

function startLiveLoop() {
  if (liveInterval) clearInterval(liveInterval);
  tracks = [];
  lastStableShapes = [];
  liveInterval = setInterval(() => {
    if (!videoModeActive || video.readyState < 2) return;

    // 1) Detección de figuras SIEMPRE (todo el cuadro, o el área
    //    seleccionada) — no depende de tener calibración todavía.
    const roi = tool.getRoi();
    const region = roi
      ? { x: clamp(roi.x, 0, video.videoWidth - 10), y: clamp(roi.y, 0, video.videoHeight - 10), w: Math.max(10, roi.w), h: Math.max(10, roi.h) }
      : { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
    region.w = Math.min(region.w, video.videoWidth - region.x);
    region.h = Math.min(region.h, video.videoHeight - region.y);

    const s = captureProc(region.x, region.y, region.w, region.h, PROC_WIDTH);
    const minAreaPx = Math.max(60, s.pw * s.ph * 0.004);
    let rawShapes = ShapeDetector.detectShapes(s.imageData, { targetShape: targetShapeInput.value, minAreaPx, maxShapes: maxShapes() });
    rawShapes = rawShapes.map(sh => remapShape(sh, 1 / s.scale, region.x, region.y));
    lastStableShapes = updateTracks(rawShapes);

    // 2) Calibración: cuadrícula automática, objeto de referencia, o
    //    manual (ya establecida por click, no se toca aquí).
    const source = calSourceInput.value;
    if (source === 'grid') {
      const g = captureProc(0, 0, video.videoWidth, video.videoHeight, 300);
      const grid = ShapeDetector.detectGridPxPerCm(g.imageData, cmPerSquare());
      if (grid) {
        videoPxPerCm = grid.pxPerCm;
        setCalBadge(`Auto (cuadrícula) — ${grid.pxPerCm.toFixed(1)} px/cm`, true);
      } else if (!videoPxPerCm) {
        setCalBadge('Buscando cuadrícula…', false);
      }
    } else if (source === 'refobject') {
      const ref = detectReferenceCalibration(lastStableShapes, refObjectTypeInput.value);
      if (ref) {
        videoPxPerCm = ref.pxPerCm;
        setCalBadge(`Auto (objeto ref.) — ${ref.pxPerCm.toFixed(1)} px/cm`, true);
      } else if (!videoPxPerCm) {
        setCalBadge('Buscando objeto de referencia…', false);
      }
    }

    // 3) Estabilización: usamos la figura principal como ancla visual.
    const anchorShape = primaryShape(lastStableShapes);
    updateStabilization(anchorShape ? { x: anchorShape.cx, y: anchorShape.cy } : null);

    tool.redraw();
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
    clearFocus();

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
          onCalibrated: (pxPerCm) => { photoPxPerCm = pxPerCm; calSourceInput.value = 'manual'; setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true); },
          onRoiSet: () => {},
          onFocusTap: (p) => {
            const hit = hitTestShapes(lastPhotoShapes, p.x, p.y);
            focusedPhotoIndex = hit ? lastPhotoShapes.indexOf(hit) : null;
            updateFocusChipUI();
            renderPhotoShapes();
          },
        });
        setCalBadge(photoPxPerCm ? `${photoPxPerCm.toFixed(1)} px/cm` : 'Sin calibrar', !!photoPxPerCm);
        renderPhotoShapes();
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
          onCalibrated: (pxPerCm) => { videoPxPerCm = pxPerCm; calSourceInput.value = 'manual'; setCalBadge(`Manual — ${pxPerCm.toFixed(1)} px/cm`, true); },
          onRoiSet: () => {},
          onFocusTap: (p) => {
            const hit = hitTestShapes(lastStableShapes, p.x, p.y);
            focusedTrackId = hit ? hit.id : null;
            updateFocusChipUI();
            tool.redraw();
          },
        });
        setCalBadge(videoPxPerCm ? `${videoPxPerCm.toFixed(1)} px/cm` : 'Buscando calibración…', !!videoPxPerCm);
        videoModeActive = true;
        tool.redraw();
      }
    }
  });
});

// ------------------------------------------------------------------
// Botón flotante de cámara: un solo toque cambia a modo video Y activa
// la cámara (no hace falta encontrar el interruptor de abajo primero).
// ------------------------------------------------------------------
btnCameraFab.addEventListener('click', () => {
  document.querySelector('.mode-btn[data-mode="video"]').click();
  if (!currentStream) {
    btnStartCam.click();
  } else {
    btnCameraFab.classList.add('active');
  }
});
