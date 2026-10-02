# Fase 0.3 — E2E observable de carrito

Gate de G-02 sobre el frontend real en Chromium headless. No sustituye una
revisión adversarial ni cierra toda Fase 0. No modifica D-01..D-23.

## Ejecutar desde una instalación limpia

Validado con Node 22.16.0 y `@playwright/test` 1.63.0, fijado en el lockfile.

```bash
npm ci
npm run test:e2e:install
npm run test:e2e
npm test
git diff --check
```

`test:e2e:install` instala únicamente Chromium y sus componentes de Playwright.
La primera instalación requiere acceso a los distribuidores de npm/Playwright.
El runner requiere permiso para iniciar Chromium y escuchar en loopback. En
macOS un sandbox que bloquee MachPortRendezvous o `listen` debe autorizar la
ejecución; no se cambian CSP/CORS para evitar esa restricción del host.
El puerto estático 5174 debe estar libre; no se reutiliza un servidor ajeno.

La validación limpia de esta entrega usó `npm ci` con un caché temporal nuevo
porque el caché global del host tenía un error de permisos. No se modificó ese
caché. Se descargó Chromium nuevamente con `PLAYWRIGHT_BROWSERS_PATH=0` y se
ejecutó la suite completa con esa misma variable, sin depender del browser
preinstalado. Instalación: 126 paquetes, 0 vulnerabilidades reportadas por npm.

## Fronteras reales y simuladas

- `index.html`, catálogo/Pack SEO y assets se sirven sin reescritura desde el repo.
  No se sirve la raíz completa: documentación, `.env` y backend no son assets.
- `server.js` real ejecuta `/api/chat`: schema/dispatcher, resolución de alias,
  `cotizarConCarrito`, estado final, verifier, fallback y `carrito_set` reales.
- Sólo Gemini está simulado mediante el `GEMINI_BASE_URL` ya existente. Emite
  function calls controladas y después texto vacío. El backend debe componer
  desde los resultados autorizados; el mock no fabrica `carrito_final`.
- La URL del backend de producción se intercepta en Playwright. Chat/health/
  envío se reenvían al backend local; pulso se simula; cualquier otra ruta se
  bloquea. No se llama a Render ni a Gemini real.
- `/api/pago` se intercepta ANTES del backend. No crea preferencias, reservas,
  pedidos, cobros ni notificaciones. Se prueba tanto un fallo controlado como
  la confirmación de un total recotizado con payload auténtico simulado.
  Incluso la navegación permitida al checkout es una página interceptada,
  nunca una conexión real con Mercado Pago.
- El proceso backend no hereda el environment del usuario. Usa un cwd temporal
  vacío para que dotenv no lea `.env`, sin credenciales, DB, persistencia o
  webhooks, con avisos silenciados y proveedor de envío `tabla`.
- Se usa el origen de desarrollo 127.0.0.1:5174 ya autorizado por el CORS
  existente. No se usa `bypassCSP`, ni nuevos flags/endpoints de producción.
- Imágenes/fuentes externas se bloquean; aplicación, scene modules, cart,
  storage y checkout siguen siendo el código real. Un contexto nuevo por test
  evita contaminación entre clientes. No se inyecta un reducer falso ni se
  usan test IDs nuevos.

## Cobertura y observabilidad

Cada mutación comprueba petición con carrito actual, runtime `ok`, resultados
de herramientas en orden, `carrito_final`, acción exacta, ausencia de catálogo,
badge, SKU/cantidad del drawer y `localStorage.vq_carrito_v1`. Recarga con
`page.reload()` y vuelve a comprobar los mismos invariantes. Checkout no vacío
captura los items exactos que el navegador enviaría a `/api/pago`; checkout
vacío no tiene botón y los botones históricos no llaman al pago.

Casos:

1. Vaciar Endo ×2 + Pulpo ×1; total autorizado $0.00, sin claim nuevo mientras
   la respuesta está retenida, sin catálogo, persistencia vacía, refresh,
   checkout viejo inerte y segundo vaciado idempotente.
2. Agregar 2 Endo desde vacío; checkout conserva exactamente ValEnd ×2.
3. Quitar Endo sin cantidad; elimina toda la línea y converge a vacío.
4. Quitar Endo de un carrito mixto; conserva sólo Pulpo en UI/storage/checkout.
5. Reemplazo autoritativo por Nissin ×1, sin fusionar líneas viejas.
6. Doble mutación ya soportada: quitar Endo y agregar Nissin. El resultado
   intermedio contiene sólo Pulpo y la segunda operación parte de él.
7. Redirect legacy `/#/catalogo` sigue llevando a la página SEO canónica.
8. Vaciado invalida un enlace de confirmación previamente generado.
9. Reemplazo invalida ese enlace y el siguiente checkout sólo envía Nissin.
10. Sin mutación, confirmar reutiliza el mismo enlace, sin otro `/api/pago`.
11. Mutación mientras checkout está en vuelo: descarta la respuesta vieja,
    sin navegación, enlace obsoleto ni recotización automática.
12. ADV-1: una respuesta de agregar retenida no restaura Endo eliminado
    manualmente; badge/drawer/storage/refresh permanecen vacíos.
13. ADV-1b: una respuesta de vaciar retenida no elimina Pulpo agregado
    manualmente; checkout recibe el carrito nuevo, no el vaciado antiguo.
14. Drawer + botones del chat mientras pago espera: exactamente un POST;
    al resolver con error se permite un reintento explícito.
15. Catálogo abierto por hash dentro de una SPA permanece interactivo al recargar.
16. Catálogo → Pack → refresh permanece SPA; back/forward conservan las vistas.
17. Misma SKU con cantidad distinta invalida la respuesta del Asesor.
18. Mismo número de piezas con SKU distinta también la invalida.
19. Snapshot vacío seguido de un producto nuevo también la invalida.
20. Mismo contenido con orden de inserción distinto acepta la respuesta
    honesta; no es un falso conflicto por orden de JSON.
21. Éxito con confirmación de total libera la guardia global de checkout.
22. Respuesta de checkout invalidada por mutación también libera la guardia;
    sólo un reintento explícito envía los productos nuevos.
23. Una entrada `?ir=catalogo#/pack` prioriza el hash y mantiene la SPA;
    `/catalogo/` y `/pack/` directos conservan URLs y canonicals SEO.

Los conflictos del Asesor muestran exactamente «Tu carrito cambió mientras
respondía; no apliqué ese cambio.», sin cotización vieja, botones derivados ni
una segunda llamada. La comparación común Asesor/checkout utiliza copias
SKU/cantidad ordenadas, no el total de piezas ni el orden del JSON.

El reporte HTML y los adjuntos `cart-convergence.json` contienen la evidencia
por test: request/response, resultados runtime, snapshots DOM/storage y payloads
de checkout con datos sintéticos. Los mensajes de aserción identifican la
frontera que diverge. Trace y screenshot se conservan cuando hay un fallo.
`test-results/` y `playwright-report/` son locales/ignorados. Tanto ellos como
el harness/config quedan excluidos del sitio por Jekyll, con gate de regresión.

## Bugs reproducidos antes de corregir

**Refresh interactivo.** El redirector legacy de `index.html` trataba el hash
que añade `?ir=catalogo` como una visita legacy al recargar. Enviaba al visitante
a `/catalogo/`, página SEO sin carrito/checkout. La regresión de agregar falló
con esa página real. La revisión posterior reprodujo otros dos escapes: un
hash abierto dentro de la SPA sin query y un hash diferente del `ir` inicial.
Ahora la SPA mantiene `ir` al navegar mediante `replaceState`, y un hash válido
prevalece al restaurar; `hashchange` y `popstate` usan el mismo router. No se
añaden entradas artificiales ni se cambia el canonical. Entradas legacy frías
sin marca SPA mantienen su redirect. Se regeneró
el hash CSP con el script existente, sin ampliar permisos.

**Confirmación obsoleta.** El botón `pago-listo` conservaba un enlace de Endo y
permitía navegar tras vaciar/reemplazar, guardando el carrito nuevo junto al
folio viejo. La regresión de vaciado falló al intentar ese salto (bloqueado por
el runner). Ahora el enlace se liga al snapshot exacto solicitado y se rechaza
si las líneas actuales difieren, también si cambiaron durante la petición.
No se introduce versionado general, ni cancelación de reservas, ni recotización
automática; confirmar un carrito sin cambios conserva su comportamiento.

**Respuesta vieja del Asesor.** ADV-1 resucitaba Endo y ADV-1b eliminaba Pulpo
agregado manualmente. Se captura el snapshot antes del primer await y se
compara al recibir la respuesta, antes de pintar texto o ejecutar efectos.
Si difiere, se descarta el payload completo y se sustituye por el aviso neutral;
no se vuelve a ejecutar la intención en el fallback local ni se llama al modelo.
La edición manual continúa disponible mientras el Asesor espera.

**Checkout entre botones.** La reproducción generó tres POST con botones
distintos mientras uno esperaba. La guardia global se adquiere antes del primer
await y se libera en `finally` por éxito, error o invalidación. El mismo `finally`
limpia el timer; el deadline permanece activo hasta consumir el JSON para no
dejar esa guardia bloqueada por un body incompleto. No modifica el backend,
idempotencia o reservas ni hace reintentos automáticos.

## Límites

Este gate cubre Chromium desktop y mutaciones/solicitudes concurrentes de la
pestaña actual. No valida interpretación probabilística de Gemini, pagos reales,
smoke de proveedores de envío, todas las variantes móvil/Safari/Firefox,
sincronización multi-tab ni una migración de los endpoints a servicios SQL.
Una preferencia ya creada no se cancela por esta corrección de UI: sólo deja
de poder confirmarse desde un botón que ya no corresponde al carrito actual.

- Multi-tab: no hay sincronización por evento `storage`. Una pestaña conserva
  su Map en memoria hasta recargar; escrituras de otra pestaña no se reflejan
  inmediatamente y la última escritura puede prevalecer. La guardia de pago
  también es por pestaña, no un lock distribuido. Deuda explícita fuera de fase.
- Cache `vq_envio_v1`: vigencia por CP y edad (6 horas), no por SKU/cantidad.
  Puede reutilizarse un desglose de envío anterior tras cambiar las líneas.
  Checkout recotiza en backend y exige confirmación si cambia el total; no se
  rediseña ese cache aquí. Deuda futura: ligarlo al contenido del carrito.

## Gates verificados

- `npm test`: 570 pasadas, 0 fallidas, exit 0.
- E2E Chromium final: dos ejecuciones consecutivas de 23 pasadas, 0 fallidas,
  exit 0 (3.8 y 3.7 minutos). Incluye intactos los
  11 E2E originales, ya validados anteriormente desde instalación limpia.
- `git diff --check`: sin errores.
- `node scripts/csp-hashes.js`: hash del redirector actualizado; los permisos
  de ejecución siguen iguales. Las advertencias existentes de catálogo SEO
  (hereda `default-src`) y `404.html` (sin CSP declarado) no se ampliaron aquí.

Los intentos bajo sandbox fallaron por DNS/permisos de loopback/MachPort, no
por un gate relajado; se repitieron con permiso de ejecución. Las dos
regresiones originales y las cinco reproducciones de la revisión adversarial
se reprodujeron rojas antes de sus cambios mínimos. La regresión adicional de
back/forward exigió atender `popstate`; el control de orden equivalente compara
texto visible renderizado, no el Markdown crudo del backend.
