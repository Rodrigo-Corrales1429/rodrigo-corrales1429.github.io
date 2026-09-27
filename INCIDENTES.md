# Qué hacer si algo se rompe o te atacan

Una hoja, para leerla con prisa. El artículo 19 de la LFPDPPP obliga a informar
**de forma inmediata** a las personas afectadas cuando una vulneración de
seguridad afecta de forma significativa sus derechos patrimoniales o morales.
Improvisar ese aviso el día del susto es lo que sale mal; por eso está escrito
aquí antes.

## 1. Señales de que algo pasa

- Telegram: 🚨 **Intentos fallidos al panel**, ⚠️ **PAGO DUPLICADO**, ⚠️ **DESCUADRE**,
  💸 **Tope diario del Asesor**.
- Un cobro en Mercado Pago que no reconoces, o un pedido que el panel no tiene.
- Un cliente que recibe un mensaje o link de pago que no mandaste tú.
- Un aviso de inicio de sesión en GitHub, Render, Mercado Pago o Google que no fuiste tú.

## 2. Contener — en este orden, los primeros 30 minutos

1. **Rota el secreto que pudo filtrarse.** Cada uno se cambia en su panel y
   después en Render → Environment:
   - `LEADS_TOKEN` (panel): generar con
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
     Rotarlo cierra también todas las sesiones abiertas del panel.
   - `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`: Mercado Pago → Tus integraciones.
   - `GEMINI_API_KEY`: Google AI Studio.
   - `TELEGRAM_BOT_TOKEN`: @BotFather → `/revoke`.
2. **Cierra sesiones** en GitHub, Render, Mercado Pago y Google, y confirma que
   el doble factor sigue activo.
3. Si el problema es el Asesor gastando créditos: baja `GEMINI_TOPE_DIARIO` en
   Render. El sitio sigue vendiendo en modo local.
4. Si el problema es el cobro: apaga los pagos quitando `MP_ACCESS_TOKEN`. El
   botón cae a WhatsApp y no se pierde ninguna venta en curso.

## 3. Averiguar

- Logs de Render: filtra por `[admin]`, `[webhook]`, `[rate-limit`, `PAGO DUPLICADO`.
  Los logs NO llevan nombres ni domicilios a propósito; el folio basta para cruzar.
- Mercado Pago es la fuente de verdad de los cobros: cruza folio contra `external_reference`.
- Anota qué datos pudieron verse, de cuántas personas y desde cuándo.

## 4. Avisar a los afectados — si hay datos personales comprometidos

Si pudieron verse datos de clientes (nombre, WhatsApp, correo, domicilio), el
aviso es **inmediato** y debe decir, en lenguaje claro:

- qué pasó y cuándo;
- qué datos de esa persona pudieron verse;
- qué hiciste ya para contenerlo;
- qué puede hacer ella (desconfiar de mensajes que pidan pagos, por ejemplo);
- a quién escribir: ventas@valquiriadental.com o WhatsApp +52 771 795 9131.

Un cobro duplicado **sin** filtración de datos no es una vulneración de datos:
se resuelve reembolsando y avisando al cliente, como indica el aviso de Telegram.

## 5. Cerrar

- Escribe en AUDITORIA.md qué pasó, cómo se detectó y qué cambió.
- Si fue un fallo de código, añade la prueba que lo habría detectado a
  `test-seguridad.js` antes de desplegar el arreglo.
- Ante una duda legal sobre el aviso a los afectados, consulta a tu abogado el
  mismo día: el plazo de la ley no espera.
