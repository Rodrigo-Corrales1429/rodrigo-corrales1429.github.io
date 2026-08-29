/**
 * ============================================================================
 *  CSP — HASHES DE LOS SCRIPTS EN LÍNEA  (scripts/csp-hashes.js)
 * ============================================================================
 *  POR QUÉ EXISTE
 *
 *  El sitio necesita scripts en línea: el import map de Three.js y el
 *  redirector de rutas antiguas tienen que ejecutarse ANTES de que cargue
 *  nada más, y un archivo aparte llegaría tarde. Los import maps además NO se
 *  pueden externalizar: los navegadores ignoran `<script type="importmap"
 *  src="...">`, así que "muévelo a un .json" rompe la escena 3D entera.
 *
 *  La alternativa correcta es declarar el HASH de cada script permitido. El
 *  navegador ejecuta solo los que coinciden; cualquier `<script>` inyectado
 *  por un atacante tiene otro hash y no corre.
 *
 *  EL PELIGRO, Y CÓMO SE DESACTIVA
 *  En cuanto hay hashes, el navegador IGNORA 'unsafe-inline'. Eso significa
 *  que si alguien edita un script en línea y no regenera el hash, ese script
 *  deja de ejecutarse EN PRODUCCIÓN, en silencio, para todos los visitantes:
 *  la escena 3D no aparece y nadie ve un error.
 *
 *  Por eso este archivo viene en pareja con una prueba (`npm test`) que
 *  recalcula los hashes y falla si no coinciden con los del CSP. El olvido
 *  se convierte en una prueba roja en vez de en una página rota.
 *
 *  USO
 *    node scripts/csp-hashes.js            → muestra los hashes actuales
 *    node scripts/csp-hashes.js --escribir → los aplica al CSP de cada página
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RAIZ = path.join(__dirname, "..");

const PAGINAS = [
  "index.html",
  "dental/index.html",
  "ia/index.html",
  "3d/index.html",
  "pack/index.html",
  "lux/index.html",
  "catalogo/index.html",
  "404.html"
];

/* Un <script> sin atributo `src`. Incluye importmap y ld+json: en varios
   navegadores el CSP de script-src también los cubre, y dejarlos fuera hace
   que el sitio funcione en un navegador y no en otro. */
const RE_INLINE = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g;

/**
 * Quita los comentarios HTML antes de buscar scripts.
 *
 * Sin esto, un comentario que MENCIONA `<script>` —y este repositorio tiene
 * varios explicando por qué el CSP es como es— se cuenta como un script real,
 * y el hash resultante cambia cada vez que se edita un comentario. El síntoma
 * es peor que el error: hashes que "se desincronizan solos" sin que nadie haya
 * tocado código ejecutable.
 */
function sinComentarios(html) {
  /* Se sustituye por espacios del mismo largo para no mover posiciones. */
  return html.replace(/<!--[\s\S]*?-->/g, c => " ".repeat(c.length));
}

/** Hashes sha256 en base64 de todos los scripts en línea de un HTML. */
function hashesDe(htmlOriginal) {
  const html = sinComentarios(htmlOriginal);
  const fuera = [];
  let m;
  RE_INLINE.lastIndex = 0;
  while ((m = RE_INLINE.exec(html)) !== null) {
    /* El hash se calcula sobre el ORIGINAL, no sobre la copia sin comentarios:
       blanquear conserva las posiciones exactamente para poder hacer esto, y
       así un script que contuviera `<!--` en su código no se corrompe.
       El contenido cuenta byte a byte: un espacio de más al final lo cambia. */
    const desde = m.index + m[0].indexOf(">", m[0].indexOf("<script")) + 1;
    const cuerpo = htmlOriginal.slice(desde, desde + m[2].length);
    const hash = crypto.createHash("sha256").update(cuerpo, "utf8").digest("base64");
    fuera.push(`'sha256-${hash}'`);
  }
  /* Sin duplicados: dos scripts idénticos comparten hash y repetirlo en el
     CSP no aporta nada. */
  return [...new Set(fuera)];
}

/** Reescribe la directiva script-src del CSP de un HTML con esos hashes. */
function conHashes(html, hashes) {
  return html.replace(
    /(http-equiv="Content-Security-Policy" content=")([^"]+)(")/,
    (todo, ini, csp, fin) => {
      const nuevo = csp.replace(/script-src([^;]*)/, (_, valor) => {
        /* Se conserva todo lo que no sea 'unsafe-inline' ni un hash viejo:
           'self', 'wasm-unsafe-eval', unpkg.com, blob: siguen haciendo falta. */
        const partes = valor.trim().split(/\s+/).filter(
          p => p && p !== "'unsafe-inline'" && !/^'sha256-/.test(p)
        );
        return `script-src ${[...partes, ...hashes].join(" ")}`;
      });
      return ini + nuevo + fin;
    }
  );
}

function revisar({ escribir }) {
  let problemas = 0;

  for (const rel of PAGINAS) {
    const abs = path.join(RAIZ, rel);
    if (!fs.existsSync(abs)) continue;
    let html = fs.readFileSync(abs, "utf8");

    const hashes = hashesDe(html);
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];

    if (!csp) {
      console.log(`  —  ${rel}: sin CSP declarado`);
      continue;
    }
    if (!/script-src/.test(csp)) {
      /* Sin script-src explícito manda default-src. Añadir hashes ahí sería
         cambiar el significado de la política entera, así que se avisa. */
      console.log(`  ⚠  ${rel}: el CSP no declara script-src (hereda default-src)`);
      continue;
    }

    const faltan = hashes.filter(h => !csp.includes(h));
    const tieneUnsafe = csp.includes("'unsafe-inline'") && /script-src[^;]*'unsafe-inline'/.test(csp);

    if (escribir) {
      const nuevo = conHashes(html, hashes);
      if (nuevo !== html) {
        fs.writeFileSync(abs, nuevo);
        console.log(`  ✎  ${rel}: ${hashes.length} hash(es) aplicados`);
      } else {
        console.log(`  =  ${rel}: ya estaba al día`);
      }
    } else {
      if (faltan.length || tieneUnsafe) {
        problemas++;
        console.log(`  ✗  ${rel}`);
        if (tieneUnsafe) console.log(`       sigue con 'unsafe-inline' en script-src`);
        for (const h of faltan) console.log(`       falta ${h}`);
      } else {
        console.log(`  ✓  ${rel}: ${hashes.length} script(s) en línea, todos con hash`);
      }
    }
  }
  return problemas;
}

if (require.main === module) {
  const escribir = process.argv.includes("--escribir");
  console.log(escribir ? "\nAplicando hashes al CSP:\n" : "\nRevisando hashes del CSP:\n");
  const problemas = revisar({ escribir });
  console.log("");
  if (!escribir && problemas) {
    console.log(`${problemas} página(s) con el CSP desactualizado.`);
    console.log("Arréglalo con:  node scripts/csp-hashes.js --escribir\n");
    process.exit(1);
  }
}

module.exports = { hashesDe, conHashes, PAGINAS, RAIZ };
