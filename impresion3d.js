/**
 * ============================================================================
 *  MOTOR DE ESTIMACIÓN — VALQUIRIA 3D  (impresion3d.js v1)
 * ============================================================================
 *  El equivalente de quote-engine.js para la división de impresión 3D.
 *  Mismas reglas de blindaje:
 *
 *  1. Toda aritmética en CENTAVOS ENTEROS. Nunca flotantes acumulados.
 *  2. El modelo de lenguaje NUNCA calcula: solo llama esta función.
 *  3. Entradas absurdas se rechazan con un mensaje que el asesor puede
 *     explicarle al usuario.
 *  4. Cada estimación se auto-verifica antes de devolverse.
 *
 *  LA REGLA COMERCIAL (definida por dirección, agosto 2026):
 *  Se cobra por gramo O por hora de impresión — LO QUE MÁS CONVENGA AL
 *  CLIENTE. Si el usuario da las dos medidas, se calculan ambas y gana la
 *  más barata. Es un argumento de venta, no un tecnicismo: díselo al cliente.
 *
 *  IMPORTANTE — esto es una ESTIMACIÓN PRELIMINAR, no una cotización en
 *  firme. La cotización final la confirma un especialista con el archivo
 *  (STL/STEP) en la mano, porque la orientación, los soportes y el relleno
 *  cambian el peso y el tiempo reales.
 * ============================================================================
 */

const { centavosAPesos } = require("./quote-engine.js");

// ------- TARIFAS (vía ENV vars con defaults, en centavos) -------

const TARIFA_HORA_CENTAVOS = parseInt(
  process.env.IMP3D_TARIFA_HORA_CENTAVOS || "8000", 10   // $80.00 MXN / hora
);
const PEDIDO_MINIMO_CENTAVOS = parseInt(
  process.env.IMP3D_PEDIDO_MINIMO_CENTAVOS || "15000", 10 // $150.00 MXN
);

/* Centavos por gramo, por material. El PLA marca la referencia pública
   ($2.50/g); el resto escala por costo real de filamento y dificultad. */
const MATERIALES = {
  pla:    { clave: "pla",    nombre: "PLA",            centavos_por_gramo: 250,
            nota: "Rígido, preciso y económico. El caballo de batalla para prototipos y piezas de uso ligero." },
  petg:   { clave: "petg",   nombre: "PETG",           centavos_por_gramo: 300,
            nota: "Mejor resistencia mecánica y a humedad que el PLA. Piezas funcionales de uso diario." },
  abs:    { clave: "abs",    nombre: "ABS / ASA",      centavos_por_gramo: 300,
            nota: "Resiste calor e impacto. ASA además aguanta intemperie." },
  tpu:    { clave: "tpu",    nombre: "TPU (flexible)", centavos_por_gramo: 350,
            nota: "Flexible tipo goma. Fundas, juntas, amortiguadores." },
  resina: { clave: "resina", nombre: "Resina",         centavos_por_gramo: 500,
            nota: "Detalle fino y superficie lisa. Incluye lavado y curado UV." }
};

const SINONIMOS_MATERIAL = {
  pla: "pla",
  petg: "petg", pet: "petg",
  abs: "abs", asa: "abs",
  tpu: "tpu", flexible: "tpu", flex: "tpu", goma: "tpu",
  resina: "resina", sla: "resina", dlp: "resina", msla: "resina",
  photopolymer: "resina", fotopolimero: "resina"
};

/* Recargo de post-procesado, en PORCENTAJE ENTERO sobre el costo de
   impresión. La pintura incluye el lijado previo (nadie pinta sin lijar). */
const POSTPROCESADO = {
  ninguno: { clave: "ninguno", pct: 0,  nombre: "Sin post-procesado" },
  lijado:  { clave: "lijado",  pct: 20, nombre: "Lijado / alisado" },
  pintura: { clave: "pintura", pct: 50, nombre: "Pintura (incluye lijado)" }
};

const SINONIMOS_POST = {
  ninguno: "ninguno", no: "ninguno", nada: "ninguno", crudo: "ninguno",
  lijado: "lijado", lijar: "lijado", alisado: "lijado", pulido: "lijado",
  pintura: "pintura", pintar: "pintura", pintado: "pintura",
  acabado: "pintura", color: "pintura"
};

// A partir de cuántas piezas el pedido se trata como mayoreo (lead, no chat).
const UMBRAL_MAYOREO = 10;

// ------- HELPERS -------

function normalizar(s) {
  return String(s == null ? "" : s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function resolverMaterial(texto) {
  const limpio = normalizar(texto);
  if (SINONIMOS_MATERIAL[limpio]) return MATERIALES[SINONIMOS_MATERIAL[limpio]];
  for (const token of limpio.split(/\s+/)) {
    if (SINONIMOS_MATERIAL[token]) return MATERIALES[SINONIMOS_MATERIAL[token]];
  }
  return null;
}

function resolverPostprocesado(texto) {
  if (texto == null || texto === "") return POSTPROCESADO.ninguno;
  const limpio = normalizar(texto);
  if (SINONIMOS_POST[limpio]) return POSTPROCESADO[SINONIMOS_POST[limpio]];
  for (const token of limpio.split(/\s+/)) {
    if (SINONIMOS_POST[token]) return POSTPROCESADO[SINONIMOS_POST[token]];
  }
  return null;
}

// ------- LA ESTIMACIÓN -------

/**
 * Calcula la estimación preliminar de una impresión 3D.
 *
 * @param {object} args
 * @param {string} args.material        pla | petg | abs | tpu | resina (tolerante)
 * @param {number} args.gramos          peso estimado por pieza, en gramos
 * @param {number} [args.horas]         horas de impresión por pieza (opcional)
 * @param {number} [args.cantidad=1]    piezas idénticas
 * @param {string} [args.postprocesado] ninguno | lijado | pintura
 */
function estimarImpresion3D(args) {
  const a = args || {};

  // --- Material ---
  const material = resolverMaterial(a.material);
  if (!material) {
    return {
      ok: false,
      error:
        "Material no reconocido. Materiales disponibles: PLA, PETG, ABS/ASA, " +
        "TPU (flexible) y resina. Pregúntale al usuario cuál necesita — o " +
        "sugiérele según el uso: si la pieza debe AGUANTAR, PETG o ABS; si " +
        "debe VERSE con detalle fino, resina; si no está seguro, PLA."
    };
  }

  // --- Gramos ---
  const gramos = Number(a.gramos);
  if (!Number.isFinite(gramos) || gramos <= 0) {
    return {
      ok: false,
      error:
        "Falta el peso estimado en gramos (mayor a 0). Si el usuario no lo " +
        "sabe, dale referencias: una pieza tamaño llavero pesa 5-15 g, una " +
        "taza ~100 g, un casco ~400-800 g. También puede mandar el archivo " +
        "por WhatsApp y el especialista lo pesa exacto."
    };
  }
  if (gramos > 20000) {
    return {
      ok: false,
      error:
        "Más de 20 kg por pieza sale del estimador: es un proyecto de " +
        "producción. Registra el interés para que un especialista lo cotice."
    };
  }

  // --- Horas (opcionales) ---
  let horas = null;
  if (a.horas != null && a.horas !== "") {
    horas = Number(a.horas);
    if (!Number.isFinite(horas) || horas <= 0 || horas > 500) {
      return {
        ok: false,
        error:
          "Las horas de impresión deben ser un número entre 0 y 500. Si el " +
          "usuario no las sabe, omite el dato: la estimación sale por gramo."
      };
    }
  }

  // --- Cantidad ---
  let cantidad = 1;
  if (a.cantidad != null && a.cantidad !== "") {
    cantidad = Number(a.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 500) {
      return {
        ok: false,
        error: "La cantidad debe ser un entero entre 1 y 500."
      };
    }
  }

  // --- Post-procesado ---
  const post = resolverPostprocesado(a.postprocesado);
  if (!post) {
    return {
      ok: false,
      error:
        "Post-procesado no reconocido. Opciones: 'ninguno', 'lijado' (+20%) " +
        "o 'pintura' (+50%, incluye lijado)."
    };
  }

  // --- Cálculo, todo en centavos enteros ---
  const por_gramo_centavos = Math.round(gramos * material.centavos_por_gramo);
  const por_hora_centavos = horas == null ? null : Math.round(horas * TARIFA_HORA_CENTAVOS);

  let base_centavos, criterio;
  if (por_hora_centavos != null && por_hora_centavos < por_gramo_centavos) {
    base_centavos = por_hora_centavos;
    criterio = "por hora de impresión (salió más barato que por gramo — se aplica el que conviene al cliente)";
  } else if (por_hora_centavos != null) {
    base_centavos = por_gramo_centavos;
    criterio = "por gramo (salió más barato que por hora — se aplica el que conviene al cliente)";
  } else {
    base_centavos = por_gramo_centavos;
    criterio = "por gramo (no se proporcionaron horas de impresión)";
  }

  const recargo_centavos = Math.round(base_centavos * post.pct / 100);
  const pieza_centavos = base_centavos + recargo_centavos;
  const subtotal_centavos = pieza_centavos * cantidad;

  const aplica_minimo = subtotal_centavos < PEDIDO_MINIMO_CENTAVOS;
  const total_centavos = aplica_minimo ? PEDIDO_MINIMO_CENTAVOS : subtotal_centavos;

  // --- Self-check ---
  const verif = (base_centavos + Math.round(base_centavos * post.pct / 100)) * cantidad;
  if (!Number.isInteger(total_centavos) || (!aplica_minimo && verif !== total_centavos)) {
    return {
      ok: false,
      error:
        "Error interno del estimador: la suma no se verificó. Por seguridad " +
        "no se generó la estimación. Deriva al especialista por WhatsApp."
    };
  }

  return {
    ok: true,
    tipo: "estimacion_preliminar",
    moneda: "MXN",
    material: {
      nombre: material.nombre,
      tarifa_por_gramo: centavosAPesos(material.centavos_por_gramo),
      nota: material.nota
    },
    tarifa_por_hora: centavosAPesos(TARIFA_HORA_CENTAVOS),
    entrada: {
      gramos_por_pieza: gramos,
      horas_por_pieza: horas,
      cantidad,
      postprocesado: post.nombre
    },
    desglose: {
      costo_por_gramo: centavosAPesos(por_gramo_centavos),
      costo_por_hora: por_hora_centavos == null ? null : centavosAPesos(por_hora_centavos),
      criterio_aplicado: criterio,
      recargo_postprocesado:
        post.pct === 0 ? null : `${post.nombre}: +${post.pct}% = ${centavosAPesos(recargo_centavos)}`,
      precio_por_pieza: centavosAPesos(pieza_centavos)
    },
    total_estimado: centavosAPesos(total_centavos),
    pedido_minimo_aplicado: aplica_minimo
      ? `El subtotal (${centavosAPesos(subtotal_centavos)}) quedó por debajo del pedido mínimo de ${centavosAPesos(PEDIDO_MINIMO_CENTAVOS)}, así que aplica el mínimo.`
      : null,
    es_mayoreo: cantidad >= UMBRAL_MAYOREO,
    nota_para_asesor:
      "ESTIMACIÓN PRELIMINAR, no cotización en firme: preséntala siempre como " +
      "estimación. La cifra final la confirma un especialista con el archivo " +
      "(STL/STEP), porque orientación, soportes y relleno cambian el peso y " +
      "el tiempo reales. Después de dar el número, ofrece los dos caminos: " +
      "mandar el archivo por WhatsApp, o registrar el interés con contacto." +
      (cantidad >= UMBRAL_MAYOREO
        ? " OJO: la cantidad ya es volumen de producción — hay descuento por " +
          "mayoreo que confirma el especialista. Registra el interés."
        : ""),
    _raw: {
      por_gramo_centavos,
      por_hora_centavos,
      base_centavos,
      recargo_centavos,
      pieza_centavos,
      subtotal_centavos,
      total_centavos
    }
  };
}

/** Tarifas de referencia para conocimiento.js y para el system prompt. */
function tarifasDeReferencia() {
  return {
    regla_comercial:
      "Se cobra por gramo O por hora de impresión, lo que más convenga al cliente.",
    por_hora: centavosAPesos(TARIFA_HORA_CENTAVOS) + " por hora de impresión",
    por_gramo: Object.values(MATERIALES).map(
      m => `${m.nombre}: ${centavosAPesos(m.centavos_por_gramo)} por gramo`
    ),
    postprocesado: [
      "Lijado / alisado: +20% sobre el costo de impresión",
      "Pintura (incluye lijado): +50% sobre el costo de impresión"
    ],
    pedido_minimo: centavosAPesos(PEDIDO_MINIMO_CENTAVOS),
    nota:
      "Los precios son estimaciones preliminares; la cotización final la " +
      "confirma un especialista con el archivo en la mano."
  };
}

module.exports = {
  estimarImpresion3D,
  tarifasDeReferencia,
  // Exportados para tests:
  MATERIALES,
  POSTPROCESADO,
  TARIFA_HORA_CENTAVOS,
  PEDIDO_MINIMO_CENTAVOS,
  UMBRAL_MAYOREO
};
