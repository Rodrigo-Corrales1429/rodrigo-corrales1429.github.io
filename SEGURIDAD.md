# Seguridad — qué está cubierto y qué no

Este sitio vive en dos sitios distintos y eso decide qué se puede proteger y
dónde:

| Pieza | Dónde corre | ¿Controlas las cabeceras HTTP? |
|---|---|---|
| Sitio (HTML, JS, modelos) | GitHub Pages | **No** |
| API del Asesor y pagos | Render | **Sí** |

Casi todas las respuestas incómodas salen de esa segunda columna.

---

## 1 · El total del pedido no se puede manipular

Es la propiedad más importante de todo el sistema, así que conviene decir
exactamente por qué se sostiene.

El navegador manda **SKUs y cantidades**. Nunca precios. En `/api/pago` se
construye una lista nueva leyendo solo esos dos campos y se descarta el resto
del objeto; los importes se releen del catálogo del servidor.

```js
const items = crudos.map(it => ({ sku: ..., cantidad: it?.cantidad }));
```

Esto no es una validación que alguien pueda esquivar con el payload adecuado:
es que **el dato no se usa**. Puedes abrir la consola, poner
`precio_centavos: 1` en cada línea del carrito y mandarlo: el pago se generará
por el precio correcto, porque ese campo no se lee en ningún punto del camino.

Además, cuando el pago se confirma, el webhook **cuadra** lo cobrado contra lo
que el servidor calculó al crear el link. Si no coinciden, escribe
`⚠️ DESCUADRE` en el log y te dice que no surtas ese pedido.

El mismo principio rige el chat: el carrito que llega del cliente pasa por
`sanearCarrito()`, que lo filtra contra el catálogo real. Solo aporta *qué
había en pantalla*; jamás un precio.

---

## 2 · Entradas

- **`/api/chat`** — `validarHistorial` acepta únicamente partes `{ text }` de
  hasta 4,000 caracteres, máximo 60 mensajes. Esto bloquea el ataque
  interesante: un cliente hostil que inyecte `functionResponse` falsos, o sea,
  resultados de herramientas que nadie ejecutó, para que el modelo se los crea
  como evidencia y cotice a un precio inventado. El frontend legítimo solo
  manda texto, así que todo lo demás se rechaza.
- **Cuerpo** — `express.json({ limit: "100kb" })`.
- **`/api/pago`** — forma del pedido antes de nada (array, 1 a 50 líneas), y
  después el motor valida SKU, stock y cantidades enteras positivas.
- **Datos del comprador** — se recortan y se les quitan los caracteres de
  control antes de viajar a Mercado Pago; el correo con forma inválida se
  descarta en vez de romper la preferencia.
- **Herramientas del modelo** — el dispatcher nunca lanza hacia arriba:
  cualquier error vuelve como `{ ok: false, error }` para que el asesor lo
  explique en su siguiente turno.

---

## 3 · Rate limiting

Dos ventanas por identidad, con topes distintos por endpoint:

| Endpoint | Por minuto | Por día |
|---|---|---|
| `/api/chat` | 15 | 400 |
| `/api/pago` | 6 | 40 |

La ventana diaria existe porque la de minuto sola no protege de nada a largo
plazo: 15 por minuto sostenidas durante un día son **21,600 llamadas al
modelo**, todas dentro del límite y todas en tu factura.

En IPv6 se agrupa por prefijo **/64**. Limitar por dirección exacta sería
decorativo: a un cliente doméstico se le asigna un /64 entero y le basta con
cambiar el último grupo para tener otra dirección.

**Lo que este limitador NO hace, dicho claro:**

- No sobrevive a un reinicio de Render. Un atacante paciente puede esperar a
  un despliegue.
- No se comparte entre instancias. Hoy da igual —hay una sola—, pero el día
  que escales a dos, cada una permitirá el cupo completo.
- No distingue a un humano de un bot con IPs rotativas.

Para lo que sí protege —un bucle de tres líneas apuntando a tu cuota de
Gemini— es suficiente. Cuando el tráfico lo justifique, el orden de las
mejoras es: primero un limitador en el borde (Cloudflare), después Redis.
Meter Redis antes que Cloudflare es pagar por lo que el borde da gratis.

---

## 4 · Cabeceras: lo que se puede y lo que no

### En Render (la API) — control total, ya aplicado

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; ...
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Más CORS con lista blanca de orígenes.

### En GitHub Pages (el sitio) — aquí está el límite real

GitHub Pages **no permite cabeceras personalizadas**. No hay `_headers`, ni
`.htaccess`, ni configuración. Lo único disponible es la CSP en `<meta>`, que
el sitio ya tiene y está bien construida.

Y hay directivas que **en `<meta>` el navegador ignora por especificación**,
no por un descuido:

| Directiva | ¿Sirve en `<meta>`? | Para qué |
|---|---|---|
| `frame-ancestors` | **No** | Clickjacking |
| `X-Frame-Options` | **No** | Clickjacking |
| `Strict-Transport-Security` | **No** | Downgrade a HTTP |
| `report-uri` / `report-to` | **No** | Telemetría de CSP |

Traducido: **hoy el sitio se puede meter en un `<iframe>` ajeno y no hay nada
en el código que lo impida.** El `<meta>` del `index.html` ya lo documenta y
por eso no finge declararlo.

Lo que sí tienes gratis de GitHub Pages: HTTPS con certificado gestionado.
Ten activada la casilla **Enforce HTTPS** en la configuración del repositorio.
Comprueba qué manda de verdad con:

```bash
curl -sI https://valquiriainc.com | grep -i "strict-transport\|x-frame\|content-security"
```

### Lo que requiere un proxy delante (Cloudflare, plan gratuito)

Poner Cloudflare entre el visitante y GitHub Pages es cambiar los nameservers
del dominio; el sitio sigue viviendo en Pages. A cambio obtienes lo que Pages
no puede dar:

1. **Cabeceras propias** vía *Transform Rules → Modify Response Header*:
   `X-Frame-Options: DENY`, HSTS con su `max-age`, `Permissions-Policy`.
   Esto cierra el hueco de clickjacking.
2. **Rate limiting en el borde**, antes de que el tráfico llegue a Render.
   Es el sitio correcto para frenar un bot: cuesta cero de tu CPU.
3. **WAF y protección contra bots**, que es lo que de verdad detiene el abuso
   distribuido que el limitador en memoria no ve.
4. **Ocultar el origen**: hoy `rodrigo-corrales1429-github-io.onrender.com` es
   público y direccionable. Detrás de un proxy puedes exigir que solo entre
   tráfico del borde.

Es la mejora de seguridad con mejor relación coste/beneficio que le queda al
proyecto, y no cuesta dinero. No es urgente hasta que el sitio tenga tráfico
real o dinero pasando por él — que es justo lo que estás por activar.

---

## 5 · Secretos

- `.env` está en `.gitignore`. Lo que se versiona es `.env.example`: nombres,
  ningún valor.
- Los `.glb` de la raíz (~57 MB, la materia prima de los modelos) también se
  ignoran: git guarda cada versión de un binario entera y para siempre.
- **Si una clave se filtra, se rota.** Borrar el archivo no basta: lo que
  entró a git se queda en el historial, y hay rastreadores que escanean GitHub
  en minutos. Gemini y Mercado Pago permiten regenerar la credencial desde su
  panel, y regenerarla invalida la vieja al instante.
- `/api/leads` se protege con `LEADS_TOKEN` por cabecera `X-Leads-Token`,
  comparado en tiempo constante, y responde **404** —no 401— cuando no cuadra:
  un endpoint que no existe no invita a insistir.
- El webhook de pagos valida la firma HMAC de Mercado Pago con
  `MP_WEBHOOK_SECRET`, con ventana de 15 minutos contra reenvíos.

Al arrancar, el servidor audita su propia configuración y escribe en el log lo
que falta. Si ves `⛔` o `⚠️` en la primera pantalla de Render, hay algo
degradado en silencio.

---

## 6 · Lo que queda pendiente, por orden

1. **Cloudflare delante del dominio.** Cierra clickjacking, da rate limiting
   de borde y WAF. Gratis.
2. **`MP_WEBHOOK_SECRET` y `LEADS_WEBHOOK_URL`** en Render. Sin el primero no
   se valida quién avisa de un pago; sin el segundo se pierden prospectos en
   cada reinicio.
3. **Persistencia real de pedidos y leads.** Hoy viven en memoria y en los
   logs. Una hoja de cálculo por webhook ya es infinitamente mejor que nada.
4. **Redis para el rate limiting**, solo si algún día hay más de una instancia.
