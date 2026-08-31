# Reporte de integración 3D

Fecha de validación local: 31 de agosto de 2026.

## Alcance y repositorios

- `valquiria_web_deploy_3` es la carpeta de entrada y no es un repositorio Git.
  Allí permanecen los cuatro GLB master de Tripo, sin modificaciones.
- `rodrigo-corrales1429.github.io` es el repositorio Git conectado a
  `origin/main`. Sólo las copias web optimizadas se añadieron a `assets/`.
- No se hizo deploy, commit ni push.

## Auditoría de la implementación existente

El sitio utiliza una sola infraestructura 3D compartida:

- Three.js `0.170.0` mediante import map, sin bundler.
- `GLTFLoader` con `DRACOLoader`; el decoder Draco se obtiene del mismo CDN de
  Three.js.
- `escena.js` controla WebGL, impresión por capas, recorte, cámara, puntero,
  responsive y `prefers-reduced-motion`.
- `modelo.js` normaliza escala/posición, conserva materiales PBR, muestrea la
  superficie de la malla y conecta la animación.
- `figuras.js` conserva una versión SDF procedural de cada figura. Si falla el
  GLB, Draco o WebGL, el contenido HTML permanece y la escena cae al SDF.
- Las páginas `/dental/`, `/3d/`, `/pack/` y `/lux/` usan
  `division-page.js`, un canvas con dimensiones reservadas, riel de progreso y
  fallback visual. El canvas es decorativo (`aria-hidden="true"`).

Antes de este trabajo, Dental usaba `assets/diente.glb`; 3D, Pack y Lux usaban
únicamente sus SDF de engrane, charola y lámpara. Los nuevos GLB quedaron
conectados sin añadir una segunda librería 3D.

## Inventario de masters

Todos los masters contienen una malla, un material PBR, una primitiva, tres
texturas JPEG 4096×4096 (base color, normal y metallic/roughness) y ninguna
animación.

| Master | Bytes | Triángulos | Vértices | SHA-256 |
| --- | ---: | ---: | ---: | --- |
| `abstract metal sculpture 3d model.glb` | 58,748,068 | 1,994,991 | 1,031,839 | `506974adb61343dd6b21f5308db312f6be6821d0c9e661a144a50b6e1e6b3971` |
| `face shield 3d model.glb` | 57,769,952 | 1,958,666 | 1,017,431 | `3a023e5dbf455598567c32b3698c71ee33b54d61908ac3e5da6d004bec93788e` |
| `tooth with viking helmet 3d model.glb` | 57,348,652 | 1,965,552 | 1,000,787 | `6e108128e4fe84a76ab9a6b9c09bf63422430e3cce2623894c948d04bd3b34ed` |
| `valquiria lux 3d.glb` | 56,392,964 | 1,933,584 | 994,411 | `4c688340cc36603fcad0a643e71032167280a9751ab1fbdfba5064318fa3efb6` |

Las texturas originales requieren aproximadamente 268 MB de VRAM por modelo.
Con 2048×2048, el mínimo estimado baja a unos 67 MB por modelo.

## Método de optimización

Se usó glTF Transform y Meshoptimizer en una instalación temporal, no como
dependencias del sitio:

1. análisis de estructura y atributos;
2. simplificación inteligente con `MeshoptSimplifier.simplifyWithAttributes`,
   ponderando posiciones, normales y UV para evitar deformación de reflejos y
   texturas;
3. compactación, deduplicación y `prune` conservador;
4. resizing Lanczos3 de 4096 a 2048 y JPEG a calidad 90;
5. Draco con posición a 14 bits, normal a 10 bits y UV a 12 bits;
6. validación con glTF Validator y comparación visual master/optimized en el
   mismo renderer Three.js.

La primera simplificación basada sólo en posiciones produjo rugosidad visible
en la escultura de `/3d` y fue descartada. La versión final incluye normales y
UV en la métrica de error. No se usó KTX2 porque el visor actual no configura
`KTX2Loader`; tampoco WebP, para conservar la compatibilidad actual.

## Resultados finales

| Modelo | Tamaño original | Tamaño optimizado | Reducción | Método utilizado | Página | Estado |
| --- | ---: | ---: | ---: | --- | --- | --- |
| Diente vikingo Dental | 57.35 MB | 1.53 MB | 97.33 % | Meshopt con normales/UV a 14 %, 275,176 triángulos; texturas 2048; Draco | `/dental/` | Integrado y validado |
| Escultura generativa | 58.75 MB | 1.62 MB | 97.24 % | Meshopt con normales/UV y límite de error, 248,959 triángulos; texturas 2048; Draco | `/3d/` | Integrado y validado |
| Empaque termoformado | 57.77 MB | 1.58 MB | 97.26 % | Meshopt con normales/UV a 12 %, 235,038 triángulos; texturas 2048; Draco | `/pack/` | Integrado y validado |
| Luminaria Valquiria | 56.39 MB | 1.13 MB | 97.99 % | Meshopt con normales/UV a 10 %, 193,357 triángulos; texturas 2048; Draco | `/lux/` | Integrado y validado |

Dental se dejó intencionalmente en 275,176 triángulos —un 10 % por encima de
la guía interna de 250,000— porque una reducción adicional empezaba a afectar
los cuernos, remaches y transiciones cerámica/metal. El archivo aun queda muy
por debajo del objetivo de 2 MB.

## Integración y rendimiento

- Dental precarga únicamente su GLB porque es el objeto principal del hero.
- 3D, Pack y Lux no precargan el GLB; el HTML y el layout se entregan primero y
  el módulo al final del documento inicia la mejora progresiva.
- Los módulos compartidos usan `v=75` para invalidar la caché anterior; los
  cuatro GLB tienen nombres nuevos y no colisionan con assets publicados.
- El canvas conserva dimensiones CSS estables, por lo que no añade layout
  shift.
- 3D, Pack y Lux conservan su porcentaje de progreso histórico. Se añadió
  holgura al marco de recorte para que ese porcentaje no rebane el modelo
  aprobado.
- Los modelos de taller conservan el giro suave del grupo y la respuesta al
  puntero sin deformar la malla.
- En una comprobación móvil de 390×844, las cuatro páginas quedaron sin
  overflow horizontal, con canvas de 360×340, estado `scene-ready` y cero
  errores o warnings de consola.

## Validación

- glTF Validator: cero errores en los cuatro GLB.
- Aviso no bloqueante: los masters no incluyen tangentes explícitas para sus
  normal maps; Three.js genera el espacio tangente por derivadas, igual que en
  la implementación previa.
- Comparación visual: silueta, curvas, reflejos, cerámica, metal, oro, cuernos,
  banda y remaches conservados.
- Los hashes de los masters se verificaron antes y después del proceso y no
  cambiaron.

## Assets web

| Archivo | SHA-256 |
| --- | --- |
| `assets/dental-viking-web.glb` | `ea54d53a146f20e3b687342eb314b6836525c025f535ff615f610e663b5c8e8a` |
| `assets/valquiria-3d-web.glb` | `291152791fc5a2ee9a58e7a8cdd13bf4bee26d6175e97f6affc547be2dee30ac` |
| `assets/valquiria-pack-web.glb` | `4f515f7c9ed465da68835a81fda30328a9d82420e657ac60df16bb8e26ca1c3f` |
| `assets/valquiria-lux-web.glb` | `8600426dc8d14a0900510c55a4ac69173c144d8cc796e1c253a27b7057824a46` |
