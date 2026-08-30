# Cobrar en valquiriainc.com

Todo lo que sigue se hace **fuera del código**. En este repositorio no hay —ni
va a haber— un token, una contraseña ni un número de cuenta. El código lee esos
valores del entorno de Render; si algún día encuentras uno escrito en un
archivo, es un incidente, no un atajo.

---

## 0 · Lo primero: dónde cae el dinero

Tú no le das a nadie tu CLABE ni tus datos bancarios para integrar los pagos.
El flujo real es:

```
cliente paga  →  tu cuenta de Mercado Pago  →  tú retiras a tu banco
```

Tu cuenta bancaria se da de alta **una sola vez, dentro de Mercado Pago**, con
tu sesión iniciada, y el sitio nunca la ve. Lo único que este backend necesita
es un **token de acceso**: una credencial que autoriza a cobrar *hacia* tu
cuenta, y que puedes revocar cuando quieras sin tocar el banco.

Esa distinción es la que hace que esto sea seguro. Si alguna vez una
integración te pide la CLABE o los datos de tu tarjeta para "conectarse", no es
Mercado Pago.

---

## 1 · Da de alta tu cuenta de cobro (en Mercado Pago, no aquí)

1. Entra a [mercadopago.com.mx](https://www.mercadopago.com.mx) con tu cuenta.
2. Completa la **validación de identidad** si no lo has hecho. Sin esto los
   cobros entran pero los retiros se quedan detenidos, y es la sorpresa más
   común del primer mes.
3. En **Tu negocio → Configuración → Cuentas bancarias**, agrega tu CLABE.
   Aquí sí van tus datos bancarios: estás en el sitio de Mercado Pago, con tu
   sesión, y nadie más los ve.
4. Decide en **Retiros** si quieres transferencia automática o manual.

Cuando termines este paso ya puedes recibir dinero. Lo que sigue es conectar
el sitio.

---

## 2 · Saca las credenciales

1. Ve a **[Tus integraciones](https://www.mercadopago.com.mx/developers/panel)**.
2. Crea una aplicación (nombre: `Valquiria Inc.`, tipo: pagos en línea,
   producto: **Checkout Pro**).
3. Abre **Credenciales de producción** y copia el **Access Token**. Empieza
   con `APP_USR-`.
4. Copia también las de **prueba** — las vas a usar en el paso 5.

> **El Access Token es una llave, trátalo como tal.** Quien lo tenga puede
> cobrar y consultar en tu nombre. No lo pegues en un chat, en un issue, ni en
> un archivo del repositorio. Si se te escapa: en esa misma pantalla hay un
> botón para regenerarlo, y regenerarlo lo invalida al instante.

---

## 3 · Ponlas en Render

En el panel de Render, servicio del backend → **Environment** → *Add
Environment Variable*. Ahí dentro los valores quedan cifrados y no aparecen en
el repositorio ni en los logs.

| Variable | Valor | ¿Obligatoria? |
|---|---|---|
| `MP_ACCESS_TOKEN` | El Access Token de producción | **Sí**, sin ella no hay pagos |
| `MP_WEBHOOK_SECRET` | La clave secreta del webhook (paso 4) | **Sí**, muy recomendable |
| `SITIO_URL` | `https://valquiriainc.com` | Ya debería estar |
| `BACKEND_URL` | La URL pública del backend | Solo si Render no la publica sola |
| `MP_MAX_CUOTAS` | Tope de mensualidades, por defecto `12` | No |
| `MP_EXCLUIR_TIPOS` | Medios a apagar, ej. `ticket` para quitar efectivo | No |
| `MP_VIGENCIA_MINUTOS` | Cuánto vive un link, por defecto `1440` (24 h) | No |
| `PEDIDOS_WEBHOOK_URL` | A dónde avisar de cada pago aprobado | No, pero conviene |

Render publica `RENDER_EXTERNAL_URL` por su cuenta, así que `BACKEND_URL`
normalmente sobra. Si en los logs ves *«Sin BACKEND_URL ni
RENDER_EXTERNAL_URL»*, defínela a mano.

Al guardar, Render reinicia el servicio. **No hay que tocar el código.**

---

## 4 · Conecta el webhook

Sin esto tienes un botón de pago. Con esto tienes una tienda: el webhook es lo
que te entera de que alguien pagó aunque cierre la pestaña al salir del banco.

1. En **Tus integraciones → tu aplicación → Webhooks**, configura la URL:

   ```
   https://TU-BACKEND.onrender.com/api/pago/webhook
   ```

2. Marca el evento **Pagos** (`payment`).
3. Mercado Pago te muestra una **clave secreta**. Cópiala a Render como
   `MP_WEBHOOK_SECRET`.
4. Usa el botón **Simular notificación** del panel. En los logs de Render debe
   aparecer una línea `[webhook] pago ... estado=...`. Si aparece
   `Rechazado por firma`, el secreto no coincide.

El backend hace dos comprobaciones, y la segunda es la importante: valida la
firma, y **aun así no se cree el estado que viene en el aviso** — vuelve a
preguntarle a Mercado Pago por ese pago. Una notificación falsificada solo
consigue que consultemos un pago que no existe.

También cuadra el importe: si lo cobrado no coincide con lo que el servidor
calculó al crear el link, escribe `⚠️ DESCUADRE` en el log y te dice que no
surtas ese pedido sin revisarlo.

---

## 5 · Pruébalo sin cobrar de verdad

1. Pon temporalmente en Render el Access Token **de prueba**.
2. Haz un pedido en el sitio. La respuesta trae `url_prueba`: ábrela.
3. Paga con una [tarjeta de prueba](https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/additional-content/test-cards).
   Para aprobar, el nombre del titular es `APRO`; para rechazar, `OTHE`.
4. Comprueba en los logs de Render que llegó el webhook y que el estado quedó
   en `approved`.
5. Vuelve a poner el token de producción.

Haz este ensayo **antes** de anunciar los pagos. Es media hora y te ahorra
descubrir el problema con un cliente real enfrente.

---

## 6 · Métodos de pago modernos

Aquí conviene ser exacto, porque es fácil prometer de más.

Checkout Pro **no elige** los medios de pago desde el código: muestra los que
estén habilitados en **tu cuenta** y disponibles para el país, el navegador y
el dispositivo del comprador. Por eso este backend no los declara uno por uno
—sería una lista que miente en cuanto cambie algo—; lo que hace es no
estorbarlos y dejarte un interruptor (`MP_EXCLUIR_TIPOS`) para apagar los que
no quieras.

Lo que ya funciona hoy, sin tocar nada más:

- **Tarjeta de crédito y débito**, con meses sin intereses según lo que tengas
  pactado (el tope lo pone `MP_MAX_CUOTAS`).
- **Saldo de Mercado Pago**.
- **Efectivo** en tiendas y **transferencia SPEI**.
- **Link de pago**: el `init_point` que devuelve `/api/pago` ES un link
  compartible. Puedes mandarlo por WhatsApp y se paga desde cualquier
  dispositivo. Caduca según `MP_VIGENCIA_MINUTOS`.

Sobre **Google Pay y Apple Pay**: la disponibilidad depende del despliegue de
Mercado Pago por país y del dispositivo, y cambia con el tiempo. **Compruébalo
en tu panel**, en *Tu negocio → Configuración → Medios de pago*: lo que
aparezca ahí habilitado es lo que verán tus clientes, sin cambios en el código.
Si algún día quieres las carteras **embebidas en tu propia página** —sin salir
a Mercado Pago— eso ya no es Checkout Pro sino *Payment Brick*, y es un
proyecto aparte: cambia el frontend del checkout, no la configuración.

No te recomiendo empezar por ahí. Checkout Pro te da hoy el flujo completo,
con la responsabilidad del cumplimiento PCI del lado de Mercado Pago.

---

## 7 · La vuelta del cliente, y por qué /gracias/ existe

Mercado Pago devuelve al comprador a las `back_urls` de la preferencia, y les
pega sus propios parámetros (`collection_status`, `payment_id`,
`external_reference`). Apuntan a **rutas reales**, no a fragmentos:

| Resultado | Vuelve a |
|---|---|
| Aprobado | `https://valquiriainc.com/gracias/` |
| Pendiente | `https://valquiriainc.com/gracias/?estado=pendiente` |
| Rechazado | `https://valquiriainc.com/gracias/?estado=fallo` |

`/gracias/` es una página de verdad que solo hace una cosa: entregarle esos
parámetros a la aplicación (`/#/gracias?...`). Antes las `back_urls` llevaban
`#` dentro, y los parámetros acababan a un lado u otro del fragmento según el
caso: el cliente que acababa de pagar aterrizaba en el home, sin folio y sin
confirmación.

### Esos parámetros NO son una prueba de pago

Es la regla más importante de esta página, y saltársela costaba caro: con
`/#/gracias?collection_status=approved&external_reference=VQ-LOQUESEA` escrito
a mano, el sitio decía «Pago confirmado», enseñaba el folio inventado y
**borraba el carrito**. No despachaba mercancía —el webhook firmado sigue
siendo el que manda— pero le mentía al cliente y le destruía el pedido.

Ahora:

1. De la URL solo se acepta el **folio**, y solo con la forma exacta que genera
   este servidor.
2. El estado se le pregunta a `GET /api/pedido/:folio`, que solo lo sabe por el
   webhook firmado. Se pregunta varias veces durante ~17 s, porque Mercado Pago
   devuelve al cliente antes de que llegue su propia notificación.
3. Mientras no haya respuesta, la página dice **«Estamos confirmando tu pago»**
   —titular, entradilla y recuadro, todo a la vez— y no toca nada.
4. **El carrito se vacía únicamente con un `approved` del servidor.** Ni con la
   URL, ni con un «probablemente», ni con el silencio del backend.
5. **Ningún** estado de la URL tiene autoridad, tampoco el malo. Creerse un
   `rejected` forjado hace que la página anuncie un fallo y ofrezca **pagar
   otra vez** algo ya cobrado; cobrar dos veces es peor que hacer esperar. Un
   rechazo de verdad tampoco cuesta la espera: el webhook también avisa de los
   rechazos, así que el servidor lo sabe al primer o segundo sondeo.

Las reglas viven en `assets/js/veredicto-pago.js`, sin DOM y sin red, para que
`npm test` pueda ejecutarlas contra el ataque de verdad
(`node test-blindaje-pago.js`).

Al volver, el Asesor **restaura la conversación** (vive en `sessionStorage`,
así que sobrevive al viaje a la pasarela) y habla primero: confirma el folio y
desglosa lo comprado.

---

## 8 · Cuánto se puede apartar, y por cuánto tiempo

Generar un link de pago **aparta mercancía**, y eso convertía el checkout
público en una palanca: una sola petición pidiendo las 27 unidades de un
producto lo dejaba agotado 24 horas sin pagar un peso. Tres topes lo cierran:

| Variable | Por omisión | Qué impide |
|---|---|---|
| `INVENTARIO_MINUTOS_RESERVA` | 15 | Que una reserva sin pagar bloquee stock más de lo que dura una compra con tarjeta. |
| `INVENTARIO_MAX_POR_SKU` | 6 | Que una sola compra se lleve todo un producto. |
| `INVENTARIO_MAX_UNIDADES` | 12 | Lo mismo, repartido entre varios productos. |
| `INVENTARIO_MAX_RESERVAS_POR_IDENTIDAD` | 1 | Que un visitante acumule mercancía apartada. Abrir un pedido nuevo **reemplaza** el anterior, así que no bloquea a quien reintenta. |
| `INVENTARIO_FRACCION_RESERVABLE` | 0.5 | **El techo que no depende de quién pida.** Las reservas sin pagar nunca retienen más de esa fracción de lo que queda por vender, vengan de las IPs que vengan. |
| `INVENTARIO_STOCK_SEGURIDAD` | 1 | Piezas que nunca se apartan sin pagar. Con stock bajo la fracción sola no basta: de 1 pieza, la mitad redondea a 0. |

El techo se calcula así, y **`INVENTARIO_MAX_POR_SKU` no entra en la cuenta**:

```
porVender  = stock − vendido
techo      = min( floor(porVender × FRACCION) , porVender − STOCK_SEGURIDAD )
cupo       = max( 0 , techo − apartado_sin_pagar )
```

`MAX_POR_SKU` es un límite **por pedido**; el techo es **por producto**. Ese
era el fallo que quedaba: con `max(MAX_POR_SKU, fracción)`, el suelo del
primero anulaba al segundo justo cuando quedaba poco stock — con 21 de 27
vendidas quedaban 6, la fracción daba 3, el `max` lo subía a 6, y una sola
reserva sin pagar volvía a dejar disponible en cero.

| Quedan | Apartable sin pagar | Siempre comprable |
|---|---|---|
| 27 | 13 | 14 |
| 10 | 5 | 5 |
| 6 | 3 | 3 |
| 2 | 1 | 1 |
| 1 | 0 | 1 |

La última fila es una decisión, no un descuido: **la última pieza no se aparta
de forma anónima**. No se puede sostener a la vez «un bot nunca aparta la
última» y «cualquier anónimo puede apartar la última». Se protege la pieza, y
el rechazo (`motivo: "stock-protegido"`, con `disponible`, `apartado`, `techo`
y `maximo_comprable_en_linea`) manda a WhatsApp, donde hay una persona.

Los tres primeros son fricción por visitante, y un visitante son cinco
pestañas o cinco IPs: con reserva de 15 min, 6 por SKU y 3 por identidad, dos
identidades bastaban para dejar un producto de 27 piezas en cero (6+6+6 desde
una, 6+3 desde otra). El cuarto es la defensa de verdad, y no se puede
esquivar multiplicando identidades.

`INVENTARIO_MINUTOS_RESERVA` está además **topado a 60 minutos en el código**:
un despliegue no limpia el panel de Render, y una variable vieja con 1440
devolvería el agujero sin que nadie tocara una línea.

El rechazo es un **400 que ofrece el canal de mayoreo**, no un portazo: quien
pide 27 piezas casi siempre es un cliente de volumen, y ese cliente se atiende
por WhatsApp con precio de volumen.

Un pago que llega **después** de que caducó la reserva —SPEI, efectivo— no se
pierde: se registra igual y el aviso de Telegram avisa de que la reserva ya
había caducado, para comprobar el stock antes de prometer fecha.

---

## 9 · El webhook responde 200 cuando ya terminó

Antes acusaba recibo **antes** de consultar el pago, «para no hacer esperar a
Mercado Pago». Si su API fallaba después de ese 200, el error se escribía en un
log que nadie mira y Mercado Pago ya daba el aviso por entregado: cobro hecho,
pedido sin registrar, sin inventario y sin avisar.

Ahora el orden es: **firma → consultar el pago → persistir y avisar → 200**. Si
algo falla, se responde 5xx y Mercado Pago reintenta. Para que reintentar sea
barato, los avisos son idempotentes por `payment_id + estado`: el mismo aviso
repetido no vuelve a sonar el teléfono.

### El descuadre no surte

Si el importe cobrado no coincide con el calculado, el pedido queda en estado
`revision`: **no** se descuenta inventario, **no** sale el aviso de preparar y
**no** cuenta como venta en el panel. Lo único que sale es la alarma de
descuadre, que dice explícitamente que no se surta.

Si cambias `SITIO_URL`, la página `/gracias/` tiene que existir en el dominio
nuevo o el comprador vuelve a un 404 justo después de pagarte.

---

## 10 · Las reglas que no se rompen

- **Sin contacto no hay link de pago.** `/api/pago` responde 400 si falta
  nombre, WhatsApp (10 dígitos), correo, código postal o calle con número, y
  dice cuál falta en `faltan` para que el Asesor lo pregunte. Un pago a medias
  sin contacto es un pedido que nadie puede rescatar.
- **El total lo calcula el backend, siempre.** El navegador manda SKUs y
  cantidades; los precios se releen del catálogo. Un carrito editado desde la
  consola no cambia lo que se cobra: el precio que traiga ni se lee.
- **Nunca pidas datos de tarjeta por el chat.** El asesor tiene instrucción
  explícita de negarse. Los datos se teclean en Mercado Pago y solo ahí.
- **`.env` no se sube.** Ya está en `.gitignore`. Lo que se versiona es
  `.env.example`, que lleva los nombres y ningún valor.
- **Si un token se filtra, se rota.** No basta con borrar el archivo: lo que
  entró a git se queda en el historial. Regenera el token en el panel.
- **Revisa los `⚠️` de los logs.** Están puestos para que un descuadre o una
  credencial faltante se vean de un vistazo.
