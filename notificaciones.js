/**
 * ============================================================================
 *  VALQUIRIA — CENTRO DE AVISOS  (notificaciones.js v1)
 * ============================================================================
 *  El problema que resuelve, dicho como lo dijo el dueño:
 *
 *    "Siento que si me piden nunca me enteraré y solo caerá dinero."
 *
 *  Eso es exactamente lo que pasa hoy: un pago aprobado escribe una línea en
 *  los logs de Render y ahí muere. Nadie mira los logs de Render un domingo.
 *
 *  QUÉ HACE ESTE MÓDULO
 *  Toma cada hecho del negocio —una visita, una pregunta al Asesor, una
 *  cotización, un pago— y decide DOS cosas:
 *    1. si merece interrumpir a una persona ahora mismo, y
 *    2. por dónde mandarlo.
 *
 *  POR QUÉ NO MANDA TODO AL INSTANTE (la decisión de diseño que importa):
 *  Un aviso por cada visita al sitio convierte el teléfono en ruido, y el
 *  ruido se silencia. A la semana de silenciarlo, un pago real pasa
 *  desapercibido y el sistema ha hecho más daño que bien. Por eso hay dos
 *  carriles:
 *
 *    URGENTE  → suena el teléfono en el momento. Solo lo que involucra dinero
 *               o una persona esperando respuesta: pago aprobado, pago
 *               fallido, lead con datos de contacto, cotización grande, y las
 *               fallas de configuración que dejan el sitio sin vender.
 *    RESUMEN  → se acumula y sale una vez al día en un solo mensaje: visitas,
 *               preguntas del Asesor, cotizaciones chicas.
 *
 *  CANALES (se encienden con variables de entorno; puedes usar varios a la vez)
 *
 *    Telegram   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *               Gratis, instantáneo, sin límite de ventana horaria y se
 *               configura en tres minutos. Es el canal RECOMENDADO para los
 *               avisos del dueño.
 *
 *    WhatsApp   WHATSAPP_TOKEN + WHATSAPP_PHONE_ID + WHATSAPP_DESTINO
 *               API de WhatsApp Cloud de Meta. Ojo con la regla de Meta: para
 *               escribirte fuera de una ventana de 24 h hace falta una
 *               PLANTILLA aprobada (WHATSAPP_PLANTILLA). Sin plantilla, los
 *               avisos solo llegan si tú le escribiste al número en las
 *               últimas 24 h. Está implementado, pero por eso Telegram es la
 *               recomendación para alertas.
 *
 *    Webhook    AVISOS_WEBHOOK_URL — Make, Zapier, n8n, Apps Script.
 *    Consola    siempre activa. Última red de seguridad.
 * ============================================================================
 */

"use strict";

const TZ = process.env.ENVIOS_TZ || "America/Mexico_City";
const SITIO = (process.env.SITIO_URL || "https://valquiriainc.com").replace(/\/+$/, "");

/* Hora local (0-23) a la que sale el resumen diario. */
const HORA_RESUMEN = parseInt(process.env.AVISOS_HORA_RESUMEN || "20", 10);

/* Una cotización por encima de esto interrumpe; por debajo, va al resumen.
   $1,500 MXN: por debajo es una consulta, por encima es una intención. */
const UMBRAL_COTIZACION_URGENTE = parseInt(
  process.env.AVISOS_UMBRAL_COTIZACION_CENTAVOS || "150000",
  10
);

/* Cortafuegos anti-inundación: nunca más de N avisos urgentes por hora.
   Si un bot ataca el formulario, no se convierte en 400 mensajes. */
const MAX_URGENTES_POR_HORA = parseInt(process.env.AVISOS_MAX_POR_HORA || "20", 10);

const TIMEOUT_MS = 8000;

// ----------------------------------------------------------------------------
// 1. Estado en memoria
// ----------------------------------------------------------------------------

/* Bitácora reciente: alimenta el panel de administración y el resumen.
   No es una base de datos — es un mirador. Lo que no se puede perder viaja
   además por webhook y vive en Mercado Pago. */
const BITACORA = [];
const MAX_BITACORA = 1000;

const PENDIENTES_DE_RESUMEN = [];
let ultimoResumenISO = null;

const marcasUrgentes = [];

function ahoraLocal(fecha = new Date()) {
  const fmt = new Intl.DateTimeFormat("es-MX", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(fecha).map(x => [x.type, x.value]));
  const hora = p.hour === "24" ? "00" : p.hour;
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    hhmm: `${hora}:${p.minute}`,
    hora: parseInt(hora, 10)
  };
}

const pesos = c => `$${(Number(c || 0) / 100).toFixed(2)} MXN`;

// ----------------------------------------------------------------------------
// 2. Canales de salida
// ----------------------------------------------------------------------------

async function conTimeout(url, opciones) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(reloj);
  }
}

async function porTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const r = await conTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat,
        text: texto.slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
    if (!r.ok) {
      console.error(`[avisos] Telegram respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[avisos] Telegram falló:", String(e?.message || e).slice(0, 160));
    return false;
  }
}

/**
 * WhatsApp Cloud API de Meta.
 *
 * Manda texto libre si hay ventana de 24 h abierta. Si está configurada
 * WHATSAPP_PLANTILLA, manda la plantilla con el texto como primera variable,
 * que es la única forma de escribir fuera de esa ventana.
 */
async function porWhatsApp(texto) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const destino = (process.env.WHATSAPP_DESTINO || "").replace(/[^0-9]/g, "");
  if (!token || !phoneId || !destino) return false;

  const plantilla = process.env.WHATSAPP_PLANTILLA;
  const plano = texto.replace(/<[^>]+>/g, "").slice(0, 900);

  const cuerpo = plantilla
    ? {
        messaging_product: "whatsapp",
        to: destino,
        type: "template",
        template: {
          name: plantilla,
          language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || "es_MX" },
          components: [{ type: "body", parameters: [{ type: "text", text: plano }] }]
        }
      }
    : {
        messaging_product: "whatsapp",
        to: destino,
        type: "text",
        text: { body: plano }
      };

  try {
    const version = process.env.WHATSAPP_API_VERSION || "v21.0";
    const r = await conTimeout(
      `https://graph.facebook.com/${version}/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(cuerpo)
      }
    );
    if (!r.ok) {
      const detalle = (await r.text()).slice(0, 300);
      console.error(`[avisos] WhatsApp respondió ${r.status}: ${detalle}`);
      /* El 131047 de Meta es "fuera de la ventana de 24 h". Merece un
         mensaje explícito o se pierden horas buscando el motivo. */
      if (detalle.includes("131047") && !plantilla) {
        console.error(
          "[avisos] WhatsApp: pasaron más de 24 h desde tu último mensaje al " +
          "número. Configura WHATSAPP_PLANTILLA con una plantilla aprobada, " +
          "o usa Telegram para las alertas."
        );
      }
      return false;
    }
    return true;
  } catch (e) {
    console.error("[avisos] WhatsApp falló:", String(e?.message || e).slice(0, 160));
    return false;
  }
}

async function porWebhook(evento, texto) {
  const url = process.env.AVISOS_WEBHOOK_URL || process.env.LEADS_WEBHOOK_URL;
  if (!url) return false;
  try {
    const r = await conTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...evento, texto: texto.replace(/<[^>]+>/g, "") })
    });
    return r.ok;
  } catch (e) {
    console.error("[avisos] Webhook falló:", String(e?.message || e).slice(0, 160));
    return false;
  }
}

/* Interruptor de silencio.
   Sin esto, en cuanto haya un TELEGRAM_BOT_TOKEN en el `.env` local, cada
   `npm test` le manda al dueño una ráfaga de pagos falsos y descuadres
   inventados a su teléfono. Un canal de alertas en el que llegan alertas
   falsas deja de leerse, y entonces ya no sirve para las de verdad. */
const SILENCIO =
  process.env.AVISOS_SILENCIO === "1" || process.env.NODE_ENV === "test";

/** Reparte un texto por todos los canales encendidos. */
async function repartir(evento, texto) {
  if (SILENCIO) {
    console.log(`[AVISO-SILENCIADO/${evento.prioridad}] ${texto.replace(/<[^>]+>/g, "").slice(0, 120)}`);
    return true;
  }
  const resultados = await Promise.allSettled([
    porTelegram(texto),
    porWhatsApp(texto),
    porWebhook(evento, texto)
  ]);
  const entregado = resultados.some(r => r.status === "fulfilled" && r.value === true);
  if (!entregado) {
    /* Ningún canal configurado o todos fallaron. La consola es lo último que
       queda, y se marca como AVISO para poder filtrarlo en Render. */
    console.log(`[AVISO/${evento.prioridad}] ${texto.replace(/<[^>]+>/g, "")}`);
  }
  return entregado;
}

// ----------------------------------------------------------------------------
// 3. Redacción: de hecho crudo a mensaje legible
// ----------------------------------------------------------------------------
/**
 * Cada tipo de evento sabe cómo contarse a sí mismo. Un aviso que no se
 * entiende de un vistazo en la pantalla de bloqueo del teléfono no sirve:
 * primero QUÉ pasó y CUÁNTO, después el detalle.
 */
/**
 * Escapa lo que NO escribió este servidor.
 *
 * Los avisos van a Telegram con `parse_mode: HTML`, y dentro de ellos se
 * interpolan cosas que teclea un desconocido: el nombre del comprador, su
 * dirección, la pregunta que le hizo al Asesor. Un `<b>` en un nombre
 * reescribe el mensaje; una etiqueta sin cerrar hace que Telegram RECHACE el
 * envío entero con un 400, y entonces el aviso del pago no llega y la venta
 * se queda sin avisar. Escapar aquí es lo que separa «un dato feo» de «me
 * perdí una venta».
 *
 * Solo sobrevive el marcado que pone la plantilla, que es de casa.
 */
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const REDACCION = {
  /* El bloque de contacto es lo que convierte un aviso en una acción. Sin él,
     «PAGO APROBADO — $1,200» obliga a ir al panel de Mercado Pago a averiguar
     de quién era y adónde va. Con él, se empaca y se manda. */
  pago_aprobado: e =>
    `💰 <b>PAGO APROBADO — ${pesos(e.total_centavos)}</b>\n` +
    `Folio ${esc(e.folio)}\n` +
    (e.comprador ? `Cliente: ${esc(e.comprador)}\n` : "⚠️ SIN datos de contacto\n") +
    (e.whatsapp ? `WhatsApp: https://wa.me/${esc(e.whatsapp)}\n` : "") +
    (e.direccion ? `Envío a: ${esc(e.direccion)}${e.cp ? ` (CP ${esc(e.cp)})` : ""}\n` : "") +
    (e.items ? `Pedido: ${esc(e.items)}\n` : "") +
    (e.envio ? `Paquetería: ${esc(e.envio)}\n` : "") +
    `Método: ${esc(e.metodo || "Mercado Pago")}\n` +
    (e.reserva_caducada
      ? `⚠️ La reserva de stock ya había caducado cuando entró el pago. ` +
        `COMPRUEBA que quede mercancía antes de prometer fecha.\n`
      : "") +
    `👉 Prepara y manda la guía.`,

  pago_iniciado: e =>
    `🟡 <b>Alguien está pagando — ${pesos(e.total_centavos)}</b>\n` +
    `Folio ${esc(e.folio)}\n` +
    (e.comprador ? `Cliente: ${esc(e.comprador)}\n` : "") +
    (e.whatsapp ? `WhatsApp: https://wa.me/${esc(e.whatsapp)}\n` : "") +
    (e.items ? `Pedido: ${esc(e.items)}\n` : "") +
    `Todavía no cobra. Si en un rato no llega el "APROBADO", abandonó el pago ` +
    `— y ahora sí sabes a quién escribirle.`,

  /* pending / in_process: ni entró ni se rechazó. Un SPEI o un pago en
     efectivo se quedaba invisible hasta que el cliente escribía preguntando
     por qué no le llegaba nada. */
  pago_pendiente: e =>
    `🟠 <b>Pago pendiente — ${pesos(e.total_centavos)}</b>\n` +
    `Folio ${esc(e.folio)}. Estado: ${esc(e.detalle || "en proceso")}\n` +
    (e.comprador ? `Cliente: ${esc(e.comprador)}\n` : "") +
    (e.whatsapp ? `WhatsApp: https://wa.me/${esc(e.whatsapp)}\n` : "") +
    (e.items ? `Pedido: ${esc(e.items)}\n` : "") +
    (e.metodo ? `Método: ${esc(e.metodo)}\n` : "") +
    `👉 NO lo mandes todavía: el dinero no ha entrado.`,

  pago_rechazado: e =>
    `🔴 <b>Pago rechazado — ${pesos(e.total_centavos)}</b>\n` +
    `Folio ${esc(e.folio)}. Motivo: ${esc(e.detalle || "no especificado")}\n` +
    (e.comprador ? `Cliente: ${esc(e.comprador)}\n` : "") +
    (e.whatsapp ? `WhatsApp: https://wa.me/${esc(e.whatsapp)}\n` : "") +
    (e.items ? `Pedido: ${esc(e.items)}\n` : "") +
    `👉 Vale la pena escribirle: casi siempre es el banco, no el cliente.`,

  descuadre: e =>
    `⚠️ <b>DESCUADRE EN UN PAGO — NO SURTAS</b>\n` +
    `Folio ${esc(e.folio)}. Se esperaba ${pesos(e.esperado_centavos)} y llegó ` +
    `${pesos(e.recibido_centavos)}.\n` +
    (e.comprador ? `Cliente: ${esc(e.comprador)}\n` : "") +
    `El pedido queda en REVISIÓN: no se descontó inventario y no se emitió ` +
    `aviso de preparación.\n👉 Revísalo en Mercado Pago antes de mover nada.`,

  lead: e =>
    `🔔 <b>Interés nuevo — ${esc(e.division || "sin división")}</b>\n` +
    `Folio ${esc(e.folio || "s/f")}\n` +
    (e.contacto ? `Contacto: ${esc(e.contacto)}\n` : "⚠️ SIN datos de contacto\n") +
    (e.resumen ? `${esc(e.resumen)}\n` : "") +
    `👉 Respóndele hoy: un interés de más de 24 h ya se enfrió.`,

  cotizacion: e =>
    `🧾 Cotización armada — ${pesos(e.total_centavos)}\n` +
    (e.items ? `${esc(e.items)}\n` : "") +
    (e.division ? `División: ${esc(e.division)}` : ""),

  pregunta: e =>
    `💬 ${e.division ? `[${esc(e.division)}] ` : ""}"${esc((e.texto || "").slice(0, 160))}"`,

  visita: e =>
    `👀 ${esc(e.pagina || "/")}${e.referente ? ` (desde ${esc(e.referente)})` : ""}`,

  config: e =>
    `🚨 <b>EL SITIO NO PUEDE VENDER</b>\n${esc(e.detalle)}\n` +
    `👉 Revisa las variables de entorno en Render.`
};

const URGENTES = new Set([
  "pago_aprobado", "pago_iniciado", "pago_pendiente", "pago_rechazado",
  "descuadre", "config"
]);

/** Decide el carril. Aquí vive toda la política de "no me hagas spam". */
function esUrgente(evento) {
  if (evento.prioridad === "urgente") return true;
  if (evento.prioridad === "resumen") return false;
  if (URGENTES.has(evento.tipo)) return true;
  /* Un interés interrumpe SOLO si dejó cómo contactarlo. Sin contacto no hay
     nada que hacer con el aviso, y un aviso sobre el que no puedes actuar es
     ruido con disfraz de información. */
  if (evento.tipo === "lead") return Boolean(evento.contacto);
  if (evento.tipo === "cotizacion") {
    return Number(evento.total_centavos || 0) >= UMBRAL_COTIZACION_URGENTE;
  }
  return false;
}

function ritmoPermitido() {
  const corte = Date.now() - 3600_000;
  while (marcasUrgentes.length && marcasUrgentes[0] < corte) marcasUrgentes.shift();
  if (marcasUrgentes.length >= MAX_URGENTES_POR_HORA) return false;
  marcasUrgentes.push(Date.now());
  return true;
}

// ----------------------------------------------------------------------------
// 4. La puerta de entrada
// ----------------------------------------------------------------------------

/**
 * Registra un hecho del negocio y lo entrega si merece entrega.
 *
 * Es `void` a propósito: NUNCA se hace `await` desde una ruta HTTP. Que
 * Telegram esté lento no puede retrasar el pago de un cliente.
 *
 * @param {object} evento  { tipo, prioridad?, ...datos del tipo }
 */
function avisar(evento) {
  /* `= {}` como valor por omisión NO cubre `null`, solo `undefined`. Un
     null llegando de una ruta de pago tumbaría el manejador entero por un
     aviso, que es exactamente al revés de lo que este módulo debe hacer:
     avisar es accesorio, cobrar no. */
  if (!evento || typeof evento !== "object") evento = {};
  const tipo = String(evento.tipo || "otro");
  const sello = ahoraLocal();
  const registro = { ...evento, tipo, en: new Date().toISOString(), local: `${sello.iso} ${sello.hhmm}` };

  BITACORA.push(registro);
  if (BITACORA.length > MAX_BITACORA) BITACORA.shift();

  const redactar = REDACCION[tipo];
  const texto = redactar
    ? redactar(registro)
    : `• ${esc(tipo)}: ${esc(JSON.stringify(evento).slice(0, 300))}`;

  if (esUrgente(registro)) {
    if (!ritmoPermitido()) {
      /* Se degrada a resumen en vez de tirarse: el hecho no se pierde. */
      PENDIENTES_DE_RESUMEN.push({ ...registro, texto, limitado: true });
      return;
    }
    repartir({ ...registro, prioridad: "urgente" }, `${texto}\n\n🕐 ${sello.hhmm}`)
      .catch(e => console.error("[avisos] fallo al repartir:", e?.message));
  } else {
    PENDIENTES_DE_RESUMEN.push({ ...registro, texto });
    if (PENDIENTES_DE_RESUMEN.length > MAX_BITACORA) PENDIENTES_DE_RESUMEN.shift();
  }
}

// ----------------------------------------------------------------------------
// 5. Resumen diario
// ----------------------------------------------------------------------------

function componerResumen(eventos, etiquetaDia) {
  const por = t => eventos.filter(e => e.tipo === t);
  const visitas = por("visita");
  const preguntas = por("pregunta");
  const cotizaciones = por("cotizacion");
  const leads = por("lead");

  const paginas = {};
  for (const v of visitas) paginas[v.pagina || "/"] = (paginas[v.pagina || "/"] || 0) + 1;
  const top = Object.entries(paginas).sort((a, b) => b[1] - a[1]).slice(0, 6);

  const valorCotizado = cotizaciones.reduce((s, c) => s + Number(c.total_centavos || 0), 0);

  const lineas = [
    `📊 <b>Valquiria — resumen del ${etiquetaDia}</b>`,
    "",
    `👀 Visitas: <b>${visitas.length}</b>`,
    ...top.map(([p, n]) => `   ${esc(p)} — ${n}`),
    "",
    `💬 Preguntas al Asesor: <b>${preguntas.length}</b>`,
    ...preguntas.slice(-5).map(p => `   "${esc((p.texto || "").slice(0, 90))}"`),
    "",
    `🧾 Cotizaciones: <b>${cotizaciones.length}</b>` +
      (valorCotizado ? ` · ${pesos(valorCotizado)} en juego` : ""),
    `🔔 Intereses registrados: <b>${leads.length}</b>`
  ];

  if (!eventos.length) {
    lineas.length = 2;
    lineas.push("Sin actividad hoy. El sitio estuvo arriba y nadie entró.");
  }

  lineas.push("", `🔗 Panel: ${SITIO}/admin/`);
  return lineas.join("\n");
}

/**
 * Se llama cada cierto tiempo desde server.js. Manda el resumen una sola vez
 * al día, cuando ya pasó la hora configurada.
 *
 * Se comprueba por RELOJ y no con un temporizador de 24 h porque Render
 * duerme y reinicia los servicios; un setTimeout de un día no sobrevive.
 */
async function quizaResumenDiario() {
  const { iso, hora } = ahoraLocal();
  if (hora < HORA_RESUMEN) return false;
  if (ultimoResumenISO === iso) return false;

  ultimoResumenISO = iso;
  const lote = PENDIENTES_DE_RESUMEN.splice(0, PENDIENTES_DE_RESUMEN.length);
  const texto = componerResumen(lote, iso);
  await repartir({ tipo: "resumen_diario", prioridad: "resumen", dia: iso }, texto);
  return true;
}

/** Fuerza el resumen ahora, sin esperar la hora. Para el botón del panel. */
async function resumenAhora() {
  const { iso } = ahoraLocal();
  const lote = PENDIENTES_DE_RESUMEN.slice();
  const texto = componerResumen(lote, `${iso} (bajo pedido)`);
  const ok = await repartir({ tipo: "resumen_manual", prioridad: "resumen" }, texto);
  return { ok, eventos: lote.length, texto: texto.replace(/<[^>]+>/g, "") };
}

// ----------------------------------------------------------------------------
// 6. Lecturas para el panel
// ----------------------------------------------------------------------------

/** La bitácora completa en orden natural, para guardarla. */
function bitacoraCruda() {
  return BITACORA.slice();
}

/** Vuelve a meter en memoria una bitácora guardada. Ver almacen.js. */
function restaurarBitacora(filas) {
  if (!Array.isArray(filas)) return 0;
  BITACORA.length = 0;
  for (const e of filas.slice(-MAX_BITACORA)) BITACORA.push(e);
  return BITACORA.length;
}

function bitacora({ tipo = null, limite = 200 } = {}) {
  const filas = tipo ? BITACORA.filter(e => e.tipo === tipo) : BITACORA;
  return filas.slice(-Math.max(1, Math.min(limite, MAX_BITACORA))).reverse();
}

function metricas() {
  const hoy = ahoraLocal().iso;
  const deHoy = BITACORA.filter(e => (e.local || "").startsWith(hoy));
  const cuenta = t => deHoy.filter(e => e.tipo === t).length;
  const suma = t =>
    deHoy.filter(e => e.tipo === t).reduce((s, e) => s + Number(e.total_centavos || 0), 0);

  return {
    dia: hoy,
    visitas: cuenta("visita"),
    preguntas: cuenta("pregunta"),
    cotizaciones: cuenta("cotizacion"),
    valor_cotizado_centavos: suma("cotizacion"),
    leads: cuenta("lead"),
    pagos_iniciados: cuenta("pago_iniciado"),
    pagos_aprobados: cuenta("pago_aprobado"),
    ingreso_centavos: suma("pago_aprobado"),
    eventos_en_bitacora: BITACORA.length,
    pendientes_de_resumen: PENDIENTES_DE_RESUMEN.length
  };
}

/** Qué canales están realmente encendidos. Para /health y el arranque. */
function estadoAvisos() {
  const canales = [];
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) canales.push("telegram");
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_DESTINO) {
    canales.push(process.env.WHATSAPP_PLANTILLA ? "whatsapp(plantilla)" : "whatsapp(24h)");
  }
  if (process.env.AVISOS_WEBHOOK_URL || process.env.LEADS_WEBHOOK_URL) canales.push("webhook");
  return {
    canales,
    hay_canal: canales.length > 0,
    silenciado: SILENCIO,
    hora_resumen: HORA_RESUMEN,
    umbral_cotizacion_urgente: pesos(UMBRAL_COTIZACION_URGENTE),
    ultimo_resumen: ultimoResumenISO
  };
}

/** Mensaje de prueba, para comprobar la plomería sin esperar a una venta. */
async function probar() {
  const estado = estadoAvisos();
  if (!estado.hay_canal) {
    return {
      ok: false,
      error:
        "No hay ningún canal configurado. Enciende Telegram con " +
        "TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID, o WhatsApp con WHATSAPP_TOKEN, " +
        "WHATSAPP_PHONE_ID y WHATSAPP_DESTINO."
    };
  }
  const ok = await repartir(
    { tipo: "prueba", prioridad: "urgente" },
    "✅ <b>Avisos de Valquiria conectados</b>\n" +
    `Canales activos: ${estado.canales.join(", ")}\n` +
    `Resumen diario a las ${estado.hora_resumen}:00 (hora del centro).\n` +
    "Si estás leyendo esto, ya te vas a enterar de cada pago."
  );
  return { ok, canales: estado.canales };
}

module.exports = {
  avisar,
  /* Se exporta para poder AFIRMAR en las pruebas qué lleva cada aviso. El
     canal silenciado recorta el texto a 120 caracteres, así que sin esto no
     hay forma de comprobar que el WhatsApp del comprador viaja en el aviso
     de un pago aprobado — que es justo el dato cuya ausencia dejaba un pago
     sin dueño. */
  REDACCION,
  bitacoraCruda,
  restaurarBitacora,
  quizaResumenDiario,
  resumenAhora,
  bitacora,
  metricas,
  estadoAvisos,
  probar
};
