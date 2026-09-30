/**
 * Verifier mínimo del Asesor Valquiria.
 *
 * El texto del modelo no crea evidencia. Este módulo sólo acepta como prueba
 * de una mutación el resultado exitoso de `calcular_cotizacion`, compara el
 * estado anterior con `carrito_final` y decide si un claim puede publicarse.
 */

"use strict";

const { tieneReferenciaProductoCatalogo } = require("./resolver-productos.js");

const ACCIONES = new Set(["reemplazar", "agregar", "quitar", "fijar", "vaciar"]);

function carritoCanonico(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(i => i && typeof i.sku === "string" &&
      Number.isInteger(i.cantidad) && i.cantidad > 0)
    .map(i => ({ sku: i.sku, cantidad: i.cantidad }))
    .sort((a, b) => a.sku.localeCompare(b.sku));
}

function mismoCarrito(a, b) {
  return JSON.stringify(carritoCanonico(a)) === JSON.stringify(carritoCanonico(b));
}

/** Crea evidencia únicamente desde la herramienta autorizada. */
function crearEvidenciaMutacion(nombreHerramienta, resultado, carritoAntes) {
  if (nombreHerramienta !== "calcular_cotizacion" || resultado?.ok !== true ||
      !ACCIONES.has(resultado.accion) || !Array.isArray(resultado.carrito_final)) {
    return null;
  }

  const antes = carritoCanonico(carritoAntes);
  const final = carritoCanonico(resultado.carrito_final);
  const cambioEstado = !mismoCarrito(antes, final);
  const sinEfecto = resultado.sin_efecto === true || resultado.changed === false || !cambioEstado;

  return {
    tipo: "mutacion_carrito",
    verificada: true,
    fuente: "calcular_cotizacion",
    accion: resultado.accion,
    cambioEstado: cambioEstado && !sinEfecto,
    sinEfecto,
    carritoAntes: antes,
    carritoFinal: final,
    resultado
  };
}

/** Resume el efecto autorizado del turno, no sólo la última operación. */
function resumirEvidenciasTurno(evidencias) {
  const verificadas = (Array.isArray(evidencias) ? evidencias : [])
    .filter(e => e?.verificada);
  if (verificadas.length === 0) return null;

  const primera = verificadas[0];
  const ultima = verificadas[verificadas.length - 1];
  return {
    verificada: true,
    cantidadOperaciones: verificadas.length,
    cambioNeto: !mismoCarrito(primera.carritoAntes, ultima.carritoFinal),
    huboCambioIntermedio: verificadas.some(e => e.cambioEstado),
    carritoAntes: primera.carritoAntes,
    carritoFinal: ultima.carritoFinal,
    ultima,
    evidencias: verificadas
  };
}

const minusculasConAcentos = texto => String(texto || "")
  .toLocaleLowerCase("es-MX")
  .normalize("NFC");

const normalizarContexto = texto => minusculasConAcentos(texto)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

/* «carrito» es contexto explícito. El contexto por producto se consulta en el
   resolvedor canónico; «pedido» y «orden» solos no distinguen Dental de los
   demás dominios. */
const CONTEXTO_CARRITO_EXPLICITO = /(?:^|[^a-z0-9_])carrito(?:$|[^a-z0-9_])/i;

/* Patrones explícitos de hechos completados. Se preservan los acentos porque
   en español distinguen «vacié» de «vacíe», «quité» de «quite», etc. */
const PATRONES_CLAIM = [
  {
    tipo: "vaciar", accion: "vaciar",
    re: /(?<![\p{L}\p{N}_])(?:ya\s+)?lo\s+(?:vacié|limpié)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", accion: "vaciar",
    re: /(?<![\p{L}\p{N}_])lo\s+(?:he|hemos)\s+(?:vaciado|limpiado)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", accion: "vaciar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:vacié|limpié)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", accion: "vaciar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:vaciado|limpiado)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", accion: "vaciar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:vaciamos|limpiamos)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", estadoFinal: "vacio", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])se\s+(?:vació|limpió)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", estadoFinal: "vacio",
    re: /\b(?:el\s+|tu\s+|mi\s+|su\s+|nuestro\s+)?carrito\s+(?:ya\s+)?(?:vaciado|limpiado|(?:quedó|está)\s+(?:completamente\s+)?vac[ií]o)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "vaciar", estadoFinal: "vacio",
    re: /(?<![\p{L}\p{N}_])(?:ya\s+)?(?:está|quedó)\s+(?:completamente\s+)?vac[ií]o\s+(?:el\s+|tu\s+|mi\s+|su\s+|nuestro\s+)?carrito\b/giu
  },
  {
    tipo: "agregar", accion: "agregar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:agregué|añadí|sumé|incorporé|metí)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "agregar", accion: "agregar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:agregado|añadido|sumado|incorporado|metido)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "agregar", accion: "agregar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:agregamos|añadimos|sumamos|incorporamos|metimos)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "agregar", accion: "agregar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])se\s+(?:agregó|añadió|sumó|incorporó|metió)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "agregar", accion: "agregar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])ya\s+te\s+(?:puse|agregué|añadí|sumé)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "quitar", accion: "quitar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:quité|eliminé|borré|removí|retiré|saqué)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "quitar", accion: "quitar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:quitado|eliminado|borrado|removido|retirado|sacado)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "quitar", accion: "quitar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:quitamos|eliminamos|borramos|removimos|retiramos|sacamos)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "quitar", accion: "quitar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])se\s+(?:quitó|eliminó|borró|removió|retiró|sacó)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "fijar", accion: "fijar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:fijé|ajusté|dejé|cambié)(?![\p{L}\p{N}_])[^.!?\n]{0,60}\b(?:cantidad|unidades|piezas)\b/giu
  },
  {
    tipo: "fijar", accion: "fijar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:fijado|ajustado|dejado|cambiado)(?![\p{L}\p{N}_])[^.!?\n]{0,60}\b(?:cantidad|unidades|piezas)\b/giu
  },
  {
    tipo: "reemplazar", accion: "reemplazar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:reemplacé|reemplazé|sustituí)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "reemplazar", accion: "reemplazar", requiereContextoCarrito: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:reemplazado|sustituido)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "actualizar", generico: true,
    re: /(?<![\p{L}\p{N}_])(?:actualicé|modifiqué)(?![\p{L}\p{N}_])[^.!?\n]{0,60}\bcarrito\b/giu
  },
  {
    tipo: "actualizar", generico: true,
    re: /(?<![\p{L}\p{N}_])(?:he|hemos)\s+(?:actualizado|modificado)(?![\p{L}\p{N}_])[^.!?\n]{0,60}\bcarrito\b/giu
  },
  {
    tipo: "actualizar", generico: true,
    re: /\b(?:el\s+|tu\s+|mi\s+|su\s+)?carrito\s+(?:ya\s+)?(?:actualizado|modificado)(?![\p{L}\p{N}_])/giu
  },
  {
    tipo: "actualizar", generico: true,
    re: /(?<![\p{L}\p{N}_])(?:ya\s+)?quedó\s+(?:en\s+)?(?:el\s+|tu\s+|mi\s+|su\s+)?carrito\b/giu
  }
];

function dentroDePregunta(texto, indice) {
  return texto.lastIndexOf("¿", indice) > texto.lastIndexOf("?", indice);
}

function limitesDeOracion(texto, indice, longitud) {
  const separadores = [".", "!", "?", "\n", ";", ":"];
  const inicios = separadores.map(c => texto.lastIndexOf(c, indice - 1));
  const finales = separadores
    .map(c => texto.indexOf(c, indice + longitud))
    .filter(i => i !== -1);
  return {
    inicio: Math.max(-1, ...inicios) + 1,
    fin: finales.length ? Math.min(...finales) : texto.length
  };
}

function tieneContextoCarrito(texto, indice, longitud) {
  const { inicio, fin } = limitesDeOracion(texto, indice, longitud);
  const oracion = texto.slice(inicio, fin);
  return CONTEXTO_CARRITO_EXPLICITO.test(normalizarContexto(oracion)) ||
    tieneReferenciaProductoCatalogo(oracion);
}

function contextoNoAfirmativo(texto, indice) {
  if (dentroDePregunta(texto, indice)) return true;

  const cortes = [".", "!", "?", "\n", ";"].map(c => texto.lastIndexOf(c, indice - 1));
  const inicio = Math.max(-1, ...cortes);
  const prefijo = texto.slice(inicio + 1, indice);

  if (/(?<![\p{L}\p{N}_])(?:no|nunca)\s+(?:(?:he|hemos|se)\s+)?$/iu.test(prefijo)) {
    return true;
  }
  return /(?<![\p{L}\p{N}_])(?:si|puede que|tal vez|quizá|quizas|quieres que|quiera que)(?![\p{L}\p{N}_])[^,;:.!?]{0,80}$/iu.test(prefijo);
}

function detectarClaimsMutacion(texto) {
  const limpio = minusculasConAcentos(texto);
  const claims = [];
  for (const patron of PATRONES_CLAIM) {
    const { tipo, re } = patron;
    re.lastIndex = 0;
    for (const match of limpio.matchAll(re)) {
      if (contextoNoAfirmativo(limpio, match.index)) continue;
      if (patron.requiereContextoCarrito &&
          !tieneContextoCarrito(limpio, match.index, match[0].length)) continue;
      claims.push({
        tipo,
        texto: match[0],
        ...(patron.accion ? { accion: patron.accion } : {}),
        ...(patron.estadoFinal ? { estadoFinal: patron.estadoFinal } : {}),
        ...(patron.generico ? { generico: true } : {})
      });
    }
  }
  return claims;
}

function claimCompatible(claim, evidencias) {
  const turno = resumirEvidenciasTurno(evidencias);
  if (!turno) return false;

  if (claim.estadoFinal === "vacio") {
    return turno.cambioNeto && turno.carritoFinal.length === 0;
  }
  if (claim.generico) return turno.cambioNeto;

  /* Con varias operaciones no se atribuye una narrativa específica a una de
     ellas: sólo los hechos sobre el estado final o el cambio neto son seguros. */
  if (turno.cantidadOperaciones !== 1) return false;
  return turno.cambioNeto && turno.ultima.accion === claim.accion;
}

function verificarClaimsMutacion(texto, evidencias) {
  const claims = detectarClaimsMutacion(texto);
  const incompatibles = claims.filter(c => !claimCompatible(c, evidencias));
  return { ok: incompatibles.length === 0, claims, incompatibles };
}

function resumenCotizacionAutorizada(resultado) {
  if (!Array.isArray(resultado?.lineas) || resultado.lineas.length === 0) return "";
  const lineas = resultado.lineas.map(l => {
    const nombre = l.nombre || l.titulo || l.sku;
    const subtotal = typeof l.subtotal_linea === "string" ? ` — ${l.subtotal_linea}` : "";
    return `${l.cantidad} × ${nombre}${subtotal}`;
  });
  const total = typeof resultado.total === "string" ? `\nTotal: **${resultado.total}**.` : "";
  return `\n\n${lineas.join("\n")}${total}`;
}

function respuestaDeterministaMutacion(evidenciaOLista) {
  const evidencias = Array.isArray(evidenciaOLista)
    ? evidenciaOLista
    : [evidenciaOLista];
  const turno = resumirEvidenciasTurno(evidencias);
  if (!turno) return null;

  if (!turno.cambioNeto) {
    const unica = turno.cantidadOperaciones === 1 ? turno.ultima : null;
    if (unica?.sinEfecto && unica.accion === "quitar") {
      return "No hice cambios: ese producto no estaba en tu carrito.";
    }
    if (unica?.sinEfecto && unica.accion === "vaciar") {
      return "No hice cambios: tu carrito ya estaba vacío.";
    }
    return "No hice cambios netos: tu carrito conserva el mismo estado." +
      resumenCotizacionAutorizada(turno.ultima.resultado);
  }

  if (turno.carritoFinal.length === 0) {
    return "Listo. Tu carrito quedó vacío.";
  }

  return "Listo. Actualicé tu carrito con el cambio solicitado." +
    resumenCotizacionAutorizada(turno.ultima.resultado);
}

function mensajePublicoErrorCotizacion(resultado) {
  const error = minusculasConAcentos(resultado?.error);
  if (/identificar|producto/.test(error)) {
    return "No pude identificar con certeza el producto que quieres modificar. " +
      "Dime su nombre de otra forma y lo intento de nuevo.";
  }
  if (/cantidad|entero|máxim|limite|límite/.test(error)) {
    return "No pude aplicar el cambio porque la cantidad no es válida. " +
      "Indícame una cantidad entera positiva.";
  }
  return "No pude aplicar el cambio al carrito. Revisa el producto y la " +
    "cantidad e inténtalo de nuevo.";
}

function respuestaContextual(resultadosHerramientas) {
  const resultados = Array.isArray(resultadosHerramientas) ? resultadosHerramientas : [];
  const ultimo = nombre => [...resultados].reverse()
    .find(r => r?.nombre === nombre && r.resultado?.ok === true)?.resultado;

  const catalogo = ultimo("listar_catalogo");
  if (catalogo && Array.isArray(catalogo.productos)) {
    return "Estas son las opciones disponibles en el catálogo Dental.";
  }

  const busqueda = ultimo("buscar_productos");
  if (busqueda && Array.isArray(busqueda.resultados)) {
    return busqueda.resultados.length
      ? "Encontré estas opciones relacionadas con lo que buscas."
      : "No encontré una coincidencia clara en el catálogo. Dime qué práctica necesitas.";
  }

  const cotizacionFallida = [...resultados].reverse().find(r =>
    r?.nombre === "calcular_cotizacion" && r.resultado?.ok === false)?.resultado;
  if (cotizacionFallida) return mensajePublicoErrorCotizacion(cotizacionFallida);

  return "No pude completar la respuesta en este momento. Tu carrito y el " +
    "contexto se conservan sin cambios; puedes continuar con tu solicitud.";
}

/** Decide el texto visible sin ejecutar herramientas ni consultar al modelo. */
function resolverSalidaAsesor({ texto, evidenciasMutacion, resultadosHerramientas }) {
  const limpio = typeof texto === "string" ? texto.trim() : "";
  const evidencias = Array.isArray(evidenciasMutacion) ? evidenciasMutacion : [];
  const turno = resumirEvidenciasTurno(evidencias);

  if (!limpio) {
    return {
      texto: respuestaDeterministaMutacion(evidencias) ||
        respuestaContextual(resultadosHerramientas),
      reescrita: true,
      motivo: turno ? "redaccion-vacia-con-mutacion" : "redaccion-vacia"
    };
  }

  const verificacion = verificarClaimsMutacion(limpio, evidencias);
  if (!verificacion.ok) {
    return {
      texto: respuestaDeterministaMutacion(evidencias) ||
        respuestaContextual(resultadosHerramientas),
      reescrita: true,
      motivo: "claim-mutacion-sin-evidencia-compatible",
      claimsBloqueados: verificacion.incompatibles
    };
  }

  return { texto: limpio, reescrita: false, motivo: "texto-compatible" };
}

module.exports = {
  crearEvidenciaMutacion,
  resumirEvidenciasTurno,
  detectarClaimsMutacion,
  verificarClaimsMutacion,
  respuestaDeterministaMutacion,
  mensajePublicoErrorCotizacion,
  respuestaContextual,
  resolverSalidaAsesor
};
