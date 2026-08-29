# PASAR LA IA AL PLAN DE PAGO

## Respuesta corta a tu pregunta

> "Lo pongo en Google Cloud o algo así, ¿no?"

**No.** Google Cloud (Vertex AI) es la ruta larga: cuentas de servicio,
credenciales JSON, regiones, y un cambio de código en el backend. No te da
nada que necesites hoy.

Lo que necesitas es **activar la facturación de la API de Gemini** en Google AI
Studio, sobre la misma llave que ya usas. Son cinco minutos, **cero cambios de
código**, y resuelve las tres cosas que pediste: más inteligente, consultas más
largas, y mucha más gente usándola a la vez.

---

## 1. Activar el plan de pago (5 minutos)

1. Entra a <https://aistudio.google.com/apikey> con la cuenta dueña de tu
   `GEMINI_API_KEY`.
2. Busca tu llave y mira su proyecto de Google Cloud.
3. Pulsa **Set up billing** / **Configurar facturación** y asocia una tarjeta.
4. Listo. La misma llave pasa a **tier de pago** al instante.

**No cambies la llave.** Es la misma; lo que cambia es el plan detrás de ella.

### Qué se desbloquea

| | Gratis | De pago |
|---|---|---|
| Peticiones por día | tope bajo y fijo | miles |
| Peticiones por minuto | muy limitado | mucho más alto |
| Modelos | solo los flash | también **2.5 Pro** |
| Tus datos | Google puede usarlos para mejorar sus modelos | **no se usan para entrenar** |

Esa última fila es la que más importa para un negocio: en el tier gratuito las
conversaciones de tus clientes son material de entrenamiento. En el de pago, no.

---

## 2. Qué modelo elegir

Precios de agosto de 2026, por millón de tokens:

| Modelo | Entrada | Salida | Para qué |
|---|---|---|---|
| `gemini-2.5-flash-lite` | $0.10 | $0.40 | Demasiado corto para vender. |
| **`gemini-2.5-flash`** | **$0.30** | **$2.50** | Lo que usas hoy. |
| `gemini-2.5-pro` | $1.25 | $10.00 | El más capaz. Solo tier de pago. |

### Mi recomendación, en dos pasos

**Paso 1 — enciende el razonamiento, no cambies de modelo.**

Hoy tienes `GEMINI_THINKING_BUDGET=0`: el Asesor responde sin razonar. Con las
herramientas nuevas (envíos, termoformado, Dental OS) tiene que decidir entre
nueve funciones y distinguir "dientes para practicar" de "sistema para mi
consultorio". Ahí es donde el razonamiento se nota.

```
GEMINI_THINKING_BUDGET=auto
```

Esto solo te da la mayor parte de la mejora que buscas, y multiplica el costo
por poco. **Haz esto primero y vive con ello una semana.**

**Paso 2 — sube a Pro solo si el paso 1 no bastó.**

```
GEMINI_MODEL=gemini-2.5-pro
GEMINI_THINKING_BUDGET=auto
```

Pro cuesta **4 veces más por entrada y 4 por salida** que Flash. Para un asesor
de ventas que ya tiene el conocimiento en `conocimiento.js` y la aritmética en
el servidor, Flash con razonamiento suele estar igual de bien. Cambia solo si
ves errores reales, no por si acaso.

### ⚠️ La trampa de los tokens de razonamiento

Los tokens de razonamiento **se cobran a precio de salida**, y pueden
multiplicar por 3 a 10 el volumen de salida en preguntas complejas. Es la
partida que la gente no presupuesta. Por eso el orden es: enciende razonamiento
en Flash, mide una semana, y solo después decide si Pro vale la pena.

---

## 3. Cuánto te va a costar de verdad

Una conversación típica del Asesor: ~4,000 tokens de entrada (el prompt del
sistema es largo) y ~600 de salida.

| Escenario | Costo por conversación | 500 conversaciones/mes |
|---|---|---|
| Flash sin razonar (hoy) | ~$0.0027 USD | **~$1.35 USD** |
| Flash + razonamiento | ~$0.006 USD | **~$3 USD** |
| Pro + razonamiento | ~$0.025 USD | **~$12.50 USD** |

Incluso la opción cara son unos **$230 MXN al mes** con 500 conversaciones. Una
sola venta de un kit de dientes realistas ($1,007) paga cuatro meses del modelo
más caro. **El costo del modelo no es tu problema; deja de optimizarlo.**

---

## 4. Sube los topes del sitio

Los límites de tu servidor están puestos para proteger una cuenta gratuita.
Con el plan de pago se te quedan cortos y estarías rechazando clientes reales.

En Render → Environment:

```
RATE_LIMIT_POR_MINUTO=25
RATE_LIMIT_POR_DIA=2000
```

Son **por visitante**, no globales. 400 al día era la protección correcta
cuando una llamada de más podía agotar tu cuota gratis; ahora solo hace falta
frenar bots.

---

## 5. Pon un tope de gasto (hazlo el mismo día)

Una llave filtrada con facturación activa es una factura sin fondo. Google
Cloud → **Facturación → Presupuestos y alertas** → crea un presupuesto de,
digamos, $20 USD con avisos al 50 %, 90 % y 100 %.

No detiene el gasto por sí solo, pero te avisa. Combinado con los límites de
tasa del sitio, es suficiente.

---

## 6. Resumen: qué poner en Render

```
GEMINI_THINKING_BUDGET=auto
RATE_LIMIT_POR_MINUTO=25
RATE_LIMIT_POR_DIA=2000
```

Y en Google AI Studio, activar facturación. Nada más.

`GEMINI_MODEL=gemini-2.5-pro` queda ahí para cuando lo quieras, a un cambio de
variable de distancia.

---

## 7. Cuándo SÍ tendría sentido Google Cloud

Para que no quede como una puerta cerrada. Vertex AI vale la pena cuando:

- necesites un **acuerdo de residencia de datos** en México o la UE;
- quieras **ajustar (fine-tune)** un modelo con tus propios datos;
- factures a través de un **contrato empresarial** de Google Cloud;
- o necesites **capacidad reservada** garantizada.

Nada de eso aplica hoy. Cuando aplique, el cambio afecta a un único archivo
(cómo se crea el cliente en `server.js`); el resto del backend no se entera.
