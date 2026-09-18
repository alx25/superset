from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .business_context import get_business_context_data
from .column_values import _query_single_column
from .dashboard_dataset_context import get_dashboard_dataset_context_data
from .dashboard_filters import get_applied_filters_data


class ValueHint(BaseModel):
    column: str | None = Field(
        None,
        description="Columna exacta donde buscar. Si no se conoce todavía "
        "(el schema llega en la misma respuesta de get_query_context), "
        "usar 'candidate_columns' en su lugar.",
    )
    candidate_columns: list[str] | None = Field(
        None,
        description="Lista de columnas a probar cuando se desconoce la columna "
        "exacta. Se busca el 'search' en cada una y se devuelven solo las que "
        "tienen matches. Ejemplo: ['familia', 'segmento', 'articulo']. "
        "Ignorado si se especifica 'column'.",
    )
    search: str = Field(
        ...,
        description="Raíz corta de 3-5 letras (ej. 'det' para detergente, "
        "'salva' para El Salvador, 'sham' para shampoo).",
    )


class GetQueryContextRequest(BaseModel):
    domain: str | None = Field(
        None,
        description="Dominio de negocio ('ventas', 'pedidos', 'pns') si la "
        "pregunta lo menciona o implica. Opcional si solo hace falta el "
        "contexto del dashboard.",
    )
    dashboard_id: int | None = Field(
        None,
        description="ID del dashboard actual, si el usuario está viendo uno. "
        "Cuando se pasa, el dataset real del dashboard tiene prioridad sobre "
        "el dataset por defecto de 'domain'.",
    )
    native_filters_key: str | None = Field(
        None,
        description="El valor de 'native_filters_key' de la URL actual "
        "(solo tiene sentido junto con dashboard_id). Si se pasa, se "
        "incluyen los filtros nativos ya aplicados en el dashboard.",
    )
    max_datasets: int = Field(3, ge=1, le=10)
    value_hints: list[ValueHint] | None = Field(
        None,
        description="USAR cuando el usuario mencione categorías, marcas, países, "
        "cadenas u otros valores de texto que se usarán como filtros. "
        "Cada item necesita 'column' (si ya se conoce) O 'candidate_columns' "
        "(lista de columnas a probar), más 'search' con raíz de 3-5 letras. "
        "Los valores reales se devuelven en 'suggested_filters' con un campo "
        "'suggested_filter' listo para copiar en los 'filters' de "
        "irex.query_dataset/irex.chart_option. "
        "Esto evita: irex.list_column_values → query vacía → re-query (3 llamadas extra). "
        "Si el schema no se conoce aún, pasar candidate_columns con columnas probables.",
    )


@tool(
    name="irex.get_query_context",
    description=(
        "LLAMAR SIEMPRE PRIMERO ante cualquier pregunta analítica cuando se "
        "conoce dashboard_id o domain. Reemplaza en una sola llamada a "
        "irex.business_context + irex.get_dashboard_dataset_context + "
        "irex.get_applied_filters. NO llamar esas tres tools por separado "
        "si get_query_context ya fue invocado — la info ya está en la respuesta.\n\n"
        "Parámetros:\n"
        "- dashboard_id + native_filters_key: pasar si el usuario está viendo "
        "un dashboard. El dataset real del dashboard tiene prioridad sobre el "
        "default de 'domain'.\n"
        "- domain: 'ventas', 'pedidos' o 'pns' si la pregunta es de esos temas. "
        "Pasar null para cualquier otro tema (precios, inventario, etc.).\n"
        "- value_hints: pasar cuando el usuario menciona categorías, marcas, "
        "países u otros valores de texto que se usarán como filtros. Usar "
        "'column' si se conoce la columna exacta, o 'candidate_columns' con "
        "columnas probables si el schema no se conoce aún. "
        "Search = raíz de 3-5 letras ('det' no 'detergente', 'salva' no "
        "'El Salvador'). Los valores reales se resuelven antes de que el "
        "agente necesite llamar irex.list_column_values.\n\n"
        "La respuesta incluye:\n"
        "- dataset_id/dataset_source: usar este ID en query_dataset/chart_option.\n"
        "- dataset.columns / dataset.metrics: schema completo listo para usar.\n"
        "- dataset.column_labels (si viene): mapa nombre_real_de_columna -> "
        "nombre de negocio, para columnas con nombre técnico/genérico (ej. "
        "'area_c' -> 'Área Comercial'). Cuando el usuario mencione un término "
        "de negocio, buscarlo en los VALORES de este mapa y usar su CLAVE (el "
        "nombre real, que también está en dataset.columns) en "
        "metrics/groupby/filters — NUNCA usar el texto del label como nombre "
        "de columna en una consulta.\n"
        "- dataset.dataset_description (si viene) / dataset.column_descriptions "
        "(si viene, mapa nombre_real -> texto): notas de negocio en texto "
        "libre escritas por un admin de Superset sobre el dataset completo o "
        "una columna puntual (ej. 'excluye devoluciones', 'vigente desde "
        "2025') — leer ANTES de interpretar esas columnas o de responder "
        "sobre alcance/limitaciones del dataset, tienen prioridad sobre "
        "suposiciones basadas solo en el nombre de la columna.\n"
        "- business_rules: filtros obligatorios del dominio (si domain != null).\n"
        "- applied_filters: filtros del dashboard activos — cada entry ya tiene "
        "column/op/value copiables como elemento de 'filters' en query_dataset.\n"
        "- suggested_filters: por cada value_hint, los valores exactos del "
        "dataset más 'suggested_filter' {column, op:'IN', value:[...]} "
        "listo para copiar en los filtros de query_dataset/chart_option.\n"
        "- native_filter_targets: filtros nativos configurados en el "
        "dashboard, con su columna target. Entries con usable_as="
        "'jinja_filters' son la ÚNICA fuente confirmada de nombres de "
        "columna para el parámetro 'jinja_filters' de query_dataset/"
        "chart_option/query_dataset_sql (usado para fijar valores tipo "
        "'año seleccionado' sin que el usuario cambie el filtro en el "
        "dashboard) — NO adivinar nombres que no aparezcan acá.\n"
        "- dashboard_tabs (solo presente si hay ambigüedad real): pestañas "
        "del dashboard que usan datasets DISTINTOS entre sí, con el/los "
        "'dataset_ids' de cada una. Si aparece, significa que 'dataset_id' "
        "de esta respuesta es solo el más usado en TODO el dashboard, no "
        "necesariamente el correcto para la pregunta — comparar el texto de "
        "la pregunta contra 'dashboard_tabs[].tab_name' y usar el dataset de "
        "la pestaña que coincida temáticamente, en vez de asumir el dominante."
    ),
    tags=["irex", "negocio", "dashboard", "dataset", "filtros", "contexto"],
)
def get_query_context(request: GetQueryContextRequest) -> dict[str, Any]:
    business: dict[str, Any] | None = None
    if request.domain:
        business = get_business_context_data(request.domain)

    dash_ctx: dict[str, Any] | None = None
    if request.dashboard_id is not None:
        dash_ctx = get_dashboard_dataset_context_data(
            request.dashboard_id, request.max_datasets
        )

    dominant_dataset_id = (
        dash_ctx.get("dominant_dataset_id") if dash_ctx else None
    )

    # 'dataset_id' (el campo que el modelo DEBE usar en query_dataset/
    # chart_option) va primero y es el ÚNICO 'dataset_id' en toda la
    # respuesta — si business_rules trajera su propio 'dataset_id' al
    # mismo nivel de detalle, un modelo puede confundirse y usar el que
    # aparece primero en el JSON (el default), no el resuelto.
    response: dict[str, Any] = {"status": "success"}

    if dominant_dataset_id is not None:
        response["dataset_id"] = dominant_dataset_id
        response["dataset_source"] = "dashboard"
        matching = next(
            (
                d
                for d in (dash_ctx.get("datasets") or [])
                if d.get("dataset_id") == dominant_dataset_id
            ),
            None,
        )
        if matching is not None:
            response["dataset"] = matching
    elif business and business.get("status") == "success":
        response["dataset_id"] = business["context"]["dataset_id"]
        response["dataset_source"] = "business_context"

    if business and business.get("status") == "success":
        business_rules = dict(business["context"])
        if dominant_dataset_id is not None:
            # Evita el campo duplicado/ambiguo: el dataset a usar ya está
            # en 'dataset_id' arriba — este 'dataset_id' es solo el default
            # del dominio, descartado porque hay un dashboard real.
            business_rules.pop("dataset_id", None)
            business_rules.pop("database_id", None)
            business_rules.pop("dataset_name", None)
            business_rules["note"] = (
                "Este es el contexto de negocio del dominio — su dataset "
                "default fue DESCARTADO porque hay un dashboard real. Usar "
                "SIEMPRE el 'dataset_id' de nivel superior de esta respuesta, "
                "no ninguno de aquí."
            )
        response["business_rules"] = business_rules
    elif business is not None:
        response["business_context_error"] = business

    if dash_ctx is not None:
        response["dashboard_datasets_used"] = dash_ctx.get("datasets_used")
        if dash_ctx.get("native_filter_targets"):
            response["native_filter_targets"] = dash_ctx["native_filter_targets"]
            response["native_filter_targets_note"] = dash_ctx.get(
                "native_filter_targets_note"
            )
        if dash_ctx.get("dashboard_tabs"):
            response["dashboard_tabs"] = dash_ctx["dashboard_tabs"]
            response["dashboard_tabs_warning"] = dash_ctx.get(
                "dashboard_tabs_warning"
            )

    if request.dashboard_id is not None and request.native_filters_key:
        filters_ctx = get_applied_filters_data(
            request.dashboard_id, request.native_filters_key
        )
        if filters_ctx.get("status") == "success":
            applied = filters_ctx.get("filters") or []
            response["applied_filters"] = applied

            # Validar que los filtros del dashboard correspondan al dataset dominante.
            # Los filtros nativos pueden referenciar columnas de CUALQUIER dataset del
            # dashboard — usarlos contra el dataset_id incorrecto causa 'columna rechazada'.
            dominant_cols = set(response.get("dataset", {}).get("columns", []))
            if dominant_cols:
                mismatched = [
                    f["column"]
                    for f in applied
                    if f.get("column") and f["column"] not in dominant_cols
                ]
                if mismatched:
                    response["applied_filters_warning"] = (
                        "ATENCIÓN: los siguientes filtros activos del dashboard "
                        "referencian columnas que NO existen en el dataset dominante "
                        f"(dataset_id={dominant_dataset_id}): "
                        + ", ".join(mismatched)
                        + ". Pertenecen a OTRO dataset del mismo dashboard. "
                        "NO incluirlos en irex.query_dataset/irex.chart_option "
                        "con este dataset_id — serán rechazados con error "
                        "'columna no encontrada'. Verificar en "
                        "'dashboard_datasets_used' cuál dataset tiene esas columnas."
                    )
        else:
            response["applied_filters_error"] = filters_ctx

    if request.value_hints:
        resolved_dataset_id = response.get("dataset_id")
        if resolved_dataset_id:
            suggested: list[dict[str, Any]] = []
            for hint in request.value_hints:
                columns_to_try: list[str] = []
                if hint.column:
                    columns_to_try = [hint.column]
                elif hint.candidate_columns:
                    columns_to_try = hint.candidate_columns

                if not columns_to_try:
                    suggested.append({
                        "searched": hint.search,
                        "error": "Se requiere 'column' o 'candidate_columns'.",
                    })
                    continue

                matched = False
                for col in columns_to_try:
                    try:
                        result = _query_single_column(
                            resolved_dataset_id, col, hint.search, row_limit=30
                        )
                    except Exception:
                        # Columna no existe en el dataset — ignorar y probar la siguiente
                        continue
                    values = result.get("values", []) if result.get("status") != "error" else []
                    if not values and len(columns_to_try) > 1:
                        continue  # sin matches, prueba la siguiente columna candidata
                    entry: dict[str, Any] = {
                        "column": col,
                        "searched": hint.search,
                    }
                    if result.get("status") == "error":
                        entry["error"] = result.get("error")
                    else:
                        entry["values"] = values
                        entry["value_count"] = result.get("value_count", 0)
                        if values:
                            entry["suggested_filter"] = {
                                "column": col,
                                "op": "IN",
                                "value": values,
                            }
                    suggested.append(entry)
                    matched = True
                    break  # columna resuelta, no seguir probando
                if not matched:
                    suggested.append({
                        "searched": hint.search,
                        "candidates_tried": columns_to_try,
                        "note": "Ninguna columna candidata existe o tiene matches. "
                                "Revisar el schema en dataset.columns y reintentar con columnas válidas.",
                    })
            response["suggested_filters"] = suggested
        else:
            response["suggested_filters_skipped"] = (
                "No se pudo determinar dataset_id — value_hints ignorados."
            )

    response["timestamp"] = datetime.now(timezone.utc).isoformat()
    return response
