/**
 * ============================================================================
 *  VALQUIRIA PACK — ESTIMADOR DE TERMOFORMADO  (termoformado.js v1)
 * ============================================================================
 *  CAMBIO DE POLÍTICA, DELIBERADO Y DOCUMENTADO:
 *
 *  Hasta hoy la regla de Pack era "NUNCA des un precio, ni un rango". Era una
 *  decisión razonable —cada molde es distinto y el contacto humano era parte
 *  del producto— pero tenía un costo: el prospecto que solo quería saber el
 *  orden de magnitud se iba sin nada, y esos son la mayoría.
 *
 *  Este módulo sustituye el silencio por un número ACOTADO Y EXPLICADO. No es
 *  lo mismo callar que inventar: aquí cada peso se desglosa (molde, lámina,
 *  formado, merma) y el resultado sale siempre como RANGO con su margen de
 *  incertidumbre declarado. El especialista sigue cerrando; ahora entra a la
 *  conversación con el cliente ya calificado y con expectativa formada.
 *
 *  CÓMO SE COTIZA UN TERMOFORMADO DE VERDAD
 *  Tres costos que se comportan distinto:
 *
 *   1. MOLDE — se paga UNA vez. Es un costo fijo del proyecto, no del tiraje.
 *      Es la razón por la que 100 piezas salen carísimas por unidad y 5,000
 *      salen baratas: el molde se reparte entre todas.
 *   2. LÁMINA — proporcional al ÁREA que ocupa la pieza en la lámina, más la
 *      merma del recorte. No al volumen ni al peso de lo que va dentro.
 *   3. FORMADO — el ciclo de máquina, que se cobra por lámina, no por pieza.
 *      Meter cuatro cavidades en una lámina divide este costo entre cuatro.
 *
 *  TODOS LOS PARÁMETROS SON DE REFERENCIA y se sobreescriben por entorno sin
 *  tocar código (PACK_*). Cuando el taller tenga sus costos reales medidos,
 *  se cargan ahí y el estimador deja de ser referencia para ser tarifa.
 * ============================================================================
 */

"use strict";

const num = (v, def) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

// ----------------------------------------------------------------------------
// 1. Parámetros del taller
// ----------------------------------------------------------------------------

/* Lámina estándar y su área ÚTIL (lo que queda dentro del marco de sujeción). */
const LAMINA_LARGO_CM = num(process.env.PACK_LAMINA_LARGO_CM, 60);
const LAMINA_ANCHO_CM = num(process.env.PACK_LAMINA_ANCHO_CM, 40);
const LAMINA_AREA_UTIL_M2 = (LAMINA_LARGO_CM * LAMINA_ANCHO_CM) / 10000;

/* Margen entre cavidades y contra el borde. Sin él las piezas se deforman
   entre sí al formar. */
const MARGEN_CM = num(process.env.PACK_MARGEN_CM, 2);

/* Merma: recorte, arranques de máquina y piezas fuera de tolerancia. */
const MERMA = num(process.env.PACK_MERMA, 0.22);

/* Precio de lámina por m², por material y calibre. Referencia de mercado. */
const MATERIALES = {
  ps_blanco_20: { nombre: "Poliestireno blanco cal. 20 (0.50 mm)", m2: num(process.env.PACK_PS20_M2, 52), opaco: true },
  ps_blanco_30: { nombre: "Poliestireno blanco cal. 30 (0.75 mm)", m2: num(process.env.PACK_PS30_M2, 78), opaco: true },
  pet_cristal_20: { nombre: "PET cristal cal. 20 (0.50 mm)", m2: num(process.env.PACK_PET20_M2, 85), opaco: false },
  pet_cristal_30: { nombre: "PET cristal cal. 30 (0.75 mm)", m2: num(process.env.PACK_PET30_M2, 125), opaco: false },
  vinil_cristal_20: { nombre: "Vinil cristal cal. 20 (0.50 mm)", m2: num(process.env.PACK_VINIL20_M2, 72), opaco: false }
};

const ALIAS_MATERIAL = {
  ps: "ps_blanco_20", poliestireno: "ps_blanco_20", blanco: "ps_blanco_20",
  base: "ps_blanco_20", charola: "ps_blanco_20", opaco: "ps_blanco_20",
  pet: "pet_cristal_20", cristal: "pet_cristal_20", transparente: "pet_cristal_20",
  tapa: "pet_cristal_20", blister: "pet_cristal_20", "blíster": "pet_cristal_20",
  vinil: "vinil_cristal_20", pvc: "vinil_cristal_20",
  grueso: "ps_blanco_30", resistente: "ps_blanco_30"
};

/* Molde impreso en 3D: un fijo por proyecto más lo que cuesta la superficie
   de cavidad. Un molde de 5 cm² y uno de 500 cm² no cuestan lo mismo. */
const MOLDE_FIJO = num(process.env.PACK_MOLDE_FIJO, 850);
const MOLDE_POR_CM2 = num(process.env.PACK_MOLDE_CM2, 3.2);
const MOLDE_MINIMO = num(process.env.PACK_MOLDE_MINIMO, 1200);

/* Complejidad: multiplica el molde, no la lámina. */
const COMPLEJIDAD = {
  simple: { factor: 1.0, desc: "Geometría sencilla: caja, charola plana, cavidad de una profundidad." },
  media: { factor: 1.45, desc: "Varias cavidades, escalones o detalle de sujeción." },
  alta: { factor: 2.1, desc: "Contornos orgánicos, socavados o tolerancias finas." }
};

/* Ciclo de máquina por lámina y arranque por corrida. */
const FORMADO_POR_LAMINA = num(process.env.PACK_FORMADO_LAMINA, 11);
const SETUP_POR_CORRIDA = num(process.env.PACK_SETUP, 450);

const MARGEN_COMERCIAL = num(process.env.PACK_MARGEN_COMERCIAL, 1.55);

/* Ancho de la horquilla que se le enseña al cliente: ±18 %. Es honestidad
   numérica, no cobardía: sin el archivo del producto en la mano, prometer una
   cifra exacta es prometer una discusión. */
const HORQUILLA = num(process.env.PACK_HORQUILLA, 0.18);

const TIRAJE_MINIMO = parseInt(process.env.PACK_TIRAJE_MINIMO || "100", 10);

// ----------------------------------------------------------------------------
// 2. Ayudas
// ----------------------------------------------------------------------------

const mx = n =>
  `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

function resolverMaterial(texto) {
  const t = String(texto || "").toLowerCase().trim();
  if (!t) return "ps_blanco_20";
  if (MATERIALES[t]) return t;
  for (const [alias, clave] of Object.entries(ALIAS_MATERIAL)) {
    if (t.includes(alias)) return clave;
  }
  return "ps_blanco_20";
}

function resolverComplejidad(texto) {
  const t = String(texto || "").toLowerCase();
  if (/alta|complej|orgánic|organic|socavad|fino|dificil|difícil/.test(t)) return "alta";
  if (/simple|sencill|plana|basic|básic|caja/.test(t)) return "simple";
  return "media";
}

/**
 * Cuántas cavidades caben en una lámina. Se prueban las dos orientaciones y
 * gana la que más rinda: girar la pieza 90° puede cambiar el costo unitario
 * un 30 %, y es gratis.
 */
function cavidadesPorLamina(largo, ancho) {
  const l = largo + MARGEN_CM;
  const a = ancho + MARGEN_CM;
  const opcion = (x, y) =>
    Math.max(0, Math.floor(LAMINA_LARGO_CM / x)) * Math.max(0, Math.floor(LAMINA_ANCHO_CM / y));
  return Math.max(opcion(l, a), opcion(a, l));
}

// ----------------------------------------------------------------------------
// 3. El estimador
// ----------------------------------------------------------------------------

/**
 * @param {object} p
 * @param {number} p.largo_cm     Largo de la pieza que va dentro.
 * @param {number} p.ancho_cm     Ancho.
 * @param {number} [p.alto_cm]    Profundidad de la cavidad.
 * @param {number} [p.tiraje]     Piezas de la corrida.
 * @param {string} [p.material]   Texto libre: "transparente", "PET", "base blanca"…
 * @param {string} [p.complejidad] "simple" | "media" | "alta" o texto libre.
 * @param {boolean}[p.con_tapa]   Base + tapa: dos moldes y dos formados.
 * @param {boolean}[p.molde_del_cliente] Servicio de bajada: no se cobra molde.
 */
function estimarTermoformado(p = {}) {
  const largo = num(p.largo_cm, 0);
  const ancho = num(p.ancho_cm, 0);
  const alto = num(p.alto_cm, 3);

  if (!largo || !ancho) {
    return {
      ok: false,
      error:
        "Para estimar un empaque necesito el largo y el ancho del producto que " +
        "va dentro, en centímetros. Con eso y el tiraje ya sale un rango.",
      falta: ["largo_cm", "ancho_cm"]
    };
  }
  if (largo > LAMINA_LARGO_CM - MARGEN_CM || ancho > LAMINA_ANCHO_CM - MARGEN_CM) {
    return {
      ok: false,
      error:
        `Esa pieza (${largo}×${ancho} cm) no cabe en la lámina estándar de ` +
        `${LAMINA_LARGO_CM}×${LAMINA_ANCHO_CM} cm. Se puede hacer, pero con ` +
        `lámina especial: lo tiene que ver el especialista.`,
      requiere_especialista: true
    };
  }

  const tiraje = Math.max(1, parseInt(p.tiraje, 10) || 500);
  const claveMat = resolverMaterial(p.material);
  const material = MATERIALES[claveMat];
  const claveComp = resolverComplejidad(p.complejidad);
  const complejidad = COMPLEJIDAD[claveComp];
  const conTapa = Boolean(p.con_tapa);
  const juegos = conTapa ? 2 : 1; // base y tapa: dos moldes, dos formados

  // --- Molde (una sola vez en la vida del proyecto) ---
  const areaCavidadCm2 = largo * ancho;
  /* La profundidad encarece el molde: estirar más lámina exige más altura de
     macho y más ajuste. Se refleja como recargo suave, no lineal. */
  const factorAlto = 1 + Math.min(0.6, alto / 25);
  const moldeUnitario = Math.max(
    MOLDE_MINIMO,
    (MOLDE_FIJO + areaCavidadCm2 * MOLDE_POR_CM2) * complejidad.factor * factorAlto
  );
  const molde = p.molde_del_cliente ? 0 : Math.round(moldeUnitario * juegos);

  // --- Lámina y formado (proporcionales al tiraje) ---
  const porLamina = cavidadesPorLamina(largo, ancho);
  if (!porLamina) {
    return {
      ok: false,
      error: "Con esas medidas no cabe ninguna cavidad completa en la lámina.",
      requiere_especialista: true
    };
  }
  const laminasPorJuego = Math.ceil(tiraje / porLamina);
  const laminas = Math.ceil(laminasPorJuego * juegos * (1 + MERMA));
  const costoLamina = laminas * LAMINA_AREA_UTIL_M2 * material.m2;
  const costoFormado = laminas * FORMADO_POR_LAMINA + SETUP_POR_CORRIDA;

  const costoVariable = (costoLamina + costoFormado) * MARGEN_COMERCIAL;
  const centro = molde + costoVariable;

  const bajo = centro * (1 - HORQUILLA);
  const alto_ = centro * (1 + HORQUILLA);
  const unitarioCentro = centro / tiraje;
  const unitarioSinMolde = costoVariable / tiraje;

  // --- Escalera de tiraje: el argumento comercial más fuerte que existe ---
  const escalones = [100, 250, 500, 1000, 2500, 5000]
    .filter(t => t !== tiraje)
    .concat([tiraje])
    .sort((a, b) => a - b)
    .map(t => {
      const lpj = Math.ceil(t / porLamina);
      const lam = Math.ceil(lpj * juegos * (1 + MERMA));
      const variable =
        (lam * LAMINA_AREA_UTIL_M2 * material.m2 + lam * FORMADO_POR_LAMINA + SETUP_POR_CORRIDA) *
        MARGEN_COMERCIAL;
      const total = molde + variable;
      return {
        tiraje: t,
        unitario: mx(total / t),
        total: mx(total),
        es_el_consultado: t === tiraje
      };
    });

  const dias = tiraje <= 500 ? "7 a 10" : tiraje <= 2000 ? "10 a 15" : "15 a 20";

  return {
    ok: true,
    es_estimacion: true,
    division: "pack",

    pieza: {
      largo_cm: largo, ancho_cm: ancho, alto_cm: alto,
      area_cm2: Math.round(areaCavidadCm2),
      cavidades_por_lamina: porLamina,
      juego: conTapa ? "base + tapa" : "solo base"
    },
    material: { clave: claveMat, nombre: material.nombre, transparente: !material.opaco },
    complejidad: { nivel: claveComp, descripcion: complejidad.desc },

    tiraje,
    tiraje_minimo_sugerido: TIRAJE_MINIMO,

    desglose: {
      molde: p.molde_del_cliente
        ? "No se cobra: el cliente aporta el molde (servicio de bajada)."
        : mx(molde),
      molde_centavos: Math.round(molde * 100),
      laminas_necesarias: laminas,
      merma_incluida: `${Math.round(MERMA * 100)}%`,
      lamina_y_formado: mx(costoVariable),
      nota:
        "El molde se paga una sola vez. Reordenar el mismo empaque después " +
        "cuesta solo lámina y formado."
    },

    total_estimado: {
      rango: `${mx(bajo)} — ${mx(alto_)}`,
      centro: mx(centro),
      centro_centavos: Math.round(centro * 100),
      unitario: mx(unitarioCentro),
      unitario_en_reorden: mx(unitarioSinMolde)
    },

    escalones_de_tiraje: escalones,
    tiempo_estimado: `${dias} días hábiles desde la aprobación del molde`,

    /* Lo que el Asesor tiene prohibido omitir al dar este número. */
    condiciones: [
      "Es una ESTIMACIÓN preliminar calculada con tarifas de referencia del taller.",
      "El precio en firme lo confirma el especialista viendo el producto o su archivo 3D: la geometría real puede cambiar el molde.",
      "No incluye impresión, etiquetado, sellado ni maquila de empaquetado.",
      "No incluye IVA ni envío del tiraje.",
      `Tiraje mínimo sugerido: ${TIRAJE_MINIMO} piezas.`
    ],

    argumento_de_volumen:
      `El molde se reparte entre todas las piezas: a ${tiraje} salen a ` +
      `${mx(unitarioCentro)} cada una, y en una reorden del mismo empaque ` +
      `bajan a ${mx(unitarioSinMolde)}.`,

    siguiente_paso:
      "Dar el rango, explicar que el molde es un pago único, y registrar el " +
      "interés con registrar_interes para que el especialista confirme con el " +
      "producto en la mano."
  };
}

/** Tarifas vivas para la capa de conocimiento. Una sola fuente de verdad. */
function tarifasDeReferencia() {
  return {
    materiales: Object.entries(MATERIALES).map(([clave, m]) => ({
      clave, nombre: m.nombre, precio_m2: mx(m.m2), transparente: !m.opaco
    })),
    lamina_estandar: `${LAMINA_LARGO_CM} × ${LAMINA_ANCHO_CM} cm`,
    molde_desde: mx(MOLDE_MINIMO),
    merma: `${Math.round(MERMA * 100)}%`,
    tiraje_minimo: TIRAJE_MINIMO,
    aviso:
      "Tarifas de referencia del taller, no lista de precios pública. Sirven " +
      "para estimar; el precio en firme lo da el especialista."
  };
}

module.exports = { estimarTermoformado, tarifasDeReferencia, MATERIALES, COMPLEJIDAD };
