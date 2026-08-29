# ENVÍOS — costo, paquetería y fecha de entrega

## Qué cambió

Antes el sitio cobraba **$150 planos** de envío, sin decir a dónde, con qué
paquetería ni cuándo llegaba. Eso es exactamente lo que hace dudar a un
comprador que no te conoce.

Ahora, con un código postal:

- el **carrito** muestra costo y fecha antes de pedir la tarjeta;
- el **Asesor** contesta "¿cuándo me llega?" con una fecha real;
- las dos cosas usan **el mismo motor**, así que nunca se contradicen.

Funciona **desde hoy y sin cuenta de paquetería**, con tarifas de referencia.
Conectar una paquetería real cambia los números por cotizaciones en vivo sin
tocar código.

---

## 1. Cómo funciona sin cuenta (modo actual)

`ENVIOS_PROVEEDOR=tabla` (el valor por omisión).

El costo sale de una tabla interna por **zona** y **peso**, calculada desde
Pachuca, Hidalgo:

| Zona | Estados | Terrestre | Express |
|---|---|---|---|
| Local | Hidalgo | 1-2 días | 1 día |
| Metropolitana | CDMX, Edomex, Puebla, Querétaro, Morelos, Tlaxcala | 2-3 días | 1-2 días |
| Nacional | el centro, el bajío, el norte cercano y el sur | 3-5 días | 2-3 días |
| Extendida | península, frontera norte, Baja California, Chiapas | 5-8 días | 3-4 días |

Cada cotización lleva `es_estimacion: true`, y **tanto el carrito como el
Asesor están obligados a decirlo**: "tarifa estimada, la guía definitiva se
confirma al preparar tu envío". Un estimado presentado como precio firme es una
reclamación esperando a ocurrir.

### Lo que ya hace bien

- **Peso volumétrico**: cobra el mayor entre el peso real y el del volumen
  (divisor 6000), como cobran las paqueterías de verdad.
- **Días hábiles reales**: salta domingos, sábados y los feriados oficiales
  mexicanos hasta 2028, más Jueves y Viernes Santos.
- **Hora de corte**: después de las 14:00 el pedido sale el siguiente día
  hábil. Nadie recoge a las 11 de la noche.
- **Día de taller**: suma 1 día hábil de preparación antes del tránsito, y lo
  muestra por separado.
- **Envío gratis** desde $999 — pero solo en el servicio más barato. Regalar el
  express convierte una promoción en una fuga.

---

## 2. Conectar una paquetería real

### Opción recomendada: Envia.com

Una sola cuenta cotiza Estafeta, DHL, FedEx, Redpack y Paquetexpress a la vez,
y el cliente elige. Es lo que más conviene cuando todavía no tienes volumen
para negociar contrato directo con una.

1. Regístrate en <https://envia.com> y verifica la cuenta.
2. Panel → **Configuración → API** → genera tu API key.
3. En Render → Environment:

```
ENVIOS_PROVEEDOR=envia
ENVIA_API_KEY=tu_api_key
```

### Alternativa: Skydropx

```
ENVIOS_PROVEEDOR=skydropx
SKYDROPX_API_KEY=tu_api_key
```

### Qué pasa al encenderlo

Las tarifas pasan a ser reales, `es_estimacion` se vuelve `false`, y el sitio
deja de decir "estimado". **Si la API falla o tarda más de 8 segundos, cae sola
a la tabla de referencia**: el cliente siempre ve un número y una fecha, nunca
un error. Eso es deliberado — un checkout que se rompe porque un tercero está
caído es un checkout que pierde ventas por algo que no controlas.

---

## 3. Ajustar sin tocar código

| Variable | Por defecto | Qué hace |
|---|---|---|
| `ENVIOS_CP_ORIGEN` | `42000` | De dónde salen las cajas. |
| `ENVIOS_DIAS_PREPARACION` | `1` | Días hábiles de taller antes de despachar. |
| `ENVIOS_HORA_CORTE` | `14` | Después de esta hora, sale al día siguiente. |
| `ENVIO_GRATIS_DESDE_CENTAVOS` | `99900` | Umbral de envío gratis ($999). |
| `ENVIOS_DIVISOR_VOLUMETRICO` | `6000` | 6000 terrestre, 5000 aéreo. |
| `ENVIOS_PESOS_JSON` | — | Peso real por SKU en gramos. |
| `ENVIOS_TARIFAS_JSON` | — | Reemplaza tarifas por zona. |

### ⚠️ Lo primero que deberías corregir: los pesos

Los pesos por producto son **estimaciones mías**, no medidas:

| SKU | Peso supuesto |
|---|---|
| `ValPulpo` | 220 g |
| `ValEnd` | 220 g |
| `Endotnissin` | 300 g |
| `DientesRealistas` | 850 g |
| Empaque | +200 g |

**Pesa una caja real de cada producto en una báscula de cocina** y corrígelos.
Es el ajuste que más impacta: un peso mal puesto es dinero perdido en cada
guía, o un cliente enojado porque le cobraste de menos.

```
ENVIOS_PESOS_JSON={"ValEnd":260,"ValPulpo":240,"Endotnissin":310,"DientesRealistas":900}
```

---

## 4. Probarlo

```bash
curl -s -X POST https://rodrigo-corrales1429-github-io.onrender.com/api/envio \
  -H 'Content-Type: application/json' \
  -d '{"cp_destino":"64000","items":[{"sku":"ValEnd","cantidad":2}]}'
```

En el sitio: mete algo al carrito, ábrelo, escribe tu código postal y pulsa
**Calcular**. En el Asesor: pregúntale "¿cuánto me sale el envío al 64000?".

Los dos números deben coincidir. Si no coinciden, algo se rompió — son el mismo
código.
