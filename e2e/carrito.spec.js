"use strict";

const { test: base, expect } = require("@playwright/test");
const { startHarness } = require("./harness");
const { calcularCotizacion, centavosAPesos } = require("../quote-engine");

const BACKEND_HOST = "rodrigo-corrales1429-github-io.onrender.com";
const ENDO = [{ sku: "ValEnd", cantidad: 2 }];
const MIXED = [...ENDO, { sku: "ValPulpo", cantidad: 1 }];
const NISSIN = [{ sku: "Endotnissin", cantidad: 1 }];
const canonical = items => [...items].sort((a, b) => a.sku.localeCompare(b.sku));

const test = base.extend({
  harness: [async ({}, use) => {
    const harness = await startHarness();
    try { await use(harness); } finally { await harness.stop(); }
  }, { scope: "worker" }],
  world: async ({ page, context, harness }, use, testInfo) => {
    const world = { page, chat: [], payments: [], snapshots: [], errors: [], unexpected: [] };
    page.on("pageerror", error => world.errors.push(error.message));
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === harness.siteUrl) return route.continue();
      if (url.hostname !== BACKEND_HOST) {
        // Sólo assets externos de presentación. Nunca salir a IA/pagos/etc.
        if (!["image", "font", "stylesheet"].includes(request.resourceType())) {
          world.unexpected.push(request.url());
        }
        return route.abort("blockedbyclient");
      }
      const cors = { "Access-Control-Allow-Origin": harness.siteUrl,
        "Content-Type": "application/json" };
      if (url.pathname === "/api/pago") {
        const payment = request.postDataJSON();
        world.payments.push(payment);
        if (world.paymentHold) await world.paymentHold;
        if (world.paymentMode === "confirmation") {
          const quote = calcularCotizacion(payment.items);
          // Variación de 1 centavo para ejercitar la confirmación real de un
          // total recotizado. El enlace ficticio JAMÁS se solicita a MP.
          const total = quote._raw.total_centavos + 1;
          return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
            url: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=e2e-never-paid",
            folio: "E2E-0001", total: centavosAPesos(total),
            desglose: { total_centavos: total,
              envio_centavos: quote._raw.envio_centavos + 1,
              envio: { cp: "42000", gratis: false,
                costo_centavos: quote._raw.envio_centavos + 1, texto: "Envío simulado" } }
          }) });
        }
        // No llega a la ruta real: no reserva inventario ni crea preferencias.
        return route.fulfill({ status: 503, headers: cors,
          body: JSON.stringify({ error: "Pago simulado: no se crea ningún pago." }) });
      }
      if (url.pathname === "/api/pulso") {
        return route.fulfill({ status: 200, headers: cors, body: '{"ok":true}' });
      }
      if (!["/health", "/api/chat", "/api/envio"].includes(url.pathname)) {
        world.unexpected.push(request.url());
        return route.abort("blockedbyclient");
      }
      const before = harness.providerCalls.length;
      const response = await route.fetch({
        url: `${harness.backendUrl}${url.pathname}${url.search}`, timeout: 10_000
      });
      if (url.pathname === "/api/chat") {
        const record = { request: request.postDataJSON(), status: response.status(),
          response: await response.json(), provider: harness.providerCalls.slice(before) };
        world.chat.push(record);
        // Barrera observacional: backend ya verificó; navegador aún espera.
        if (world.hold) await world.hold;
      }
      await route.fulfill({ response });
    });
    try {
      await page.goto(`${harness.siteUrl}/?ir=catalogo`);
      await expect(page.locator("#pre"), "DOM: aplicación real lista").toHaveClass(/gone/);
      await use(world);
      expect(world.errors, "DOM: sin errores JavaScript").toEqual([]);
      expect(world.unexpected, "Red: ningún endpoint externo no autorizado").toEqual([]);
    } finally {
      world.release?.();
      await testInfo.attach("cart-convergence.json", {
        body: Buffer.from(JSON.stringify({ chat: world.chat, checkout: world.payments,
          snapshots: world.snapshots, errors: world.errors, unexpected: world.unexpected }, null, 2)),
        contentType: "application/json"
      });
    }
  }
});

async function advisor(page) {
  if (await page.locator("#drawer").getAttribute("aria-hidden") === "false") {
    await page.getByRole("button", { name: "Cerrar carrito", exact: true }).click();
  }
  if (await page.locator("#asesor").getAttribute("aria-hidden") !== "false") {
    await page.getByRole("button", { name: "Abrir el Asesor Valquiria", exact: true }).click();
  }
}

async function send(world, text, { held = false } = {}) {
  const { page } = world;
  await advisor(page);
  const before = world.chat.length;
  const bubbles = await page.locator("#asesor-log .msj.bot").count();
  await page.getByRole("textbox", { name: "Mensaje para el asesor", exact: true }).fill(text);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect.poll(() => world.chat.length, { message: "Backend: recibió petición real del navegador" })
    .toBe(before + 1);
  if (!held) {
    await expect(page.locator("#asesor-send"), "DOM: turno terminó").toBeEnabled();
    await expect(page.locator("#asesor-log .msj.bot"), "DOM: respuesta visible")
      .toHaveCount(bubbles + 1);
  }
  return world.chat[before];
}

function verified(record, previous, final, actions) {
  expect(record.status, "Backend: HTTP 200, no fallback local del navegador").toBe(200);
  expect(canonical(record.request.carrito), "Backend: recibió carrito actual")
    .toEqual(canonical(previous));
  const cot = record.response.cotizacion;
  expect(cot.ok, "Backend: cotización validada").toBe(true);
  expect(canonical(cot.carrito_final), "Backend: estado final autorizado")
    .toEqual(canonical(final));
  expect(record.response.acciones, "Action: un único reemplazo autoritativo exacto")
    .toEqual([{ tipo: "carrito_set", items: cot.carrito_final }]);
  expect(record.response.products, "Backend: no catálogo automático irrelevante").toEqual([]);
  expect(record.response.meta.herramientas, "Backend: sólo herramientas de carrito esperadas")
    .toEqual(actions.map(() => "calcular_cotizacion"));
  expect(record.provider, "Backend: tool → resultado → fallback sin nuevas tool calls").toHaveLength(2);
  const runtime = record.provider.at(-1).functionResponses;
  expect(runtime.map(r => r.response.accion), "Backend: acciones ejecutadas en orden").toEqual(actions);
  for (const result of runtime) {
    expect(result.name, "Backend: herramienta permitida").toBe("calcular_cotizacion");
    expect(result.response.ok, "Backend: runtime aceptó el contrato").toBe(true);
  }
  expect(canonical(runtime.at(-1).response.carrito_final), "Backend: runtime = action")
    .toEqual(canonical(final));
  if (!final.length) {
    expect(cot.total, "Backend: total cero").toBe("$0.00 MXN");
    expect(record.response.reply, "Verifier: confirmación factual del estado vacío")
      .toMatch(/carrito.*vacío/i);
  }
}

async function converge(world, items, stage) {
  const { page } = world;
  const pieces = items.reduce((sum, line) => sum + line.cantidad, 0);
  await expect(page.locator("#cart-n"), `${stage} / badge: suma de cantidades`).toHaveText(String(pieces));
  if (await page.locator("#asesor").getAttribute("aria-hidden") === "false") {
    await page.getByRole("button", { name: "Cerrar asesor", exact: true }).click();
  }
  if (await page.locator("#drawer").getAttribute("aria-hidden") !== "false") {
    await page.getByRole("button", { name: "Abrir carrito", exact: true }).click();
  }
  await expect(page.locator("#drawer .ci"), `${stage} / drawer: número exacto de líneas`).toHaveCount(items.length);
  const dom = await page.locator("#drawer .ci").evaluateAll(lines => lines.map(line => ({
    sku: line.dataset.sku, cantidad: Number(line.querySelector(".ci-ctl > span").textContent)
  })));
  expect(canonical(dom), `${stage} / DOM: SKU/cantidad sin productos fantasma`).toEqual(canonical(items));
  const storage = await page.evaluate(() => JSON.parse(localStorage.getItem("vq_carrito_v1") || "[]"));
  expect(canonical(storage), `${stage} / storage: coincide con estado autorizado`).toEqual(canonical(items));
  // PII nunca debe migrar de sessionStorage al almacenamiento persistente.
  expect(await page.evaluate(() => localStorage.getItem("vq_comprador_v1")), `${stage} / storage: sin PII persistente`).toBeNull();
  if (!items.length) {
    await expect(page.locator("#drawer .vacio"), `${stage} / drawer: estado vacío factual`).toContainText("Tu carrito está vacío");
    await expect(page.locator("#env-total"), `${stage} / total: no importe antiguo`).toHaveCount(0);
    await expect(page.locator("#ir-pagar"), `${stage} / checkout: no botón de pedido vacío`).toHaveCount(0);
  }
  world.snapshots.push({ stage, badge: pieces, drawer: dom, localStorage: storage });
}

async function refresh(world, items) {
  const before = world.page.url();
  await world.page.reload();
  await expect(world.page, "Refresh: permanece en la entrada interactiva, no en la página SEO")
    .toHaveURL(before);
  await expect(world.page.locator("#pre"), "Refresh: frontend real restaurado").toHaveClass(/gone/);
  await converge(world, items, "refresh");
}

async function seedCatalog(world, items) {
  for (const line of items) {
    const card = world.page.locator(`.card[data-sku="${line.sku}"]`);
    await card.getByRole("spinbutton").fill(String(line.cantidad));
    await card.getByRole("button", { name: "Agregar", exact: true }).click();
  }
}

async function requestCheckout(world, items) {
  const { page } = world;
  const before = world.payments.length;
  await converge(world, items, "antes de checkout");
  await page.locator("#ir-pagar").click();
  const form = page.locator(".chat-datos:not(.listo)");
  if (await form.count()) {
    await form.getByRole("textbox", { name: "Nombre completo", exact: true }).fill("Cliente E2E");
    await form.getByRole("textbox", { name: "WhatsApp", exact: true }).fill("7710000000");
    await form.getByRole("textbox", { name: "Correo", exact: true }).fill("e2e@example.test");
    await form.getByRole("textbox", { name: "Código postal", exact: true }).fill("42000");
    await form.getByRole("textbox", { name: "Calle y número, colonia y ciudad", exact: true }).fill("Calle Prueba 1, Centro, Pachuca");
    await form.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.locator(".chat-datos").last(), "Checkout: datos sintéticos aceptados").toHaveClass(/listo/);
    await page.locator('.chat-act[data-acc="pago"]').last().click();
  }
  await expect.poll(() => world.payments.length, { message: "Checkout: petición de pago interceptada, sin efectos" }).toBe(before + 1);
  expect(canonical(world.payments.at(-1).items), "Checkout: items exactos, sin copiar estado antiguo").toEqual(canonical(items));
}

async function checkout(world, items) {
  const { page } = world;
  await requestCheckout(world, items);
  if (world.paymentMode === "confirmation") {
    await expect(page.locator('.chat-act[data-acc="pago-listo"]'), "Checkout: confirmación de total recotizado")
      .toHaveCount(1);
  } else {
    await expect(page.locator("#asesor-log .msj.bot").last(), "Checkout: stub no declara pago real")
      .toContainText("No pude generar el link de pago");
  }
  await converge(world, items, "después de checkout simulado");
}

async function emptyCheckout(world) {
  const before = world.payments.length;
  await advisor(world.page);
  const staleButton = world.page.locator('.chat-act[data-acc="pago"]').first();
  if (await staleButton.count()) {
    await staleButton.click();
    // Dos frames para observar que el handler síncrono no inicia una petición.
    await world.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  expect(world.payments.length, "Checkout vacío: botones viejos no recuperan productos ni llaman pago").toBe(before);
  await converge(world, [], "checkout vacío");
}

test("G-02: vaciar converge a cero, sin claim anticipado; refresh y checkout no resucitan productos", async ({ world }) => {
  const added = await send(world, "agrégame 2 Endo");
  verified(added, [], ENDO, ["agregar"]);
  await advisor(world.page);
  await world.page.getByRole("button", { name: "Cerrar asesor", exact: true }).click();
  await seedCatalog(world, [{ sku: "ValPulpo", cantidad: 1 }]);
  await checkout(world, MIXED); // deja botón de pago viejo y comprador capturado
  await advisor(world.page);
  const botsBefore = await world.page.locator("#asesor-log .msj.bot").count();
  world.hold = new Promise(resolve => { world.release = resolve; });
  const cleared = await send(world, "vacía mi carrito", { held: true });
  verified(cleared, MIXED, [], ["vaciar"]);
  await expect(world.page.locator("#cart-n"), "Antes de action: badge conserva estado previo").toHaveText("3");
  await expect(world.page.locator("#asesor-log .msj.bot"), "Antes de action: no nuevo claim de éxito visible").toHaveCount(botsBefore);
  await expect(world.page.locator("#asesor-send"), "Antes de action: frontend todavía espera").toBeDisabled();
  world.release();
  world.hold = null;
  await expect(world.page.locator("#asesor-send")).toBeEnabled();
  await expect(world.page.locator("#asesor-log .msj.bot").last(), "Verifier visible: vaciado factual").toContainText("vacío");
  await expect(world.page.locator(".chat-cot .tot").last(), "DOM: total autorizado cero").toContainText("$0.00 MXN");
  await expect(world.page.locator(".chat-prods"), "DOM: no catálogo después de vaciar").toHaveCount(0);
  await converge(world, [], "vaciar");
  await emptyCheckout(world);
  await refresh(world, []);
  await emptyCheckout(world);
  const again = await send(world, "vacía mi carrito");
  verified(again, [], [], ["vaciar"]);
  await converge(world, [], "vaciar de nuevo");
});

test("Agregar 2 Endo: backend, action, badge, drawer, storage, refresh y checkout", async ({ world }) => {
  const record = await send(world, "agrégame 2 Endo");
  verified(record, [], ENDO, ["agregar"]);
  await converge(world, ENDO, "agregar");
  await refresh(world, ENDO);
  await checkout(world, ENDO);
});

test("Quitar Endo sin cantidad elimina la línea completa y persiste el carrito vacío", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  const record = await send(world, "quita los Endo");
  verified(record, ENDO, [], ["quitar"]);
  await expect(world.page.locator(".chat-cot .tot").last()).toContainText("$0.00 MXN");
  await converge(world, [], "quitar última línea");
  await emptyCheckout(world);
  await refresh(world, []);
  await emptyCheckout(world);
});

test("Quitar Endo de carrito mixto conserva únicamente Pulpo, también en checkout", async ({ world }) => {
  await seedCatalog(world, MIXED);
  const final = [{ sku: "ValPulpo", cantidad: 1 }];
  const record = await send(world, "quita los Endo");
  verified(record, MIXED, final, ["quitar"]);
  await converge(world, final, "quitar línea de carrito mixto");
  await refresh(world, final);
  await checkout(world, final);
});

test("Reemplazo autoritativo no fusiona Nissin con las líneas viejas", async ({ world }) => {
  await seedCatalog(world, MIXED);
  const record = await send(world, "reemplaza mi carrito por un Nissin");
  verified(record, MIXED, NISSIN, ["reemplazar"]);
  await converge(world, NISSIN, "reemplazar");
  await refresh(world, NISSIN);
  await checkout(world, NISSIN);
});

test("Doble mutación existente: agregar parte del resultado de quitar, sin productos fantasma", async ({ world }) => {
  await seedCatalog(world, MIXED);
  const final = [{ sku: "ValPulpo", cantidad: 1 }, ...NISSIN];
  const record = await send(world, "quita los Endo y agrégame un Nissin");
  verified(record, MIXED, final, ["quitar", "agregar"]);
  const results = record.provider.at(-1).functionResponses;
  expect(results[0].response.carrito_final, "Backend: primera mutación deja sólo Pulpo")
    .toEqual([{ sku: "ValPulpo", cantidad: 1 }]);
  expect(canonical(results[1].response.carrito_final), "Backend: segunda parte del resultado de la primera")
    .toEqual(canonical(final));
  await converge(world, final, "doble mutación");
  await refresh(world, final);
  await checkout(world, final);
});

test("La corrección de refresh conserva el redirect legacy al catálogo SEO", async ({ world, harness }) => {
  await world.page.goto(`${harness.siteUrl}/#/catalogo`);
  await expect(world.page, "SEO: entrada legacy sin query aún se reemplaza por la URL limpia")
    .toHaveURL(`${harness.siteUrl}/catalogo/`);
  await expect(world.page.getByRole("heading", { level: 1 }))
    .toHaveText("Modelos dentales para práctica y entrenamiento.");
});

test("Vaciado invalida un enlace de checkout ya generado, sin navegar ni crear otro pago", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  world.paymentMode = "confirmation";
  await checkout(world, ENDO);
  const record = await send(world, "vacía mi carrito");
  verified(record, ENDO, [], ["vaciar"]);
  const before = world.page.url();
  await world.page.locator('.chat-act[data-acc="pago-listo"]').click();
  await expect(world.page, "Checkout: enlace antiguo no puede enviar el pedido vaciado a MP").toHaveURL(before);
  expect(world.payments, "Checkout: confirmar un enlace obsoleto no crea una segunda preferencia").toHaveLength(1);
  expect(await world.page.evaluate(() => sessionStorage.getItem("vq_pago_en_curso")),
    "Checkout: no guarda un pago antiguo como si correspondiera al carrito vacío").toBeNull();
  await converge(world, [], "enlace de checkout obsoleto");
  await refresh(world, []);
});

test("Reemplazo invalida el enlace viejo y el siguiente checkout lee sólo el carrito nuevo", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  world.paymentMode = "confirmation";
  await checkout(world, ENDO);
  const record = await send(world, "reemplaza mi carrito por un Nissin");
  verified(record, ENDO, NISSIN, ["reemplazar"]);
  const before = world.page.url();
  await world.page.locator('.chat-act[data-acc="pago-listo"]').click();
  await expect(world.page, "Checkout: reemplazo invalida el enlace para Endo").toHaveURL(before);
  expect(world.payments, "Checkout: no recotiza automáticamente ni duplica reservas").toHaveLength(1);
  await expect(world.page.locator("#asesor-log .msj.bot").last(), "Checkout: explica factual el enlace obsoleto")
    .toContainText("ya no corresponde al pedido actual");
  await refresh(world, NISSIN);
  world.paymentMode = "failure";
  await checkout(world, NISSIN);
});

test("Confirmar sin mutación reutiliza el enlace generado y no solicita un segundo pago", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  world.paymentMode = "confirmation";
  await checkout(world, ENDO);
  const target = "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=e2e-never-paid";
  const destinations = [];
  // Página de pago también simulada: no existe contacto real con MP.
  await world.page.route(target, async route => {
    destinations.push(route.request().url());
    await route.fulfill({ contentType: "text/html", body: "<h1>Checkout simulado</h1>" });
  });
  await advisor(world.page);
  await world.page.locator('.chat-act[data-acc="pago-listo"]').click();
  await expect(world.page, "Checkout sin mutación: permite confirmar el mismo pedido").toHaveURL(target);
  await expect(world.page.getByRole("heading")).toHaveText("Checkout simulado");
  expect(destinations, "Checkout: un único salto simulado al enlace ya existente").toEqual([target]);
  expect(world.payments, "Idempotencia UI: confirmar no crea otra preferencia").toHaveLength(1);
});

test("Mutación con checkout en vuelo rechaza la respuesta vieja sin recuperar productos", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  world.paymentMode = "confirmation";
  world.paymentHold = new Promise(resolve => { world.release = resolve; });
  await requestCheckout(world, ENDO);
  const before = world.page.url();
  const record = await send(world, "vacía mi carrito");
  verified(record, ENDO, [], ["vaciar"]);
  world.release();
  world.paymentHold = null;
  await expect(world.page.locator("#asesor-log .msj.bot").last(), "Checkout en vuelo: respuesta vieja se descarta")
    .toContainText("No pude generar el link de pago");
  await expect(world.page.locator('.chat-act[data-acc="pago-listo"]'), "Checkout en vuelo: ningún enlace obsoleto disponible")
    .toHaveCount(0);
  await expect(world.page, "Checkout en vuelo: no redirige al pedido antiguo").toHaveURL(before);
  expect(world.payments, "Checkout en vuelo: no recotiza automáticamente").toHaveLength(1);
  expect(await world.page.evaluate(() => sessionStorage.getItem("vq_pago_en_curso")),
    "Checkout en vuelo: ningún snapshot de pago divergente").toBeNull();
  await converge(world, [], "mutación durante checkout");
  await refresh(world, []);
});

async function releaseAdvisor(world) {
  world.release();
  world.hold = null;
  await expect(world.page.locator("#asesor-send"), "Asesor: termina el turno retenido").toBeEnabled();
}

async function conflict(world, quoteCount, paymentButtonCount) {
  const { page } = world;
  await advisor(page);
  await expect(page.locator("#asesor-log .msj.bot").last(), "Asesor obsoleto: no afirma una mutación descartada")
    .toHaveText("Tu carrito cambió mientras respondía; no apliqué ese cambio.");
  await expect(page.locator(".chat-cot"), "Asesor obsoleto: no muestra una cotización vieja").toHaveCount(quoteCount);
  await expect(page.locator('.chat-act[data-acc="pago"]'), "Asesor obsoleto: no crea acciones de pago derivadas")
    .toHaveCount(paymentButtonCount);
  expect(world.chat, "Asesor obsoleto: no inicia otra llamada al backend").toHaveLength(1);
  expect(world.chat[0].provider, "Asesor obsoleto: no regenera con Gemini").toHaveLength(2);
}

test("ADV-1: respuesta vieja no restaura Endo eliminado manualmente", async ({ world }) => {
  await seedCatalog(world, ENDO);
  world.hold = new Promise(resolve => { world.release = resolve; });
  const record = await send(world, "agrégame 2 Endo", { held: true });
  verified(record, ENDO, [{ sku: "ValEnd", cantidad: 4 }], ["agregar"]);
  await converge(world, ENDO, "ADV-1 antes de edición manual");
  await world.page.locator('.ci[data-sku="ValEnd"] .ci-quitar').click();
  await converge(world, [], "ADV-1 edición manual");
  await releaseAdvisor(world);
  await conflict(world, 0, 0);
  await converge(world, [], "ADV-1 respuesta obsoleta descartada");
  await refresh(world, []);
  await emptyCheckout(world);
});

test("ADV-1b: vaciado viejo no elimina Pulpo agregado mientras el Asesor responde", async ({ world }) => {
  await seedCatalog(world, ENDO);
  world.hold = new Promise(resolve => { world.release = resolve; });
  const record = await send(world, "vacía mi carrito", { held: true });
  verified(record, ENDO, [], ["vaciar"]);
  await advisor(world.page);
  await world.page.getByRole("button", { name: "Cerrar asesor", exact: true }).click();
  await seedCatalog(world, [{ sku: "ValPulpo", cantidad: 1 }]);
  await converge(world, MIXED, "ADV-1b edición manual");
  await releaseAdvisor(world);
  await conflict(world, 0, 0);
  await converge(world, MIXED, "ADV-1b respuesta obsoleta descartada");
  await refresh(world, MIXED);
  await checkout(world, MIXED);
});

test("Dual-button checkout: drawer y chat sólo crean un POST, y el error libera la guardia", async ({ world }) => {
  await send(world, "agrégame 2 Endo");
  world.paymentHold = new Promise(resolve => { world.release = resolve; });
  await requestCheckout(world, ENDO);
  await converge(world, ENDO, "doble checkout en vuelo");
  await world.page.locator("#ir-pagar").click();
  await advisor(world.page);
  await world.page.locator('.chat-act[data-acc="pago"]').first().click();
  await world.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(world.payments, "Guardia global: drawer + chat no crean otras preferencias").toHaveLength(1);
  world.release();
  world.paymentHold = null;
  await expect(world.page.locator("#asesor-log .msj.bot").last()).toContainText("No pude generar el link de pago");
  await checkout(world, ENDO);
  expect(world.payments, "Guardia global: permite reintento explícito después del error").toHaveLength(2);
});

test("Refresh routing: hash de catálogo abierto dentro de SPA permanece interactivo", async ({ world, harness }) => {
  test.setTimeout(60_000);
  await world.page.goto(`${harness.siteUrl}/?asesor=1`);
  await expect(world.page.locator("#pre")).toHaveClass(/gone/, { timeout: 20_000 });
  await converge(world, [], "SPA antes de entrar por hash");
  await world.page.locator('#drawer-pie a[href="#/catalogo"]').click();
  await expect(world.page.locator("#v-catalogo")).toHaveClass(/on/);
  await refresh(world, []);
});

test("Refresh routing: navegar de catálogo a Pack conserva SPA y back/forward", async ({ world }) => {
  test.setTimeout(60_000);
  await world.page.evaluate(() => { location.hash = "#/pack"; });
  await expect(world.page.locator("#v-pack")).toHaveClass(/on/);
  await refresh(world, []);
  await world.page.getByRole("button", { name: "Cerrar carrito", exact: true }).click();
  await world.page.locator('#v-pack a.volver[href="#/"]').click();
  await expect(world.page.locator("#v-hub")).toHaveClass(/on/);
  await world.page.goBack();
  await expect(world.page.locator("#v-pack"), "Back: regresa a Pack interactivo").toHaveClass(/on/);
  await world.page.goForward();
  await expect(world.page.locator("#v-hub"), "Forward: regresa al home interactivo").toHaveClass(/on/);
});

for (const scenario of [
  { name: "misma SKU con cantidad distinta", initial: ENDO,
    final: [{ sku: "ValEnd", cantidad: 3 }], edit: "quantity" },
  { name: "mismo número de piezas pero SKU distinta", initial: ENDO,
    final: [{ sku: "ValPulpo", cantidad: 2 }], edit: "product" },
  { name: "snapshot vacío con producto nuevo", initial: [],
    final: [{ sku: "ValPulpo", cantidad: 1 }], edit: "empty" }
]) {
  test(`Snapshot canónico: descarta ${scenario.name}`, async ({ world }) => {
    await seedCatalog(world, scenario.initial);
    world.hold = new Promise(resolve => { world.release = resolve; });
    const record = await send(world, "agrégame 2 Endo", { held: true });
    verified(record, scenario.initial,
      [{ sku: "ValEnd", cantidad: scenario.initial.length ? 4 : 2 }], ["agregar"]);
    await converge(world, scenario.initial, "snapshot original");
    if (scenario.edit === "quantity") {
      await world.page.locator('.ci[data-sku="ValEnd"] [data-d="1"]').click();
    } else {
      if (scenario.edit === "product") {
        await world.page.locator('.ci[data-sku="ValEnd"] .ci-quitar').click();
      }
      await world.page.getByRole("button", { name: "Cerrar carrito", exact: true }).click();
      await seedCatalog(world, scenario.final);
    }
    await converge(world, scenario.final, "edición manual canónica");
    await releaseAdvisor(world);
    await conflict(world, 0, 0);
    await converge(world, scenario.final, "snapshot nuevo conservado");
    await refresh(world, scenario.final);
    await checkout(world, scenario.final);
  });
}

test("Snapshot canónico: mismo contenido reordenado permite la respuesta honesta", async ({ world }) => {
  await seedCatalog(world, MIXED);
  world.hold = new Promise(resolve => { world.release = resolve; });
  const final = [{ sku: "ValPulpo", cantidad: 1 }];
  const record = await send(world, "quita los Endo", { held: true });
  verified(record, MIXED, final, ["quitar"]);
  await converge(world, MIXED, "orden original");
  await world.page.locator('.ci[data-sku="ValEnd"] .ci-quitar').click();
  await world.page.getByRole("button", { name: "Cerrar carrito", exact: true }).click();
  await seedCatalog(world, ENDO);
  const reordered = await world.page.evaluate(() => JSON.parse(localStorage.getItem("vq_carrito_v1")));
  expect(reordered, "Control: cambia el orden real sin cambiar SKU/cantidad").toEqual([MIXED[1], MIXED[0]]);
  await releaseAdvisor(world);
  await advisor(world.page);
  await expect(world.page.locator("#asesor-log .msj.bot").last())
    .toContainText("Listo. Actualicé tu carrito con el cambio solicitado.");
  await expect(world.page.locator(".chat-cot")).toHaveCount(1);
  expect(world.chat, "No regenera la respuesta compatible").toHaveLength(1);
  await converge(world, final, "reordenamiento equivalente aceptado");
  await refresh(world, final);
  await checkout(world, final);
});

for (const outcome of ["success", "invalidated"]) {
  test(`Global checkout lock: ${outcome} libera la guardia para un intento explícito`, async ({ world }) => {
    await send(world, "agrégame 2 Endo");
    world.paymentMode = "confirmation";
    world.paymentHold = new Promise(resolve => { world.release = resolve; });
    await requestCheckout(world, ENDO);
    let final = ENDO;
    if (outcome === "invalidated") {
      const record = await send(world, "reemplaza mi carrito por un Nissin");
      verified(record, ENDO, NISSIN, ["reemplazar"]);
      final = NISSIN;
    }
    await converge(world, final, "guardia antes de resolver");
    await world.page.locator("#ir-pagar").click();
    await advisor(world.page);
    await world.page.locator('.chat-act[data-acc="pago"]').first().click();
    await world.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(world.payments, "Guardia sigue global aunque cambie el carrito").toHaveLength(1);
    const before = world.page.url();
    world.release();
    world.paymentHold = null;
    if (outcome === "success") {
      await expect(world.page.locator('.chat-act[data-acc="pago-listo"]')).toHaveCount(1);
    } else {
      await expect(world.page.locator("#asesor-log .msj.bot").last()).toContainText("No pude generar el link de pago");
      await expect(world.page.locator('.chat-act[data-acc="pago-listo"]')).toHaveCount(0);
    }
    await expect(world.page, "No navega sin confirmar ni con respuesta invalidada").toHaveURL(before);
    world.paymentMode = "failure";
    await checkout(world, final);
    expect(world.payments, "Sin deadlock: sólo el reintento explícito genera otro POST").toHaveLength(2);
  });
}

test("Refresh routing: entrada SPA con query viejo prioriza hash; páginas SEO mantienen canonical", async ({ world, harness }) => {
  test.setTimeout(60_000);
  await world.page.goto(`${harness.siteUrl}/?ir=catalogo#/pack`);
  await expect(world.page.locator("#pre")).toHaveClass(/gone/, { timeout: 20_000 });
  await expect(world.page.locator("#v-pack")).toHaveClass(/on/);
  await expect(world.page).toHaveURL(`${harness.siteUrl}/?ir=pack#/pack`);
  await refresh(world, []);
  await expect(world.page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://valquiriainc.com/");
  for (const route of ["catalogo", "pack"]) {
    await world.page.goto(`${harness.siteUrl}/${route}/`);
    await expect(world.page).toHaveURL(`${harness.siteUrl}/${route}/`);
    await expect(world.page.locator('link[rel="canonical"]'))
      .toHaveAttribute("href", `https://valquiriainc.com/${route}/`);
    await expect(world.page.locator("#asesor")).toHaveCount(0);
  }
});
