# Mini Desktop

Mini entorno de escritorio como PWA: Bloc de notas, Lector de PDF, Hoja de
cálculo, Reproductor de video y Reproductor de audio, dentro de un
"escritorio" falso con barra de tareas, pensado para usar con teclado +
mouse Bluetooth y una pantalla externa.

## Estructura del repo

```
mini-desktop/
├── index.html          shell: escritorio, slots, barra de tareas
├── manifest.json        metadatos de la PWA (icono, nombre, id)
├── service-worker.js     caché para que funcione offline
├── css/style.css         estilo blanco y negro tipo Windows 95/98
├── js/shell.js           gestor de ventanas (slots, minimizar, cerrar)
├── js/app-notepad.js     mini-app: bloc de notas (UTF-8)
├── js/app-sheet.js       mini-app: hoja de cálculo (fórmulas + filtros)
├── js/app-pdf.js         mini-app: lector de PDF (varias pestañas)
├── js/app-video.js       mini-app: reproductor de video
├── js/app-audio.js       mini-app: reproductor de audio (segundo plano)
└── icons/                iconos de la PWA (192px y 512px)
```

## Publicarla en GitHub Pages

1. Crea en GitHub un repositorio público llamado exactamente **`mini-desktop`**
   (si usas otro nombre, tienes que cambiar `id`, `start_url` y `scope` en
   `manifest.json` por la ruta real, ver más abajo).
2. Sube todo el contenido de esta carpeta a la rama `main`, en la raíz del
   repo (no dentro de una subcarpeta).
3. Ve a **Settings → Pages**, en "Source" elige la rama `main` y la carpeta
   `/ (root)`. Guarda.
4. En un par de minutos tu app queda publicada en:
   `https://TU-USUARIO.github.io/mini-desktop/`
5. Ábrela desde Chrome en tu teléfono y usa "Agregar a pantalla de inicio" /
   "Instalar app" para instalarla como PWA.

### Sobre el `id` del manifest (para que no salga "ya instalada")

`manifest.json` ya trae:

```json
"id": "/mini-desktop/",
"start_url": "/mini-desktop/",
"scope": "/mini-desktop/"
```

Esto es importante porque GitHub Pages aloja todos tus repos bajo el mismo
dominio (`tu-usuario.github.io`). Si el `id` fuera algo ambiguo como `"./"`,
Chrome puede confundir esta PWA con otra que hayas instalado desde ese mismo
dominio y mostrar "ya instalada" aunque nunca la hayas instalado. Con un
`id` explícito que incluye la ruta real del repo, ese choque desaparece.

Si en algún momento cambias el nombre del repositorio, recuerda actualizar
esas tres líneas con la ruta nueva.

## Qué puede hacer cada mini-app (y qué no)

**Bloc de notas**
- Abre y escribe texto en UTF-8 (no soporta ANSI, por decisión explícita
  para mantenerlo simple).
- "Descargar" genera un archivo `.txt` nuevo; **no sobrescribe** el archivo
  original que abriste (Android no permite eso de forma confiable desde un
  navegador). Si quieres reemplazar el original, hazlo tú mismo desde tu
  gestor de archivos después de descargar.
- Mientras escribes, el texto se autoguarda dentro de la propia app (para
  que sobreviva a minimizar o recargar), pero eso no es lo mismo que haber
  descargado el archivo.

**Hoja de cálculo**
- Grilla fija de 10 columnas (A-J) × 25 filas.
- Fórmulas soportadas: `+ - * /`, paréntesis, `SUMA(rango o lista)` y
  `BUSCARV(valor, rango, columna)`.
- Filtros: toca el encabezado de una columna para mostrar/ocultar filas
  según sus valores.
- Abre y descarga `.csv` únicamente (no genera `.xlsx`).

**Lector de PDF**
- Solo lectura. Abre varios PDFs a la vez, cada uno en su propia pestaña
  interna.
- Controles simples: página anterior/siguiente y zoom.
- Los PDFs que abres quedan guardados en el propio teléfono (IndexedDB)
  para que, si minimizas o recargas la app, sigan ahí sin tener que volver
  a seleccionarlos. Al cerrar la ventana con la "X" si se eliminan.
- Se renderiza a la resolución real de píxeles de tu pantalla
  (`devicePixelRatio`), no a la resolución "lógica" de CSS, así que se ve
  nítido también en pantallas de alta densidad (la mayoría de teléfonos y
  monitores modernos).

**Reproductor de video**
- Solo lectura. Abre un archivo de video con el selector nativo y lo
  reproduce con los controles propios del navegador (play/pausa, barra de
  progreso, volumen, pantalla completa).
- No se guarda entre recargas completas de la PWA (al ser solo
  reproducción, simplemente vuelves a elegir el archivo).

**Reproductor de audio**
- Solo lectura. Igual que el de video, pero para audio, y con un extra:
  usa la **Media Session API**, así que sigue sonando aunque apagues la
  pantalla o minimices la ventana dentro del escritorio, y además aparecen
  controles de play/pausa en la pantalla de bloqueo / notificaciones de
  Android.
- Este comportamiento de "segundo plano" depende del navegador y de la
  configuración de ahorro de batería de tu teléfono — en la gran mayoría
  de los Android con Chrome funciona bien, pero algunos fabricantes son
  más agresivos cerrando apps en segundo plano.

## El gestor de ventanas, en corto

- Las 3 apps son fijas, no se pueden abrir "varias instancias" de la misma.
- Solo 2 pueden estar visibles a la vez, repartiendo el espacio según el
  botón **"Vista"** de la barra de tareas:
  - **100%**: una sola app ocupa toda la pantalla (la otra se minimiza
    automáticamente, sin perder lo que tenía).
  - **78% / 22%**: una app grande y una pequeña. Al elegir este modo se
    pregunta cuál lado (izquierda o derecha) es el grande.
  - **50% / 50%**: las dos parten el espacio por igual (el modo por
    defecto).
  - El reparto es por **lado físico** (izquierda/derecha), no por app: si
    quieres que el lector de PDF se vea grande en modo 78/22, primero
    marca ese lado como "grande" en el menú Vista y luego abre el PDF ahí
    (o muévelo con el diálogo de reemplazo si ya estaba en el otro lado).
- El icono-dock con los 3 accesos directos queda oculto siempre (tanto en
  horizontal como en vertical) para aprovechar mejor el espacio; las 3
  apps se abren igual desde el botón **"Inicio"**.
- "_" minimiza (el contenido sigue vivo, solo se oculta).
- "X" cierra de verdad: se pierde lo que tenía cargado esa app (por eso
  pregunta primero si hay cambios sin descargar).
- En modo 78/22 o 50/50, si ya hay 2 ventanas abiertas y abres una
  tercera, te pregunta cuál de las dos visibles quieres reemplazar.

## Sobre PDF.js y el modo offline

El lector de PDF usa la librería [PDF.js](https://mozilla.github.io/pdf.js/)
de Mozilla, cargada desde un CDN público (cdnjs) en vez de venir incluida en
el repo. Esto significa:

- La **primera vez** que abras un PDF necesitas conexión a internet (para
  que el navegador descargue esa librería).
- El resto de la app (bloc de notas, hoja de cálculo, el escritorio en sí)
  funciona completamente offline después de la primera visita, gracias al
  `service-worker.js`.
- Si cdnjs llegara a retirar esa versión en el futuro, el lector de PDF
  dejaría de cargar hasta que actualices la URL en `index.html` y
  `js/app-pdf.js` (busca `pdf.js/2.16.105`) a una versión vigente — puedes
  verificarla en <https://cdnjs.com/libraries/pdf.js>.

**Si quieres que el lector de PDF funcione 100% offline desde ya:**
1. Desde un computador con internet, descarga la carpeta `build/` del
   paquete `pdfjs-dist` (por ejemplo con `npm install pdfjs-dist`, o desde
   los releases de <https://github.com/mozilla/pdf.js>).
2. Copia `pdf.min.js` y `pdf.worker.min.js` a una carpeta `lib/` dentro de
   este repo.
3. En `index.html`, cambia la línea del `<script src="https://cdnjs...">`
   por `<script src="lib/pdf.min.js"></script>`.
4. En `js/app-pdf.js`, cambia la URL del `workerSrc` por `'lib/pdf.worker.min.js'`.
5. Agrega esas dos rutas (`lib/pdf.min.js`, `lib/pdf.worker.min.js`) a la
   lista `APP_SHELL` de `service-worker.js`.
6. Sube `CACHE_VERSION` en `service-worker.js` (explicado abajo) y vuelve a
   publicar.

## Actualizar la app después de hacer cambios

Cada vez que edites cualquier archivo y lo subas a GitHub, abre
`service-worker.js` y sube el número de `CACHE_VERSION` (por ejemplo, de
`'mini-desktop-v1'` a `'mini-desktop-v2'`). Si no haces esto, los teléfonos
que ya instalaron la app pueden seguir viendo la versión vieja por un
tiempo, porque el service worker sirve todo desde su caché local.

## Limitaciones ya conocidas (y aceptadas a propósito)

- No hay "guardar", solo "descargar una versión nueva" — limitación real de
  los navegadores en Android, no un descuido.
- No hay explorador de carpetas en vivo: cada vez que quieras añadir un
  archivo nuevo se abre el selector nativo de Android.
- Las ventanas tienen tamaño fijo (mitad izquierda / mitad derecha de la
  pantalla), no se pueden mover ni redimensionar libremente.
- En pantallas angostas (teléfono en vertical, sin monitor externo) los dos
  paneles se apilan uno encima del otro en vez de lado a lado.
