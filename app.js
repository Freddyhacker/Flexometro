/*
  app.js
  ------
  Conecta la interfaz con detector.js. Todo corre en el navegador:
  no hay llamadas de red, servidores ni servicios externos.
*/

const UNIT_FACTORS = { mm: 10, cm: 1, m: 0.01, in: 0.393700787 };
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
    // El rectángulo de área mínima de un círculo es (casi) un cuadrado
    // cuyo lado es el diámetro — más robusto ante trazos imperfectos
    // que asumir área = πr².
    const diametroPx = (shape.rectW + shape.rectH) / 2;
    const radioCm = (diametroPx / 2) / pxPerCm;
    m.radio_cm = radioCm;
    m.diametro_cm = radioCm * 2;
    m.circunferencia_cm = 2 * Math.PI * radioCm;
  } else if (shape.shapeType === 'cuadrado' || shape.shapeType === 'rectangulo') {
    // rectW/rectH vienen del rectángulo de área mínima: correctos aunque
    // la figura esté rotada en la foto.
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

// Dibuja el contorno REAL de la figura detectada: el rectángulo de área
// mínima (con su rotación) para cuadrado/rectángulo, o la cápsula convexa
// para círculo/triángulo/polígono. Esto muestra la forma tal cual fue
// reconocida, no una caja genérica alineada a los ejes.
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

// Remapea TODAS las coordenadas de una figura (incluye corners/hull, no
// solo el bbox) tras recortar por área seleccionada y/o reescalar
// (downscale de procesamiento en video). scale multiplica, luego se suma
// el desplazamiento (offsetX, offsetY).
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

// ------------------------------------------------------------------
// Render de resultados
// ------------------------------------------------------------------
const resultsCard = document.getElementById('card-results');
const resultsList = document.getElementById('resultsList');

function renderResults(shapes, pxPerCm, unit) {
  if (!shapes.length || !pxPerCm) {
    resultsCard.hidden = true;
    resultsList.innerHTML = '';
    return;
  }
  resultsCard.hidden = false;
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
      <div class="result-head"><span><span class="idx">#${i + 1}</span> ${SHAPE_LABELS[s.shapeType] || s.shapeType}</span></div>
      <div class="result-body">${metrics}</div>
    </div>`;
  }).join('');
}

// ------------------------------------------------------------------
// Referencias comunes
// ------------------------------------------------------------------
const calStatus = document.getElementById('calStatus');
const calValueInput = document.getElementById('calValue');
const calUnitInput = document.getElementById('calUnit');
const outUnitInput = document.getElementById('outUnit');
const targetShapeInput = document.getElementById('targetShape');

function setCalStatus(text, ok) {
  calStatus.textContent = text;
  calStatus.className = 'status ' + (ok ? 'status-ok' : 'status-pending');
}

// ==================================================================
// Herramienta de interacción sobre un canvas: modo "calibrar" (2 puntos)
// o modo "área" (arrastrar un rectángulo con mouse o dedo).
// baseDrawFn(ctx) debe pintar la imagen/video de fondo, SIN limpiar
// nada más (el propio helper se encarga del resto).
// ==================================================================
function makeInteractiveCanvas(canvas, baseDrawFn, callbacks, initialRoi) {
  let mode = 'calibrate'; // 'calibrate' | 'roi' | 'none'
  let calPoints = [];
  let roi = initialRoi || null; // {x,y,w,h} en coords de canvas (px reales del canvas)
  let dragging = false;
  let dragStart = null;
  let dragCurrent = null;

  function toCanvasCoords(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function currentDragRect() {
    const x = Math.min(dragStart.x, dragCurrent.x);
    const y = Math.min(dragStart.y, dragCurrent.y);
    const w = Math.abs(dragCurrent.x - dragStart.x);
    const h = Math.abs(dragCurrent.y - dragStart.y);
    return { x, y, w, h };
  }

  function redraw() {
    const ctx = canvas.getContext('2d');
    baseDrawFn(ctx);

    if (calPoints.length) {
      ctx.fillStyle = '#e8622c';
      ctx.strokeStyle = '#e8622c';
      ctx.lineWidth = 2;
      calPoints.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill(); });
      if (calPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(calPoints[0].x, calPoints[0].y);
        ctx.lineTo(calPoints[1].x, calPoints[1].y);
        ctx.stroke();
      }
    }

    const rectToShow = dragging ? currentDragRect() : roi;
    if (rectToShow) {
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = '#e8622c';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(rectToShow.x, rectToShow.y, rectToShow.w, rectToShow.h);
      ctx.setLineDash([]);
    }
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (mode !== 'roi') return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    dragStart = toCanvasCoords(e);
    dragCurrent = dragStart;
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (mode !== 'roi' || !dragging) return;
    dragCurrent = toCanvasCoords(e);
    redraw();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (mode !== 'roi' || !dragging) return;
    dragging = false;
    const r = currentDragRect();
    if (r.w > 12 && r.h > 12) {
      roi = r;
      callbacks.onRoiSet && callbacks.onRoiSet(roi);
    }
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
    redraw,
    getRoi() { return roi; },
    clearRoi() { roi = null; redraw(); callbacks.onRoiSet && callbacks.onRoiSet(null); },
    clearCal() { calPoints = []; redraw(); },
  };
}

function wireModeButtons(groupSelector, target, tools, hintEl, hints) {
  document.querySelectorAll(`${groupSelector} .mbtn[data-target="${target}"]`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`${groupSelector} .mbtn[data-target="${target}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tool = btn.dataset.tool;
      tools.setMode(tool);
      hintEl.textContent = hints[tool] || '';
    });
  });
}

// ==================================================================
// MODO FOTO
// ==================================================================
const fileInput = document.getElementById('fileInput');
const photoViewfinder = document.getElementById('photoViewfinder');
const photoCanvas = document.getElementById('photoCanvas');
const photoModeBtns = document.getElementById('photoModeBtns');
const photoActions = document.getElementById('photoActions');
const btnDetectPhoto = document.getElementById('btnDetectPhoto');
const btnClearCalPhoto = document.getElementById('btnClearCalPhoto');
const btnClearRoiPhoto = document.getElementById('btnClearRoiPhoto');
const photoToolHint = document.getElementById('photoToolHint');

const MAX_PHOTO_WIDTH = 900;
let photoImage = null;
let photoPxPerCm = null;
let photoTool = null;

function drawPhotoBase(ctx) {
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  ctx.drawImage(photoImage, 0, 0, photoCanvas.width, photoCanvas.height);
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

    photoViewfinder.hidden = false;
    photoActions.hidden = false;
    photoModeBtns.hidden = false;
    photoPxPerCm = null;
    setCalStatus('Sin calibrar — modo calibrar activo: toca 2 puntos', false);

    photoTool = makeInteractiveCanvas(photoCanvas, drawPhotoBase, {
      onCalibrated: (pxPerCm) => {
        photoPxPerCm = pxPerCm;
        setCalStatus(`Calibrado — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
    });
    photoTool.redraw();
  };
  img.src = URL.createObjectURL(file);
});

wireModeButtons('#photoModeBtns', 'photo', { setMode: (m) => photoTool && photoTool.setMode(m) }, photoToolHint, {
  calibrate: 'Modo calibrar: toca 2 puntos de distancia conocida.',
  roi: 'Modo área: arrastra un rectángulo sobre la zona a analizar.',
});

btnClearRoiPhoto.addEventListener('click', () => photoTool && photoTool.clearRoi());

btnClearCalPhoto.addEventListener('click', () => {
  photoPxPerCm = null;
  if (photoTool) { photoTool.clearCal(); }
  setCalStatus('Sin calibrar', false);
  renderResults([], null, outUnitInput.value);
});

btnDetectPhoto.addEventListener('click', () => {
  if (!photoImage) return;
  if (!photoPxPerCm) {
    alert('Primero calibra: activa "📏 Calibrar", toca 2 puntos sobre la foto y escribe la distancia real entre ellos.');
    return;
  }

  const ctx = photoCanvas.getContext('2d');
  const roi = photoTool.getRoi();
  const region = roi
    ? { x: Math.round(roi.x), y: Math.round(roi.y), w: Math.round(roi.w), h: Math.round(roi.h) }
    : { x: 0, y: 0, w: photoCanvas.width, h: photoCanvas.height };

  const imageData = ctx.getImageData(region.x, region.y, region.w, region.h);
  const minAreaPx = Math.max(150, region.w * region.h * 0.004);
  let shapes = ShapeDetector.detectShapes(imageData, { targetShape: targetShapeInput.value, minAreaPx });

  // Volvemos a coordenadas completas del canvas (incluye corners/hull)
  shapes = shapes.map(s => remapShape(s, 1, region.x, region.y));

  photoTool.redraw();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2f6f5e';
  ctx.font = 'bold 15px monospace';
  shapes.forEach((s, i) => {
    drawShapeOutline(ctx, s);
    const label = `#${i + 1}`;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#2f6f5e';
    ctx.fillRect(s.minX, Math.max(0, s.minY - 20), tw + 10, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, s.minX + 5, Math.max(15, s.minY - 5));
  });

  if (!shapes.length) alert('No encontré figuras. Prueba con más contraste, mejor luz, o ajusta el área seleccionada.');
  renderResults(shapes, photoPxPerCm, outUnitInput.value);
});

// ==================================================================
// MODO VIDEO (cámara en vivo) — con selector de cámara y estabilización
// ==================================================================
const cameraSelectRow = document.getElementById('cameraSelectRow');
const cameraSelect = document.getElementById('cameraSelect');
const btnStartCam = document.getElementById('btnStartCam');
const videoViewfinder = document.getElementById('videoViewfinder');
const video = document.getElementById('video');
const videoOverlay = document.getElementById('videoOverlay');
const videoModeBtns = document.getElementById('videoModeBtns');
const videoActions = document.getElementById('videoActions');
const btnFreezeCal = document.getElementById('btnFreezeCal');
const btnResumeLive = document.getElementById('btnResumeLive');
const btnClearCalVideo = document.getElementById('btnClearCalVideo');
const btnClearRoiVideo = document.getElementById('btnClearRoiVideo');
const videoToolHint = document.getElementById('videoToolHint');
const stabRow = document.getElementById('stabRow');
const stabToggle = document.getElementById('stabToggle');

let videoPxPerCm = null;
let liveInterval = null;
let videoTool = null;
let frozen = false;
let currentStream = null;
let lastStableShapes = [];

const PROC_WIDTH = 320;
const procCanvas = document.createElement('canvas');

// ------------------------------------------------------------------
// Estabilización de imagen (estilo "recorte" tipo Gyroflow, pero usando
// la figura detectada como punto de referencia en vez de datos de
// giroscopio). Cada cuadro se dibuja con un ligero zoom, y el recorte
// se desplaza para compensar el temblor respecto a un ancla suavizada.
// ------------------------------------------------------------------
const STAB_ZOOM = 1.12;   // cuánto se hace zoom (12%) para tener margen de recorte
const STAB_ALPHA = 0.15;  // qué tan lento se mueve el ancla "estable" (más lento = más firme)

let stabAnchor = null;    // {x,y} posición suavizada de referencia, en coords de video crudo
let currentXform = null;  // transform usado para dibujar el cuadro ACTUAL {sx,sy,sw,sh,cw,ch}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function defaultXform() {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
  const cw = videoOverlay.width || vw, ch = videoOverlay.height || vh;
  if (!stabToggle.checked) return { sx: 0, sy: 0, sw: vw, sh: vh, cw, ch };
  const sw = vw / STAB_ZOOM, sh = vh / STAB_ZOOM;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, cw, ch };
}

// A partir de las figuras crudas de ESTE cuadro, calcula el transform a
// usar en el PRÓXIMO cuadro (desfase de 1 cuadro, imperceptible a ~5fps
// de detección, pero evita una dependencia circular).
function computeNextXform(rawShapes) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cw = videoOverlay.width, ch = videoOverlay.height;

  if (!stabToggle.checked) { stabAnchor = null; return { sx: 0, sy: 0, sw: vw, sh: vh, cw, ch }; }

  const sw = vw / STAB_ZOOM, sh = vh / STAB_ZOOM;
  const baseSx = (vw - sw) / 2, baseSy = (vh - sh) / 2;

  if (!rawShapes.length) {
    // sin ancla visible este cuadro: mantenemos el último recorte tal cual
    return currentXform || { sx: baseSx, sy: baseSy, sw, sh, cw, ch };
  }

  const anchorShape = rawShapes.reduce((a, b) => (b.areaPx > a.areaPx ? b : a));
  const raw = { x: anchorShape.cx, y: anchorShape.cy };
  if (!stabAnchor) stabAnchor = { ...raw };

  const shiftX = raw.x - stabAnchor.x;
  const shiftY = raw.y - stabAnchor.y;
  stabAnchor.x += (raw.x - stabAnchor.x) * STAB_ALPHA;
  stabAnchor.y += (raw.y - stabAnchor.y) * STAB_ALPHA;

  return {
    sx: clamp(baseSx + shiftX, 0, vw - sw),
    sy: clamp(baseSy + shiftY, 0, vh - sh),
    sw, sh, cw, ch,
  };
}

function renderVideoFrame(xform) {
  const ctx = videoOverlay.getContext('2d');
  ctx.clearRect(0, 0, videoOverlay.width, videoOverlay.height);
  ctx.drawImage(video, xform.sx, xform.sy, xform.sw, xform.sh, 0, 0, xform.cw, xform.ch);
}

// Conversión entre coordenadas de PANTALLA (lo que el usuario ve/toca en
// el canvas) y coordenadas de VIDEO CRUDO (necesarias para recortar y
// detectar). El zoom es constante; solo cambia el desplazamiento (pan).
function videoToDisplay(x, y, xform) {
  return { x: (x - xform.sx) * (xform.cw / xform.sw), y: (y - xform.sy) * (xform.ch / xform.sh) };
}
function displayToVideo(x, y, xform) {
  return { x: xform.sx + x * (xform.sw / xform.cw), y: xform.sy + y * (xform.sh / xform.ch) };
}
function displayRectToVideoRect(rect, xform) {
  const p1 = displayToVideo(rect.x, rect.y, xform);
  const p2 = displayToVideo(rect.x + rect.w, rect.y + rect.h, xform);
  return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) };
}

// Dibuja las cajas + etiquetas de las figuras estabilizadas sobre el
// overlay. Se usa tanto en cada tick de detección como al redibujar por
// interacción (arrastre de área), para que nunca queden "rastros".
function cornersFromCenter(cx, cy, w, h, angle) {
  const hw = w / 2, hh = h / 2;
  const local = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return local.map(p => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

function drawTrackOutline(ctx, t, xform) {
  const scaleX = xform.cw / xform.sw, scaleY = xform.ch / xform.sh;
  const mp = (x, y) => videoToDisplay(x, y, xform);

  if (t.shapeType === 'cuadrado' || t.shapeType === 'rectangulo') {
    const corners = cornersFromCenter(t.cx, t.cy, t.rectW, t.rectH, t.rectAngle).map(p => mp(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
  } else if (t.shapeType === 'circulo') {
    const center = mp(t.cx, t.cy);
    const radius = (t.rectW + t.rectH) / 4 * ((scaleX + scaleY) / 2);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  } else if (t.hull && t.hull.length >= 3) {
    const pts = t.hull.map(p => mp(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
  }
}

// Dibuja el cuadro de video (ya estabilizado según currentXform) y, sobre
// él, el contorno + etiqueta de cada figura rastreada. Es la única fuente
// de dibujo del video: por eso se usa como baseDrawFn de la herramienta
// interactiva (así calibración/área siempre ven el video "en vivo").
function drawStableShapes(ctx) {
  const xform = currentXform || defaultXform();
  renderVideoFrame(xform);

  if (!videoPxPerCm) {
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#e8622c';
    ctx.fillText('Sin calibrar — toca "Congelar y calibrar"', 14, 30);
    return;
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2f6f5e';
  ctx.font = 'bold 16px monospace';
  lastStableShapes.forEach((s) => {
    drawTrackOutline(ctx, s, xform);
    const topLeft = videoToDisplay(s.minX, s.minY, xform);
    const m = computeMeasurements(s, videoPxPerCm);
    const label = mainLabel(m, outUnitInput.value);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#2f6f5e';
    ctx.fillRect(topLeft.x, Math.max(0, topLeft.y - 22), tw + 10, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, topLeft.x + 5, Math.max(16, topLeft.y - 6));
  });
}

// --- Listado de cámaras disponibles (incluye webcams USB si el SO las expone) ---
async function refreshCameraList() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    if (cams.length <= 1) { cameraSelectRow.hidden = true; return; }
    cameraSelectRow.hidden = false;
    cameraSelect.innerHTML = cams.map((c, i) =>
      `<option value="${c.deviceId}">${c.label || 'Cámara ' + (i + 1)}</option>`
    ).join('');
  } catch (e) { /* enumerar puede fallar sin permiso previo; no es crítico */ }
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
  sizeOverlayToVideo();
  await refreshCameraList(); // ahora sí trae etiquetas (labels) con permiso concedido
}

function sizeOverlayToVideo() {
  videoOverlay.width = video.videoWidth;
  videoOverlay.height = video.videoHeight;
}

btnStartCam.addEventListener('click', async () => {
  try {
    await startCamera();
    videoViewfinder.hidden = false;
    videoActions.hidden = false;
    videoModeBtns.hidden = false;
    stabRow.hidden = false;
    btnStartCam.textContent = 'Cambiar cámara';

    stabAnchor = null;
    currentXform = defaultXform();

    videoTool = makeInteractiveCanvas(videoOverlay, drawStableShapes, {
      onCalibrated: (pxPerCm) => {
        videoPxPerCm = pxPerCm;
        setCalStatus(`Calibrado — ${pxPerCm.toFixed(1)} px/cm`, true);
      },
      onRoiSet: () => {},
    });
    videoTool.setMode('none'); // solo se activa al "Congelar y calibrar" o "Área"

    startLiveLoop();
  } catch (err) {
    alert('No pude activar la cámara: ' + err.message);
  }
});

stabToggle.addEventListener('change', () => {
  stabAnchor = null;
  currentXform = defaultXform();
});

cameraSelect.addEventListener('change', async () => {
  if (currentStream) currentStream.getTracks().forEach(t => t.stop());
  await startCamera();
  videoPxPerCm = null;
  setCalStatus('Cámara cambiada — vuelve a calibrar', false);
  lastStableShapes = [];
  renderResults([], null, outUnitInput.value);
});

wireModeButtons('#videoModeBtns', 'video', { setMode: (m) => videoTool && videoTool.setMode(m) }, videoToolHint, {
  calibrate: 'Congela la imagen (botón de arriba) y luego toca 2 puntos.',
  roi: 'Modo área: arrastra un rectángulo sobre la zona a analizar.',
});

btnClearRoiVideo.addEventListener('click', () => videoTool && videoTool.clearRoi());

// --------------------------------------------------------------
// Estabilización: seguimiento simple de figuras entre cuadros con
// suavizado exponencial (EMA) sobre posición, tamaño y forma.
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
      const t = tracks[best];
      const a = SMOOTH_ALPHA;
      t.minX = t.minX * (1 - a) + raw.minX * a;
      t.maxX = t.maxX * (1 - a) + raw.maxX * a;
      t.minY = t.minY * (1 - a) + raw.minY * a;
      t.maxY = t.maxY * (1 - a) + raw.maxY * a;
      t.areaPx = t.areaPx * (1 - a) + raw.areaPx * a;
      t.perimeterPx = t.perimeterPx * (1 - a) + raw.perimeterPx * a;
      t.rectW = t.rectW * (1 - a) + raw.rectW * a;
      t.rectH = t.rectH * (1 - a) + raw.rectH * a;
      t.rectAngle = t.rectAngle * (1 - a) + raw.rectAngle * a;
      t.hull = raw.hull; // el contorno de círculo/triángulo/polígono usa el último cuadro tal cual
      t.cx = (t.minX + t.maxX) / 2;
      t.cy = (t.minY + t.maxY) / 2;
      t.missed = 0;
      t.matched = true;
      // estabilidad de la etiqueta: solo cambia si el nuevo tipo se repite
      // 2 veces seguidas (evita que la etiqueta "parpadee" entre formas).
      if (raw.shapeType !== t.shapeType) {
        if (t.pendingType === raw.shapeType) {
          t.shapeType = raw.shapeType;
          t.pendingType = null;
        } else {
          t.pendingType = raw.shapeType;
        }
      } else {
        t.pendingType = null;
      }
      used.add(best);
    } else {
      tracks.push({ ...raw, missed: 0, matched: true });
    }
  });

  tracks = tracks.filter(t => {
    if (!t.matched) t.missed++;
    return t.missed <= MAX_MISSED_FRAMES;
  });

  return tracks;
}

function startLiveLoop() {
  if (liveInterval) clearInterval(liveInterval);
  tracks = [];
  lastStableShapes = [];
  liveInterval = setInterval(() => {
    if (frozen || video.readyState < 2) return;

    const xform = currentXform || defaultXform();

    if (!videoPxPerCm) {
      videoTool && videoTool.redraw(); // dibuja el video + mensaje "sin calibrar"
      renderResults([], null, outUnitInput.value);
      currentXform = computeNextXform([]);
      return;
    }

    // El área seleccionada (si existe) está en coordenadas de PANTALLA;
    // la convertimos a coordenadas de VIDEO CRUDO con el transform de
    // ESTE cuadro para saber qué región recortar y analizar.
    const roiDisplay = videoTool ? videoTool.getRoi() : null;
    const region = roiDisplay
      ? displayRectToVideoRect(roiDisplay, xform)
      : { x: xform.sx, y: xform.sy, w: xform.sw, h: xform.sh };
    region.x = clamp(region.x, 0, video.videoWidth - 10);
    region.y = clamp(region.y, 0, video.videoHeight - 10);
    region.w = clamp(region.w, 10, video.videoWidth - region.x);
    region.h = clamp(region.h, 10, video.videoHeight - region.y);

    const procScale = Math.min(PROC_WIDTH / region.w, 1);
    const procW = Math.max(20, Math.round(region.w * procScale));
    const procH = Math.max(20, Math.round(region.h * procScale));
    procCanvas.width = procW;
    procCanvas.height = procH;
    const pctx = procCanvas.getContext('2d');
    pctx.drawImage(video, region.x, region.y, region.w, region.h, 0, 0, procW, procH);

    const imageData = pctx.getImageData(0, 0, procW, procH);
    const minAreaPx = Math.max(60, procW * procH * 0.004);
    let rawShapes = ShapeDetector.detectShapes(imageData, {
      targetShape: targetShapeInput.value,
      minAreaPx,
    });

    const inv = 1 / procScale;
    rawShapes = rawShapes.map(s => remapShape(s, inv, region.x, region.y)); // vuelven a coords de video crudo

    lastStableShapes = updateTracks(rawShapes);

    // videoTool.redraw() usa drawStableShapes como base: renderiza el
    // video con el xform ACTUAL (currentXform, aún no actualizado) y
    // dibuja los contornos ya alineados con ese mismo cuadro.
    videoTool && videoTool.redraw();
    renderResults(lastStableShapes, videoPxPerCm, outUnitInput.value);

    // Calculamos el recorte a usar en el PRÓXIMO cuadro, en base a dónde
    // quedó la figura de referencia en ESTE cuadro.
    currentXform = computeNextXform(rawShapes);
  }, 220);
}

btnFreezeCal.addEventListener('click', () => {
  frozen = true;
  const savedRoi = videoTool ? videoTool.getRoi() : null;

  // Congelamos el canvas TAL COMO SE VE (ya estabilizado), no el video
  // crudo, para que los 2 puntos de calibración coincidan exactamente
  // con lo que el usuario está mirando en pantalla.
  const frameSnapshot = document.createElement('canvas');
  frameSnapshot.width = videoOverlay.width;
  frameSnapshot.height = videoOverlay.height;
  frameSnapshot.getContext('2d').drawImage(videoOverlay, 0, 0);

  videoTool = makeInteractiveCanvas(videoOverlay, (ctx) => ctx.drawImage(frameSnapshot, 0, 0), {
    onCalibrated: (pxPerCm) => {
      videoPxPerCm = pxPerCm;
      setCalStatus(`Calibrado — ${pxPerCm.toFixed(1)} px/cm`, true);
    },
    onRoiSet: () => {},
  }, savedRoi);
  videoTool.setMode('calibrate');
  document.querySelectorAll('#videoModeBtns .mbtn').forEach(b => b.classList.remove('active'));
  document.querySelector('#videoModeBtns .mbtn[data-tool="calibrate"]').classList.add('active');
  videoToolHint.textContent = 'Toca 2 puntos de distancia conocida sobre la imagen congelada.';
  videoTool.redraw();

  setCalStatus('Marca 2 puntos sobre el cuadro congelado', false);
  btnResumeLive.hidden = false;
});

btnResumeLive.addEventListener('click', () => {
  frozen = false;
  btnResumeLive.hidden = true;

  const savedRoi = videoTool ? videoTool.getRoi() : null;
  videoTool = makeInteractiveCanvas(videoOverlay, drawStableShapes, {
    onCalibrated: (pxPerCm) => {
      videoPxPerCm = pxPerCm;
      setCalStatus(`Calibrado — ${pxPerCm.toFixed(1)} px/cm`, true);
    },
    onRoiSet: () => {},
  }, savedRoi);
  videoTool.setMode('none');
  videoTool.redraw();
});

btnClearCalVideo.addEventListener('click', () => {
  videoPxPerCm = null;
  setCalStatus('Sin calibrar', false);
  renderResults([], null, outUnitInput.value);
});

// ==================================================================
// Tabs (Foto / Video)
// ==================================================================
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const mode = tab.dataset.mode;
    document.getElementById('panel-foto').hidden = mode !== 'foto';
    document.getElementById('panel-video').hidden = mode !== 'video';
  });
});
