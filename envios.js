/**
 * ============================================================================
 *  VALQUIRIA — MOTOR DE ENVÍOS  (envios.js v1)
 * ============================================================================
 *  Convierte "¿cuánto me sale el envío y cuándo llega?" en un número y una
 *  fecha que el cliente puede leer ANTES de pagar. Hasta hoy el sitio cobraba
 *  un envío plano de $150 sin decir a dónde, con qué paquetería, ni cuándo
 *  llegaba. Eso es exactamente lo que hace dudar a un comprador nuevo.
 *
 *  ARQUITECTURA — POR QUÉ HAY TRES PROVEEDORES Y NO UNO:
 *
 *  1. `tabla`    → tarifas de referencia locales. NO necesita cuenta ni API
 *                  key. Es el modo por defecto y garantiza que el sitio
 *                  SIEMPRE pueda dar un costo y una fecha, aunque la API de
 *                  la paquetería esté caída o todavía no exista la cuenta.
 *  2. `envia`    → Envia.com. Agregador mexicano: una sola cuenta cotiza
 *                  Estafeta, DHL, FedEx, Redpack, Paquetexpress y más.
 *  3. `skydropx` → Skydropx. El otro agregador grande en México.
 *
 *  Los tres devuelven EXACTAMENTE la misma forma de objeto. El Asesor, el
 *  carrito y el checkout no saben —ni les importa— cuál está activo.
 *
 *  REGLA DE HONESTIDAD (la más importante de este archivo):
 *  Toda cotización lleva un campo `fuente`. Si dice "referencia", el número
 *  salió de la tabla local y es un ESTIMADO; si dice el nombre de un
 *  agregador, es una cotización real de la paquetería. El Asesor está
 *  obligado a distinguirlos al hablar. Un estimado presentado como precio
 *  firme es una reclamación esperando a ocurrir.
 *
 *  CÓMO ENCENDER LAS TARIFAS EN VIVO (sin tocar código):
 *    ENVIOS_PROVEEDOR=envia
 *    ENVIA_API_KEY=...            (Envia.com → Configuración → API)
 *  o bien:
 *    ENVIOS_PROVEEDOR=skydropx
 *    SKYDROPX_API_KEY=...
 * ============================================================================
 */

"use strict";

// ----------------------------------------------------------------------------
// 1. Configuración
// ----------------------------------------------------------------------------

const PROVEEDOR = (process.env.ENVIOS_PROVEEDOR || "tabla").toLowerCase().trim();

/* Código postal de origen: de dónde salen las cajas. Pachuca, Hidalgo. */
const CP_ORIGEN = (process.env.ENVIOS_CP_ORIGEN || "42000").trim();

/* Umbral de envío gratis. Se reutiliza el mismo que ya usa el carrito para
   que la promesa del sitio y la del Asesor no se contradigan nunca. */
const ENVIO_GRATIS_DESDE_CENTAVOS = parseInt(
  process.env.ENVIO_GRATIS_DESDE_CENTAVOS || "99900",
  10
);

/* Divisor volumétrico. Las paqueterías cobran por el MAYOR entre peso real y
   peso volumétrico. Terrestre en México suele ser /6000; aéreo /5000. */
const DIVISOR_VOLUMETRICO = parseInt(
  process.env.ENVIOS_DIVISOR_VOLUMETRICO || "6000",
  10
);

/* Hora límite para que un pedido salga el MISMO día hábil. Después de esta
   hora la caja ya no alcanza la recolección. */
const HORA_CORTE = parseInt(process.env.ENVIOS_HORA_CORTE || "14", 10);

/* Días hábiles que tarda Valquiria en fabricar/empacar antes de entregar la
   caja a la paquetería. Es tiempo de MANIOBRA, no de tránsito, y el cliente
   lo tiene que ver por separado: es la diferencia entre "tardan mucho" y
   "sé exactamente qué está pasando con mi pedido". */
const DIAS_PREPARACION = parseInt(process.env.ENVIOS_DIAS_PREPARACION || "1", 10);

const TIMEOUT_API_MS = parseInt(process.env.ENVIOS_TIMEOUT_MS || "8000", 10);

/* Peso por omisión de una pieza del catálogo Dental, en gramos. Los modelos
   dentales son ligeros; lo que pesa de verdad es el empaque de protección.
   Se puede afinar por SKU con ENVIOS_PESOS_JSON={"DientesRealistas":900}. */
const PESO_POR_OMISION_G = parseInt(process.env.ENVIOS_PESO_OMISION_G || "250", 10);

const PESO_EMPAQUE_G = parseInt(process.env.ENVIOS_PESO_EMPAQUE_G || "200", 10);

const PESOS_POR_SKU = (() => {
  const base = {
    ValPulpo: 220,
    ValEnd: 220,
    Endotnissin: 300,
    DientesRealistas: 850 // kit de 32 piezas: pesa como cuatro cajas normales
  };
  try {
    return { ...base, ...JSON.parse(process.env.ENVIOS_PESOS_JSON || "{}") };
  } catch {
    console.error("[envios] ENVIOS_PESOS_JSON no es JSON válido; se ignora.");
    return base;
  }
})();

// ----------------------------------------------------------------------------
// 2. Geografía: de código postal a zona tarifaria
// ----------------------------------------------------------------------------
/**
 * México no tiene "zonas de envío" oficiales: cada paquetería inventa las
 * suyas. Esta tabla agrupa por ESTADO (los dos primeros dígitos del CP) y
 * luego por distancia real desde Hidalgo, que es de donde sale la mercancía.
 *
 * Es deliberadamente gruesa. Su trabajo no es clavar el peso exacto de una
 * guía: es no mentirle al cliente por un factor de dos mientras no haya
 * cuenta de paquetería conectada.
 */

const ESTADOS_POR_CP = [
  [1, 16, "Ciudad de México"],
  [20, 20, "Aguascalientes"],
  [21, 22, "Baja California"],
  [23, 23, "Baja California Sur"],
  [24, 24, "Campeche"],
  [25, 27, "Coahuila"],
  [28, 28, "Colima"],
  [29, 30, "Chiapas"],
  [31, 33, "Chihuahua"],
  [34, 35, "Durango"],
  [36, 38, "Guanajuato"],
  [39, 41, "Guerrero"],
  [42, 43, "Hidalgo"],
  [44, 49, "Jalisco"],
  [50, 57, "Estado de México"],
  [58, 61, "Michoacán"],
  [62, 62, "Morelos"],
  [63, 63, "Nayarit"],
  [64, 67, "Nuevo León"],
  [68, 71, "Oaxaca"],
  [72, 75, "Puebla"],
  [76, 76, "Querétaro"],
  [77, 77, "Quintana Roo"],
  [78, 79, "San Luis Potosí"],
  [80, 82, "Sinaloa"],
  [83, 85, "Sonora"],
  [86, 86, "Tabasco"],
  [87, 89, "Tamaulipas"],
  [90, 90, "Tlaxcala"],
  [91, 96, "Veracruz"],
  [97, 97, "Yucatán"],
  [98, 99, "Zacatecas"]
];

/* Zona tarifaria por estado, medida desde Hidalgo. */
const ZONA_POR_ESTADO = {
  Hidalgo: "local",

  "Ciudad de México": "metropolitana",
  "Estado de México": "metropolitana",
  Tlaxcala: "metropolitana",
  Puebla: "metropolitana",
  Querétaro: "metropolitana",
  Morelos: "metropolitana",

  Guanajuato: "nacional",
  Veracruz: "nacional",
  "San Luis Potosí": "nacional",
  Michoacán: "nacional",
  Jalisco: "nacional",
  Aguascalientes: "nacional",
  Zacatecas: "nacional",
  Guerrero: "nacional",
  Oaxaca: "nacional",
  "Nuevo León": "nacional",
  Tamaulipas: "nacional",
  Coahuila: "nacional",
  Colima: "nacional",
  Nayarit: "nacional",
  Durango: "nacional",

  Chihuahua: "extendida",
  Sinaloa: "extendida",
  Sonora: "extendida",
  "Baja California": "extendida",
  "Baja California Sur": "extendida",
  Chiapas: "extendida",
  Tabasco: "extendida",
  Campeche: "extendida",
  Yucatán: "extendida",
  "Quintana Roo": "extendida"
};

/** Normaliza un CP a 5 dígitos. Devuelve null si no es un CP mexicano. */
function normalizarCP(cp) {
  const limpio = String(cp ?? "").replace(/[^0-9]/g, "");
  if (limpio.length !== 5) return null;
  return limpio;
}

/** CP → { estado, zona }. Devuelve null si el CP no cae en ningún rango. */
function ubicar(cp) {
  const limpio = normalizarCP(cp);
  if (!limpio) return null;
  const prefijo = parseInt(limpio.slice(0, 2), 10);
  const fila = ESTADOS_POR_CP.find(([a, b]) => prefijo >= a && prefijo <= b);
  if (!fila) return null;
  const estado = fila[2];
  return { cp: limpio, estado, zona: ZONA_POR_ESTADO[estado] || "nacional" };
}

// ----------------------------------------------------------------------------
// 3. Calendario hábil mexicano
// ----------------------------------------------------------------------------
/**
 * Una fecha de entrega que cae en domingo o el 16 de septiembre no es una
 * fecha de entrega: es una promesa rota con calendario.
 *
 * Días de descanso obligatorio (Ley Federal del Trabajo art. 74) más Jueves
 * y Viernes Santos, que no son oficiales pero durante los cuales las
 * paqueterías no mueven carga en México.
 */
const FERIADOS = new Set([
  // 2026
  "2026-01-01", "2026-02-02", "2026-03-16", "2026-04-02", "2026-04-03",
  "2026-05-01", "2026-09-16", "2026-11-16", "2026-12-25",
  // 2027
  "2027-01-01", "2027-02-01", "2027-03-15", "2027-03-25", "2027-03-26",
  "2027-05-01", "2027-09-16", "2027-11-15", "2027-12-25",
  // 2028
  "2028-01-01", "2028-02-07", "2028-03-20", "2028-04-13", "2028-04-14",
  "2028-05-01", "2028-09-16", "2028-11-20", "2028-12-25",
  // 2029
  "2029-01-01", "2029-02-05", "2029-03-19", "2029-03-29", "2029-03-30",
  "2029-05-01", "2029-09-16", "2029-11-19", "2029-12-25",
  // 2030 — incluye el 1 de diciembre: transmisión del Poder Ejecutivo, que
  // es descanso obligatorio cada seis años (art. 74 LFT).
  "2030-01-01", "2030-02-04", "2030-03-18", "2030-04-18", "2030-04-19",
  "2030-05-01", "2030-09-16", "2030-11-18", "2030-12-01", "2030-12-25"
]);

/* Última fecha con feriados cargados. Pasada esa fecha el cálculo sigue
   funcionando —salta fines de semana— pero deja de saltar días festivos, y una
   entrega prometida el 16 de septiembre es una queja. Se avisa al arrancar en
   vez de esperar a que alguien lo note. */
const FERIADOS_HASTA = "2030-12-25";

/* Se trabaja en horario del centro de México sin depender de la zona horaria
   del servidor: Render corre en UTC y un pedido de las 19:00 de México se
   contaría como del día siguiente. */
const TZ = process.env.ENVIOS_TZ || "America/Mexico_City";

function partesLocales(fecha) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false
  });
  const p = Object.fromEntries(fmt.formatToParts(fecha).map(x => [x.type, x.value]));
  return {
    iso: `${p.year}-${p.month}-${p.day}`,
    hora: parseInt(p.hour === "24" ? "0" : p.hour, 10)
  };
}

function esHabil(iso) {
  if (FERIADOS.has(iso)) return false;
  /* Se construye a mediodía UTC para que el día no se corra por zona horaria. */
  const dia = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dia !== 0 && dia !== 6; // 0 domingo, 6 sábado
}

function sumarDias(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Avanza `n` días HÁBILES desde `iso` (sin contar el día de partida). */
function diasHabilesDesde(iso, n) {
  let cursor = iso;
  let restantes = Math.max(0, n);
  let guarda = 0;
  while (restantes > 0 && guarda++ < 400) {
    cursor = sumarDias(cursor, 1);
    if (esHabil(cursor)) restantes--;
  }
  return cursor;
}

const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-09-03" → "jueves 3 de septiembre". Para que lo lea un humano. */
function fechaLarga(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS_ES[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES_ES[d.getUTCMonth()]}`;
}

/**
 * Calcula la ventana de entrega a partir de los días de TRÁNSITO de la
 * paquetería, sumando antes la preparación de Valquiria y respetando la hora
 * de corte.
 */
function ventanaDeEntrega(diasMin, diasMax, ahora = new Date()) {
  const { iso, hora } = partesLocales(ahora);

  /* Si ya pasó la hora de corte, o si hoy no es hábil, la preparación
     empieza a contar el siguiente día hábil. */
  let salida = iso;
  if (hora >= HORA_CORTE || !esHabil(iso)) salida = diasHabilesDesde(iso, 1);

  const despacho = diasHabilesDesde(salida, DIAS_PREPARACION);
  const min = diasHabilesDesde(despacho, diasMin);
  const max = diasHabilesDesde(despacho, diasMax);

  return {
    dias_preparacion: DIAS_PREPARACION,
    dias_transito: diasMin === diasMax ? `${diasMin}` : `${diasMin}-${diasMax}`,
    sale_de_taller: despacho,
    entrega_desde: min,
    entrega_hasta: max,
    /* La frase que ve el cliente. Una sola línea, sin jerga logística. */
    texto:
      min === max
        ? `Llega el ${fechaLarga(min)}`
        : `Llega entre el ${fechaLarga(min)} y el ${fechaLarga(max)}`
  };
}

// ----------------------------------------------------------------------------
// 4. Peso: real contra volumétrico
// ----------------------------------------------------------------------------

/** Peso facturable en kg: el mayor entre el real y el volumétrico. */
function pesoFacturable({ peso_kg, largo_cm, ancho_cm, alto_cm }) {
  const real = Number(peso_kg) > 0 ? Number(peso_kg) : 0;
  const l = Number(largo_cm) > 0 ? Number(largo_cm) : 0;
  const a = Number(ancho_cm) > 0 ? Number(ancho_cm) : 0;
  const h = Number(alto_cm) > 0 ? Number(alto_cm) : 0;
  const volumetrico = l && a && h ? (l * a * h) / DIVISOR_VOLUMETRICO : 0;
  const facturable = Math.max(real, volumetrico, 0.5); // nadie cobra menos de 1/2 kg
  return {
    real_kg: Math.round(real * 100) / 100,
    volumetrico_kg: Math.round(volumetrico * 100) / 100,
    facturable_kg: Math.ceil(facturable * 10) / 10,
    manda: volumetrico > real ? "volumétrico" : "real"
  };
}

/**
 * Estima peso y caja a partir de las líneas del carrito. Sirve para que el
 * cliente vea un costo de envío sin teclear dimensiones que no conoce.
 */
function pesoDelPedido(lineas = []) {
  let gramos = PESO_EMPAQUE_G;
  let piezas = 0;
  for (const l of Array.isArray(lineas) ? lineas : []) {
    const cant = Math.max(1, parseInt(l?.cantidad, 10) || 1);
    const unit = PESOS_POR_SKU[l?.sku] || PESO_POR_OMISION_G;
    gramos += unit * cant;
    piezas += cant;
  }
  /* Caja que crece por escalones, no de forma continua: nadie tiene una caja
     de 23.4 cm. Son las tres medidas de cartón que se usan en el taller. */
  const caja =
    piezas <= 2 ? { largo_cm: 25, ancho_cm: 20, alto_cm: 12 }
    : piezas <= 6 ? { largo_cm: 35, ancho_cm: 25, alto_cm: 18 }
    : { largo_cm: 45, ancho_cm: 35, alto_cm: 25 };

  return { peso_kg: Math.round((gramos / 1000) * 100) / 100, piezas, ...caja };
}

// ----------------------------------------------------------------------------
// 5. Tarifas de referencia (proveedor `tabla`)
// ----------------------------------------------------------------------------
/**
 * Tarifas en CENTAVOS por escalón de peso. Son de REFERENCIA: reflejan el
 * orden de magnitud del mercado mexicano terrestre, no un contrato firmado.
 *
 * Se pueden reemplazar completas sin tocar código:
 *   ENVIOS_TARIFAS_JSON={"nacional":{"terrestre":{"escalones":[[1,18000]]}}}
 */
const TARIFAS_BASE = {
  local: {
    terrestre: { escalones: [[1, 11000], [3, 13500], [5, 16500], [10, 23000], [20, 36000], [30, 48000]], extra_kg: 1600, dias: [1, 2] },
    express:   { escalones: [[1, 18000], [3, 22000], [5, 27000], [10, 38000], [20, 60000], [30, 80000]], extra_kg: 2600, dias: [1, 1] }
  },
  metropolitana: {
    terrestre: { escalones: [[1, 13500], [3, 16500], [5, 20000], [10, 29000], [20, 45000], [30, 60000]], extra_kg: 2000, dias: [2, 3] },
    express:   { escalones: [[1, 22000], [3, 27000], [5, 33000], [10, 48000], [20, 75000], [30, 99000]], extra_kg: 3300, dias: [1, 2] }
  },
  nacional: {
    terrestre: { escalones: [[1, 17000], [3, 21000], [5, 26000], [10, 38000], [20, 60000], [30, 80000]], extra_kg: 2600, dias: [3, 5] },
    express:   { escalones: [[1, 28000], [3, 34000], [5, 42000], [10, 62000], [20, 98000], [30, 130000]], extra_kg: 4200, dias: [2, 3] }
  },
  extendida: {
    terrestre: { escalones: [[1, 23000], [3, 29000], [5, 36000], [10, 52000], [20, 82000], [30, 110000]], extra_kg: 3600, dias: [5, 8] },
    express:   { escalones: [[1, 38000], [3, 47000], [5, 58000], [10, 85000], [20, 134000], [30, 179000]], extra_kg: 5800, dias: [3, 4] }
  }
};

const TARIFAS = (() => {
  try {
    const extra = JSON.parse(process.env.ENVIOS_TARIFAS_JSON || "{}");
    const salida = JSON.parse(JSON.stringify(TARIFAS_BASE));
    for (const [zona, servicios] of Object.entries(extra)) {
      salida[zona] = { ...(salida[zona] || {}), ...servicios };
    }
    return salida;
  } catch {
    console.error("[envios] ENVIOS_TARIFAS_JSON no es JSON válido; se usan las tarifas base.");
    return TARIFAS_BASE;
  }
})();

function costoPorTabla(zona, servicio, kg) {
  const t = TARIFAS[zona]?.[servicio];
  if (!t) return null;
  for (const [tope, centavos] of t.escalones) {
    if (kg <= tope) return { centavos, dias: t.dias };
  }
  const ultimo = t.escalones[t.escalones.length - 1];
  const excedente = Math.ceil(kg - ultimo[0]);
  return { centavos: ultimo[1] + excedente * t.extra_kg, dias: t.dias };
}

// ----------------------------------------------------------------------------
// 6. Proveedores en vivo
// ----------------------------------------------------------------------------

async function pedirConTimeout(url, opciones) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), TIMEOUT_API_MS);
  try {
    return await fetch(url, { ...opciones, signal: ctrl.signal });
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Envia.com — POST /ship/rate/. Un solo contrato cotiza varias paqueterías.
 * Devuelve `null` (no lanza) si algo falla: quien llama cae a la tabla.
 */
async function cotizarConEnvia(origen, destino, paquete) {
  const key = process.env.ENVIA_API_KEY;
  if (!key) return null;
  const base = process.env.ENVIA_API_URL || "https://api.envia.com";
  try {
    const r = await pedirConTimeout(`${base}/ship/rate/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        origin: { postalCode: origen.cp, country: "MX" },
        destination: { postalCode: destino.cp, country: "MX" },
        packages: [{
          content: "Material didáctico",
          amount: 1,
          type: "box",
          weight: paquete.facturable_kg,
          weightUnit: "KG",
          lengthUnit: "CM",
          dimensions: {
            length: paquete.largo_cm, width: paquete.ancho_cm, height: paquete.alto_cm
          }
        }],
        shipment: { type: 1 },
        settings: { currency: "MXN" }
      })
    });
    if (!r.ok) {
      console.error(`[envios] Envia.com respondió ${r.status}`);
      return null;
    }
    const json = await r.json();
    const filas = Array.isArray(json?.data) ? json.data : [];
    return filas
      .filter(f => Number(f?.totalPrice) > 0)
      .map(f => ({
        paqueteria: String(f.carrierDescription || f.carrier || "Paquetería"),
        servicio: String(f.serviceDescription || f.service || "Estándar"),
        costo_centavos: Math.round(Number(f.totalPrice) * 100),
        dias_min: Math.max(1, parseInt(f.deliveryEstimate, 10) || 3),
        dias_max: Math.max(1, parseInt(f.deliveryEstimate, 10) || 5)
      }));
  } catch (e) {
    console.error("[envios] Envia.com falló:", String(e?.message || e).slice(0, 160));
    return null;
  }
}

/** Skydropx — POST /v1/quotations. Misma forma de salida que Envia. */
async function cotizarConSkydropx(origen, destino, paquete) {
  const key = process.env.SKYDROPX_API_KEY;
  if (!key) return null;
  const base = process.env.SKYDROPX_API_URL || "https://api.skydropx.com";
  try {
    const r = await pedirConTimeout(`${base}/v1/quotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token token=${key}` },
      body: JSON.stringify({
        zip_from: origen.cp,
        zip_to: destino.cp,
        parcel: {
          weight: paquete.facturable_kg,
          length: paquete.largo_cm,
          width: paquete.ancho_cm,
          height: paquete.alto_cm
        }
      })
    });
    if (!r.ok) {
      console.error(`[envios] Skydropx respondió ${r.status}`);
      return null;
    }
    const json = await r.json();
    const filas = Array.isArray(json?.rates) ? json.rates : [];
    return filas
      .filter(f => Number(f?.total_pricing) > 0)
      .map(f => ({
        paqueteria: String(f.provider || "Paquetería"),
        servicio: String(f.service_level_name || "Estándar"),
        costo_centavos: Math.round(Number(f.total_pricing) * 100),
        dias_min: Math.max(1, parseInt(f.days, 10) || 3),
        dias_max: Math.max(1, parseInt(f.days, 10) || 5)
      }));
  } catch (e) {
    console.error("[envios] Skydropx falló:", String(e?.message || e).slice(0, 160));
    return null;
  }
}

// ----------------------------------------------------------------------------
// 7. La función pública
// ----------------------------------------------------------------------------

const pesos = c => `$${(c / 100).toFixed(2)} MXN`;

/**
 * Cotiza el envío a un código postal.
 *
 * @param {object} p
 * @param {string} p.cp_destino          CP mexicano de 5 dígitos.
 * @param {Array}  [p.lineas]            Líneas del carrito ({sku, cantidad}).
 * @param {number} [p.peso_kg]           Peso real, si se conoce.
 * @param {number} [p.largo_cm|ancho_cm|alto_cm]
 * @param {number} [p.subtotal_centavos] Para aplicar el envío gratis.
 * @returns {Promise<object>} { ok, opciones[], ... } — nunca lanza.
 */
async function cotizarEnvio(p = {}) {
  const destino = ubicar(p.cp_destino);
  if (!destino) {
    return {
      ok: false,
      error:
        "Necesito un código postal mexicano de 5 dígitos para calcular el " +
        "envío. Por ejemplo: 42000.",
      cp_recibido: p.cp_destino ?? null
    };
  }

  const origen = ubicar(CP_ORIGEN) || { cp: CP_ORIGEN, estado: "Hidalgo", zona: "local" };

  /* Si vienen líneas, el peso se deduce del pedido; si no, de lo que pasen. */
  const delPedido = Array.isArray(p.lineas) && p.lineas.length
    ? pesoDelPedido(p.lineas)
    : null;

  const paquete = pesoFacturable({
    peso_kg: p.peso_kg ?? delPedido?.peso_kg,
    largo_cm: p.largo_cm ?? delPedido?.largo_cm,
    ancho_cm: p.ancho_cm ?? delPedido?.ancho_cm,
    alto_cm: p.alto_cm ?? delPedido?.alto_cm
  });
  const caja = {
    largo_cm: p.largo_cm ?? delPedido?.largo_cm ?? 25,
    ancho_cm: p.ancho_cm ?? delPedido?.ancho_cm ?? 20,
    alto_cm: p.alto_cm ?? delPedido?.alto_cm ?? 12
  };

  // --- Tarifas: primero en vivo, luego la red de seguridad ---
  let crudas = null;
  let fuente = "referencia";

  if (PROVEEDOR === "envia") {
    crudas = await cotizarConEnvia(origen, destino, { ...paquete, ...caja });
    if (crudas?.length) fuente = "Envia.com";
  } else if (PROVEEDOR === "skydropx") {
    crudas = await cotizarConSkydropx(origen, destino, { ...paquete, ...caja });
    if (crudas?.length) fuente = "Skydropx";
  }

  if (!crudas || !crudas.length) {
    crudas = ["terrestre", "express"]
      .map(servicio => {
        const t = costoPorTabla(destino.zona, servicio, paquete.facturable_kg);
        if (!t) return null;
        return {
          paqueteria: "Paquetería nacional",
          servicio: servicio === "terrestre" ? "Terrestre (estándar)" : "Express",
          costo_centavos: t.centavos,
          dias_min: t.dias[0],
          dias_max: t.dias[1]
        };
      })
      .filter(Boolean);
    fuente = "referencia";
  }

  /* Envío gratis: NO se le regala al cliente el express, solo el más barato.
     Regalar el servicio caro convierte una promoción en una fuga. */
  const subtotal = Number.isInteger(p.subtotal_centavos) ? p.subtotal_centavos : 0;
  const aplicaGratis = subtotal >= ENVIO_GRATIS_DESDE_CENTAVOS;

  const ordenadas = crudas.slice().sort((a, b) => a.costo_centavos - b.costo_centavos);

  const opciones = ordenadas.map((o, i) => {
    const gratis = aplicaGratis && i === 0;
    const cobro = gratis ? 0 : o.costo_centavos;
    const entrega = ventanaDeEntrega(o.dias_min, o.dias_max);
    return {
      paqueteria: o.paqueteria,
      servicio: o.servicio,
      costo_centavos: cobro,
      costo: gratis ? "Gratis" : pesos(cobro),
      costo_lista: pesos(o.costo_centavos),
      envio_gratis: gratis,
      ...entrega,
      recomendada: i === 0
    };
  });

  const falta = aplicaGratis ? 0 : ENVIO_GRATIS_DESDE_CENTAVOS - subtotal;

  return {
    ok: true,
    fuente,
    es_estimacion: fuente === "referencia",
    origen: { cp: origen.cp, estado: origen.estado },
    destino: { cp: destino.cp, estado: destino.estado, zona: destino.zona },
    paquete: {
      ...paquete,
      ...caja,
      piezas: delPedido?.piezas ?? null,
      nota_peso: `Se cobra el peso ${paquete.manda} (${paquete.facturable_kg} kg).`
    },
    envio_gratis_desde: pesos(ENVIO_GRATIS_DESDE_CENTAVOS),
    falta_para_envio_gratis: falta > 0 ? pesos(falta) : null,
    falta_para_envio_gratis_centavos: falta > 0 ? falta : 0,
    opciones,
    /* Frase lista para el Asesor: un renglón, con la advertencia incluida
       cuando el número salió de la tabla y no de una paquetería. */
    resumen:
      opciones.length
        ? `${opciones[0].servicio} a ${destino.estado} (CP ${destino.cp}): ` +
          `${opciones[0].costo}. ${opciones[0].texto}.` +
          (fuente === "referencia"
            ? " Tarifa de referencia; la guía definitiva se confirma al generar el envío."
            : ` Cotización en vivo vía ${fuente}.`)
        : "No hay servicio disponible a ese código postal.",
    aviso_para_el_asesor:
      fuente === "referencia"
        ? "ESTIMACIÓN de tabla interna, NO cotización de paquetería. Preséntala " +
          "siempre como estimado y aclara que la guía definitiva se confirma al " +
          "generar el envío."
        : `Cotización real de ${fuente}. Puedes darla como firme para hoy; ` +
          `las tarifas de paquetería cambian sin aviso.`
  };
}

/** Estado del módulo, para /health y para la auditoría de arranque. */
function estadoEnvios() {
  const vivo =
    (PROVEEDOR === "envia" && !!process.env.ENVIA_API_KEY) ||
    (PROVEEDOR === "skydropx" && !!process.env.SKYDROPX_API_KEY);
  /* Se avisa con seis meses de margen, que es tiempo de sobra para añadir el
     año siguiente sin prisas. */
  const margen = new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10);
  return {
    proveedor: PROVEEDOR,
    tarifas_en_vivo: vivo,
    feriados_hasta: FERIADOS_HASTA,
    feriados_por_caducar: margen > FERIADOS_HASTA,
    cp_origen: CP_ORIGEN,
    dias_preparacion: DIAS_PREPARACION,
    hora_corte: HORA_CORTE,
    envio_gratis_desde: pesos(ENVIO_GRATIS_DESDE_CENTAVOS)
  };
}

module.exports = {
  cotizarEnvio,
  estadoEnvios,
  FERIADOS_HASTA,
  // Exportados para pruebas y para reutilizar desde el carrito:
  ubicar,
  normalizarCP,
  pesoFacturable,
  pesoDelPedido,
  ventanaDeEntrega,
  diasHabilesDesde,
  esHabil,
  fechaLarga,
  costoPorTabla
};
