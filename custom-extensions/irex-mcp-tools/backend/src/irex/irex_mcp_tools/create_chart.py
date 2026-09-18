from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

from .query_dataset import (
    _AGG_PATTERN,
    _parse_filter,
    _parse_metric,
    _sanitize_rows,
    DatasetFilter,
)


def _column_ref(spec: str) -> dict[str, Any]:
    """Convierte 'SUM(col)' al formato ColumnRef plano {name, aggregate, label}
    que esperan los chart configs (table/pivot_table/xy), o {name} si no hay
    agregación (columna de agrupación)."""
    m = _AGG_PATTERN.match(spec.strip())
    if not m:
        return {"name": spec.strip()}
    aggregate, column = m.groups()
    return {"name": column, "aggregate": aggregate.upper(), "label": spec}


def _filter_config(f: DatasetFilter) -> dict[str, Any]:
    """Formato FilterConfig {column, op, value} que esperan los chart configs
    (distinto del {col, op, val} que usa QueryContextFactory). OJO: acá la
    igualdad es '=', no '==' (Literal["=", ">", "<", ">=", "<=", "!=", "LIKE",
    "ILIKE", "NOT LIKE", "IN", "NOT IN"])."""
    op_map = {"==": "=", "=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<="}
    operator = op_map.get(f.op.strip(), f.op.strip().upper())
    return {"column": f.column, "op": operator, "value": f.value}


class CreateChartRequest(BaseModel):
    dataset_id: int = Field(..., description="ID del dataset de Superset")
    chart_type: Literal["table", "pivot_table", "line", "bar", "area", "scatter"] = Field(
        "table",
        description=(
            "'table'=lista simple. 'pivot_table'=tabla cruzada (filas x columnas). "
            "'line'/'bar'/'area'/'scatter'=gráfico con eje X (series de tiempo u otro)."
        ),
    )
    x: str | None = Field(
        None,
        description="Columna del eje X. OBLIGATORIO para line/bar/area/scatter "
        "(ej. 'fecha_id' para series de tiempo).",
    )
    rows: list[str] = Field(
        default_factory=list,
        description="Columnas de agrupación (filas). Para 'table' y 'pivot_table'.",
    )
    columns: list[str] = Field(
        default_factory=list,
        description="Columnas cruzadas, solo para 'pivot_table' (ej. ['anio_id']).",
    )
    group_by: list[str] = Field(
        default_factory=list,
        description="Series/desagregación adicional, solo para line/bar/area/scatter.",
    )
    metrics: list[str] = Field(
        ...,
        min_length=1,
        description="Formato 'AGREGADO(columna)' ej. 'SUM(pns)', o nombre de "
        "métrica guardada del dataset.",
    )
    filters: list[DatasetFilter] = Field(default_factory=list)
    row_limit: int = Field(1000, ge=1, le=10000)
    chart_name: str | None = None
    save_chart: bool = Field(
        True,
        description="Si True (default), guarda el chart permanentemente en "
        "Superset y devuelve explore_url para abrirlo. Si False, solo valida "
        "la configuración y devuelve una vista previa de los datos.",
    )


def _build_chart_config(request: CreateChartRequest) -> dict[str, Any]:
    filters = [_filter_config(f) for f in request.filters]

    if request.chart_type == "table":
        columns = [{"name": r} for r in request.rows] + [
            _column_ref(m) for m in request.metrics
        ]
        return {
            "chart_type": "table",
            "columns": columns,
            "filters": filters,
            "row_limit": request.row_limit,
        }

    if request.chart_type == "pivot_table":
        cfg: dict[str, Any] = {
            "chart_type": "pivot_table",
            "rows": [{"name": r} for r in request.rows],
            "metrics": [_column_ref(m) for m in request.metrics],
            "filters": filters,
            "row_limit": request.row_limit,
        }
        if request.columns:
            cfg["columns"] = [{"name": c} for c in request.columns]
        return cfg

    if not request.x:
        raise ValueError(
            f"chart_type='{request.chart_type}' requiere especificar 'x' "
            "(columna del eje X)."
        )
    cfg = {
        "chart_type": "xy",
        "kind": request.chart_type,
        "x": {"name": request.x},
        "y": [_column_ref(m) for m in request.metrics],
        "filters": filters,
        "row_limit": request.row_limit,
    }
    if request.group_by:
        cfg["group_by"] = [{"name": g} for g in request.group_by]
    return cfg


@tool(
    name="irex.create_chart",
    description=(
        "DESHABILITADO — esta tool no está disponible. "
        "El sistema no permite crear ni guardar gráficos en Superset desde el chat. "
        "Para visualizar datos usar irex.chart_option (renderiza en el chat sin guardar). "
        "No llamar esta tool bajo ninguna circunstancia."
    ),
    tags=["irex", "grafico", "guardar"],
)
def create_chart(request: CreateChartRequest) -> dict[str, Any]:
    return {
        "status": "disabled",
        "error": (
            "irex.create_chart está deshabilitado. El sistema no permite crear "
            "ni guardar gráficos en Superset desde el chat. "
            "Usar irex.chart_option para visualizar los datos en el chat."
        ),
    }

    from superset.commands.chart.data.get_data_command import ChartDataCommand
    from superset.common.query_context_factory import QueryContextFactory
    from superset.mcp_service.chart.chart_utils import map_config_to_form_data
    from superset.mcp_service.chart.schemas import parse_chart_config
    from superset.mcp_service.utils.url_utils import get_superset_base_url

    try:
        raw_config = _build_chart_config(request)
        config = parse_chart_config(raw_config)
        form_data = map_config_to_form_data(config, dataset_id=request.dataset_id)
    except Exception as exc:
        return {
            "status": "error",
            "error": f"Error armando la configuración del chart: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # Verifica que la consulta realmente funciona ANTES de guardar el chart,
    # usando el mismo motor que irex.query_dataset (resuelve RLS vía Jinja).
    dims = list(request.rows) + list(request.columns) + list(request.group_by)
    if request.x:
        dims.append(request.x)

    factory = QueryContextFactory()
    query_context = factory.create(
        datasource={"id": request.dataset_id, "type": "table"},
        queries=[
            {
                "filters": [_parse_filter(f) for f in request.filters],
                "columns": dims,
                "metrics": [_parse_metric(m) for m in request.metrics],
                "row_limit": min(request.row_limit, 50),
            }
        ],
        form_data={
            "datasource": f"{request.dataset_id}__table",
            "viz_type": form_data["viz_type"],
        },
    )
    command = ChartDataCommand(query_context)
    command.validate()
    result = command.run()
    query_result = (result or {}).get("queries", [{}])[0]

    if query_result.get("error"):
        return {
            "status": "error",
            "error": f"La consulta del chart falló: {query_result['error']}",
            "form_data": form_data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    response: dict[str, Any] = {
        "status": "success",
        "preview_rows": _sanitize_rows(query_result.get("data") or [])[:10],
        "viz_type": form_data["viz_type"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if request.save_chart:
        from superset.commands.chart.create import CreateChartCommand
        from superset.daos.dataset import DatasetDAO
        from superset.utils import json as superset_json

        dataset = DatasetDAO.find_by_id(request.dataset_id)
        if not dataset:
            response["status"] = "error"
            response["error"] = f"Dataset {request.dataset_id} no encontrado"
            return response

        chart_name = (
            request.chart_name
            or f"{form_data['viz_type']} - {dataset.table_name}"
        )
        # La página de Explore lee "datasource" desde los params guardados,
        # no solo de las columnas datasource_id/datasource_type del Slice.
        # Sin esto el frontend reporta "Faltan parámetros de la URL".
        form_data_with_datasource = {
            **form_data,
            "datasource": f"{dataset.id}__table",
        }
        create_cmd = CreateChartCommand(
            {
                "slice_name": chart_name,
                "viz_type": form_data["viz_type"],
                "datasource_id": dataset.id,
                "datasource_type": "table",
                "params": superset_json.dumps(form_data_with_datasource),
            }
        )
        chart = create_cmd.run()
        response["chart_id"] = chart.id
        response["chart_name"] = chart.slice_name
        response["explore_url"] = (
            f"{get_superset_base_url()}/explore/?slice_id={chart.id}"
        )

    return response
