/**
 * ============================================================================
 *  GRAFO DE DEPENDENCIAS — qué módulos alcanza un archivo, sin ejecutarlo
 * ============================================================================
 *  Lo usa test-seguridad.js para demostrar que el backend productivo no
 *  alcanza los servicios SQL de la Fase 2B.
 *
 *  No hay parser de JavaScript instalado y no merece una dependencia nueva:
 *  un lexer pequeño separa el código de comentarios, cadenas, plantillas y
 *  expresiones regulares, y reconoce SOLO estas formas, con especificador
 *  literal:
 *
 *    require("x")          import("x")          import "x"
 *    import x from "x"     import { a } from "x"     import * as n from "x"
 *    export { a } from "x"     export * from "x"
 *
 *  Todo lo demás que pueda cargar código —require con una variable, un
 *  alias de require, module.require, createRequire, eval, Function, vm.run*,
 *  una plantilla con ${} como especificador, una ruta relativa que no se
 *  resuelve o un archivo que el lexer no termina de entender— se devuelve
 *  como DUDOSO. Quien use esto debe fallar ante cualquier dudoso: ante la
 *  duda, falla cerrado. También el acceso por corchetes con esos nombres
 *  (`globalThis["require"]`) y `x.constructor.constructor`.
 *
 *  El lexer NO interpreta secuencias de escape, así que tampoco confía en
 *  ellas: un especificador o un acceso por corchetes escrito con escapes
 *  (`require("\x70g")`, `g["\x72equire"]`) es dudoso, y cualquier barra
 *  invertida que quede en el código fuera de cadenas, plantillas, regex y
 *  comentarios —solo puede ser un identificador escapado, `r\u{65}quire`—
 *  también.
 *
 *  LÍMITE, dicho claro: no detecta una carga ofuscada a propósito con un
 *  nombre construido en tiempo de ejecución (`g["req" + "uire"]`). Para eso
 *  están las otras dos barreras de la prueba: ninguna ruta 2B puede aparecer
 *  escrita en el grafo, y el arranque real no puede cargarla.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ANTES_DE_REGEX = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete",
  "void", "throw", "case", "do", "else", "yield", "await"]);

/* Código con los comentarios en blanco, cada cadena literal sustituida por
   "§n" (su texto queda en `literales[n]`), cada plantilla con ${} por
   __PLANTILLA__(…) con su código interno intacto, y cada regex por /§R/. */
function enmascarar(fuente) {
  const literales = [];
  const conEscape = new Set();   // índices de literales que traían «\»
  let escapeVisto = false;
  let i = 0;
  let salida = "";
  let previo = "";      // último carácter significativo emitido
  let palabra = "";     // última palabra emitida (para decidir regex vs división)
  let ultimo = "";      // último carácter emitido, espacios incluidos

  const emitir = s => {
    salida += s;
    for (const ch of s) {
      if (/\s/.test(ch)) { ultimo = ch; continue; }
      if (/[\w$]/.test(ch)) palabra = /[\w$]/.test(ultimo) ? palabra + ch : ch;
      else palabra = "";
      previo = ch;
      ultimo = ch;
    }
  };

  function cadena(cierre) {
    let texto = "";
    escapeVisto = false;
    i++;
    while (i < fuente.length) {
      const c = fuente[i];
      if (c === "\\") { escapeVisto = true; texto += fuente[i + 1] ?? ""; i += 2; continue; }
      if (c === cierre) { i++; return texto; }
      if (c === "\n") throw new Error("cadena sin cerrar");
      texto += c;
      i++;
    }
    throw new Error("cadena sin cerrar");
  }

  function plantilla() {
    i++;                                   // tras la comilla invertida
    let texto = "";
    let conBarra = false;
    const partes = [];
    while (i < fuente.length) {
      const c = fuente[i];
      if (c === "\\") { conBarra = true; texto += fuente[i + 1] ?? ""; i += 2; continue; }
      if (c === "`") { i++; return partes.length ? { dinamica: partes } : { texto, conBarra }; }
      if (c === "$" && fuente[i + 1] === "{") {
        i += 2;
        partes.push(codigoHasta("}"));
        continue;
      }
      texto += c;
      i++;
    }
    throw new Error("plantilla sin cerrar");
  }

  /* Lexea código hasta el cierre `fin` al nivel 0 (o hasta el final). */
  function codigoHasta(fin) {
    const guardado = { salida, previo, palabra, ultimo };
    salida = "";
    previo = "";
    palabra = "";
    ultimo = "";
    let profundidad = 0;
    while (i < fuente.length) {
      const c = fuente[i];
      const d = fuente[i + 1];
      if (fin && c === fin && profundidad === 0) {
        i++;
        const dentro = salida;
        ({ salida, previo, palabra, ultimo } = guardado);
        return dentro;
      }
      if (c === "/" && d === "/") { while (i < fuente.length && fuente[i] !== "\n") i++; continue; }
      if (c === "/" && d === "*") {
        const cierre = fuente.indexOf("*/", i + 2);
        if (cierre < 0) throw new Error("comentario sin cerrar");
        salida += fuente.slice(i, cierre + 2).replace(/[^\n]/g, " ");
        i = cierre + 2;
        continue;
      }
      if (c === "'" || c === '"') {
        literales.push(cadena(c));
        if (escapeVisto) conEscape.add(literales.length - 1);
        emitir(`"§${literales.length - 1}"`);
        continue;
      }
      if (c === "`") {
        const p = plantilla();
        if (p.dinamica) emitir(`__PLANTILLA__(${p.dinamica.join(",")})`);
        else {
          literales.push(p.texto);
          if (p.conBarra) conEscape.add(literales.length - 1);
          emitir(`"§${literales.length - 1}"`);
        }
        continue;
      }
      if (c === "/" && (previo === "" || "(,=:[!&|?{};+-*%<>~^".includes(previo) || ANTES_DE_REGEX.has(palabra))) {
        i++;
        let enClase = false;
        while (i < fuente.length) {
          const r = fuente[i];
          if (r === "\\") { i += 2; continue; }
          if (r === "\n") throw new Error("regex sin cerrar");
          if (r === "[") enClase = true;
          else if (r === "]") enClase = false;
          else if (r === "/" && !enClase) break;
          i++;
        }
        if (i >= fuente.length) throw new Error("regex sin cerrar");
        i++;
        while (i < fuente.length && /[a-z]/i.test(fuente[i])) i++;
        emitir("/§R/");
        continue;
      }
      if (c === "{") profundidad++;
      if (c === "}") profundidad--;
      emitir(c);
      i++;
    }
    if (fin) throw new Error(`falta cerrar «${fin}»`);
    const dentro = salida;
    ({ salida, previo, palabra, ultimo } = guardado);
    return dentro;
  }

  const codigo = codigoHasta(null);
  return { codigo, literales, conEscape };
}

const FORMAS = [
  /* Sin un punto delante: `module.require("x")` u `obj.import("x")` no son
     la forma reconocida y quedan como dudosos. */
  ["require", /(?<![.\w$])require\s*\(\s*"§(\d+)"\s*\)/g],
  ["import()", /(?<![.\w$])import\s*\(\s*"§(\d+)"\s*\)/g],
  ["import estático", /\bimport\s+[\w$*{}\s,]+?\s+from\s+"§(\d+)"/g],
  ["import de efecto", /\bimport\s+"§(\d+)"/g],
  ["export … from", /\bexport\s+(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+"§(\d+)"/g]
];

const DUDOSOS = [
  /\brequire\b/, /\bimport\b/, /\bexport\s+(?:\*|\{[^}]*\})\s+from\b/, /\bcreateRequire\b/,
  /\bmodule\s*\.\s*require\b/, /\beval\s*\(/, /\bnew\s+Function\b/, /(^|[^.\w$])Function\s*\(/,
  /\bvm\s*\.\s*(?:runIn\w*|compileFunction|Script|SourceTextModule)\b/,
  /\bprocess\s*\.\s*(?:mainModule|binding|dlopen)\b/, /\bimportScripts\b/,
  /* `x.constructor.constructor("…")` es Function sin nombrarla. */
  /\.\s*constructor\s*\.\s*constructor\b/
];

/* `globalThis["require"]`, `module["require"]`, `process["mainModule"]`: el
   nombre va en una cadena y el lexer lo guardó aparte; se busca ahí. */
const NOMBRES_SOSPECHOSOS = new Set(["require", "import", "module", "mainModule", "createRequire",
  "constructor", "eval", "Function", "binding", "dlopen"]);

/* Las dependencias de UN archivo: { deps: [{forma, especificador}], dudosos: [texto] }. */
function dependenciasDe(fuente) {
  let masc;
  try { masc = enmascarar(fuente); } catch (e) { return { deps: [], dudosos: [`no se pudo analizar: ${e.message}`] }; }
  let resto = masc.codigo;
  const deps = [];
  const dudosos = [];
  for (const [forma, re] of FORMAS) {
    resto = resto.replace(re, (m, n) => {
      /* El lexer no decodifica escapes: «\x70g» lo leería como «x70g». Un
         especificador así no se sabe qué carga, y se trata como dudoso. */
      if (masc.conEscape.has(Number(n))) dudosos.push(`${forma} con un especificador escrito con escapes`);
      else deps.push({ forma, especificador: masc.literales[Number(n)] });
      return " ".repeat(m.length);
    });
  }
  /* Fuera de cadenas, plantillas, regex y comentarios una barra invertida
     solo puede ser un identificador escapado (`r\u{65}quire`), que las
     búsquedas por nombre no ven. */
  if (resto.includes("\\")) dudosos.push("identificador escrito con escapes Unicode");
  for (const m of resto.matchAll(/\[\s*"§(\d+)"\s*\]/g)) {
    if (masc.conEscape.has(Number(m[1]))) dudosos.push("acceso por corchetes con un nombre escrito con escapes");
    else if (NOMBRES_SOSPECHOSOS.has(masc.literales[Number(m[1])])) dudosos.push(`acceso por corchetes a «${masc.literales[Number(m[1])]}»`);
  }
  for (const re of DUDOSOS) {
    const m = resto.match(re);
    if (m) dudosos.push(resto.slice(Math.max(0, m.index - 30), m.index + 40).replace(/\s+/g, " ").trim());
  }
  return { deps, dudosos };
}

function resolver(desde, especificador) {
  if (!especificador.startsWith(".") && !path.isAbsolute(especificador)) return { externo: especificador };
  const base = path.resolve(path.dirname(desde), especificador.split("?")[0]);
  for (const c of [base, base + ".js", base + ".mjs", base + ".cjs", path.join(base, "index.js")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { archivo: c };
  }
  return { roto: especificador };
}

/* El grafo completo desde `entrada`: módulos propios alcanzados, paquetes
   externos y todo lo dudoso, con el archivo donde apareció. */
function grafoDesde(entrada) {
  const modulos = new Set();
  const externos = new Set();
  const dudosos = [];
  const pendientes = [path.resolve(entrada)];
  while (pendientes.length) {
    const archivo = pendientes.pop();
    if (modulos.has(archivo)) continue;
    modulos.add(archivo);
    if (!/\.(c|m)?js$/.test(archivo)) continue;         // .json: sin código
    const { deps, dudosos: d } = dependenciasDe(fs.readFileSync(archivo, "utf8"));
    for (const x of d) dudosos.push(`${archivo}: ${x}`);
    for (const { especificador } of deps) {
      const r = resolver(archivo, especificador);
      if (r.archivo) pendientes.push(r.archivo);
      else if (r.externo) externos.add(r.externo);
      else dudosos.push(`${archivo}: no se resuelve «${r.roto}»`);
    }
  }
  return { modulos: [...modulos], externos: [...externos], dudosos };
}

module.exports = { dependenciasDe, grafoDesde };
