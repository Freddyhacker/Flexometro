/*
  detector.js
  -----------
  Motor de visión por computadora 100% JavaScript (sin librerías externas).
  Recibe un ImageData (de un <canvas>) y devuelve las figuras detectadas
  con sus medidas en píxeles. La conversión a unidades reales se hace en
  app.js usando la escala de calibración (px por cm).

  Este archivo no depende de OpenCV ni de ninguna librería: todo — umbral
  automático, componentes conexas, perímetro y clasificación de forma —
  está implementado a mano para que la app funcione 100% en el navegador,
  sin llamadas externas.
*/

const ShapeDetector = (() => {

  // ------------------------------------------------------------------
  // 1) Escala de grises + umbral automático (Otsu)
  // ------------------------------------------------------------------

  function toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8ClampedArray(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      // luminancia perceptual
      gray[p] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0;
    }
    return gray;
  }

  // Blur de caja 3x3 separable (horizontal + vertical). Suaviza ruido de
  // sensor/compresión que de otra forma hace "temblar" el área y el
  // perímetro medidos de un cuadro de video a otro.
  function boxBlur3(gray, width, height) {
    const tmp = new Uint8ClampedArray(gray.length);
    const out = new Uint8ClampedArray(gray.length);

    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1);
        tmp[row + x] = (gray[row + x0] + gray[row + x] + gray[row + x1]) / 3;
      }
    }
    // vertical
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
        out[y * width + x] = (tmp[y0 * width + x] + tmp[y * width + x] + tmp[y1 * width + x]) / 3;
      }
    }
    return out;
  }

  function otsuThreshold(gray) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

    const total = gray.length;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * hist[t];

    let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 127;

    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  // Devuelve una máscara binaria (Uint8Array, 1 = figura / 0 = fondo).
  // Asume automáticamente qué lado del umbral es "figura" (la clase
  // minoritaria de píxeles, ya que las figuras suelen ocupar menos área
  // que el fondo/cuadrícula).
  function binarize(gray, width, height) {
    const t = otsuThreshold(gray);
    let below = 0;
    for (let i = 0; i < gray.length; i++) if (gray[i] <= t) below++;
    const foregroundIsDark = below < gray.length / 2;

    const mask = new Uint8Array(gray.length);
    for (let i = 0; i < gray.length; i++) {
      const isDark = gray[i] <= t;
      mask[i] = (isDark === foregroundIsDark) ? 1 : 0;
    }
    return mask;
  }

  // ------------------------------------------------------------------
  // 2) Componentes conexas (flood fill iterativo, 4-conectividad)
  // ------------------------------------------------------------------

  function connectedComponents(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    const components = [];
    const stack = new Int32Array(mask.length);

    for (let start = 0; start < mask.length; start++) {
      if (mask[start] !== 1 || visited[start]) continue;

      let sp = 0;
      stack[sp++] = start;
      visited[start] = 1;

      let minX = width, maxX = 0, minY = height, maxY = 0;
      let area = 0;
      const pixels = [];

      while (sp > 0) {
        const idx = stack[--sp];
        const x = idx % width;
        const y = (idx / width) | 0;

        area++;
        pixels.push(idx);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        // 4 vecinos
        if (x > 0) {
          const n = idx - 1;
          if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (x < width - 1) {
          const n = idx + 1;
          if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (y > 0) {
          const n = idx - width;
          if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack[sp++] = n; }
        }
        if (y < height - 1) {
          const n = idx + width;
          if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack[sp++] = n; }
        }
      }

      components.push({ area, minX, maxX, minY, maxY, pixels });
    }

    return components;
  }

  // Perímetro aproximado: cuenta píxeles del componente que tienen al
  // menos un vecino (4-conectividad) fuera de la máscara o fuera de imagen.
  function estimatePerimeter(pixels, mask, width, height) {
    let perimeter = 0;
    const pixelSet = new Set(pixels);
    for (const idx of pixels) {
      const x = idx % width;
      const y = (idx / width) | 0;
      let isBoundary = false;

      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        isBoundary = true;
      } else {
        const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
        for (const n of neighbors) {
          if (mask[n] !== 1) { isBoundary = true; break; }
        }
      }
      if (isBoundary) perimeter++;
    }
    return perimeter;
  }

  // ------------------------------------------------------------------
  // 3) Clasificación de forma (heurística geométrica, sin polígonos)
  // ------------------------------------------------------------------

  function classifyShape(area, perimeter, minX, maxX, minY, maxY) {
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const bboxArea = w * h;
    const extent = area / bboxArea;               // qué tanto llena su caja
    const aspect = w / h;

    // 'extent' es mucho más estable que la circularidad basada en conteo
    // de píxeles de borde (esa se distorsiona con el efecto "escalera").
    // Valores teóricos de referencia (figura alineada a su bbox):
    //   cuadrado/rectángulo lleno -> extent ≈ 1.0
    //   círculo                  -> extent ≈ π/4 ≈ 0.785
    //   triángulo                -> extent ≈ 0.5

    if (extent > 0.90) {
      return (aspect >= 0.9 && aspect <= 1.1) ? 'cuadrado' : 'rectangulo';
    }
    if (extent > 0.64) {
      return 'circulo';
    }
    if (extent > 0.35) {
      return 'triangulo';
    }
    return 'poligono';
  }

  // ------------------------------------------------------------------
  // 4) API principal
  // ------------------------------------------------------------------

  /**
   * Detecta todas las figuras en un ImageData.
   * @param {ImageData} imageData
   * @param {Object} opts
   * @param {string} opts.targetShape - 'auto' o un tipo específico
   * @param {number} opts.minAreaPx - área mínima en píxeles para considerar una figura
   * @param {number} opts.maxShapes - límite de figuras a devolver
   */
  function detectShapes(imageData, opts = {}) {
    const { width, height } = imageData;
    const targetShape = opts.targetShape || 'auto';
    const minAreaPx = opts.minAreaPx || (width * height * 0.004);
    const maxAreaPx = width * height * 0.9;
    const maxShapes = opts.maxShapes || 25;
    const applyBlur = opts.blur !== false; // activado por defecto

    let gray = toGrayscale(imageData);
    if (applyBlur) gray = boxBlur3(gray, width, height);

    const mask = binarize(gray, width, height);
    const components = connectedComponents(mask, width, height);

    const shapes = [];
    for (const c of components) {
      if (c.area < minAreaPx || c.area > maxAreaPx) continue;
      const perimeter = estimatePerimeter(c.pixels, mask, width, height);
      const shapeType = classifyShape(c.area, perimeter, c.minX, c.maxX, c.minY, c.maxY);
      if (targetShape !== 'auto' && shapeType !== targetShape) continue;

      shapes.push({
        shapeType,
        areaPx: c.area,
        perimeterPx: perimeter,
        minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY,
        cx: (c.minX + c.maxX) / 2, cy: (c.minY + c.maxY) / 2,
      });
    }

    shapes.sort((a, b) => b.areaPx - a.areaPx);
    return shapes.slice(0, maxShapes);
  }

  return { detectShapes, toGrayscale, boxBlur3, otsuThreshold, binarize, connectedComponents };
})();

if (typeof module !== 'undefined') module.exports = ShapeDetector;
