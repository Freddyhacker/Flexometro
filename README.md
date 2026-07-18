# 📐 Medidor de Figuras — cámara en tiempo real

App web de una sola página. No usa librerías externas, no tiene backend y no envía ninguna
imagen a ningún servidor: todo el procesamiento ocurre en el propio navegador (cámara,
detección de figuras y cálculo de medidas).

## Qué hace
- Activa la cámara del celular y detecta en vivo círculos, cuadrados, rectángulos,
  triángulos y otros polígonos.
- Calibración manual: tocas dos puntos de una distancia conocida (por ejemplo un lado de
  una cuadrícula de 1×1 cm, o dos marcas de una regla), indicas cuánto mide en la
  realidad, y la app calcula la escala píxeles → unidad real.
- Muestra diámetro, radio, circunferencia, lados, perímetro y área según la figura,
  en mm, cm o m (selector arriba a la derecha).
- Detecta varias figuras a la vez, siempre que no se toquen entre sí y estén sobre un
  fondo razonablemente uniforme (hoja blanca, mesa lisa, etc.).
- El botón "Fondo oscuro" invierte la detección si tus figuras son claras sobre un
  fondo oscuro (por defecto asume figuras oscuras sobre fondo claro).
- El deslizador de "Sensibilidad" ajusta el tamaño mínimo de figura que se detecta,
  útil para ignorar ruido o detectar objetos muy pequeños.

## Publicarlo en GitHub Pages (sin usar la terminal)

1. Entra a [github.com](https://github.com) y crea una cuenta si no tienes una.
2. Arriba a la derecha pulsa **+** → **New repository**.
   - Nombre: por ejemplo `medidor-figuras`.
   - Marca **Public**.
   - Pulsa **Create repository**.
3. En la página del repo recién creado, pulsa **Add file → Upload files**.
4. Arrastra el archivo `index.html` (el de esta carpeta) y confirma con **Commit changes**.
5. Ve a la pestaña **Settings** del repo → en el menú lateral **Pages**.
6. En "Build and deployment" → **Source**, elige **Deploy from a branch**.
   - Branch: `main`, carpeta `/ (root)`. Guarda.
7. Espera 1–2 minutos y recarga la página de Settings → Pages. Ahí aparecerá el link,
   algo como:

   `https://TU-USUARIO.github.io/medidor-figuras/`

8. Abre ese link en el navegador del celular (Chrome o Safari) y dale a "Activar cámara".
   Puedes guardar el link como acceso directo en la pantalla de inicio.

**Importante:** la cámara solo funciona en conexión **https** (que es justo lo que da
GitHub Pages) o en `localhost`. Abrir el `index.html` directamente como archivo local no
mostrará la cámara en muchos navegadores.

## Cómo calibrar bien
1. Coloca cerca del objeto a medir una referencia de tamaño conocido: una regla, o una
   hoja impresa con cuadrícula de 1×1 cm (o del tamaño que uses).
2. Pulsa **Calibrar escala**.
3. Toca dos puntos en la pantalla que correspondan a una distancia que conoces
   exactamente (por ejemplo, el borde de una celda de la cuadrícula, o 5 cm de la regla).
4. Escribe el valor real y su unidad, confirma.
5. La calibración se guarda en el celular (no se pierde al recargar). Puedes recalibrar
   cuando quieras — por ejemplo si acercas o alejas la cámara, ya que la escala en
   píxeles cambia con la distancia al objeto.

## Limitaciones a tener en cuenta
- Es una app 100% del lado del cliente (sin OpenCV ni ninguna librería), así que la
  detección es geométrica simple (contorno + clasificación por número de vértices y
  circularidad). Funciona mejor con buena luz, fondo uniforme y figuras bien
  diferenciadas del fondo.
- Las figuras no deben tocarse ni superponerse entre sí para que se detecten por
  separado correctamente.
- La calibración es válida mientras no cambies la distancia cámara–objeto.
