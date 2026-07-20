# 📐 Medidor — figuras en vivo (100% navegador)

App web que detecta figuras geométricas (círculo, cuadrado, rectángulo,
triángulo) y calcula sus medidas reales en mm/cm/m/in, a partir de una foto
o de la cámara **en vivo**. Todo el procesamiento (detección de formas,
video) corre **dentro del navegador**, en JavaScript puro — sin Python, sin
servidor, sin ningún servicio de terceros. Por eso se puede alojar
directamente en **GitHub Pages**, que te da el link (`usuario.github.io/repo`)
sin depender de nada externo.

## Cómo subirla a GitHub Pages

1. Crea un repositorio en GitHub y sube estos archivos:
   `index.html`, `style.css`, `detector.js`, `app.js`.
   ```bash
   git init
   git add .
   git commit -m "Medidor de figuras"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
   (o arrastra los archivos desde la web de GitHub: "Add file" → "Upload files")

2. En el repo, ve a **Settings → Pages**.
   - En "Source" elige la rama `main` y la carpeta `/ (root)`.
   - Guarda. En 1-2 minutos tu app estará en:
     `https://TU_USUARIO.github.io/TU_REPO/`

3. Abre esa URL desde el celular (Chrome/Safari). El acceso a la cámara
   requiere HTTPS — GitHub Pages ya sirve todo por HTTPS, así que funciona
   directo. Puedes usar "Agregar a pantalla de inicio" para que se sienta
   como una app nativa.

No hay build, no hay `npm install`, no hay backend: son 4 archivos estáticos.

## Cómo probarla en tu computadora antes de subirla

Solo ábrela con un servidor local simple (algunos navegadores bloquean
`file://` para la cámara):
```bash
python3 -m http.server 8000
# o: npx serve
```
Y entra a `http://localhost:8000`.

## Funciones

### Calibración por 2 puntos
En vez de depender de detectar automáticamente una cuadrícula, tocas (o
haces click en) dos puntos de los que sepas la distancia real —por
ejemplo dos esquinas de un cuadro de tu papel cuadriculado— y escribes esa
distancia. Es más preciso y más rápido que un detector automático de
cuadrícula, y funciona igual con cualquier tamaño de cuadro.

### Selección de área (ROI)
Con el botón **▭ Área** puedes arrastrar (con el dedo o el mouse) un
rectángulo sobre la foto o el video para limitar dónde se buscan figuras.
Útil si hay ruido/objetos alrededor que no quieres que interfieran, y
además acelera la detección en video en vivo (menos píxeles que procesar).

### 🎥 Cámara en vivo, estabilizada
- El video se procesa localmente cada ~220 ms.
- Para evitar que las cajas y las medidas "tiemblen" por micro-movimientos
  de la mano o ruido de la cámara, la app:
  - aplica un suavizado (blur 3×3) a cada cuadro antes de detectar, y
  - seguimiento entre cuadros: cada figura se empareja con la del cuadro
    anterior por cercanía, y su posición/tamaño se promedia con suavizado
    exponencial en vez de "saltar" a cada nueva lectura.
  - una figura solo cambia de tipo (p. ej. círculo → polígono) si esa
    nueva clasificación se repite en 2 cuadros seguidos, para que no
    parpadee la etiqueta por una lectura aislada.
  - si una figura se pierde por 1-3 cuadros (por ejemplo tapada un
    instante), se mantiene su última posición conocida en vez de
    desaparecer y reaparecer bruscamente.
- La calibración se hace **congelando** un cuadro (botón "Congelar y
  calibrar"), tocando los 2 puntos ahí, y reanudando. Así evitas que la
  mano tiemble justo mientras marcas los puntos.

### Cámaras USB / externas
**Sí es posible.** El navegador no distingue "cámara interna" de "cámara
USB": si tu sistema operativo reconoce la cámara USB como un dispositivo
de video estándar (la gran mayoría de webcams USB son clase UVC y no
necesitan drivers), el navegador la ve igual que la cámara integrada.

- En **computadora** (Windows/Mac/Linux): conecta la webcam USB, dale
  permiso de cámara al navegador, y aparecerá en el selector **"Cámara"**
  que se muestra en la app apenas hay más de una disponible.
- En **celular Android**: si el teléfono soporta USB-OTG y la cámara es
  clase UVC, Chrome para Android suele detectarla igual, apareciendo
  también en ese selector.
- En **iPhone**: Safari generalmente **no** da acceso a webcams USB
  externas (solo a la cámara nativa), salvo excepciones muy puntuales.

La app no necesita configuración especial para esto — el selector de
cámara ya cubre el caso automáticamente.

## Precisión — cosas a tener en cuenta

Este motor de detección está escrito desde cero en JavaScript (sin
OpenCV ni ninguna librería) para que la app no dependa de nada externo.
Es sólido para figuras sólidas de un solo color sobre fondo parejo, pero
tiene límites:
- Clasifica la forma según cuánto llena su caja envolvente (extent), no
  por conteo de vértices — funciona muy bien para círculo/cuadrado/
  rectángulo; el triángulo y polígonos son una aproximación.
- Para triángulos y polígonos no calcula lados individuales (sí área y
  perímetro aproximado), a diferencia de círculo/cuadrado/rectángulo.
- Mejor contraste y luz pareja = mejores resultados.

## Estructura del proyecto

- `index.html` — estructura de la página.
- `style.css` — estilos (sin fuentes ni imágenes externas).
- `detector.js` — motor de visión por computadora (escala de grises,
  blur, umbral automático, componentes conexas, clasificación de forma).
- `app.js` — interfaz, calibración, selección de área, cámara en vivo y
  estabilización.

## Ideas para mejorar más adelante

- Guardar/exportar historial de mediciones (CSV).
- Detección de más formas (pentágono, hexágono, óvalo).
- Modo "varias calibraciones guardadas" para cambiar de escala rápido.
