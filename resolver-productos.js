/**
 * ============================================================================
 *  RESOLVEDOR DE PRODUCTOS — de como escribe un estudiante al SKU del catálogo
 * ============================================================================
 *  Por qué existe este archivo.
 *
 *  `calcular_cotizacion` exigía un SKU exacto y sensible a mayúsculas. Eso
 *  obligaba al modelo a hacer un viaje de ida y vuelta —buscar_productos,
 *  leer los resultados, y recién entonces cotizar— por cada producto que el
 *  usuario mencionara. Con un mensaje como «2 endo, 1 pulpo, 3 realistas y 2
 *  nissin» ese baile se repite cuatro veces, y es exactamente ahí donde el
 *  modelo se deja artículos en el camino: cotiza tres de los cuatro, o cotiza
 *  los cuatro pero con la cantidad del anterior.
 *
 *  La solución no es pedirle al modelo que se concentre más. Es quitarle el
 *  trabajo: ahora puede escribir `{ producto: "endo", cantidad: 2 }` y este
 *  módulo decide que eso es `ValEnd`. Una sola llamada, sin viajes previos,
 *  y la parte que se puede equivocar deja de estar en el modelo y pasa a
 *  estar en código determinista que se puede probar.
 *
 *  La escalera de resolución, de más a menos confiable. Se para en el primer
 *  peldaño que da un ganador claro:
 *
 *    1. SKU exacto            "ValEnd", "valend"      → exacta
 *    2. Alias curado          "endo", "kit completo"  → exacta
 *    3. Keyword del catálogo  "pulpotomia"            → exacta
 *    4. Difuso sobre la frase "nisiin", "realistass"  → alta
 *    5. Puntaje por tokens    "dientes para endo"     → media
 *
 *  Cuando dos productos empatan, NO se elige a la suerte: se devuelven las
 *  alternativas y una confianza baja, y el asesor pregunta. Equivocarse de
 *  producto en silencio es peor que preguntar una vez.
 * ============================================================================
 */

const { getCatalogoActivo, getProductoPorSku } = require("./catalog.js");
const { normalizarTexto, levenshtein } = require("./quote-engine.js");

/* ---------------------------------------------------------------------------
 * ALIAS CURADOS — el vocabulario real de un estudiante de odontología.
 * ---------------------------------------------------------------------------
 *  Esto NO duplica las keywords de productos.json: las keywords alimentan la
 *  BÚSQUEDA (donde un empate solo cambia el orden de unas tarjetas) y estos
 *  alias alimentan la COTIZACIÓN (donde un empate cobra el producto
 *  equivocado). Por eso aquí mandan estos y no aquellas.
 *
 *  El caso que lo justifica: "kit endo" estaba en las keywords de DOS
 *  productos a la vez. Para buscar da igual; para cotizar, no.
 * ------------------------------------------------------------------------- */
const ALIAS = {
  ValEnd: [
    "endo", "endos", "endodoncia", "endodoncias", "endodoncia normal",
    "kit endo", "kit endodoncia", "kit de endodoncia",
    "dientes endo", "dientes de endo", "dientes endodoncia",
    "diente endo", "diente de endodoncia",
    "practica endodoncia", "practica de endodoncia",
    "conducto", "conductos", "tratamiento de conducto",
    "endodoncista", "endodontico"
  ],
  ValPulpo: [
    "pulpo", "pulpos", "pulpotomia", "pulpotomias",
    "kit pulpo", "kit pulpotomia", "kit de pulpotomia",
    "dientes pulpo", "dientes de pulpotomia", "diente pulpo",
    "pediatria", "pediatrico", "pediatricos", "odontopediatria",
    "infantil", "infantiles", "dientes infantiles", "dientes de niño",
    "dientes de niños", "practica de pulpotomia"
  ],
  DientesRealistas: [
    "realista", "realistas", "kit realista", "kit realistas",
    "kit de dientes realistas", "dientes realistas",
    "kit completo", "completo", "kit avanzado",
    "32 dientes", "treintaidos dientes", "kit de 32", "kit 32",
    "boca completa", "arcada", "arcada completa", "todos los dientes",
    "set completo", "estuche", "ultrarealista", "ultra realista",
    "kit ultra realista"
  ],
  Endotnissin: [
    "nissin", "nisin", "nissim", "nisan", "nissan", "nicin", "nissn",
    "tipo nissin", "tipodonto nissin", "dientes nissin", "diente nissin",
    "dientes tipo nissin", "kit nissin", "compatible nissin",
    "para nissin", "endo nissin", "nissin endodoncia", "tipodonto"
  ]
};

/* ---------------------------------------------------------------------------
 * ÍNDICE — se construye una vez al arrancar, igual que el catálogo.
 * ------------------------------------------------------------------------- */

/* Palabras que no distinguen un producto de otro dentro del catálogo Dental:
   TODO aquí son dientes para practicar. Si "dientes" puntuara, cualquier
   frase empataría los cuatro productos. */
const RUIDO = new Set([
  "diente", "dientes", "kit", "kits", "practica", "practicas", "para",
  "valquiria", "dental", "modelo", "modelos", "pieza", "piezas",
  "producto", "productos", "quiero", "dame", "necesito", "ocupo",
  "unos", "unas", "por", "favor", "con", "los", "las", "del"
]);

/* Singular tosco: quita la -s o -es final. "endos"→"endo", "realistas"→
   "realista". No pretende ser gramática, solo un intento más de casar. */
function sinPlural(t) {
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

/* Cuánta distancia de edición se tolera según lo larga que sea la palabra.
   Una palabra corta con un error es otra palabra distinta; una larga sigue
   siendo reconocible. Sin esta escala, "endo" casaría con "endos" y también
   con cualquier cosa de cuatro letras. */
function tolerancia(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

const INDICE = (() => {
  const entradas = [];   // { frase, sku, peso }
  const vistos = new Set();

  const meter = (frase, sku, peso) => {
    const f = normalizarTexto(frase);
    if (!f) return;
    const llave = f + "|" + sku;
    if (vistos.has(llave)) return;
    vistos.add(llave);
    entradas.push({ frase: f, sku, peso });
  };

  for (const p of getCatalogoActivo()) {
    meter(p.sku, p.sku, 100);
    for (const a of ALIAS[p.sku] || []) meter(a, p.sku, 80);
    for (const k of p.keywords) meter(k, p.sku, 60);
    meter(p.nombre, p.sku, 40);
  }
  return entradas;
})();

/* Tokens significativos de una frase: sin ruido, sin números, sin palabras
   de una o dos letras. */
function tokensUtiles(texto) {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter(t => t.length >= 3 && !RUIDO.has(t) && !/^\d+$/.test(t));
}

/**
 * Resuelve un texto libre al SKU del catálogo que el usuario quiso decir.
 *
 * @param {string} texto  "endo", "nisiin", "kit completo", "ValEnd"...
 * @returns {{ok:boolean, sku?:string, nombre?:string, confianza?:string,
 *            alternativas?:Array, error?:string}}
 */
function resolverSku(texto) {
  if (typeof texto !== "string" || texto.trim() === "") {
    return { ok: false, error: "Texto de producto vacío." };
  }

  /* — Peldaño 1: SKU exacto, sin importar mayúsculas — */
  const crudo = texto.trim();
  const porSku = getCatalogoActivo().find(
    p => p.sku.toLowerCase() === crudo.toLowerCase()
  );
  if (porSku) {
    return { ok: true, sku: porSku.sku, nombre: porSku.nombre, confianza: "exacta" };
  }

  const frase = normalizarTexto(texto);
  if (!frase) return { ok: false, error: "Texto de producto vacío." };

  /* — Peldaños 2 y 3: la frase entera coincide con un alias o una keyword.
       Se elige el de mayor peso, así el alias curado gana a la keyword. — */
  const exactas = INDICE.filter(e => e.frase === frase);
  if (exactas.length) {
    const mejor = exactas.reduce((a, b) => (b.peso > a.peso ? b : a));
    const rivales = new Set(exactas.filter(e => e.peso === mejor.peso).map(e => e.sku));
    if (rivales.size === 1) {
      const p = getProductoPorSku(mejor.sku);
      return { ok: true, sku: p.sku, nombre: p.nombre, confianza: "exacta" };
    }
  }

  /* — Peldaño 4: la frase entera, pero con erratas. "nisiin" → "nissin". — */
  const fraseSing = sinPlural(frase);
  let mejorDif = null;
  for (const e of INDICE) {
    const objetivo = e.frase;
    const d = Math.min(
      levenshtein(frase, objetivo),
      levenshtein(fraseSing, sinPlural(objetivo))
    );
    if (d <= tolerancia(Math.max(frase.length, objetivo.length))) {
      /* Menos distancia manda; a igual distancia, más peso. */
      if (!mejorDif || d < mejorDif.d || (d === mejorDif.d && e.peso > mejorDif.peso)) {
        mejorDif = { d, peso: e.peso, sku: e.sku };
      }
    }
  }
  if (mejorDif) {
    const p = getProductoPorSku(mejorDif.sku);
    return {
      ok: true, sku: p.sku, nombre: p.nombre,
      confianza: mejorDif.d === 0 ? "exacta" : "alta"
    };
  }

  /* — Peldaño 5: puntaje por tokens. Aquí caen las frases largas
       («dientes para practicar endodoncia»). — */
  const tokens = tokensUtiles(texto);
  if (!tokens.length) {
    return {
      ok: false,
      error: `No pude identificar a qué producto se refiere "${texto}".`
    };
  }

  const puntos = new Map();
  const suma = (sku, n) => puntos.set(sku, (puntos.get(sku) || 0) + n);

  for (const token of tokens) {
    const tSing = sinPlural(token);
    for (const e of INDICE) {
      const palabras = e.frase.split(/\s+/).filter(w => !RUIDO.has(w));
      let mejor = 0;
      for (const w of palabras) {
        if (w === token || w === tSing || sinPlural(w) === tSing) {
          mejor = Math.max(mejor, 3);
        } else if (w.length >= 4 && token.length >= 4 &&
                   (w.startsWith(token) || token.startsWith(w))) {
          mejor = Math.max(mejor, 2);
        } else if (w.length >= 4 && token.length >= 4 &&
                   levenshtein(token, w) <= tolerancia(Math.max(token.length, w.length))) {
          mejor = Math.max(mejor, 1);
        }
      }
      if (mejor) suma(e.sku, mejor * (e.peso / 100));
    }
  }

  if (!puntos.size) {
    return {
      ok: false,
      error: `No pude identificar a qué producto se refiere "${texto}".`
    };
  }

  const orden = [...puntos.entries()].sort((a, b) => b[1] - a[1]);
  const [skuGanador, puntaje] = orden[0];
  const segundo = orden[1];
  const p = getProductoPorSku(skuGanador);
  if (!p) {
    return { ok: false, error: `No pude identificar el producto "${texto}".` };
  }

  /* Empate o casi empate: se resuelve preguntando, no adivinando. */
  const ambiguo = segundo && segundo[1] >= puntaje * 0.85;
  return {
    ok: true,
    sku: p.sku,
    nombre: p.nombre,
    confianza: ambiguo ? "baja" : "media",
    alternativas: ambiguo
      ? orden.slice(0, 3).map(([s]) => {
          const q = getProductoPorSku(s);
          return q ? { sku: q.sku, nombre: q.nombre } : null;
        }).filter(Boolean)
      : undefined
  };
}

module.exports = { resolverSku, ALIAS, INDICE };
