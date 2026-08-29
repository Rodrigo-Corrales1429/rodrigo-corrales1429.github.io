# AVISOS — cómo enterarte de cada venta

> "Siento que si me piden nunca me enteraré y solo caerá dinero."

Este documento arregla eso. Al terminar, tu teléfono suena cuando alguien
paga, y cada noche te llega un resumen de lo que pasó en el sitio.

---

## 1. Qué te avisa, y qué NO

La decisión de diseño más importante del sistema es **no avisarte de todo**.
Un aviso por cada visita convierte el teléfono en ruido, el ruido se silencia,
y a la semana de silenciarlo se te pasa un pago real. Así que hay dos carriles:

### Te interrumpe al momento

| Aviso | Por qué merece interrumpir |
|---|---|
| 💰 **Pago aprobado** | Hay dinero en tu cuenta y una caja que preparar. |
| 🟡 **Pago iniciado** | Alguien se fue al banco. Si no llega el "aprobado" en un rato, es un carrito abandonado que puedes rescatar. |
| 🟠 **Pago pendiente** | SPEI, OXXO o pago en revisión. El dinero NO ha entrado: no lo mandes todavía. |
| 🔴 **Pago rechazado** | Casi siempre es el banco, no el cliente. Escribirle recupera la venta. |
| ⚠️ **Descuadre** | Se cobró un importe distinto del calculado. El pedido queda en REVISIÓN: no descuenta inventario y no pide surtir. |
| 🔔 **Interés con contacto** | Un prospecto dejó su teléfono o correo. A las 24 h ya se enfrió. |
| 🧾 **Cotización grande** | Por encima de $1,500 MXN. Es intención, no curiosidad. |
| 🚨 **Configuración rota** | El sitio no puede vender. Es lo único que te despierta de madrugada con razón. |

### Se acumula para el resumen de la noche

Visitas, preguntas al Asesor, cotizaciones chicas, intereses sin contacto y
📦 **tope de apartado alcanzado** — cuando las reservas sin pagar llegan al
techo de un producto. Significa una de dos cosas: una racha de ventas de verdad
(toca reponer) o alguien abriendo links que no completa. Las dos se quieren
saber, ninguna merece despertar a nadie.
Sale un solo mensaje al día a las 20:00 (hora del centro).

### Todo aviso de pago trae a quién escribirle

Los tres avisos de pago llegan con **nombre, WhatsApp con enlace directo,
correo, código postal y calle** del comprador. No es adorno: antes de esto un
pago aprobado era un folio y un importe, y averiguar de quién era exigía entrar
al panel de Mercado Pago; un pago rechazado no se podía rescatar porque no
había a quién escribirle.

Esos datos los valida el servidor antes de crear el link de pago (`/api/pago`
responde 400 si falta alguno), así que un aviso sin contacto solo puede
significar un pedido creado antes de este cambio. Cuando pasa, el aviso lo
dice: **⚠️ SIN datos de contacto**.

### Lo que NO llega dos veces

Mercado Pago reintenta sus notificaciones, y desde que el webhook responde 200
solo al terminar, reintenta más. Los avisos son idempotentes por
`payment_id + estado`: el mismo pago aprobado no vuelve a sonar el teléfono.
Una transición de verdad —de pendiente a aprobado— sí es noticia nueva y sí
suena.

### Lo que un comprador escriba no puede romper el aviso

Los avisos van a Telegram con `parse_mode: HTML` y dentro llevan cosas que
teclea un desconocido: nombre, dirección, la pregunta que le hizo al Asesor.
Todo eso se escapa antes de interpolarse. No es una precaución teórica: una
etiqueta sin cerrar hace que Telegram **rechace el mensaje entero** con un 400,
y entonces el aviso de esa venta simplemente no llega.

### Cortafuegos

Nunca más de **20 avisos urgentes por hora**. Si un bot ataca el formulario,
no se convierte en 400 mensajes: lo que pase del tope baja al resumen, sin
perderse.

---

## 2. Telegram — 3 minutos, gratis (RECOMENDADO)

Es el canal recomendado para tus alertas y la razón es concreta: no tiene
ventana de 24 horas, no cuesta, no necesita aprobación de nadie, y llega al
instante.

### Paso 1 — crea el bot

1. Abre Telegram y busca **@BotFather**.
2. Mándale `/newbot`.
3. Te pide un nombre (`Valquiria Avisos`) y un usuario terminado en `bot`
   (`valquiria_avisos_bot`).
4. Te devuelve un **token** así:
   `8123456789:AAF3xk9_dEmoT0k3nNoEsRealCambiala`

### Paso 2 — consigue tu chat id

1. Busca el bot que acabas de crear y mándale cualquier mensaje (`hola`).
   **Este paso es obligatorio:** un bot no puede escribirle primero a nadie.
2. Abre en el navegador, cambiando `TU_TOKEN`:

   ```
   https://api.telegram.org/botTU_TOKEN/getUpdates
   ```

3. Busca `"chat":{"id":123456789` — ese número es tu `TELEGRAM_CHAT_ID`.

### Paso 3 — ponlo en Render

Panel de Render → tu servicio → **Environment**:

```
TELEGRAM_BOT_TOKEN=8123456789:AAF3xk9_...
TELEGRAM_CHAT_ID=123456789
```

Guarda. Render reinicia solo.

### Paso 4 — compruébalo

Entra a `https://valquiriainc.com/admin/` y pulsa **Probar avisos**. Debe
llegarte un mensaje en segundos.

---

## 3. WhatsApp — implementado, con una trampa que debes conocer

Está soportado, pero **léelo antes de elegirlo**.

WhatsApp no es como Telegram: Meta no deja que un negocio te escriba cuando
quiera. Solo puedes recibir texto libre **dentro de las 24 horas siguientes a
que tú le escribas al número**. Pasadas esas 24 h, Meta rechaza el mensaje con
el error `131047` y hace falta una **plantilla aprobada por Meta**.

Traducido: si eliges solo WhatsApp y no configuras plantilla, tendrías que
escribirle a tu propio bot todos los días para seguir recibiendo avisos. Por
eso la recomendación es Telegram para las alertas — y WhatsApp para hablar con
los clientes, que es donde de verdad hace falta.

### Si aun así lo quieres

1. Crea una app en <https://developers.facebook.com> → producto **WhatsApp**.
2. Apunta el **Phone number ID** y genera un **token permanente** (token de
   usuario de sistema; el de prueba caduca en 24 h).
3. En Render:

```
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_DESTINO=527717959131
WHATSAPP_PLANTILLA=aviso_valquiria     # opcional pero MUY recomendable
WHATSAPP_PLANTILLA_IDIOMA=es_MX
```

La plantilla debe tener **una sola variable en el cuerpo**: ahí se inserta el
texto del aviso. Ejemplo para dar de alta en Meta:

> Valquiria: {{1}}

Categoría **Utility**. Suele aprobarse en minutos.

Puedes tener Telegram y WhatsApp encendidos a la vez: el aviso sale por los
dos.

---

## 4. Webhook — para Make, Zapier, n8n o una hoja de cálculo

```
AVISOS_WEBHOOK_URL=https://hook.us1.make.com/xxxxx
```

Recibe cada aviso como JSON. Sirve si quieres que además caigan en una hoja de
cálculo o en tu CRM.

---

## 5. Ajustes finos

| Variable | Por defecto | Qué hace |
|---|---|---|
| `AVISOS_HORA_RESUMEN` | `20` | Hora local del resumen diario (0-23). |
| `AVISOS_UMBRAL_COTIZACION_CENTAVOS` | `150000` | Cotización que interrumpe. `150000` = $1,500. |
| `AVISOS_MAX_POR_HORA` | `20` | Tope de avisos urgentes por hora. |

---

## 6. El panel

`https://valquiriainc.com/admin/`

Pide el `LEADS_TOKEN` que ya tienes configurado en Render (si no lo tienes,
invéntate uno largo y ponlo: sin él el panel no abre). Se guarda solo en tu
navegador.

Ahí ves, en una pantalla:

- **quién pagó, cuánto y qué se lleva** — la respuesta a tu pregunta;
- quién se fue al banco y no volvió (carritos abandonados con folio);
- los intereses dejados con el Asesor, marcando los que traen contacto;
- lo que la gente le pregunta al Asesor — la mejor lista de ideas de producto
  que vas a tener;
- por qué sección entran las visitas;
- y qué está mal configurado, dicho sin rodeos.

Tres botones: **Actualizar**, **Mandarme el resumen** (sin esperar a las 20:00)
y **Probar avisos**.

---

## 7. Un límite que tienes que conocer

Los pedidos e intereses del panel viven **en la memoria del proceso**. Render
reinicia al desplegar y duerme el plan gratuito; cuando eso pasa, esa lista se
vacía.

Lo que **no** se pierde:

- **Mercado Pago** tiene el registro definitivo de todo lo cobrado. Ese es el
  que cuenta para la contabilidad.
- Los **avisos** ya te llegaron al teléfono y ahí se quedan.
- Si configuras `LEADS_WEBHOOK_URL`, cada lead y cada pedido queda además
  fuera del servidor.

**Cómo quitarle el asterisco (lo más barato primero):**

1. **Persistent Disk en Render** — ~1 USD/mes por 1 GB. Es lo que hace que la
   instantánea de `almacen.js` sirva de algo:

   ```
   Render → tu servicio → Disks → Add Disk
   Mount path: /var/data        Size: 1 GB
   ```

   Y luego la variable:

   ```
   ALMACEN_RUTA=/var/data/valquiria.json
   ```

   Con eso, pedidos, intereses y bitácora sobreviven a los despliegues y a que
   Render duerma el servicio. Los pedidos se guardan en el momento; el resto,
   cada 30 segundos y al cerrar.

2. **`LEADS_WEBHOOK_URL`** — manda cada prospecto fuera del servidor (Make,
   Zapier, una hoja de cálculo). Es complementario, no alternativo: el disco
   te da historial consultable, el webhook te da copia fuera.

3. **Base de datos** (Render Postgres, ~7 USD/mes) — hace falta de verdad
   cuando haya más de un proceso sirviendo el sitio: dos instancias escribiendo
   el mismo archivo se pisan. Mientras sea una sola, el disco basta.
