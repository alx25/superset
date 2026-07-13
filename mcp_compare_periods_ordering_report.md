# Informe: posible falta de orden por métrica en `irex.compare_periods` antes de truncar por `row_limit`

## Para quién es este documento

Este repo (`mcp_superset`) es el **agente/cliente** que llama a las tools MCP de Superset vía `MCP_URL` (servidor remoto, `192.168.76.11:5009`, código fuera de este repo). El problema descrito acá está en la **implementación de la tool `irex.compare_periods`**, no en este cliente. Si tenés acceso al código de ese servidor MCP (probablemente una extensión/plugin de Superset), este documento es el punto de partida para investigar y, si aplica, corregir.

## Resumen del problema

Se pidió la misma consulta analítica a tres modelos distintos (mismo dataset, mismo período, mismos filtros). Los tres llamaron a `irex.compare_periods` con parámetros ligeramente distintos — en particular, distinto `row_limit` — y obtuvieron **rankings de "marca con mayor variación de precio" sustancialmente distintos**, no solo distinta redacción. Cuando `row_limit` corta el resultado antes de la cantidad real de categorías (`marca`), las filas que sobreviven al corte **no parecen ser las de mayor variación**, sino un subconjunto aparentemente arbitrario — lo cual sugiere que la tool no aplica un `ORDER BY` por la métrica relevante antes de aplicar el límite.

## Evidencia: 3 sesiones reales, misma pregunta

Prompt del usuario (idéntico en las 3 sesiones):

```
1. ¿Qué marcas tuvieron mayor variación de precio (aumentos y disminuciones) entre junio y julio 2026, considerando solo el canal Tradicional?
2. Genera un gráfico de barras comparando el precio promedio de esas marcas entre junio y julio.
3. Exporta a Excel el detalle completo por marca y formato, incluyendo solo las marcas con variación mayor al 8%.
```

- **Claude Sonnet 5**: `logs/sessions/0af020ce-c667-42e6-9b96-e829fe4e4dcd.jsonl`
- **GPT-5.4**: `logs/sessions/313f9f32-e530-434e-9dd2-1a9318a8fccd.jsonl`
- **Qwen3.7-Max**: `logs/sessions/5ed64555-cd28-4d2d-89a3-bdb8bfd6f5c1.jsonl`

Dataset: `353` ("Analisis toma de precios CR"). Filtros: `anio=2026`, `canal=Canal Tradicional`, `clasificacion_cliente IN (...)`. `period_a_filters=mes:6`, `period_b_filters=mes:7`.

### La llamada que expone el problema

En la sesión de GPT-5.4, la segunda llamada a `compare_periods` (subtarea 1, buscando el ranking de marcas) fue:

```json
{
  "request": {
    "dataset_id": 353,
    "metrics": ["Precio Promedio Regular"],
    "groupby": ["marca"],
    "base_filters": [
      {"column": "anio", "op": "IN", "value": [2026]},
      {"column": "clasificacion_cliente", "op": "IN", "value": ["Cadenas de Supermercados", "Referencia de WM", "Supermercados Principales", "Sustitutos"]},
      {"column": "canal", "op": "IN", "value": ["Canal Tradicional"]}
    ],
    "period_a_filters": [{"column": "mes", "op": "IN", "value": [6]}],
    "period_b_filters": [{"column": "mes", "op": "IN", "value": [7]}],
    "row_limit": 10
  }
}
```

Nótese: `groupby` es **solo `["marca"]`** (sin dimensiones más finas como `articulo`/`gramaje`), sin `min_variation_pct` que ya filtre por magnitud, y `row_limit: 10` — es decir, un ranking plano de las 45 marcas totales, cortado a solo 10.

**Resultado devuelto** (inicio del JSON, el resto se trunca en el log por límite de preview):

```json
{"status":"success","period_a_row_count":10,"period_b_row_count":10,"matched_count":10,
 "unmatched_a_only_count":0,"unmatched_b_only_count":0,"alerts_count":10,
 "rows":[{"marca":"Chupetin","Precio Promedio Regular_a":912.5,"Precio Promedio Regular_b":625.0, ...}, ...]}
```

`period_a_row_count: 10` == el `row_limit` pedido exactamente → confirma que **se truncó** (había más marcas disponibles: la misma sesión, en la llamada anterior sin agrupar por marca, reportó 45 marcas distintas).

La primera fila devuelta es **Chupetin** (912.5 → 625.0, **-31.5%**). Es una variación real y grande, pero **no la mayor**: en la sesión de Qwen3.7-Max (que sí trajo más filas, `row_limit=100`), la marca con mayor variación relativa es **Terso** (+8.09%), seguida de **Orix** (+5.22%) y **Ultra Klin** (+4.57%) — ninguna de estas tres aparece **en ningún lugar** de la respuesta final de GPT-5.4, ni en su tabla de "marcas que concentraron más aumentos" ni en la de "disminuciones". Quedaron fuera del corte de 10 filas.

### Comparación cuantitativa entre las 3 sesiones (misma consulta base, mismo dataset/filtros/período)

| | Sonnet 5 (`row_limit=200` en detalle) | GPT-5.4 (`row_limit=10` en ranking) | Qwen3.7-Max (`row_limit=100` en ranking c/ `min_variation_pct=8`) |
|---|---|---|---|
| Filas reales disponibles (detalle articulo+gramaje+marca) | 276 | 276 | 276 |
| Filas realmente procesadas | **200** (truncado) | 276 (no truncado en detalle) | 276 (no truncado en detalle) |
| Irex: aumentos/disminuciones | 52 / 4 | 56 / 8 | 59 / 6 |
| Irex: variación promedio | +2.32% | +2.08% | +2.24% |
| Marcas con mayor variación detectadas | Orix, Ultra Klin, Axion | *(ninguna de estas tres)* | Terso, Orix, Ultra Klin, Axion |
| Filas exportadas con variación >8% (subtarea 3) | 12 | 14 | 12 |

Ningún par de sesiones coincide exactamente en los conteos de alertas por marca, pese a ser la misma pregunta sobre los mismos datos. La causa más clara y verificable es el truncamiento sin orden aparente por magnitud de variación; el resto de la diferencia (12 vs 14 vs 12 filas exportadas, conteos de alertas ligeramente distintos incluso entre Sonnet/GPT/Qwen sin truncar) podría deberse a filtros/interpretaciones ligeramente distintas de cada modelo y amerita revisión aparte si estos números van a un informe de negocio real.

## Lo que se pide verificar en el servidor MCP

1. **¿`compare_periods` aplica un `ORDER BY` explícito por la métrica de variación (`%` de cambio, o el criterio de "mayor variación") antes de aplicar `LIMIT row_limit`?** Si no lo hace, o si ordena por otro criterio (alfabético, orden de inserción, `id_producto`, etc.), un `row_limit` menor a la cardinalidad real de `groupby` va a devolver un subconjunto que no necesariamente son "las categorías más relevantes" — que es exactamente lo que se observó.
2. Si no hay orden explícito: agregar `ORDER BY ABS(variación_pct) DESC` (o el criterio que corresponda al modo de uso — "mayor variación" implica magnitud absoluta, no solo aumentos) antes de truncar por `row_limit`, para que un corte parcial siga siendo el top-N real.
3. Auditar si otras tools con `row_limit` (`query_dataset`, `query_dataset_sql`, `list_column_values`, `chart_option`) tienen el mismo patrón de truncar sin orden garantizado por la métrica relevante del pedido.
4. Si hay diferencias en `period_a_row_count`/`matched_count` entre corridas con **el mismo `row_limit` sin truncar** (Sonnet detalle truncado no aplica; comparar GPT vs Qwen: `period_b_row_count` 263 vs 267 con el mismo `row_limit=2000`, ambos sin aparente truncamiento) — vale la pena confirmar si el dataset subyacente cambia entre corridas (ingesta en curso) o si hay alguna inestabilidad de agregación (p.ej. `LIMIT` sin `ORDER BY` determinístico incluso cuando no debería truncar, afectando el orden de filas empatadas).

## Mitigación ya aplicada del lado del cliente (este repo)

Mientras se confirma/corrige en el servidor, se agregó una salvaguarda en `agent/core.py::normalize_irex_dataset_args` (2026-07-09): cuando `compare_periods` recibe un `groupby` de una sola dimensión (ranking plano, sin `min_variation_pct` que ya acote el resultado) y un `row_limit` menor a 200, se sube automáticamente a 200. Esto reduce el riesgo de truncar a un puñado de filas arbitrarias, pero **no resuelve el problema de fondo** si la tool no ordena por la métrica correcta — con suficientes categorías (por ejemplo, más de 200 marcas reales) el mismo síntoma podría reaparecer.
