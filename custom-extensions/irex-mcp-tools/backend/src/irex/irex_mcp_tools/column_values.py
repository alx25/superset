from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator
from superset_core.mcp.decorators import tool


class LookupItem(BaseModel):
    column: str = Field(..., description="Nombre de la columna")
    search: str | None = Field(None, description="Substring a buscar (case-insensitive)")
    row_limit: int = Field(50, ge=1, le=200)


class ListColumnValuesRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    column: str | None = Field(
        None,
        description="Columna donde buscar. MUTUAMENTE EXCLUYENTE con 'lookups': "
        "usar uno u otro, nunca ambos en la misma llamada. "
        "Para varias columnas, usar 'lookups' y dejar este campo en null.",
    )
    search: str | None = Field(
        None,
        description="Raíz corta para buscar (case-insensitive, 3-5 letras). "
        "El dataset puede usar abreviaciones inesperadas: 'detergente' puede "
        "estar guardado como 'Det. Polvo', 'Det Liq.', etc. Usar la raíz "
        "mínima para maximizar recall: 'det' en vez de 'detergente', "
        "'salva' en vez de 'El Salvador', 'sham' en vez de 'shampoo'. "
        "Sin search devuelve los valores más frecuentes hasta row_limit.",
    )
    row_limit: int = Field(100, ge=1, le=500)
    lookups: list[LookupItem] | None = Field(
        None,
        description="MUTUAMENTE EXCLUYENTE con 'column'+'search': usar uno u otro. "
        "Cuando se pasa 'lookups', los campos 'column', 'search', 'row_limit' "
        "de nivel superior se ignoran por completo. "
        "Ejemplo: lookups=[{column:'familia', search:'det'}, "
        "{column:'marca', search:'irex'}]. "
        "También acepta strings sueltos como atajo para {column: <string>} sin "
        "'search' (ej. lookups=['formato', {column:'marca', search:'irex'}]).",
    )

    @field_validator("lookups", mode="before")
    @classmethod
    def _coerce_bare_strings(cls, v: Any) -> Any:
        if not isinstance(v, list):
            return v
        return [{"column": item} if isinstance(item, str) else item for item in v]


def _query_single_column(
    dataset_id: int,
    column: str,
    search: str | None,
    row_limit: int,
) -> dict[str, Any]:
    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory

    filters = []
    if search:
        filters.append({"col": column, "op": "ILIKE", "val": f"%{search}%"})

    count_metric = {
        "expressionType": "SQL",
        "sqlExpression": "COUNT(*)",
        "label": "count",
    }

    factory = QueryContextFactory()
    query_context = factory.create(
        datasource={"id": dataset_id, "type": "table"},
        queries=[
            {
                "filters": filters,
                "columns": [column],
                "metrics": [count_metric],
                "row_limit": row_limit,
                "orderby": [[count_metric, False]],
            }
        ],
        form_data={
            "datasource": f"{dataset_id}__table",
            "viz_type": "table",
        },
    )
    command = ChartDataCommand(query_context)
    command.validate()
    result = command.run()
    query_result = (result or {}).get("queries", [{}])[0]

    if query_result.get("error"):
        return {
            "status": "error",
            "column": column,
            "error": query_result["error"],
        }

    rows = query_result.get("data") or []
    values = [r.get(column) for r in rows]
    truncated = len(values) >= row_limit

    entry: dict[str, Any] = {
        "status": "success",
        "column": column,
        "values": values,
        "value_count": len(values),
        "truncated": truncated,
    }
    if truncated:
        entry["warning"] = (
            f"Se alcanzó row_limit={row_limit} — pueden existir más "
            "valores distintos no mostrados. Ajustá 'search' para acotar."
        )
    return entry


@tool(
    name="irex.list_column_values",
    description=(
        "FALLBACK para resolución de valores — preferir irex.get_query_context "
        "con value_hints cuando el dashboard_id es conocido. "
        "Usar esta tool directamente solo cuando ya se tiene dataset_id pero "
        "no se llamó get_query_context, o para búsquedas adicionales no "
        "cubiertas por value_hints.\n\n"
        "Devuelve los valores REALES y distintos de una o varias columnas "
        "(ordenados por frecuencia), respetando el row-level security.\n\n"
        "Reglas de búsqueda:\n"
        "- search = raíz de 3-5 letras, NO el término completo. El dataset "
        "puede tener abreviaciones: 'detergente' → search='det' (puede ser "
        "'Det. Polvo'); 'El Salvador' → search='salva'; 'lavaplatos' → "
        "search='lava'. Nunca usar el término completo del usuario como search.\n"
        "- Si search devuelve 0 resultados, intentar con una raíz diferente "
        "(primeras 3 letras, sigla, etc.). NO repetir la misma búsqueda ni "
        "variantes similares sin reducir el término.\n"
        "- Sin search devuelve los valores más frecuentes — útil para explorar "
        "qué valores existen en la columna.\n\n"
        "Para varias columnas en una sola llamada usar 'lookups':\n"
        "  lookups=[{column:'familia', search:'det'}, "
        "{column:'marca', search:'irex'}]"
    ),
    tags=["irex", "negocio", "consulta", "filtros"],
    class_permission_name="SQLLab",
    method_permission_name="execute_sql_query",
)
def list_column_values(request: ListColumnValuesRequest) -> dict[str, Any]:
    ts = datetime.now(timezone.utc).isoformat()

    if request.lookups:
        results = []
        for item in request.lookups:
            results.append(
                _query_single_column(
                    request.dataset_id, item.column, item.search, item.row_limit
                )
            )
        return {
            "status": "success",
            "results": results,
            "timestamp": ts,
        }

    if not request.column:
        return {
            "status": "error",
            "error": "Se requiere 'column' o 'lookups'.",
            "timestamp": ts,
        }

    entry = _query_single_column(
        request.dataset_id, request.column, request.search, request.row_limit
    )
    entry["timestamp"] = ts
    return entry
