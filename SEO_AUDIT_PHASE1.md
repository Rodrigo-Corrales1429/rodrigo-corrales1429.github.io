# Auditoría SEO técnica — Fase 1

- Fecha: 18 de agosto de 2026
- Rama revisada: `seo-clean-routes-v1`
- Pull Request: #1, `SEO: rutas indexables para divisiones de Valquiria`
- Base: `main`
- Estado del PR durante la auditoría: draft, abierto y sin merge

## Alcance

Se revisaron la portada, el router por hash, `404.html`, `robots.txt`, `sitemap.xml`, `CNAME`, los estilos compartidos y las páginas `/dental/`, `/catalogo/`, `/ia/`, `/3d/`, `/pack/` y `/lux/`.

La comprobación incluyó respuesta HTTP local, metadatos, canonicals, headings, enlaces y recursos internos, JSON-LD, navegación, accesibilidad básica y consistencia entre sitemap y URLs canónicas. También se contrastaron los productos y precios visibles con `productos.json`.

## PASS

- Las seis rutas nuevas existen como directorios con `index.html` y responden directamente con HTTP 200.
- Ninguna landing necesita ejecutar JavaScript para mostrar su contenido principal.
- Cada URL tiene `title`, meta description y canonical propios.
- Cada landing tiene un solo H1 y una jerarquía H1 → H2 → H3 lógica.
- `robots.txt` permite rastreo y declara el sitemap canónico.
- `sitemap.xml` contiene exactamente la portada y las seis URLs canónicas de la Fase 1.
- Los JSON-LD son JSON válido y usan `Organization`, `WebSite`, `WebPage`, `CollectionPage`, `Service` y `BreadcrumbList` según el tipo de página.
- Los precios visibles del catálogo coinciden con los precios promocionales actuales de `productos.json`.
- No se detectaron referencias internas rotas en HTML, CSS, favicon o isotipo.
- La portada, Three.js, las animaciones, el Asesor, el carrito, Mercado Pago y el router existente permanecen intactos.
- Las Google Fonts ya incluían `display=swap`; no fue necesario corregir ese punto.

## WARNINGS

- Los precios del catálogo SEO son una copia estática. Deben revisarse cada vez que cambie `productos.json`; en Fase 2 conviene definir una fuente única para contenido y datos estructurados.
- La validación final en GitHub Pages debe comprobar el redirect `/ruta` → `/ruta/`, los códigos HTTP reales y la presentación en dispositivos físicos.
- Rich Results Test y la canonical elegida por Google solo pueden verificarse después del despliegue.
- Las páginas de producto y servicio de intención específica pertenecen a Fase 2; no deben añadirse al sitemap hasta contar con contenido suficiente y verificable.

## BLOCKERS

### Detectado

La portada no enlazaba ninguna URL limpia. Todos sus accesos apuntaban a rutas `#/…`, de modo que la jerarquía `Valquiria Inc. → División` no existía mediante enlaces HTTP normales.

### Corregido en la rama

La portada ahora incluye enlaces HTML rastreables a las cinco divisiones y al catálogo, sin cambiar los portales ni la navegación interactiva existente.

No quedan blockers técnicos conocidos dentro del alcance de Fase 1.

## PROPOSED CHANGES

Los cambios razonables derivados de la auditoría se aplicaron localmente en la rama del PR:

- `index.html`: enlaces limpios desde la holding, descripción más concisa, robots explícito y schema `WebSite`.
- `assets/css/valquiria.css`: foco visible y organización de la navegación adicional del footer.
- `3d/index.html`
- `catalogo/index.html`
- `dental/index.html`
- `ia/index.html`
- `lux/index.html`
- `pack/index.html`
  - títulos más concisos;
  - CSP y política de referrer;
  - skip link;
  - breadcrumbs semánticos;
  - navegación móvil disponible;
  - dimensiones explícitas del isotipo;
  - enlaces consistentes a divisiones y catálogo;
  - Open Graph y X/Twitter con imagen social.
- `assets/css/seo-pages.css`: estilos de foco, breadcrumbs, skip link y navegación móvil horizontal.
- `assets/og-valquiria.png`: tarjeta social 1200 × 630 propia de la marca.
- `404.html`: metadatos y explicación actualizados para una arquitectura híbrida de rutas limpias y router por hash.
- `SEO_PLAN.md`: mapa de intención, estado y siguientes páginas recomendadas.

## Validación previa a merge

- Ejecutar las pruebas existentes del repositorio.
- Volver a recorrer todas las URLs y referencias locales.
- Validar JSON-LD y correspondencia con contenido visible.
- Revisar el diff para confirmar que no hay cambios en lógica de compra, pago o Asesor.
- Probar el PR desplegado en desktop y móvil antes de autorizar merge.

No se hizo merge ni publicación durante esta auditoría.
