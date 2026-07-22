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

  // Perímetro aproximado por conteo de píxeles de borde (rápido; se usa
  // solo como referencia, la clasificación real usa la cápsula convexa).
  function estimatePerimeter(pixels, mask, width, height) {
    let perimeter = 0;
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

  // Extrae los píxeles de borde como puntos {x,y} (para la cápsula convexa).
  function boundaryPoints(pixels, mask, width, height) {
    const pts = [];
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
      if (isBoundary) pts.push({ x, y });
    }
    return pts;
  }

  // ------------------------------------------------------------------
  // 1b) Detección automática de cuadrícula de calibración
  // ------------------------------------------------------------------

  function sobelMagnitude(gray, width, height) {
    const out = new Float32Array(width * height);
    const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let sx = 0, sy = 0, k = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = gray[(y + dy) * width + (x + dx)];
            sx += v * gx[k]; sy += v * gy[k]; k++;
          }
        }
        out[y * width + x] = Math.sqrt(sx * sx + sy * sy);
      }
    }
    return out;
  }

  function normalizeToByte(arr) {
    let max = 1;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    const out = new Uint8ClampedArray(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] / max) * 255;
    return out;
  }

  /**
   * Busca una cuadrícula (líneas formando cuadros) en la imagen y estima
   * cuántos píxeles equivalen a 1 cm, a partir del tamaño real de cada
   * cuadro (cmPerSquare). Detecta los BORDES (líneas de la cuadrícula) y
   * trata cada celda interior como su propia región, igual que "agujeros"
   * delimitados por esas líneas.
   *
   * Devuelve { pxPerCm, count } o null si no encuentra suficientes
   * cuadros de tamaño consistente como para confiar en la medida.
   */
  function detectGridPxPerCm(imageData, cmPerSquare) {
    const { width, height } = imageData;
    const gray = toGrayscale(imageData);

    // OJO: aquí NO aplicamos el blur de 3x3 que sí usamos para detectar
    // figuras — ese blur ensancha demasiado una línea de cuadrícula fina
    // (de 1-2 px) y termina "comiéndose" varios píxeles de cada celda,
    // subestimando el tamaño real de la cuadrícula.
    const mag = sobelMagnitude(gray, width, height);
    const bytes = normalizeToByte(mag);
    const t = otsuThreshold(bytes);

    const edgeMask = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) edgeMask[i] = bytes[i] > t ? 1 : 0;

    // Medimos el grosor típico de una línea ya detectada (en píxeles),
    // recorriendo VARIAS filas (no solo una: si una fila cae justo sobre
    // una línea horizontal de la cuadrícula, medir solo ahí daría un
    // resultado absurdo) y usando la MEDIANA de todas las rachas cortas
    // encontradas. Ese grosor es lo que le "robamos" a cada celda al
    // separarlas, así que se lo devolvemos a la medida final.
    const sampleRows = [0.2, 0.35, 0.5, 0.65, 0.8].map(f => Math.floor(height * f));
    const allRuns = [];
    for (const y of sampleRows) {
      let run = 0;
      for (let x = 0; x < width; x++) {
        if (edgeMask[y * width + x] === 1) {
          run++;
        } else if (run > 0) {
          if (run < width * 0.1) allRuns.push(run); // descarta rachas gigantes (fila degenerada)
          run = 0;
        }
      }
    }
    allRuns.sort((a, b) => a - b);
    const avgLineThickness = allRuns.length ? allRuns[Math.floor(allRuns.length / 2)] : 1;

    // Invertimos: el primer plano ahora son las celdas INTERIORES de la
    // cuadrícula (regiones separadas por las líneas de borde).
    const cellMask = new Uint8Array(edgeMask.length);
    for (let i = 0; i < edgeMask.length; i++) cellMask[i] = edgeMask[i] === 1 ? 0 : 1;

    const components = connectedComponents(cellMask, width, height);
    const imgArea = width * height;
    const minArea = imgArea * 0.0002;
    const maxArea = imgArea * 0.2; // permite pocos cuadros grandes (cámara cerca)

    const sides = [];
    for (const c of components) {
      if (c.area < minArea || c.area > maxArea) continue;
      const w = c.maxX - c.minX + 1, h = c.maxY - c.minY + 1;
      if (w <= 1 || h <= 1) continue;
      const aspect = w / h;
      if (aspect < 0.7 || aspect > 1.3) continue;
      if (c.area / (w * h) < 0.6) continue; // debe llenar bien su caja
      sides.push((w + h) / 2);
    }

    if (sides.length < 4) return null;

    sides.sort((a, b) => a - b);
    const median = sides[Math.floor(sides.length / 2)];
    const filtered = sides.filter(s => s > median * 0.6 && s < median * 1.4);
    if (filtered.length < 4) return null;

    const measuredSide = filtered.reduce((a, b) => a + b, 0) / filtered.length;
    // Cada celda perdió aprox. el grosor de UNA línea de borde (la que la
    // separa de la siguiente celda); se lo devolvemos.
    const sidePx = measuredSide + avgLineThickness;
    return { pxPerCm: sidePx / cmPerSquare, count: filtered.length };
  }

  // ------------------------------------------------------------------
  // 3) Geometría real: cápsula convexa, polígono simplificado y
  //    rectángulo de área mínima (tolera figuras rotadas/imperfectas)
  // ------------------------------------------------------------------

  // Cápsula convexa (monotone chain / Andrew's algorithm).
  function convexHull(points) {
    const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const n = pts.length;
    if (n < 3) return pts;
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = n - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  function polygonPerimeter(poly) {
    let per = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      per += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return per;
  }

  function polygonArea(poly) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    return Math.abs(area) / 2;
  }

  function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  }

  // Simplificación de Douglas-Peucker: reduce un contorno a sus vértices
  // "reales", absorbiendo ruido de píxeles y ligeras irregularidades
  // (equivalente a lo que hace approxPolyDP en OpenCV).
  function douglasPeucker(points, epsilon) {
    if (points.length < 3) return points;
    let dmax = 0, index = 0;
    const first = points[0], last = points[points.length - 1];
    for (let i = 1; i < points.length - 1; i++) {
      const d = perpendicularDistance(points[i], first, last);
      if (d > dmax) { dmax = d; index = i; }
    }
    if (dmax > epsilon) {
      const left = douglasPeucker(points.slice(0, index + 1), epsilon);
      const right = douglasPeucker(points.slice(index), epsilon);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  function simplifiedVertexCount(hull) {
    if (hull.length < 3) return hull.length;
    const perimeter = polygonPerimeter(hull);
    const epsilon = Math.max(1.5, perimeter * 0.025);
    const closed = hull.concat([hull[0]]);
    const simplified = douglasPeucker(closed, epsilon);
    return Math.max(1, simplified.length - 1);
  }

  // Rectángulo de área mínima mediante "rotating calipers": prueba un
  // rectángulo alineado a cada arista de la cápsula convexa y se queda
  // con el de menor área. A diferencia de un bounding box alineado a los
  // ejes, esto SÍ reconoce correctamente un cuadrado/rectángulo rotado.
  function minAreaRect(hull) {
    let best = null;
    for (let i = 0; i < hull.length; i++) {
      const p1 = hull[i], p2 = hull[(i + 1) % hull.length];
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const cos = Math.cos(-angle), sin = Math.sin(-angle);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of hull) {
        const rx = p.x * cos - p.y * sin;
        const ry = p.x * sin + p.y * cos;
        if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
      }
      const w = maxX - minX, h = maxY - minY;
      const area = w * h;
      if (!best || area < best.area) best = { area, w, h, angle, cos, sin, minX, minY };
    }
    return best;
  }

  // Devuelve las 4 esquinas del rectángulo mínimo, en coordenadas de imagen
  // (útil para dibujar el contorno real, no solo una caja alineada).
  function rectCorners(rect) {
    const cosA = Math.cos(rect.angle), sinA = Math.sin(rect.angle);
    const local = [
      { x: rect.minX, y: rect.minY },
      { x: rect.minX + rect.w, y: rect.minY },
      { x: rect.minX + rect.w, y: rect.minY + rect.h },
      { x: rect.minX, y: rect.minY + rect.h },
    ];
    // deshace la rotación (rotamos con -angle antes; ahora aplicamos +angle)
    return local.map(p => ({
      x: p.x * cosA - p.y * sinA,
      y: p.x * sinA + p.y * cosA,
    }));
  }

  // ------------------------------------------------------------------
  // 4) Clasificación de forma usando geometría real (tolera rotación,
  //    esquinas redondeadas y trazos imperfectos/manuales).
  // ------------------------------------------------------------------

  function classifyShape(area, hull) {
    const hullArea = polygonArea(hull);
    const solidity = hullArea > 0 ? area / hullArea : 0; // 1.0 = totalmente convexo

    const rect = minAreaRect(hull);
    const rectArea = Math.max(rect.w * rect.h, 1);
    const rectExtent = area / rectArea;      // qué tanto llena su rectángulo mínimo
    const aspect = rect.w / Math.max(rect.h, 0.001);
    const aspectNorm = aspect >= 1 ? aspect : 1 / aspect;

    const perimeter = polygonPerimeter(hull);
    // Razón isoperimétrica (4πA/P²): 1.0 para un círculo perfecto, ~0.785
    // para un cuadrado, ~0.6 para un triángulo equilátero. A diferencia de
    // comparar radios desde el centroide, esto SÍ distingue un círculo de
    // un cuadrado (las 4 esquinas de un cuadrado están igual de lejos del
    // centro que los puntos de un círculo, así que esa métrica no sirve).
    const circularity = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 0;

    // La cantidad de vértices tras simplificar (Douglas-Peucker) es la
    // señal más confiable: un círculo -incluso a mano- conserva muchos
    // vértices al simplificar porque su contorno curva en todas
    // direcciones; un polígono con lados rectos colapsa a sus esquinas
    // reales sin importar rotación ni tamaño.
    const vertexCount = simplifiedVertexCount(hull);

    // 1) Pocos vértices + buen llenado de su rectángulo mínimo -> polígono
    //    de lados rectos (cuadrado/rectángulo), tolera esquinas redondeadas
    //    (que agregan 1-2 vértices extra) y cualquier rotación.
    if (vertexCount <= 6 && rectExtent > 0.78 && solidity > 0.85) {
      const type = (aspectNorm <= 1.15) ? 'cuadrado' : 'rectangulo';
      return { type, rect, solidity, vertexCount };
    }

    // 2) Triángulo: 3 vértices, o llena ~35-65% de su rectángulo mínimo.
    if (vertexCount <= 3 || (rectExtent > 0.35 && rectExtent <= 0.65 && solidity > 0.85)) {
      return { type: 'triangulo', rect, solidity, vertexCount };
    }

    // 3) Círculo: muchos vértices tras simplificar + razón isoperimétrica
    //    alta. Tolera trazos a mano (no exige un círculo perfecto).
    if (vertexCount >= 6 && circularity > 0.80 && solidity > 0.85) {
      return { type: 'circulo', rect, solidity, vertexCount };
    }

    // 4) Cualquier otro polígono convexo/irregular.
    return { type: 'poligono', rect, solidity, vertexCount };
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

      const bPoints = boundaryPoints(c.pixels, mask, width, height);
      if (bPoints.length < 3) continue;
      const hull = convexHull(bPoints);
      if (hull.length < 3) continue;

      const { type: shapeType, rect, solidity, vertexCount } = classifyShape(c.area, hull);
      if (targetShape !== 'auto' && shapeType !== targetShape) continue;

      const perimeterPx = polygonPerimeter(hull); // más preciso que el conteo de píxeles
      const corners = rectCorners(rect);
      // El ángulo debe corresponder siempre al lado LARGO (rectW), sin
      // importar si el algoritmo de rotating calipers probó el lado
      // corto primero.
      const longAxisAngle = (rect.w >= rect.h) ? rect.angle : rect.angle + Math.PI / 2;

      shapes.push({
        shapeType,
        areaPx: c.area,
        perimeterPx,
        rectW: Math.max(rect.w, rect.h),
        rectH: Math.min(rect.w, rect.h),
        rectAngle: longAxisAngle,
        corners,           // 4 esquinas del rectángulo mínimo (para dibujar aunque esté rotado)
        hull,               // cápsula convexa completa (para dibujar círculos/polígonos con su forma real)
        solidity, vertexCount,
        minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY,
        cx: (c.minX + c.maxX) / 2, cy: (c.minY + c.maxY) / 2,
      });
    }

    shapes.sort((a, b) => b.areaPx - a.areaPx);
    return shapes.slice(0, maxShapes);
  }

  return {
    detectShapes, detectGridPxPerCm, toGrayscale, boxBlur3, otsuThreshold, binarize, connectedComponents,
    convexHull, minAreaRect, douglasPeucker,
  };
})();

if (typeof module !== 'undefined') module.exports = ShapeDetector;
