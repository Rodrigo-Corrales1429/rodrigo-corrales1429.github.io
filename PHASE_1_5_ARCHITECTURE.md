# Fase 1.5 — arquitectura de convergencia

## Problema actual

Fase 1 dejó dos representaciones de cada división:

- una URL limpia, indexable y útil sin JavaScript (`/dental/`, `/ia/`, `/3d/`,
  `/pack/`, `/lux/` y `/catalogo/`);
- una vista del router histórico por fragmento (`/#/dental`, etc.) que concentra
  la escena Three.js, el riel, el Asesor y el carrito.

La separación obliga a elegir entre contenido indexable y experiencia de marca,
y mantiene enlaces públicos hacia rutas que no son las canónicas. Además, el
canvas de la aplicación histórica ocupa toda la ventana y posiciona el modelo
respecto del texto mediante desplazamientos globales; esa decisión produce
encimamientos cuando cambia el ancho disponible.

## Alcance de este prototipo

Esta rama convierte únicamente `/dental/` en la experiencia maestra. Conserva
el HTML SEO de Fase 1 y lo mejora progresivamente con el molar, la impresión por
capas y el riel existentes. No convierte todavía `/ia/`, `/3d/`, `/pack/` ni
`/lux/`, no crea páginas de producto y no modifica pagos.

## Arquitectura propuesta

Cada división continuará siendo un documento HTML independiente servido por
GitHub Pages. Su contenido comercial, navegación, breadcrumbs, H1, CTA, enlaces
internos y datos estructurados vivirán en el HTML, nunca en la configuración
JavaScript.

La mejora interactiva se divide en capas pequeñas:

1. `escena.js` sigue siendo el motor compartido Three.js y la única fuente de
   la animación de impresión.
2. `figuras.js` y `modelo.js` siguen resolviendo geometría, mallas y fallback
   procedural.
3. `division-config.js` describe solamente montaje visual por división
   (`route`, `figure`, `progress`, `side`, `title`). No contiene copy SEO.
4. `division-page.js` lee `data-division` del documento, inicia la figura, enlaza
   el progreso con el riel y aplica la degradación si WebGL no está disponible.
5. `division-page.css` reserva zonas reales para navegación, riel, canvas y
   contenido sin depender de coordenadas absolutas para el texto.

No se extraen en esta fase el Asesor ni el carrito de `app.js`: ambos están
entrelazados con catálogo, cotización y pago, y separarlos para un solo
prototipo aumentaría el riesgo. Se conservan intactos en la aplicación de
inicio. Dental ofrece acceso limpio al catálogo y un CTA directo a WhatsApp;
el acceso al Asesor se mantiene desde Inicio. La futura convergencia de esos
componentes debe hacerse después de aprobar el patrón Dental, con pruebas de
estado y pago.

## Estrategia de rutas

Las rutas públicas definitivas siguen siendo:

- `/`
- `/dental/`
- `/ia/`
- `/3d/`
- `/pack/`
- `/lux/`
- `/catalogo/`

La navegación principal usa enlaces HTML normales hacia esas rutas. Esto
produce navegación de documento completo y garantiza que cada destino entregue
su HTML estático aun si JavaScript está bloqueado.

Filosofía y Contacto permanecen por ahora como vistas corporativas de la home;
no se crearán URLs indexables nuevas fuera del alcance acordado. No deben
convertirse en páginas canónicas hasta decidir su arquitectura SEO.

### History API

No se incorpora `pushState` en el prototipo. Precargar o intercambiar documentos
podría mejorar la continuidad visual, pero también introduciría dos fuentes de
estado y exigiría restauración de foco, scroll, metadata y errores de red. La
navegación normal es la opción segura para Fase 1.5. Una mejora futura podría
usar View Transitions sobre navegaciones reales, sin convertir el sitio en SPA.

## Estrategia para rutas legacy por `#`

Un script mínimo, ejecutado al inicio de la home, reconoce exclusivamente los
fragmentos históricos conocidos y usa `location.replace()` para llevarlos a su
URL limpia equivalente. El reemplazo evita contaminar el historial y no puede
generar un bucle porque los documentos destino no ejecutan el router legacy.

Los anchors de un mismo documento, por ejemplo `/dental/#modelos`, no son rutas
legacy: permanecen como navegación interna accesible y no son interceptados.

## Motor 3D

Se conserva el molar `assets/diente.glb` y su fallback SDF. El motor se ajustará
de forma retrocompatible para medir el rectángulo real del canvas en vez de
asumir siempre `innerWidth × innerHeight`. En la home ese rectángulo continúa
siendo la ventana completa; en Dental es la celda reservada del hero.

La carga se realiza con un script `type="module"`, después de que el navegador
ya dispone del HTML. El canvas tiene dimensiones CSS estables desde el primer
render y es decorativo (`aria-hidden="true"`). Si Three.js, la malla, Draco o
WebGL fallan, el texto y los CTA permanecen; el módulo oculta únicamente la
capa visual fallida. `prefers-reduced-motion` continúa usando la ruta ya
soportada por el motor para presentar el objeto sin la animación completa.

Para evitar doble descarga, la URL de la malla será absoluta y cualquier
preload conservará el mismo modo CORS que GLTFLoader. Dental no precargará
figuras de otras divisiones.

## Layout desktop

El hero de Dental usa grid con tres áreas explícitas:

| Área | Función |
|---|---|
| Riel | progreso de fabricación y lectura de capa |
| Escena | canvas y estado alternativo de WebGL |
| Contenido | marca, H1, resumen y CTA |

El canvas queda contenido y recortado por la celda de escena. El contenido no
se superpone al modelo y conserva un ancho de lectura estable. La subnavegación
Dental usa anchors del mismo documento.

## Layout móvil

El orden del DOM y del grid será:

1. marca/división;
2. H1;
3. resumen;
4. escena 3D con riel compacto;
5. CTA;
6. contenido extendido.

El canvas tiene una altura reservada y ancho máximo de `100%`. Las cuadrículas
de contenido y productos pasan a una columna. Ningún componente usa un ancho
basado en viewport que pueda superar al contenedor.

## Riel

El riel no controla la animación: observa `escena.alProgresar()` y presenta el
porcentaje, milímetros y número de capa calculados por el motor. Si JavaScript
no inicia, permanece oculto y no deja un espacio vacío. En movimiento reducido
se presenta el estado final, no un progreso perpetuo.

## Degradación sin JavaScript

El HTML inicial contiene todo lo necesario para entender y convertir:

- metadata y canonical;
- navegación y breadcrumbs;
- “Valquiria Dental”, H1 y resumen;
- CTA a catálogo y WhatsApp;
- tecnología, casos de entrenamiento y audiencias;
- los cuatro productos reales, enlazados a `/catalogo/`;
- declaración de material didáctico.

La clase de mejora se añade sólo después de iniciar el módulo. Sin ella, el
hero usa el espacio visual como una composición gráfica estática, sin mensaje
de error ni contenido vacío visible.

## Teléfono

El teléfono permanece incrustado en HTML y en los módulos que lo consumen para
no añadir una petición o dependencia runtime. Una prueba de repositorio define
el teléfono oficial visible y el valor `wa.me`, normaliza los archivos públicos
y falla si encuentra el número anterior o una variante inconsistente. Para el
próximo cambio se actualizan esos dos valores esperados y todas las referencias
señaladas por la prueba; así el cambio es simple, explícito y verificable.

## Pack y Lux

Los modelos actuales no se alteran. `division-config.js` reserva las constantes
`PACK_MODEL` y `LUX_MODEL`. En el futuro se sustituye únicamente su valor por la
ruta absoluta del `.glb` aprobado y se declara ese valor en el registro de la
figura correspondiente; no se cambia el layout ni el adaptador de página.
`MODELO.md` documentará requisitos, ubicación y pasos de reemplazo.

## Riesgos y mitigaciones

- **Costo de Three.js y la malla:** se carga después del HTML y sólo Dental
  solicita el molar.
- **Cambios en el motor compartido:** las medidas por canvas son
  retrocompatibles y se cubren con las pruebas 3D existentes.
- **WebGL o Draco no disponibles:** malla → SDF → contenido HTML; cada capa es
  una degradación válida.
- **CLS:** el hero y el canvas tienen dimensiones definidas antes de ejecutar
  JavaScript.
- **Navegación duplicada:** los enlaces públicos apuntan a URLs limpias y el
  router por fragmento queda sólo como compatibilidad de entrada.
- **Asesor/carrito:** se conservan en `app.js`; no se modifica su lógica de
  compra ni Mercado Pago en este prototipo.
- **Contenido de producto duplicado:** Dental muestra nombres y descripciones
  breves estables, sin publicar nuevas páginas ni schema `Product`/`Offer`.

## Archivos previstos

| Archivo | Cambio previsto |
|---|---|
| `dental/index.html` | HTML definitivo Dental, metadata preservada, hero, producto y hooks progresivos |
| `assets/css/division-page.css` | layout maestro desktop/móvil, riel y estados de mejora |
| `assets/js/division-config.js` | configuración visual reutilizable y constantes de modelos futuros |
| `assets/js/division-page.js` | adaptador de escena y riel para URLs limpias |
| `assets/js/escena.js` | medición del canvas contenido, sin cambiar la API pública |
| `assets/js/figuras.js` | rutas de malla absolutas para documentos anidados |
| `index.html` | redirección legacy segura, enlaces públicos limpios y teléfono |
| `assets/js/app.js` | teléfono y compatibilidad legacy sin refactor de pagos |
| páginas de división y catálogo | teléfono público actualizado; sin rediseño |
| `server.js`, `conocimiento.js` | teléfono del Asesor actualizado |
| `MODELO.md` | reemplazo futuro de `PACK_MODEL` y `LUX_MODEL` |
| `SEO_PLAN.md` | ubicación futura de fotos reales y prueba social |
| `test-phase-1-5.js`, `package.json` | controles de rutas, HTML, teléfono, overflow, referencias y preservación |

Este documento se creó antes de modificar el código de implementación.
