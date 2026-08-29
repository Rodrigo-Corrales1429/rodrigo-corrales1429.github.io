# Auditoría del 2026-08-29 — qué se arregló y qué no

Registro de la revisión externa y de lo que se hizo con cada hallazgo.
Se documenta también lo **rechazado**, porque un hallazgo descartado sin
explicación vuelve a aparecer en la siguiente auditoría.

---

## Arreglado

### Seguridad

| # | Hallazgo | Qué se hizo |
|---|---|---|
| C1 | Webhook de pagos aceptaba avisos sin firma | **Falla cerrada**: sin `MP_WEBHOOK_SECRET` responde 503 y manda un aviso urgente. Antes solo advertía y seguía, así que un POST falso podía hacer que se enviara mercancía no pagada. |
| A6 | CORS aceptaba localhost en producción | Con `NODE_ENV=production` solo quedan los orígenes reales. |
| A7 | Token de admin débil | La comparación sigue en tiempo constante (el hash evita filtrar la longitud), y el servidor **avisa al arrancar** si el token tiene menos de 24 caracteres. La defensa real contra fuerza bruta es la longitud, no el hash. |
| A8 | Sin tope agregado del historial | 60 mensajes × 8 partes × 4,000 caracteres = 1.9 MB de prompt legales. Ahora hay tope sumado (`MAX_CARACTERES_HISTORIAL`, 24,000). |
| C4 | CSP con `'unsafe-inline'` | Sustituido por **hashes sha256** por script. Ver más abajo por qué no se hizo como proponía la auditoría. |

### Operación

| # | Hallazgo | Qué se hizo |
|---|---|---|
| C8 | Sin cierre limpio | `SIGTERM`/`SIGINT` terminan lo que está en vuelo antes de salir. Importa sobre todo por el webhook de pagos: un aviso cortado a media respuesta es un pedido sin registrar. |
| C5 | Todo en memoria | `almacen.js`: instantánea en disco con escritura atómica. Los pedidos fuerzan volcado inmediato; lo demás cada 30 s y al cerrar. Un archivo corrupto **no impide arrancar**. ⚠️ Necesita un Persistent Disk en Render o no persiste nada. |
| A3 | Sin control de stock: sobreventa | `inventario.js`: reserva al generar el link de pago, confirma al aprobarse, libera al rechazarse y caduca sola. Antes dos personas compraban la misma última pieza. |
| M9 | Las pruebas usaban canales reales | `AVISOS_SILENCIO=1`. Sin esto, `npm test` con Telegram configurado te mandaba pagos falsos al teléfono. |

### SEO y frontend

| # | Hallazgo | Qué se hizo |
|---|---|---|
| C2 | Search Console sin verificar | Hueco preparado en `index.html` con instrucciones. **Lo tienes que completar tú**: es tu cuenta. |
| A10 | Sin `LocalBusiness` | Añadido con dirección a nivel ciudad, horario, moneda y formas de pago. Sin calle a propósito: publicar un domicilio sin atención al público invita visitas y Google penaliza lo que no puede verificar. |
| A11 | CTA principal era "Ver el catálogo" | Ahora es **"Cotizar ahora"** (el Asesor cotiza cuatro divisiones; el catálogo sirve a una). El catálogo queda de secundario. |
| A5 | Sin desglose de IVA | El carrito y el motor lo muestran. Configurable con `PRECIOS_LLEVAN_IVA`, porque es una afirmación fiscal. |
| M2 | Sin salto al contenido en la home | Añadido, apuntando a `#app`, enfocable y con estilo. |
| M11 | Imagen social de 1 MB | Recomprimida a JPEG: **1,086 KB → 212 KB**. Por encima de 1 MB, WhatsApp y X la degradan o la ignoran. |
| M12 | Sin `hreflang` | `es-mx` + `x-default` en las siete páginas. |
| B1 | Icono de iOS en SVG | iOS ignora el SVG. Generado `apple-touch-icon.png` de 180×180. |
| M1 | Sin PWA | `manifest.webmanifest` enlazado. **Sin service worker a propósito**: uno mal hecho sirve precios cacheados y viejos, que en una tienda es peor que no tener PWA. |
| M7 | Feriados solo hasta 2028 | Ampliados a **2030**, incluido el 1 de diciembre de 2030 (transmisión del Ejecutivo). El servidor avisa 6 meses antes de que caduquen. |
| A1 | Umbral de envío gratis en 5 sitios | No se centralizó (obligaría a una petición extra en el arranque de la página). En su lugar, una prueba compara los cinco y falla si se desincronizan. |

---

## Rechazado, y por qué

### ❌ C3 — "sitemap.xml no existe"

**Sí existe.** Se generó el 2026-08-28 con las 7 rutas, `lastmod`, `changefreq`
y `priority`. La auditoría se hizo sobre una copia anterior del repositorio.

### ❌ C7 — "El timeout de Gemini (45 s) excede el límite de 30 s de Render"

**La premisa es falsa.** Render permite respuestas HTTP largas —del orden de
minutos, no de 30 segundos—. Bajar el timeout a 25 s no arreglaba nada y sí
podía cortar turnos legítimos con varias llamadas a herramientas encadenadas.

Lo que se hizo: dejarlo configurable (`GEMINI_TIMEOUT_MS`) y documentar cuál
es el criterio real, que es la paciencia de una persona, no un límite de la
plataforma.

### ❌ C4 (la solución propuesta) — "mueve el importmap a un `.json` externo"

**Eso rompe la escena 3D.** Los navegadores **no** soportan
`<script type="importmap" src="...">`; los import maps externos se ignoran.
Aplicar ese cambio dejaba el sitio sin Three.js.

Lo que se hizo: hashes sha256 por script, con `scripts/csp-hashes.js` para
regenerarlos y una prueba en `npm test` que falla si se desincronizan. Hace
falta esa prueba porque, en cuanto hay hashes, el navegador ignora
`'unsafe-inline'`: un script editado sin regenerar el hash deja de ejecutarse
**en producción y en silencio**.

```bash
npm run csp:fix
```

### ❌ A9 — "35 console.log en producción"

Son **12**, no 35. Y no son ruido: `[LEAD]`, `[PEDIDO]`, `[webhook]` y
`[config]` son la última red de seguridad documentada en `SEGURIDAD.md` — si
falla el webhook y se reinicia el proceso, ese log es lo único que queda de un
prospecto. Silenciarlos sería quitar el respaldo justo donde más falta hace.

### ❌ A10 (parte) — "no hay BreadcrumbList"

**Sí lo hay**, en las seis páginas de división desde la fase SEO 1. Lo que
faltaba de verdad era `LocalBusiness`, y eso sí se añadió.

### ❌ M13 — "los titles de división son genéricos"

Los siete son únicos y descriptivos. Por ejemplo:
`Empaques termoformados a medida | Valquiria Pack`.

### ❌ M2 (parte) — "no hay skip link"

Ya existía en las seis páginas de división. Faltaba solo en la home, y ahí se
añadió.

### ⚠️ A2 — Pesos de envío

Confirmado como pendiente. **Hay que pesar una caja real de cada SKU** y poner
los valores en `ENVIOS_PESOS_JSON`. Ver `ENVIOS.md §3`.

### ⚠️ La observación sobre XSS que la auditoría no hizo

Se marcó `'unsafe-inline'` de forma genérica, pero no se revisó **la superficie
real de XSS**: cómo se pinta la respuesta del modelo. Está bien resuelta —
`md()` en `assets/js/app.js` escapa primero con `esc()` y solo después aplica
negritas y párrafos, que es el orden correcto—. Se deja anotado para que no se
"arregle" al revés en el futuro.

---

## Lo que sigue pendiente, y depende de ti

1. **Google Search Console** — descomentar la etiqueta en `index.html` con tu
   código, enviar el sitemap y pedir indexación de `/ia/`, `/3d/`, `/pack/`.
2. **UptimeRobot** (gratis) — monitores sobre `/health` y `valquiriainc.com`.
   Sin esto, si el sitio cae un domingo nadie se entera.
3. **Persistent Disk en Render** + `ALMACEN_RUTA` — sin disco, la instantánea
   no persiste.
4. **Pesar los productos** y corregir `ENVIOS_PESOS_JSON`.
5. **Variables en Render**: `NODE_ENV=production`, `LEADS_TOKEN` largo,
   `MP_WEBHOOK_SECRET` (obligatorio ya: sin él el webhook rechaza).

## No se hizo, y es una decisión

- **CI/CD, staging, ESLint/Prettier, pruebas e2e.** Son buenas prácticas, pero
  para un repositorio de un solo desarrollador con 159 pruebas que corren en
  dos segundos, añaden más ceremonia que seguridad. Vale la pena cuando entre
  una segunda persona a tocar el código.
- **Testimonios y prueba social.** Requiere clientes reales dando permiso.
  Inventarlos sería fabricar reseñas.
- **Base de datos.** La instantánea cubre el caso de un solo proceso. Cuando
  haya más de una instancia sirviendo, dos procesos escribiendo el mismo
  archivo se pisan y ahí sí toca Postgres.

---

# Segunda auditoría — el checkout conversacional (rama `asesor-mostrador`)

Revisión externa de la fase «el Asesor es el mostrador». Bloqueó el merge, y
tenía razón: lo que encontró no era robo de credenciales —eso quedó cerrado en
la primera auditoría— sino algo peor de explicar a un cliente. Mentirle sobre
su pago, cobrarle un importe distinto del que vio, o quedarse sin existencias
porque alguien abrió un link y se fue.

## Cerrado en este diff

| ID | Qué pasaba | Qué lo cierra |
|---|---|---|
| **B-01** | `/#/gracias?collection_status=approved&external_reference=VQ-FALSO` decía «Pago confirmado», enseñaba el folio inventado y **borraba el carrito**. | De la URL solo se acepta el folio. El estado lo dice `GET /api/pedido/:folio`, que solo lo sabe por el webhook firmado. Sin confirmación no se afirma nada y no se toca el carrito. Reglas en `assets/js/veredicto-pago.js`, sin DOM, para poder ejecutarlas en pruebas. |
| **B-02** | El webhook respondía 200 **antes** de consultar el pago. Si la API de Mercado Pago fallaba después, el cobro quedaba sin registrar y sin reintento. | Firma → consultar → persistir y avisar → 200. Si algo falla, 5xx y Mercado Pago reintenta. |
| **B-03** | Una sola preferencia apartaba las 27 unidades de un SKU durante 24 h, gratis. | Reserva de 15 min (era 1 440), tope de 6 por producto, 12 por compra y 3 reservas vivas por visitante. El rechazo ofrece el canal de mayoreo. |
| **B-04** | La página cotizaba el envío por código postal y el checkout cobraba una tarifa plana: $15 de diferencia en CP 03330. | `/api/pago` cotiza con el mismo motor que `/api/envio` y devuelve el desglose. Si el total cambia, el front lo enseña y espera confirmación en vez de saltar. |
| **M-01** | Nombre, correo, WhatsApp y domicilio vivían indefinidamente en `localStorage`, también después de pagar. | `sessionStorage`, y se borran al confirmarse el pago. |
| **M-02** | El descuadre se detectaba, se avisaba… y seguía por la ruta de aprobado: descontaba inventario y pedía surtir. | Estado `revision`: sin inventario, sin aviso de preparación, sin contar como venta. |
| **M-03** | Cada reintento de Mercado Pago repetía el aviso. | Idempotencia por `payment_id + estado`. |
| **M-04** | El panel aceptaba el token por `?t=`. | Solo cabecera `X-Leads-Token`. |
| **M-06** | Telegram usa `parse_mode: HTML` e interpolaba datos del comprador sin escapar. Una etiqueta sin cerrar hace que Telegram rechace el mensaje: el aviso de la venta no llega. | Todo lo que no escribe el servidor se escapa. |
| **M-08** | El log volcaba el pedido completo, con correo, teléfono y domicilio. | El log lleva folio, estado, importe y SKUs; el contacto viaja por el webhook, que es quien lo necesita. |

## Segunda vuelta: B-01 y B-03 estaban a medias

La reauditoría los devolvió, y con razón las dos veces.

**B-01 · el `rejected` forjado también mentía.** El `approved` ya no se creía,
pero el `rejected` sí, con el argumento de que «no puede hacer daño: conserva
el carrito y ofrece reintentar». El argumento era falso y el contraejemplo es
el caso más caro que hay:

    la URL dice rejected · el servidor diría approved
    → la página anuncia que el pago falló y ofrece PAGAR OTRA VEZ
    → el cliente paga dos veces lo mismo.

Ahora no hay atajo: se pregunta siempre. Un rechazo de verdad no cuesta la
espera, porque el webhook de Mercado Pago también avisa de los rechazos.

**B-03 · el tope por identidad era fricción, no defensa.** Con 6 por SKU y 3
reservas por identidad, dos identidades dejaban ValEnd en cero: 6+6+6 desde una
y 6+3 desde otra. Un visitante son cinco pestañas o cinco IPs, así que contar
por identidad nunca iba a bastar. Lo que se añadió:

1. **Un techo por producto que no depende de quién pida**
   (`INVENTARIO_FRACCION_RESERVABLE`, 0.5): las reservas SIN PAGAR nunca
   retienen más de la mitad de lo que queda por vender. Con 50 identidades
   distintas pidiendo el máximo, ValEnd conserva 15 de 27 piezas comprables.
   Las ventas confirmadas no cuentan en ese techo: esas son reales.
2. **Una reserva viva por identidad**, y se consigue **reemplazando** la
   anterior en vez de negando la nueva — negar castiga al caso común, que es
   el cliente que deja un pago a medias y vuelve a intentarlo.
3. **`INVENTARIO_MINUTOS_RESERVA` topado a 60 en el código.** Un despliegue no
   limpia el panel de Render: una variable vieja con 1440 devolvía el agujero
   entero sin tocar una línea. Corrígela igualmente en Render — el techo es la
   red de seguridad, no la configuración.

Lo que **no** se hizo: un desafío anti-bot verificado en servidor. Requiere una
cuenta de un tercero (Turnstile, hCaptcha) y meterlo por mi cuenta sería añadir
una dependencia externa al camino del pago sin que nadie lo decidiera. El techo
por producto acota el daño sin depender de eso; el desafío sigue siendo la
palanca siguiente si algún día el apretón de inventario se vuelve rutina — y
ahora hay un aviso, `inventario_apretado`, que dice cuándo pasa.

## Sigue pendiente, y es tuyo

- **M-05 — tope global de gasto en Gemini.** El limitador es por IP y en
  memoria: frena a un visitante, no a mil. Lo que de verdad lo acota es el
  presupuesto de Google. Ver `IA_PRO.md`.
- **M-07 — disco persistente.** Sin `ALMACEN_RUTA`, un reinicio de Render borra
  pedidos, reservas y bitácora. La dirección del fallo es segura —se liberan
  reservas, no se inventa stock— pero un folio olvidado hace que la página de
  gracias diga «no pudimos verificar» a alguien que sí pagó.

## Cómo comprobar que B-01 está cerrado

Con el sitio servido, y con algo en el carrito:

```
/#/gracias?collection_status=approved&status=approved&external_reference=VQ-FALSO1-ABCDEF
```

Debe decir **«No pudimos confirmar tu pago»**, conservar el carrito íntegro y
no enseñar en ninguna parte la frase «Pago confirmado». El mismo ataque, sin
navegador, está en `node test-blindaje-pago.js`.
