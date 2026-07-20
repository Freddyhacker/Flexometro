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
  const w = shape.maxX - shape.minX + 1;
  const h = shape.maxY - shape.minY + 1;
  const areaCm2 = shape.areaPx / (pxPerCm * pxPerCm);
  const perimetroCm = shape.perimeterPx / pxPerCm;

  const m = { shapeType: shape.shapeType, area_cm2: areaCm2, perimetro_cm: perimetroCm };

  if (shape.shapeType === 'circulo') {
    const radioPx = Math.sqrt(shape.areaPx / Math.PI);
    const radioCm = radioPx / pxPerCm;
    m.radio_cm = radioCm;
    m.diametro_cm = radioCm * 2;
    m.circunferencia_cm = 2 * Math.PI * radioCm;
  } else if (shape.shapeType === 'cuadrado' || shape.shapeType === 'rectangulo') {
    const wCm = Math.max(w, h) / pxPerCm;
    const hCm = Math.min(w, h) / pxPerCm;
    m.largo_cm = wCm;
    m.ancho_cm = hCm;
    m.diagonal_cm = Math.sqrt(wCm * wCm + hCm * hCm);
  } else {
    m.ancho_aprox_cm = w / pxPerCm;
    m.alto_aprox_cm = h / pxPerCm;
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

  // Volvemos a coordenadas completas del canvas
  shapes = shapes.map(s => ({
    ...s,
    minX: s.minX + region.x, maxX: s.maxX + region.x,
    minY: s.minY + region.y, maxY: s.maxY + region.y,
  }));

  photoTool.redraw();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2f6f5e';
  ctx.font = 'bold 15px monospace';
  shapes.forEach((s, i) => {
    const w = s.maxX - s.minX, h = s.maxY - s.minY;
    ctx.strokeRect(s.minX, s.minY, w, h);
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

let videoPxPerCm = null;
let liveInterval = null;
let videoTool = null;
let frozen = false;
let currentStream = null;
let lastStableShapes = [];

const PROC_WIDTH = 320;
const procCanvas = document.createElement('canvas');

// Dibuja las cajas + etiquetas de las figuras estabilizadas sobre el
// overlay. Se usa tanto en cada tick de detección como al redibujar por
// interacción (arrastre de área), para que nunca queden "rastros".
function drawStableShapes(ctx) {
  ctx.clearRect(0, 0, videoOverlay.width, videoOverlay.height);

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
    const x = s.minX, y = s.minY, w = s.maxX - s.minX, h = s.maxY - s.minY;
    ctx.strokeRect(x, y, w, h);
    const m = computeMeasurements(s, videoPxPerCm);
    const label = mainLabel(m, outUnitInput.value);
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = '#2f6f5e';
    ctx.fillRect(x, Math.max(0, y - 22), tw + 10, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x + 5, Math.max(16, y - 6));
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
    btnStartCam.textContent = 'Cambiar cámara';

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

    if (!videoPxPerCm) {
      lastStableShapes = [];
      videoTool && videoTool.redraw();
      renderResults([], null, outUnitInput.value);
      return;
    }

    const roi = videoTool ? videoTool.getRoi() : null;
    const region = roi
      ? { x: Math.round(roi.x), y: Math.round(roi.y), w: Math.round(roi.w), h: Math.round(roi.h) }
      : { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };

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
    rawShapes = rawShapes.map(s => ({
      ...s,
      minX: s.minX * inv + region.x, maxX: s.maxX * inv + region.x,
      minY: s.minY * inv + region.y, maxY: s.maxY * inv + region.y,
      cx: s.cx * inv + region.x, cy: s.cy * inv + region.y,
    }));

    lastStableShapes = updateTracks(rawShapes);
    videoTool && videoTool.redraw();
    renderResults(lastStableShapes, videoPxPerCm, outUnitInput.value);
  }, 220);
}

btnFreezeCal.addEventListener('click', () => {
  frozen = true;
  sizeOverlayToVideo();
  const savedRoi = videoTool ? videoTool.getRoi() : null;

  const frameSnapshot = document.createElement('canvas');
  frameSnapshot.width = videoOverlay.width;
  frameSnapshot.height = videoOverlay.height;
  frameSnapshot.getContext('2d').drawImage(video, 0, 0, videoOverlay.width, videoOverlay.height);

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
