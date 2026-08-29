/**
 * ============================================================================
 *  VALQUIRIA — PULSO  (pulso.js v1)
 * ============================================================================
 *  Cuenta visitas. Nada más.
 *
 *  POR QUÉ EXISTE: el sitio es estático en GitHub Pages, así que no hay logs
 *  de servidor. Sin esto, "¿cuánta gente entra?" y "¿qué división le interesa
 *  a la gente?" no tienen respuesta, y el resumen diario del dueño estaría
 *  vacío de lo único que pasa todos los días.
 *
 *  POR QUÉ NO ES GOOGLE ANALYTICS: Analytics obliga a un aviso de cookies,
 *  mete un tercero entre el visitante y el sitio, y añade ~50 KB al primer
 *  render de una página cuyo argumento es la velocidad. Esto ocupa menos de
 *  un kilobyte.
 *
 *  QUÉ SE MANDA, EXACTAMENTE: la ruta (de una lista blanca que valida el
 *  servidor), el dominio de donde llegó el visitante, y si es su primera
 *  página de la sesión. Nada más.
 *
 *  QUÉ NO SE MANDA: ni cookies, ni identificador persistente, ni IP en claro,
 *  ni huella del navegador, ni la consulta de búsqueda, ni parámetros de
 *  campaña. No se puede reconstruir a una persona con esto, y por eso no
 *  hace falta un banner de consentimiento.
 * ============================================================================
 */

(() => {
  "use strict";

  /* Una sola URL, igual que en app.js. Apuntar a localhost en desarrollo
     parece cómodo pero lo bloquea el propio CSP de las páginas, que solo
     autoriza el backend de producción. */
  const API = "https://rodrigo-corrales1429-github-io.onrender.com";

  /* En local NO se cuenta nada. Probar el sitio no debe inflar las visitas
     reales del dueño: unas métricas en las que no se puede confiar son peores
     que no tener métricas. */
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;

  /* Respeta "No rastrear". Contar visitas es inofensivo, pero quien pidió que
     no lo cuenten tiene derecho a que no lo cuenten. */
  if (navigator.doNotTrack === "1" || window.doNotTrack === "1") return;

  /* Primera página de la sesión. sessionStorage muere al cerrar la pestaña:
     no persigue a nadie entre visitas, solo evita contar cinco veces al que
     navega cinco secciones. */
  let nuevo = true;
  try {
    nuevo = !sessionStorage.getItem("vq_visto");
    sessionStorage.setItem("vq_visto", "1");
  } catch { /* modo privado: se cuenta como nuevo y ya */ }

  /* La ruta normalizada, sin query ni fragmento: /dental/, no
     /dental/?utm_source=x#modelos. El servidor la valida igualmente contra
     su lista blanca. */
  let pagina = location.pathname.replace(/index\.html$/, "");
  if (!pagina.endsWith("/")) pagina += "/";
  if (pagina === "//") pagina = "/";

  const carga = JSON.stringify({
    tipo: "visita",
    pagina,
    referente: document.referrer || "",
    nuevo
  });

  const mandar = () => {
    try {
      /* sendBeacon sobrevive a que el usuario cierre la pestaña de inmediato,
         que es justo cuando más interesa contar el rebote. */
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API + "/api/evento", new Blob([carga], { type: "application/json" }));
        return;
      }
      fetch(API + "/api/evento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: carga,
        keepalive: true
      }).catch(() => {});
    } catch { /* medir nunca puede romper la página */ }
  };

  /* Se espera a que la página esté pintada: la telemetría va después de que
     el visitante ya tiene su contenido, nunca compitiendo con él. Y si la
     pestaña abrió en segundo plano, se espera a que alguien la mire de
     verdad — si no, un enlace abierto "para después" contaría como visita. */
  if (document.visibilityState === "hidden") {
    document.addEventListener("visibilitychange", function una() {
      if (document.visibilityState !== "hidden") {
        document.removeEventListener("visibilitychange", una);
        mandar();
      }
    });
  } else if (document.readyState === "complete") {
    setTimeout(mandar, 400);
  } else {
    addEventListener("load", () => setTimeout(mandar, 400), { once: true });
  }
})();
