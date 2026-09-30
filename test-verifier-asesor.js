/**
 * Regresiones de Fase 0.2: verifier mínimo y fallback contextual.
 *
 * Levanta el backend real contra un Gemini falso. Así se comprueba el flujo
 * completo functionCall → functionResponse → redacción final sin gastar API.
 */

"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { getCatalogoActivo } = require("./catalog.js");
const { ALIAS } = require("./resolver-productos.js");
const { detectarClaimsMutacion } = require("./verifier-asesor.js");

const PUERTO_GEMINI = 4741;
const PUERTO_APP = 4742;
const BASE = `http://127.0.0.1:${PUERTO_APP}`;

let pasadas = 0;
const fallos = [];
const llamadas = new Map();

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
    pasadas++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallos.push(nombre);
  }
}

const respuestaTexto = texto => ({
  candidates: [{
    content: { role: "model", parts: texto ? [{ text: texto }] : [] },
    finishReason: "STOP"
  }]
});

const respuestaTool = (name, args = {}) => ({
  candidates: [{
    content: { role: "model", parts: [{ functionCall: { name, args } }] },
    finishReason: "STOP"
  }]
});

const respuestaTools = llamadasTool => ({
  candidates: [{
    content: {
      role: "model",
      parts: llamadasTool.map(({ name, args = {} }) => ({
        functionCall: { name, args }
      }))
    },
    finishReason: "STOP"
  }]
});

function guion(escenario, turno) {
  switch (escenario) {
    case "T1":
    case "T9":
      if (turno === 1) return respuestaTool("calcular_cotizacion", { accion: "vaciar" });
      if (turno === 2) return respuestaTexto("");
      if (turno === 3) return respuestaTool("listar_catalogo");
      return respuestaTexto("Estas son las opciones del catálogo.");
    case "T2":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", { accion: "vaciar" })
        : respuestaTexto("Listo, vacié tu carrito.");
    case "T3":
      return respuestaTexto("Listo, vacié tu carrito.");
    case "T4":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "quitar", items: [{ producto: "nissin" }]
          })
        : respuestaTexto("Listo, eliminé los Nissin.");
    case "T5":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "agregar", items: [{ producto: "nissin", cantidad: 2 }]
          })
        : respuestaTexto("Listo, vacié tu carrito.");
    case "T6":
      return turno === 1
        ? respuestaTool("listar_catalogo")
        : respuestaTexto("Estas son las opciones disponibles.");
    case "T7":
      if (turno === 1) return respuestaTexto("");
      if (turno === 2) return respuestaTool("listar_catalogo");
      return respuestaTexto("Catálogo forzado.");
    case "T8":
      if (turno === 1) return respuestaTexto("");
      if (turno === 2) {
        return respuestaTool("calcular_cotizacion", {
          accion: "agregar", items: [{ producto: "nissin", cantidad: 2 }]
        });
      }
      return respuestaTexto("Mutación adicional ejecutada.");
    case "T10":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "agregar", items: [{ producto: "nissin", cantidad: 2 }]
          })
        : respuestaTexto("Listo, vacié tu carrito. Total $1.00 MXN.");
    case "T11": return respuestaTexto("Listo, tu carrito quedó vacío.");
    case "T12": return respuestaTexto("He vaciado tu carrito.");
    case "T13": return respuestaTexto("He agregado 2 Nissin.");
    case "T14": return respuestaTexto("Se vació tu carrito.");
    case "T15": return respuestaTexto("Ya te puse 2 endos.");
    case "T16": return respuestaTexto("Carrito vaciado ✅");
    case "T17": return respuestaTexto("Ya está vacío tu carrito.");
    case "T18": return respuestaTexto("Vaciamos tu carrito.");
    case "T19":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", { accion: "vaciar" })
        : respuestaTexto("Tu carrito quedó vacío.");
    case "T20":
      return respuestaTexto("¿Quieres que vacíe tu carrito o sólo quite los endo?");
    case "T21":
      return respuestaTexto("¿Quieres que lo agregue a tu carrito?");
    case "T22":
      return respuestaTexto("¿Quieres que ajuste la estimación a 50 piezas?");
    case "T23":
      return respuestaTexto("El envío quedó en $135 para tu pedido.");
    case "T24":
      return respuestaTexto("Cuando lo retire de la paquetería...");
    case "T25":
      return respuestaTexto("Puede que cambie el costo si modificas el pedido.");
    case "T26":
      return turno === 1
        ? respuestaTools([
            {
              name: "calcular_cotizacion",
              args: {
                accion: "agregar",
                items: [{ producto: "nissin", cantidad: 2 }]
              }
            },
            {
              name: "calcular_cotizacion",
              args: { accion: "quitar", items: [{ producto: "pulpo" }] }
            }
          ])
        : respuestaTexto("");
    case "T27":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "agregar",
            items: [{ producto: "producto inexistente", cantidad: 1 }]
          })
        : respuestaTexto("");
    case "T28": return respuestaTexto("Listo, ya lo vacié.");
    case "T29": return respuestaTexto("Listo, lo he vaciado.");
    case "T30":
      return respuestaTexto("Listo, vacié tu carrito, ya no tienes productos en tu pedido.");
    case "T31":
      return respuestaTexto("He vaciado tu carrito y no queda nada en tu pedido.");
    case "T32":
      return respuestaTexto("Quité el acabado brillante de la estimación 3D.");
    case "T33":
      return respuestaTexto("Agregué tus datos de contacto para el especialista.");
    case "T34":
      return respuestaTexto("Saqué la cuenta: con envío te sale en $1,397.");
    case "T35":
      return respuestaTexto("Eliminé la tapa de PET de la propuesta de empaque.");
    case "T36":
      return respuestaTexto("Agregué a la propuesta de IA un módulo nuevo.");
    case "T37":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "agregar", items: [{ producto: "nissin", cantidad: 2 }]
          })
        : respuestaTexto("He agregado 2 Nissin.");
    case "T38": return respuestaTexto("Quité los endo.");
    case "T39":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "quitar", items: [{ producto: "endo" }]
          })
        : respuestaTexto("Quité los endo.");
    case "T40":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", { accion: "vaciar" })
        : respuestaTexto("Ya lo vacié.");
    case "T41":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", { accion: "vaciar" })
        : respuestaTexto("Lo he vaciado.");
    case "T42": return respuestaTexto("Lo quité del carrito.");
    case "T43": return respuestaTexto("Lo eliminé de tu pedido.");
    case "T44":
      return turno === 1
        ? respuestaTool("calcular_cotizacion", {
            accion: "quitar", items: [{ producto: "endo" }]
          })
        : respuestaTexto("Lo quité del carrito.");
    case "T45": return respuestaTexto("Agregué 3 realistas.");
    case "T46": return respuestaTexto("Quité los de pediatría.");
    case "T47": return respuestaTexto("He agregado 2 kits completos.");
    case "T48": return respuestaTexto("Agregué 2 kits avanzados.");
    case "T49": return respuestaTexto("Agregué 1 arcada completa.");
    case "T50": return respuestaTexto("Agregué 2 Nissin.");
    case "T51": return respuestaTexto("Agregué 2 de pulpotomía.");
    case "T52": return respuestaTexto("Quité la tapa de PET de tu pedido de empaques.");
    case "T53": return respuestaTexto("Agregué un módulo nuevo al pedido de IA.");
    case "T54": return respuestaTexto("Eliminé el acabado brillante de la orden 3D.");
    default:
      return respuestaTexto("Respuesta neutral.");
  }
}

const geminiFalso = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", () => {
    if (!req.url.includes(":generateContent")) {
      res.writeHead(404).end("{}");
      return;
    }
    let contenidos = [];
    try { contenidos = JSON.parse(cuerpo).contents || []; } catch { /* inválido */ }
    const escenario = (JSON.stringify(contenidos).match(/#(T\d+)/) || [])[1] || "otro";
    const turno = (llamadas.get(escenario) || 0) + 1;
    llamadas.set(escenario, turno);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(guion(escenario, turno)));
  });
});

async function pedir(escenario, carrito = []) {
  llamadas.delete(escenario);
  const r = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", parts: [{ text: `#${escenario}` }] }],
      carrito
    })
  });
  return { status: r.status, cuerpo: await r.json() };
}

const carritoInicial = [{ sku: "ValEnd", cantidad: 2 }];
const accionCarrito = r => (r.cuerpo.acciones || []).find(a => a.tipo === "carrito_set");
const normalizar = texto => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const afirmaVaciado = texto => /\bvacie\b/.test(normalizar(texto));

async function main() {
  await new Promise(r => geminiFalso.listen(PUERTO_GEMINI, "127.0.0.1", r));
  const env = {
    ...process.env,
    PORT: String(PUERTO_APP),
    NODE_ENV: "test",
    AVISOS_SILENCIO: "1",
    GEMINI_API_KEY: "clave-falsa-de-pruebas",
    GEMINI_BASE_URL: `http://127.0.0.1:${PUERTO_GEMINI}`,
    GEMINI_TOPE_DIARIO: "100",
    GEMINI_TOPE_MINUTO: "100",
    RATE_LIMIT_POR_MINUTO: "100",
    ALMACEN_RUTA: ""
  };
  const servidor = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  servidor.stdout.on("data", d => logs.push(String(d)));
  servidor.stderr.on("data", d => logs.push(String(d)));

  try {
    let vivo = false;
    for (let i = 0; i < 80 && !vivo; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { vivo = (await fetch(BASE + "/health")).ok; } catch { /* arrancando */ }
    }
    afirmar(vivo, `el backend no arrancó: ${logs.join("").slice(-1000)}`);

    console.log("\n[FASE 0.2] Verifier y fallback contextual");

    await prueba("T1 · vaciar + LLM vacío conserva acción y evita catálogo", async () => {
      const r = await pedir("T1", carritoInicial);
      afirmar(r.status === 200, `HTTP ${r.status}`);
      afirmar(/carrito qued[oó] vac[ií]o/i.test(r.cuerpo.reply), r.cuerpo.reply);
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "falta carrito_set=[]");
      afirmar(!(r.cuerpo.meta?.herramientas || []).includes("listar_catalogo"), "forzó listar_catalogo");
      afirmar((r.cuerpo.products || []).length === 0, "mostró catálogo");
    });

    await prueba("T2 · vaciar + claim compatible conserva el texto", async () => {
      const r = await pedir("T2", carritoInicial);
      afirmar(r.cuerpo.reply === "Listo, vacié tu carrito.", `reescribió: ${r.cuerpo.reply}`);
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "falta carrito_set=[]");
    });

    await prueba("T3 · claim de vaciado sin tool se bloquea", async () => {
      const r = await pedir("T3", carritoInicial);
      afirmar(r.cuerpo.reply !== "Listo, vacié tu carrito.", "el claim falso llegó al usuario");
      afirmar(!afirmaVaciado(r.cuerpo.reply), `fallback todavía afirma vaciado: ${r.cuerpo.reply}`);
      afirmar(!accionCarrito(r), "inventó una acción de carrito");
    });

    await prueba("T4 · quitar ausente reescribe el falso éxito como no-cambio", async () => {
      const r = await pedir("T4", carritoInicial);
      afirmar(r.cuerpo.cotizacion?.changed === false && r.cuerpo.cotizacion?.sin_efecto === true,
        "la evidencia no marca el no-op");
      afirmar(/no (?:hice|se hicieron) cambios|no estaba/i.test(r.cuerpo.reply), r.cuerpo.reply);
      afirmar(!/listo,? elimin[eé]/i.test(r.cuerpo.reply), "permitió el claim incompatible");
      afirmar(JSON.stringify(accionCarrito(r)?.items) === JSON.stringify(carritoInicial),
        "no preservó el estado real");
    });

    await prueba("T5 · agregar + claim de vaciado se reescribe desde evidencia", async () => {
      const r = await pedir("T5", carritoInicial);
      const items = accionCarrito(r)?.items || [];
      afirmar(items.some(i => i.sku === "ValEnd" && i.cantidad === 2), "perdió ValEnd");
      afirmar(items.some(i => i.sku === "Endotnissin" && i.cantidad === 2), "no agregó Nissin");
      afirmar(!afirmaVaciado(r.cuerpo.reply), `mantuvo el claim falso: ${r.cuerpo.reply}`);
    });

    await prueba("T6 · listar catálogo legítimo sigue generando tarjetas", async () => {
      const r = await pedir("T6");
      afirmar(r.cuerpo.reply === "Estas son las opciones disponibles.", r.cuerpo.reply);
      afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) === '["listar_catalogo"]',
        `tools: ${JSON.stringify(r.cuerpo.meta?.herramientas)}`);
      afirmar((r.cuerpo.products || []).length === 4, "no devolvió el catálogo legítimo");
    });

    await prueba("T7 · respuesta vacía sin tools no llama catálogo", async () => {
      const r = await pedir("T7");
      afirmar((llamadas.get("T7") || 0) === 1, `hizo ${llamadas.get("T7")} llamadas al proveedor`);
      afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una tool de fallback");
      afirmar((r.cuerpo.products || []).length === 0, "mostró catálogo");
      afirmar(/conserv/i.test(r.cuerpo.reply), `fallback no preserva estado: ${r.cuerpo.reply}`);
    });

    await prueba("T8 · el fallback no ejecuta una mutación adicional", async () => {
      const r = await pedir("T8", carritoInicial);
      afirmar((llamadas.get("T8") || 0) === 1, "el fallback volvió a consultar al modelo");
      afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "el fallback ejecutó una tool");
      afirmar(!accionCarrito(r), "el fallback produjo una mutación");
    });

    await prueba("T9 · una mutación verificada sobrevive al fallo de redacción", async () => {
      const r = await pedir("T9", carritoInicial);
      afirmar(r.cuerpo.cotizacion?.ok === true, "perdió la cotización autorizada");
      afirmar(Array.isArray(r.cuerpo.cotizacion?.carrito_final) &&
        r.cuerpo.cotizacion.carrito_final.length === 0, "perdió carrito_final=[]");
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "perdió carrito_set=[]");
    });

    await prueba("T10 · el fallback sólo menciona el total autorizado", async () => {
      const r = await pedir("T10", carritoInicial);
      afirmar(!r.cuerpo.reply.includes("$1.00"), `repitió el total inventado: ${r.cuerpo.reply}`);
      afirmar(r.cuerpo.cotizacion?.total && r.cuerpo.reply.includes(r.cuerpo.cotizacion.total),
        `no usó el total autorizado ${r.cuerpo.cotizacion?.total}: ${r.cuerpo.reply}`);
    });

    const claimsSinEvidencia = [
      ["T11", "Listo, tu carrito quedó vacío."],
      ["T12", "He vaciado tu carrito."],
      ["T13", "He agregado 2 Nissin."],
      ["T14", "Se vació tu carrito."],
      ["T15", "Ya te puse 2 endos."],
      ["T16", "Carrito vaciado ✅"],
      ["T17", "Ya está vacío tu carrito."],
      ["T18", "Vaciamos tu carrito."]
    ];
    for (const [escenario, frase] of claimsSinEvidencia) {
      await prueba(`${escenario} · claim sin evidencia se bloquea: ${frase}`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply !== frase, `el claim falso llegó intacto: ${frase}`);
        afirmar(!accionCarrito(r), "inventó una acción de carrito");
      });
    }

    await prueba("T19 · estado vacío con evidencia compatible se permite", async () => {
      const r = await pedir("T19", carritoInicial);
      afirmar(r.cuerpo.reply === "Tu carrito quedó vacío.", `reescribió: ${r.cuerpo.reply}`);
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "falta carrito_set=[]");
    });

    const frasesLegitimas = [
      ["T20", "¿Quieres que vacíe tu carrito o sólo quite los endo?"],
      ["T21", "¿Quieres que lo agregue a tu carrito?"],
      ["T22", "¿Quieres que ajuste la estimación a 50 piezas?"],
      ["T23", "El envío quedó en $135 para tu pedido."],
      ["T24", "Cuando lo retire de la paquetería..."],
      ["T25", "Puede que cambie el costo si modificas el pedido."]
    ];
    for (const [escenario, frase] of frasesLegitimas) {
      await prueba(`${escenario} · frase no operativa pasa intacta`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply === frase, `reescribió indebidamente: ${r.cuerpo.reply}`);
      });
    }

    await prueba("T26 · cambio seguido de no-op reporta el efecto neto", async () => {
      const r = await pedir("T26", carritoInicial);
      const items = accionCarrito(r)?.items || [];
      afirmar(items.some(i => i.sku === "ValEnd" && i.cantidad === 2), "perdió ValEnd");
      afirmar(items.some(i => i.sku === "Endotnissin" && i.cantidad === 2), "perdió Nissin");
      afirmar(!/no hice cambios/i.test(r.cuerpo.reply), `negó el cambio neto: ${r.cuerpo.reply}`);
      afirmar(/actualic/i.test(r.cuerpo.reply), `no confirmó el estado final: ${r.cuerpo.reply}`);
      afirmar((llamadas.get("T26") || 0) === 2, "ejecutó llamadas extra al proveedor");
      afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) ===
        '["calcular_cotizacion","calcular_cotizacion"]', "ejecutó herramientas adicionales");
    });

    await prueba("T27 · un error de tool no filtra instrucciones internas", async () => {
      const r = await pedir("T27", carritoInicial);
      afirmar(!/pregúntale|llama listar_catalogo/i.test(r.cuerpo.reply),
        `filtró una instrucción interna: ${r.cuerpo.reply}`);
      afirmar(/no pude/i.test(r.cuerpo.reply), `no produjo un error público útil: ${r.cuerpo.reply}`);
      afirmar(!accionCarrito(r), "un fallo produjo una acción de carrito");
    });

    const vaciadosPronombreSinEvidencia = [
      ["T28", "Listo, ya lo vacié."],
      ["T29", "Listo, lo he vaciado."],
      ["T30", "Listo, vacié tu carrito, ya no tienes productos en tu pedido."],
      ["T31", "He vaciado tu carrito y no queda nada en tu pedido."]
    ];
    for (const [escenario, frase] of vaciadosPronombreSinEvidencia) {
      await prueba(`${escenario} · vaciado completado sin evidencia se bloquea`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply !== frase, `el claim falso llegó intacto: ${frase}`);
        afirmar(!/(?:vacié|he vaciado|quedó vacío|está vacío)/i.test(r.cuerpo.reply),
          `el fallback aún afirma vaciado: ${r.cuerpo.reply}`);
        afirmar(!accionCarrito(r), "inventó una acción de carrito");
        afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
        afirmar((llamadas.get(escenario) || 0) === 1, "hizo llamadas extra al proveedor");
      });
    }

    const frasesDeOtrosDominios = [
      ["T32", "Quité el acabado brillante de la estimación 3D."],
      ["T33", "Agregué tus datos de contacto para el especialista."],
      ["T34", "Saqué la cuenta: con envío te sale en $1,397."],
      ["T35", "Eliminé la tapa de PET de la propuesta de empaque."],
      ["T36", "Agregué a la propuesta de IA un módulo nuevo."]
    ];
    for (const [escenario, frase] of frasesDeOtrosDominios) {
      await prueba(`${escenario} · verbo completado ajeno al carrito pasa intacto`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply === frase, `reescribió otro dominio: ${r.cuerpo.reply}`);
        afirmar(!accionCarrito(r), "inventó una acción de carrito");
        afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
        afirmar((llamadas.get(escenario) || 0) === 1, "hizo llamadas extra al proveedor");
      });
    }

    await prueba("T37 · agregar producto con evidencia conserva el claim", async () => {
      const r = await pedir("T37", carritoInicial);
      afirmar(r.cuerpo.reply === "He agregado 2 Nissin.", `reescribió: ${r.cuerpo.reply}`);
      afirmar(accionCarrito(r)?.items?.some(i =>
        i.sku === "Endotnissin" && i.cantidad === 2), "falta Nissin en carrito_set");
      afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) === '["calcular_cotizacion"]',
        "ejecutó herramientas inesperadas");
      afirmar((llamadas.get("T37") || 0) === 2, "hizo llamadas extra al proveedor");
    });

    await prueba("T38 · quitar producto sin evidencia bloquea el claim", async () => {
      const r = await pedir("T38", carritoInicial);
      afirmar(r.cuerpo.reply !== "Quité los endo.", "el claim falso llegó intacto");
      afirmar(!/quit[eé] los endo/i.test(r.cuerpo.reply), `aún afirma retiro: ${r.cuerpo.reply}`);
      afirmar(!accionCarrito(r), "inventó una acción de carrito");
      afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
    });

    await prueba("T39 · quitar producto con evidencia conserva el claim", async () => {
      const r = await pedir("T39", carritoInicial);
      afirmar(r.cuerpo.reply === "Quité los endo.", `reescribió: ${r.cuerpo.reply}`);
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "no retiró ValEnd");
      afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) === '["calcular_cotizacion"]',
        "ejecutó herramientas inesperadas");
      afirmar((llamadas.get("T39") || 0) === 2, "hizo llamadas extra al proveedor");
    });

    for (const [escenario, frase] of [["T40", "Ya lo vacié."], ["T41", "Lo he vaciado."]]) {
      await prueba(`${escenario} · pronombre de vaciado con evidencia se permite`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply === frase, `reescribió: ${r.cuerpo.reply}`);
        afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "falta carrito_set=[]");
        afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) === '["calcular_cotizacion"]',
          "ejecutó herramientas inesperadas");
        afirmar((llamadas.get(escenario) || 0) === 2, "hizo llamadas extra al proveedor");
      });
    }

    await prueba("T42 · pronombre de retiro con carrito exige evidencia", async () => {
      const r = await pedir("T42", carritoInicial);
      afirmar(r.cuerpo.reply !== "Lo quité del carrito.", "el claim falso llegó intacto");
      afirmar(!accionCarrito(r), "inventó una acción de carrito");
      afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
      afirmar((llamadas.get("T42") || 0) === 1, "hizo llamadas extra al proveedor");
    });

    await prueba("T43 · pedido sin producto no se asume como carrito", async () => {
      const frase = "Lo eliminé de tu pedido.";
      const r = await pedir("T43", carritoInicial);
      afirmar(r.cuerpo.reply === frase, `reescribió un pedido ambiguo: ${r.cuerpo.reply}`);
      afirmar(!accionCarrito(r), "inventó una acción de carrito");
      afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
      afirmar((llamadas.get("T43") || 0) === 1, "hizo llamadas extra al proveedor");
    });

    await prueba("T44 · pronombre de retiro con evidencia se permite", async () => {
      const r = await pedir("T44", carritoInicial);
      afirmar(r.cuerpo.reply === "Lo quité del carrito.", `reescribió: ${r.cuerpo.reply}`);
      afirmar(JSON.stringify(accionCarrito(r)?.items) === "[]", "no retiró ValEnd");
      afirmar(JSON.stringify(r.cuerpo.meta?.herramientas) === '["calcular_cotizacion"]',
        "ejecutó herramientas inesperadas");
      afirmar((llamadas.get("T44") || 0) === 2, "hizo llamadas extra al proveedor");
    });

    const claimsDentalesSinEvidencia = [
      ["T45", "Agregué 3 realistas."],
      ["T46", "Quité los de pediatría."],
      ["T47", "He agregado 2 kits completos."],
      ["T48", "Agregué 2 kits avanzados."],
      ["T49", "Agregué 1 arcada completa."],
      ["T50", "Agregué 2 Nissin."],
      ["T51", "Agregué 2 de pulpotomía."]
    ];
    for (const [escenario, frase] of claimsDentalesSinEvidencia) {
      await prueba(`${escenario} · alias Dental sin evidencia exige tool`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply !== frase, `el claim falso llegó intacto: ${frase}`);
        afirmar(!/(?:agregu[eé]|he agregado|quit[eé])[^.!?]*(?:realistas|pediatr[ií]a|kits?|arcada|nissin|pulpotom[ií]a)/i.test(r.cuerpo.reply),
          `el fallback aún afirma la mutación: ${r.cuerpo.reply}`);
        afirmar(!accionCarrito(r), "inventó una acción de carrito");
        afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
        afirmar((llamadas.get(escenario) || 0) === 1, "hizo llamadas extra al proveedor");
      });
    }

    const frasesPedidoOrdenNoDentales = [
      ["T52", "Quité la tapa de PET de tu pedido de empaques."],
      ["T53", "Agregué un módulo nuevo al pedido de IA."],
      ["T54", "Eliminé el acabado brillante de la orden 3D."]
    ];
    for (const [escenario, frase] of frasesPedidoOrdenNoDentales) {
      await prueba(`${escenario} · pedido/orden de otro dominio pasa intacto`, async () => {
        const r = await pedir(escenario, carritoInicial);
        afirmar(r.cuerpo.reply === frase, `reescribió otro dominio: ${r.cuerpo.reply}`);
        afirmar(!accionCarrito(r), "inventó una acción de carrito");
        afirmar((r.cuerpo.meta?.herramientas || []).length === 0, "ejecutó una herramienta");
        afirmar((llamadas.get(escenario) || 0) === 1, "hizo llamadas extra al proveedor");
      });
    }

    const aliasCanonicos = [...new Set(Object.values(ALIAS).flat())];
    await prueba(`vocabulario · ${aliasCanonicos.length} alias, SKU y nombres canónicos dan contexto`, async () => {
      const referenciasCatalogo = getCatalogoActivo()
        .flatMap(producto => [producto.sku, producto.nombre]);
      const referencias = [...aliasCanonicos, ...referenciasCatalogo];
      const omitidas = referencias.filter(referencia =>
        !detectarClaimsMutacion(`Agregué 1 ${referencia}.`)
          .some(claim => claim.accion === "agregar"));
      afirmar(omitidas.length === 0,
        `${omitidas.length} referencias sin cubrir: ${omitidas.join(", ")}`);
      afirmar(aliasCanonicos.length > 0, "ALIAS no expuso referencias canónicas");
    });
  } finally {
    servidor.kill("SIGKILL");
    geminiFalso.close();
  }

  console.log("");
  if (fallos.length) {
    console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    process.exit(1);
  }
  console.log(`✓ ${pasadas}/${pasadas} pruebas de verifier del Asesor pasaron.\n`);
}

main().catch(e => {
  console.error(e);
  try { geminiFalso.close(); } catch { /* ya cerrado */ }
  process.exit(1);
});
