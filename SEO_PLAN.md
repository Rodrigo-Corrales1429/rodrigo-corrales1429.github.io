# Plan SEO y arquitectura de adquisición orgánica

## Principios de publicación

- Una URL corresponde a una intención útil y diferenciada.
- No se publica una página si solo repite el contenido de su división.
- Los datos estructurados deben coincidir con el HTML visible y con la fuente comercial vigente.
- Precio, moneda, inventario, SKU, envíos y devoluciones solo se declaran cuando están confirmados.
- Los modelos de Valquiria Dental se describen siempre como material didáctico, no como dispositivos médicos ni productos para uso en pacientes.
- Toda URL indexable debe recibir enlaces HTML normales y devolver contenido útil sin depender del router por hash.

## URLs actuales — Fase 1

| URL | División | Intención primaria | Intención secundaria | Tipo de página | Estado | Schema | CTA | Enlaces internos recomendados |
|---|---|---|---|---|---|---|---|---|
| `/` | Holding | conocer Valquiria Inc. | navegar a división o catálogo | corporativa | Implementada | `Organization`, `WebSite` | explorar división / catálogo | todas las divisiones y `/catalogo/` |
| `/dental/` | Dental | modelos dentales para práctica | endodoncia, pulpotomía, tipodonto, docencia | división comercial | Implementada | `WebPage`, `BreadcrumbList` | abrir catálogo / cotizar | `/catalogo/` y futuras páginas de producto |
| `/catalogo/` | Dental | catálogo de modelos dentales | compra, mayoreo, distribución | colección transaccional | Implementada | `CollectionPage`, `BreadcrumbList` | comprar / cotizar mayoreo | `/dental/` y futuras páginas de producto |
| `/ia/` | IA | inteligencia artificial para empresas | automatización, agentes, visión, datos | división comercial | Implementada | `Service`, `BreadcrumbList` | solicitar diagnóstico | futuras páginas de solución |
| `/3d/` | 3D | impresión 3D profesional | prototipado, FDM, resina, series cortas | división comercial | Implementada | `Service`, `BreadcrumbList` | cotizar pieza | futuras páginas de servicio |
| `/pack/` | Pack | empaques termoformados a medida | blíster, charola, molde, prototipo | división comercial | Implementada | `Service`, `BreadcrumbList` | cotizar empaque | futuras páginas de servicio |
| `/lux/` | Lux | lámparas e iluminación impresa | personalización, interiorismo, series cortas | división comercial | Implementada | `Service`, `BreadcrumbList` | plantear proyecto | `/3d/` cuando el contexto sea manufactura |

## Fase 2 priorizada

### Prioridad 1 — Valquiria Dental

| URL | Intención primaria | Tipo | Estado | Schema previsto | CTA | Enlaces internos |
|---|---|---|---|---|---|---|
| `/dental/dientes-endodoncia/` | comprar dientes para practicar endodoncia | producto | Pendiente; existe SKU `ValEnd` | `Product`, `Offer`, `BreadcrumbList` | comprar / mayoreo | `/dental/`, `/catalogo/`, productos relacionados |
| `/dental/dientes-pulpotomia/` | comprar dientes para práctica de pulpotomía | producto | Pendiente; existe SKU `ValPulpo` | `Product`, `Offer`, `BreadcrumbList` | comprar / mayoreo | `/dental/`, `/catalogo/`, endodoncia |
| `/dental/dientes-tipo-nissin/` | dientes compatibles con tipodonto Nissin | producto | Pendiente; existe SKU `Endotnissin` | `Product`, `Offer`, `BreadcrumbList` | comprar / confirmar compatibilidad | `/dental/`, `/catalogo/`, endodoncia |
| `/dental/kit-32-dientes-realistas/` | kit de 32 dientes para práctica | producto | Pendiente; existe SKU `DientesRealistas` | `Product`, `Offer`, `BreadcrumbList` | comprar / mayoreo | `/dental/`, `/catalogo/`, endodoncia |
| `/dental/modelos-dentales-universidades/` | modelos dentales para universidades | solución B2B | Pendiente de validar proceso y condiciones | `Service`, `BreadcrumbList` | solicitar cotización institucional | productos Dental y `/dental/` |

Antes de publicar `Product` + `Offer`, la página debe leer o generar sus datos desde la misma fuente que el catálogo. No se copiarán manualmente precio o stock sin un mecanismo de sincronización.

### Prioridad 2 — Valquiria Pack

| URL | Intención primaria | Tipo | Estado | Schema previsto | CTA | Enlaces internos |
|---|---|---|---|---|---|---|
| `/pack/empaques-termoformados/` | fabricante de empaques termoformados | servicio | Pendiente | `Service`, `BreadcrumbList` | solicitar cotización | `/pack/`, blíster, charolas |
| `/pack/blister-personalizado/` | blíster personalizado | servicio | Pendiente | `Service`, `BreadcrumbList` | enviar dimensiones y cantidad | `/pack/`, empaques a medida |
| `/pack/charolas-termoformadas/` | charolas termoformadas a medida | servicio | Pendiente | `Service`, `BreadcrumbList` | cotizar charola | `/pack/`, empaques a medida |
| `/pack/empaques-a-la-medida/` | empaque a la medida para producto | servicio | Pendiente; evitar solapamiento con la página general | `Service`, `BreadcrumbList` | iniciar proyecto | `/pack/`, blíster, charolas |

Cada página deberá documentar únicamente materiales, proceso de molde, prototipo y tirajes confirmados. No se publicará una cantidad mínima sin fuente comercial.

### Prioridad 3 — Valquiria IA

| URL | Intención primaria | Tipo | Estado | Schema previsto | CTA | Enlaces internos |
|---|---|---|---|---|---|---|
| `/ia/automatizacion-empresas/` | automatización con IA para empresas | solución | Pendiente | `Service`, `BreadcrumbList` | solicitar diagnóstico | `/ia/`, agentes, análisis |
| `/ia/agentes-ia/` | agentes de IA para atención y procesos | solución | Pendiente | `Service`, `BreadcrumbList` | revisar proceso | `/ia/`, automatización |
| `/ia/vision-computadora/` | visión por computadora para inspección | solución | Pendiente | `Service`, `BreadcrumbList` | evaluar caso de uso | `/ia/`, análisis de datos |
| `/ia/analisis-datos/` | análisis de datos y anomalías con IA | solución | Pendiente | `Service`, `BreadcrumbList` | definir métrica | `/ia/`, automatización, visión |

El contenido debe describir problema, usuario, proceso, entregable, métrica, límites y CTA. No se publicarán porcentajes de ahorro, precisión o productividad sin evidencia.

### Prioridad 4 — Valquiria 3D

| URL | Intención primaria | Tipo | Estado | Schema previsto | CTA | Enlaces internos |
|---|---|---|---|---|---|---|
| `/3d/impresion-3d-profesional/` | contratar impresión 3D profesional | servicio | Pendiente | `Service`, `BreadcrumbList` | cotizar archivo | `/3d/`, resina, prototipado |
| `/3d/prototipado-rapido/` | servicio de prototipado rápido | servicio | Pendiente | `Service`, `BreadcrumbList` | revisar prototipo | `/3d/`, impresión profesional |
| `/3d/impresion-resina/` | impresión 3D en resina | servicio | Pendiente | `Service`, `BreadcrumbList` | enviar archivo | `/3d/`, prototipado |
| `/3d/produccion-series-cortas/` | producción de series cortas | servicio | Pendiente | `Service`, `BreadcrumbList` | cotizar lote | `/3d/`, impresión profesional |

### Valquiria Lux

Mantener `/lux/` como única URL indexable hasta contar con un catálogo, materiales, variantes o procesos suficientes para crear páginas independientes. Crear URLs prematuras produciría contenido delgado y competencia interna.

## Preparación internacional

La jerarquía actual permite incorporar después `/en/`, `/en/dental/`, `/en/ai/`, `/en/3d-printing/` y `/en/thermoformed-packaging/`. La implementación futura debe usar traducción localizada, canonicals propios, hreflang recíproco, `x-default` y selector de idioma mediante enlaces; no se redirigirá automáticamente por IP o idioma del navegador.

## Checklist posterior al despliegue

- Abrir cada URL publicada y comprobar respuesta 200, canonical y contenido sin JavaScript.
- Search Console → Inspección de URLs para portada, divisiones y catálogo.
- Solicitar indexación de las URLs prioritarias.
- Enviar o volver a comprobar `https://valquiriainc.com/sitemap.xml`.
- Confirmar la canonical reconocida por Google.
- Ejecutar Rich Results Test para `Organization`, `BreadcrumbList`, `Service` y, en Fase 2, `Product`/`Offer`.
- Probar las tarjetas Open Graph y X/Twitter.
- Revisar Core Web Vitals y Page Experience con datos de campo cuando existan.
- Revisar cobertura de indexación, duplicados y páginas rastreadas no indexadas.
- Comprobar navegación, Asesor, carrito y Mercado Pago después de cada despliegue.
- Revisar precio, stock y disponibilidad estructurada contra la fuente comercial vigente.
