# Comercio PostgreSQL — integración y operación V1

Implementado en código, pendiente de revisión adversarial y configuración de producción.
No se contactó producción ni proveedores reales. No autoriza el despliegue por sí mismo.
La especificación v1.3 FINAL permanece congelada. Esto conecta el monolito modular a
los servicios SQL existentes, sin ORM, Redis, nuevos pagos, CRM ni logística ejecutiva.

## Autoridad y límites

`npm start` sigue siendo `node server.js`. `PERSISTENCIA=postgres` activa el adaptador
`services/postgres-runtime.js`. Una `DATABASE_URL` sin modo también exige SQL; un modo
inválido, o `legacy` con URL configurada, cierra comercio. Sólo antes del cutover, sin
URL SQL y sin opt-in, permanece el comportamiento legacy. No existe catch que pase a RAM.

| Operación | Autoridad cuando SQL está activo |
| --- | --- |
| Checkout preparado | orders, order_items, inventory_reservations, payment_attempts |
| Estado financiero y conciliación | payments, payment_events, audit_events |
| Stock físico/disponibilidad/consumo | inventory, reservations y movimientos SQL |
| Precio y peso | catálogo backend; no precio/stock/estado enviado por navegador |
| Historial admin y consulta pública | SQL; proyección pública sin PII |
| Entrega de avisos | outbox durable; canales externos fuera de transacción |
| Carrito visual/snapshot/lock | frontend existente; no representa reserva ni pago |
| Leads, visitas y bitácora del Asesor | legacy; SQL leads sólo tiene tabla, sin servicio maduro |

`PEDIDOS` no recibe, restaura ni decide pedidos SQL. `inventario.js` no reserva ni
consume ventas SQL. `almacen.js` no guarda/restaura comercio SQL; conserva leads y
bitácora legacy. Su configuración no sustituye el respaldo PostgreSQL. Retirada futura
del modo legacy exige un incremento explícito, no una eliminación oportunista.
El Asesor recibe disponibilidad SQL mediante una lectura inyectada: ninguna herramienta
del modelo importa pg ni dispone de capacidad para modificar tablas. Si falla esa
lectura no se inventa stock de productos.json. Vaciar carrito no necesita consultar stock.

## Transacciones e idempotencia

TX1 confirma pedido, líneas, snapshot interno de envío, reserva e intento antes de
crear preferencia. Un lease SQL serializa el único POST por intento; la red nunca
mantiene abiertos los locks SQL. TX2 asocia preference_id/URL y escribe el aviso.
El webhook verifica firma, consulta el pago al proveedor, valida monto en centavos,
MXN, collector_id, live_mode, folio e attempt_id. Una transacción confirma evento,
pago, estado, consumo completo, auditoría y outbox. Sólo después se responde 200.

Checkout acepta opcionalmente `Idempotency-Key` (8–120 caracteres alfanuméricos,
guion/underscore). HMAC incluye visitante y llave; no se guardan sus valores crudos.
El fingerprint contiene identidad derivada, cotización autorizada y comprador.
Llave repetida con contenido distinto devuelve 409; una repetición válida devuelve
el mismo intento/link listo. Sin header se reutiliza el mismo checkout pendiente
vigente mientras sus reservas no hayan sido reemplazadas/liberadas. El TTL vencido de
una reserva no permite fabricar otra preferencia para ese mismo intento vigente.
Un checkout cuyo pago ya terminó no abre otra preferencia como reintento.

Las constraints únicas y los locks SQL deduplican payment IDs/eventos/movimientos.
Pending tardío no degrada approved. Dos pagos distintos de una orden son dos hechos
financieros para revisión, no dos ventas/ingresos de dashboard. Refund/chargeback no
reponen stock automáticamente. Una aprobación tardía asigna todo o conserva pago
approved + `paid_unallocated`; no hay descuento parcial ni stock negativo.

### Preferencia incierta: seguridad antes que disponibilidad

La [referencia oficial de creación de preferencias](https://www.mercadopago.com.mx/developers/en/reference/online-payments/checkout-pro-preferences/create-preference/post)
no establece una garantía de idempotencia de `X-Idempotency-Key` para este endpoint.
No se infiere la garantía de la API de Orders ni se cambia de producto de pago.
El header estable se conserva, pero NO se repite un POST si el proceso/red/commit
dejaron su resultado incierto. `creating` vencido pasa a `uncertain`; el reintento
devuelve 503, conserva el registro y exige conciliación operacional. Una reserva
incierta expira según la política; un rechazo 4xx definitivo (excepto 408/429) la libera.
Ante preferencia incierta, el mensaje HTTP pide no volver a pagar por ahora y confirma
que el intento se conserva para conciliación; no promete revisión humana en curso.

Admin privado expone `intentos_inciertos`. El operador debe consultar preferencias
en Mercado Pago por el folio, confirmar cuenta/entorno/attempt_id, líneas, monto,
vigencia e identificador, y decidir mediante una intervención SQL revisada/auditada.
Si la búsqueda es vacía/ambigua NO resetear retry_count, no forzar `prepared` ni crear
otro POST a ciegas. Esperar vigencia y verificar pagos/conciliación. No hay reconciliador
automático de preferencias en V1. Los webhooks de una orden incierta siguen siendo
conciliables con folio/attempt_id verificados, aun si TX2 nunca recibió el ID de preferencia.

## Configuración requerida (nunca valores en repositorio)

- `NODE_ENV=production`, `PERSISTENCIA=postgres`, `DATABASE_URL` privada.
- `COMMERCE_HMAC_KEY`: hex de al menos 32 bytes aleatorios de un generador criptográfico;
  sin default ni reutilización de token admin. Guardar en secret manager.
- `MP_ACCOUNT_ID`, `MP_ENVIRONMENT=production`, access token y webhook secret del mismo
  ambiente/cuenta. No definir `MP_API_URL` ni mocks en producción.
- `DATABASE_TLS=verify-full`; CA privada opcional mediante `DATABASE_CA_FILE` legible
  sólo por el runtime, fuera de Git. Verificación de hostname/certificado obligatoria.
  Ningún destino remoto admite TLS desactivado aunque NODE_ENV no sea production.
  Sólo localhost/127.0.0.1/::1 en desarrollo/test pueden usar disable; overrides de
  destino/TLS mediante query o authority codificada como socket se rechazan.
- Mantener DB_POOL_MAX=5, conexión 5000 ms, statement 15000 ms y lock 5000 ms salvo
  ajuste medido. Presupuesto total de conexiones = pool × instancias + operación/migración.
- Canal operacional autorizado: PEDIDOS_WEBHOOK_URL y al menos un canal de avisos
  (Telegram/WhatsApp/AVISOS_WEBHOOK_URL). No activar AVISOS_SILENCIO en producción.
- LEADS_TOKEN aleatorio fuerte, CORS/orígenes, proxy y CSP existentes; no relajarlos.

Runtime: rol LOGIN propio, sin SUPERUSER/CREATEDB/CREATEROLE/BYPASSRLS ni permisos
administrativos globales. En un schema dedicado: USAGE, SELECT/INSERT/UPDATE en tablas
comerciales necesarias y SELECT en schema_migrations; sin CREATE/DROP/ALTER ni DELETE
por comodidad. Rol de migraciones separado, dueño del schema. Fijar search_path al
schema controlado; revocar CREATE a PUBLIC en él y en schemas previos de búsqueda.
No se gestionaron roles productivos ni se verificaron grants desde pruebas locales.

## Migración, stock y cutover

1. Aprobar respaldo restaurable, roles, TLS y ventana. Detener nuevos checkouts legacy
   sin apagar recepción de webhooks (retirar temporalmente token de creación en modo
   legacy también impide consultas: preferir bloquear sólo /api/pago en proxy operativo).
2. Medir `MP_VIGENCIA_MINUTOS` EFECTIVA, no asumir 60 si hay una variable vieja. Esperar
   el máximo TTL; verificar en Mercado Pago pagos en proceso, OXXO/SPEI diferidos y
   pendientes. TTL de preferencia no prueba que no haya liquidaciones tardías.
3. Conciliar pagos legacy/stock físico y conservar evidencia mínima privada. No importar
   automáticamente snapshots RAM ni sembrar productos.json al arrancar.
4. Ejecutar explícitamente `npm run db:migrate` con el rol de migración, en la DB/schema
   aprobados. La CLI no carga .env por sí sola. 001 permanece intacta; 002 es aditiva.
5. Cargar baseline de stock contado y aprobado en mantenimiento, mediante operación SQL
   autorizada con transacción, `services/inventory.lockInventory`, filas ordenadas y
   parámetros; registrar movimientos `baseline` (no para ceros) con operation_key único
   y auditoría. No se añadió una herramienta pública de reposición ni importación automática.
   Sin filas inventory, checkout rechaza por stock: nunca usa stock JSON como fallback.
6. Activar modo/secretos SQL; comprobar admin privado, schema compatible, stock contado y
   canales. Un smoke productivo requiere autorización distinta de esta implementación.

Un pago legacy no correlacionable se conserva como payment/event review + outbox de
alerta, visible en `pagos_no_conciliados`; no inventa orden ni consume stock. El operador
confirma en el proveedor/contacta al cliente y decide reembolso/cumplimiento manual,
con autorización y auditoría. Nunca convertir directamente esa alerta en surtido.

Rollback antes del primer pedido SQL: sólo tras verificar ausencia de pedidos/intentos
y reactivar legacy con el estado/stock reconciliados. Después del primer pedido SQL:
mantener SQL y desplegar una versión compatible corregida o cerrar checkout; NUNCA
volver a RAM ni restaurar un snapshot legacy sobre los pedidos SQL. No revertir 001/002
con ventas vivas. Un rollback de código no deshace pagos en el proveedor.

## Caídas, entrega y observabilidad

/health significa proceso vivo. DB/schema/clave inválidos cierran checkout con 503
genérico antes del proveedor; webhook falla 5xx para permitir reintento. No devuelve
SQL, constraint, query, host, credenciales o stack. Admin conserva autenticación y
expone db_connected/schema_compatible/configuration_valid, fallos checkout/conciliación,
pool total/idle/waiting y paid_unallocated_count; no publica ese diagnóstico.
El lector del snapshot legacy conserva leads/bitácora sin restaurar pedidos SQL;
sus diagnósticos sólo usan conteos/códigos, no fragmentos JSON, rutas ni metadata cruda.

Outbox usa leases/fencing y SKIP LOCKED; arranca con el proceso y reintenta cada 30 s,
con backoff de entrega 1 min, lote máximo 20 y deadlines de canales. Pedido/cobro
confirmados no se revierten por fallo de aviso. Entrega es at-least-once: el receptor
debe deduplicar `evento_id`/`X-Idempotency-Key` (outbox.id). No garantiza exactly-once
en sistemas externos ni aceptación de todos los canales: un canal de avisos exitoso
marca ese aviso entregado. Una reversión posterior impide ejecutar un surtido pendiente.
Los avisos SQL no se copian a la bitácora RAM; métricas financieras admin vienen de SQL.

## PII, respaldos, retención y rotación

Orders guarda nombre80/email160/teléfono normalizado, CP/dirección180/referencias140;
las líneas y el snapshot de envío no contienen prompts. HMAC guarda correlación, no
UUID bruto. Payments guarda sólo identificadores/estado/monto/moneda/cuenta/entorno y
tipo de método acotado; no payer/card/raw JSON. Event/outbox/audit no guardan payload
completo del proveedor, errores raw, IP, headers, dispositivos ni chats. La entrega
externa usa sólo contacto necesario del pedido y canal operacional autorizado.
Conocer folio no demuestra propiedad: la respuesta pública tiene seis campos,
sin contacto/domicilio. Admin requiere las credenciales existentes.

Cifrado at-rest y respaldos cifrados son obligaciones del proveedor/operador, NO
propiedades verificadas por este código. Definir accesos mínimos al backup, destino
separado, cifrado y llaves separadas, alertas de fallo, frecuencia/RPO/RTO y una prueba
de restore en entorno aislado. Tras restore, comparar pagos del proveedor por el
intervalo perdido, retener datos financieros y replay controlado para reconciliar;
no reabrir cobros/surtidos hasta confirmar invariantes. No descargar backups en Git.

El responsable debe aprobar política de retención PII/legal/contable y eliminación
segura, incluyendo backups y canales receptores. No se inventó un plazo ni se automatizó
una purga. Inventario/dedupe financieros no pueden borrarse para resolver privacidad
sin conservar integridad/auditoría requerida. Revisión legal/privacidad pendiente.

Rotar credencial DB/admin/proveedor mediante secret manager y acceso revocado.
COMMERCE_HMAC_KEY tiene una sola versión en V1: rotación coordinada sólo tras drenar
intentos/reservas/idempotencia activos y conciliar pagos, guardando el material anterior
privadamente para operación autorizada. No rotación en caliente ni multiclave fingida.
La dedupe financiera/movimientos SQL sigue por payment ID/order-SKU, pero cambiar la
clave cambia fingerprints/identidad/event hashes y exige atención operacional.

## Evidencia local y gaps

test:commerce cubre la matriz de 25 fallos, con procesos A/B y dos pools PostgreSQL
reales, proveedor HTTP falso, corte real de conexión, lock/statement timeout reales,
SQLSTATE de deadlock inyectado, rollback, PII/errores, idempotencia y outbox/restart.
Las suites exigen NODE_ENV=test, DATABASE_URL ausente, TEST_DATABASE_URL local exacta
valquiria_test y marcador `valquiria:disposable-test` antes de DDL. No hay skip silencioso.

Pendientes de operación/revisión: configuración/stock/roles/TLS/canales/backup reales,
restore ensayado y política de retención; revisión adversarial final; conciliación
manual de intents inciertos y pagos legacy; leads durables como fase independiente;
rate limits siguen por proceso (borde requerido al escalar), global inventory advisory
lock serializa escritores y debe medirse antes de aumentar volumen. No se llamó
proveedor real; la simulación no certifica metadata/contratos de una cuenta productiva.
