# Las piezas esculpidas

El sitio dibuja cada figura de dos maneras posibles:

- **SDF** — una función matemática en `assets/js/figuras.js`. Cero kilobytes,
  cero peticiones, y la silueta se afina cambiando un número.
- **Malla esculpida** — un `.glb` en `assets/`. Se declara con el campo `glb`
  en el registro de figuras y **sustituye** a la SDF.

Las dos conviven a propósito: si el `.glb` no llega —conexión mala, WebGL sin
memoria, un archivo que todavía no has subido— la escena cae sola a la figura
procedural y el visitante ve un sitio completo, no un hueco. Esa caída está
probada, no es teórica.

---

## Estado actual

| Figura | Sección | Cómo se dibuja hoy | Veredicto |
|---|---|---|---|
| Valquiria | Hub | **Malla** (`valquiria.glb`, 1.9 MB) | Listo |
| Diente vikingo | Dental | **Malla** (`dental-viking-web.glb`, 1.53 MB) | Listo |
| Cyborg | IA | **Malla** (`cyborg.glb`, 2.2 MB) | Listo |
| Empaque termoformado | Pack | **Malla** (`valquiria-pack-web.glb`, 1.58 MB) | Listo |
| Luminaria | Lux | **Malla** (`valquiria-lux-web.glb`, 1.13 MB) | Listo |
| Escultura generativa | 3D | **Malla** (`valquiria-3d-web.glb`, 1.62 MB) | Listo |

Las mallas de Tripo parten de ~2 M de triángulos y 55–59 MB. Las copias web
pasan por simplificación consciente de normales y UV, resizing de texturas y
Draco. La caída a SDF sigue viva: si un `.glb` no llega, esa sección se dibuja
procedural. Las métricas y hashes de la integración más reciente están en
`MODELOS_3D_REPORTE.md`.

### Por qué se conserva la SDF

Una función de distancia construida con elipsoides y cajas fundidas da muy bien
la **geometría de taller**: un engrane maquinado, una charola termoformada, una
lámpara de peldaños. Son objetos que de verdad están hechos de primitivas.

No da **anatomía** ni **personaje**. El molar de la SDF se lee como una caja
redondeada con dos palillos: las cinco cúspides quedan en bultos, los surcos
oclusales no se resuelven a la escala a la que se ve la pieza, y las raíces
salen como alfileres. La cyborg tiene el mismo techo. Insistir ahí es pulir algo
que no puede llegar al nivel del resto del sitio.

---

## Piezas con requisitos especiales

### 1 · `assets/dental-viking-web.glb` — diente vikingo Dental

Es la pieza que vende la división que **sí** está facturando, así que es la más
importante de las dos.

- **Qué**: el diente con casco vikingo que identifica a Valquiria Dental.
- **Detalles críticos**: silueta del diente, cuernos, casco, banda, remaches y
  separación limpia entre cerámica, metal oscuro y oro.
- **Orientación**: corona y casco hacia **+Y**, frente hacia **+Z**.
- **Escala**: el sitio la normaliza; `encaje` conserva su ancho dentro del hero.
- **Color**: cerámica marfil, metal oscuro reflectante y detalles dorados.

### 2 · `assets/cyborg.glb` — la Valquiria IA

Tu idea es la correcta: **la misma valquiria, con piezas encima**. No un robot
distinto — el mismo personaje, reconocible, aumentado.

- **Base**: la misma figura de `valquiria_cgi.jpg` / `valquiria.glb`.
- **Encima**: placa facial cubriendo media cara con ranura de visor, núcleo
  luminoso en el esternón, costillas de placa en un flanco, hombreras
  angulares en vez de domos, trenza de cable segmentado por la espalda, y las
  alas del yelmo hechas de segmentos separados —datos, no plumas—.
- **Composición**: **busto**, sin piernas. Termina en punta sobre una peana de
  anillos escalonados. No camina, procesa. Si te resulta más fácil entregar la
  figura completa, también sirve: el marco se ajusta con `encaje` y `alza`.
- **Orientación**: cabeza hacia **+Y**, de frente a **+Z**.
- **Color**: el mismo marfil de la armadura, con el metal de las placas más
  frío y el núcleo en el violeta del curado (`#8B6BFF`).

---

## Requisitos técnicos — la lista que importa

Valen para cualquier `.glb` que entre al sitio:

- **Formato** `.glb` binario. Draco en la geometría es bienvenido (el
  decodificador ya está permitido en la CSP).
- **Peso: por debajo de 8 MB.** El de la valquiria pesa 1.9 MB y es el techo
  cómodo. Por encima de 8 MB el móvil sufre.
- **Triángulos: entre 80 k y 250 k.** Por encima de ~200 k no se distingue un
  detalle más a la escala a la que se ve la pieza, y en un teléfono empieza a
  costar cuadros.
- **Texturas a 2048 como máximo**, en JPEG. Tres mapas (color, normal,
  rugosidad) es el estándar de la valquiria actual.
- **De pie, cabeza/corona hacia +Y, de frente a +Z.** El sitio normaliza escala,
  centrado y apoyo — **la rotación no**.
- **Una sola malla o pocas.** Se fusionan al muestrear, pero menos es más
  rápido.

### Si el archivo que te entrega el generador es enorme

Es lo normal. Esta tabla conserva el historial anterior; la corrida actual está
documentada en `MODELOS_3D_REPORTE.md`:

| Pieza | Entrada | Triángulos | Salida | Factor |
|---|---|---|---|---|
| `valquiria.glb` | 59 MB | 1.99 M | 1.9 MB | 31× |
| `diente.glb` | 54.9 MB | 1.99 M → 179 k | **0.98 MB** | 56× |
| `cyborg.glb` | 55.9 MB | 1.96 M → 176 k | **2.18 MB** | 26× |

La receta, con `gltf-transform`, en este orden y por estas razones:

1. **`weld()` primero.** Los generadores entregan la malla sin soldar: vértices
   duplicados en cada costura. Sin soldar, el simplificador no puede colapsar
   aristas a través de ellas y no baja del 60 % por más que se le insista.
2. **Simplificar con posiciones, normales y UV**. En superficies metálicas,
   usar sólo posiciones puede conservar la silueta y aun así deformar reflejos.
3. **`dedup()` y `prune()`** para tirar lo que quedó huérfano.
4. **`textureCompress({ resize: [2048, 2048], quality: 88 })`.**
5. **`draco({ quantizePositionBits: 14 })`** al final. Es lo que convierte
   megabytes de posiciones y normales en cientos de kilobytes.

---

## Cómo declarar una pieza nueva

En `assets/js/figuras.js`, dentro del registro `FIGURAS`:

```js
diente: {
  fn: diente, modo: 3, dist: 5.0, mm: 20.7, nombre: 'Molar',
  glb: DENTAL_MODEL,
  bb: { x0: -.62, x1: .62, y0: -1.10, y1: .90, z0: -.56, z1: .56 }
},
```

### Modelos de 3D, Pack y Lux

Las tres constantes están conectadas en `assets/js/division-config.js` y sus
figuras declaran el `glb` correspondiente en `assets/js/figuras.js`. El
adaptador de página, el riel y el layout no cambiaron; la SDF de cada figura
permanece como fallback. Como sus avances son inferiores a 1, las tres usan
`holgura` para mantener el modelo aprobado por debajo del plano de recorte.

- `glb` — la ruta. Con esto basta.
- `encaje` y `alza` — opcionales. Ajustan la malla al marco de la SDF cuando las
  dos no representan lo mismo. La valquiria los usa (`0.74` y `0.19`) porque su
  SDF reserva el tercio superior del marco para una lanza que la malla no trae;
  sin corregirlo, la pieza salía enorme.
- `holgura` — solo para secciones cuyo `tope` es menor que 1. Estira el marco
  **por encima** de la pieza para que el corte del cabezal caiga en aire y no
  en la malla. Lo necesita la cyborg: `/ia` imprime al 94 % a propósito, y sin
  holgura ese 6 % que falta se lo lleva la cabeza. La cuenta es
  `holgura ≥ 1 / tope` (con `tope` .94 → 1.07, que deja un pelo de margen).
- `solida` — la malla activa el curado por sí sola, pero las figuras de taller
  la conservan para que su SDF fallback también termine como pieza sólida.

### Animación

La malla y su nube de puntos se ven a la vez durante el curado, así que tienen
que moverse **exactamente igual** o el efecto —que son el mismo objeto en dos
estados— se rompe delante del visitante. Eso vive en `animarMallas` de
`modelo.js`, y hoy cubre:

- `modo: 0` — el personaje del hub: respira, cambia el peso de pierna y sigue al
  visitante con la mirada.
- `modo: 4` — la cyborg: levita, la órbita gira más rápido que el cuerpo y el
  núcleo late.
- `modo: 3` — quieta dentro del grupo compartido. El grupo conserva su giro
  lento y la respuesta al puntero; es el modo de Dental, 3D, Pack y Lux.

---

## Tres trampas que ya se pagaron

- **`encajar()` normaliza por ALTURA y nadie comprueba el ANCHO.** Escala con
  `alto / medida.y`, centra en X/Z, y el ancho sale de la proporción de la
  malla. Si la pieza esculpida es más rechoncha que su SDF, se desborda de la
  caja y se mete debajo del texto de la sección. Le pasó al molar: 0.69 de
  ancho por alto contra los 0.62 de la SDF daban 1.38 en una caja de 1.24, con
  el titular sobre marfil brillante. Se corrige con `encaje` —no tocando el
  `bb`, que la SDF sigue usando—. La cuenta es
  `encaje ≤ (ancho_caja / alto_caja) ÷ (ancho_malla / alto_malla)`.

- **El `preload` del `.glb` en `index.html` lleva `crossorigin`.** No es
  decorativo: sin ese atributo el modo de credenciales no casa con el de three,
  el preload se descarta y el archivo se descarga **dos veces**. Chrome lo avisa
  en consola.
- **Nunca quites `blob:` de `connect-src` en la CSP.** GLTFLoader extrae las
  texturas del `.glb` como URLs `blob:`; sin ese permiso la malla carga **gris**.
  Y si dejas de usar Draco, entonces sí puedes quitar `'wasm-unsafe-eval'` de
  `script-src`.

---

## La red de seguridad

Si un `.glb` no llega, la escena vuelve sola a la SDF de `figuras.js`: la misma
coreografía, dibujada con puntos. El visitante ve un sitio completo. Para apagar
**todas** las mallas de golpe —depuración o incidente— está `USAR_MODELO` en
`escena.js`.
