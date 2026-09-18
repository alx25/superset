from collections import Counter
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool


# Marcador para excluir un native filter del contexto que ve el LLM. Se
# escribe en el campo 'Description' del filtro (modal de edición > pestaña
# Settings, en Superset) — no requiere cambios de código para marcar/
# desmarcar un filtro como interno. Filtros marcados desaparecen por completo
# de 'applied_filters' y 'native_filter_targets' (el LLM ni se entera de que
# existen, evitando que los reaplique en una consulta por error).
_HIDDEN_FILTER_MARKER = "#no-ia"


def _is_hidden_from_ia(description: str | None) -> bool:
    return bool(description) and _HIDDEN_FILTER_MARKER in description.lower()


def get_hidden_native_filter_ids(dashboard_id: int) -> set[str]:
    """IDs de native filters de este dashboard marcados como ocultos para el
    LLM. Reusado por irex.get_applied_filters para no filtrar por columnas/
    valores que el usuario no debe ver en la conversación."""
    import json as _json

    from superset.daos.dashboard import DashboardDAO

    try:
        dashboard = DashboardDAO.find_by_id(dashboard_id)
    except Exception:
        return set()
    if dashboard is None or not dashboard.json_metadata:
        return set()
    try:
        metadata = _json.loads(dashboard.json_metadata)
    except (TypeError, ValueError):
        return set()

    hidden: set[str] = set()
    for native_filter in metadata.get("native_filter_configuration", []) or []:
        filter_id = native_filter.get("id")
        if filter_id and _is_hidden_from_ia(native_filter.get("description")):
            hidden.add(filter_id)
    return hidden


def get_hidden_dataset_columns(dataset_id: int) -> set[str]:
    """Nombres de columnas del dataset marcadas como ocultas para el LLM."""
    from superset.daos.dataset import DatasetDAO

    try:
        dataset = DatasetDAO.find_by_id(dataset_id)
    except Exception:
        return set()
    if dataset is None:
        return set()
    return {
        c.column_name
        for c in dataset.columns
        if c.column_name and _is_hidden_from_ia(c.description)
    }


def _reject_hidden_columns(dataset_id: int, referenced: set[str]) -> str | None:
    hidden = get_hidden_dataset_columns(dataset_id)
    conflicts = sorted(referenced & hidden)
    if not conflicts:
        return None
    return (
        "Columna(s) no disponible(s) para consultas por IA: "
        + ", ".join(conflicts)
        + ". Usar solo columnas visibles en dataset.columns de "
        "irex.get_query_context/irex.get_dashboard_dataset_context."
    )


class GetDashboardDatasetContextRequest(BaseModel):
    dashboard_id: int = Field(..., description="ID del dashboard")
    max_datasets: int = Field(
        3,
        ge=1,
        le=10,
        description="Máximo de datasets distintos a describir en detalle "
        "(columnas/métricas). Siempre se describe al menos el dataset "
        "dominante.",
    )


def _consumed_via_jinja(column: str, dominant_sql: str | None) -> bool:
    """True si el SQL virtual del dataset dominante referencia esta columna
    vía filter_values()/get_filters() — es decir, aunque la columna exista
    nominalmente en el dataset (ej. columna de salida de un SELECT), el
    propio SQL ya la consume como parámetro Jinja en un WHERE/CASE interno,
    por lo que un WHERE literal posterior sobre esa misma columna es
    semánticamente incorrecto (caso real: dataset 198, columna 'medida' —
    el SQL hace `WHERE medida = '{{ filter_values('medida')[0] }}'`, dejando
    la columna de salida ya pre-filtrada a un solo valor)."""
    import re as _re

    if not dominant_sql or not column:
        return False
    pattern = r"filter_values\(\s*['\"]" + _re.escape(column) + r"['\"]"
    return bool(_re.search(pattern, dominant_sql))


def _native_filter_targets(
    dashboard_id: int,
    dominant_columns: set[str],
    dominant_sql: str | None = None,
) -> list[dict[str, Any]] | None:
    """Extrae los targets de los filtros nativos configurados en el dashboard
    (dashboard.json_metadata.native_filter_configuration), distinguiendo los
    que aplican DIRECTO (columna real del dataset dominante, usable en
    'filters' normal de irex.query_dataset/chart_option/query_dataset_sql) de
    los que son solo targets Jinja de OTRO dataset — esto último es lo que
    hace falta para poblar 'jinja_filters' con un nombre CONFIRMADO en vez de
    adivinar (ej. un filtro 'Año' que apunta a 'anio_ids' de un dataset
    puente, usado en el dataset real vía filter_values('anio_ids') dentro de
    su SQL para calcular columnas tipo 'año seleccionado vs año anterior').

    También cubre el caso en que la columna SÍ existe en el dataset dominante
    pero su propio SQL virtual ya la consume vía filter_values() (ver
    _consumed_via_jinja) — coincidencia de nombre no implica que sea
    filtrable por WHERE literal normal."""
    import json as _json

    from superset.daos.dashboard import DashboardDAO

    try:
        dashboard = DashboardDAO.find_by_id(dashboard_id)
    except Exception:
        return None
    if dashboard is None or not dashboard.json_metadata:
        return None
    try:
        metadata = _json.loads(dashboard.json_metadata)
    except (TypeError, ValueError):
        return None

    targets: list[dict[str, Any]] = []
    for native_filter in metadata.get("native_filter_configuration", []) or []:
        if _is_hidden_from_ia(native_filter.get("description")):
            continue
        name = native_filter.get("name")
        filter_type = native_filter.get("filterType")
        for target in native_filter.get("targets", []) or []:
            column = (target.get("column") or {}).get("name")
            if not column:
                continue
            direct = column in dominant_columns
            consumed_via_jinja = direct and _consumed_via_jinja(
                column, dominant_sql
            )
            targets.append(
                {
                    "filter_name": name,
                    "column": column,
                    "target_dataset_id": target.get("datasetId"),
                    "filter_type": filter_type,
                    "usable_as": (
                        "jinja_filters"
                        if not direct or consumed_via_jinja
                        else "filters"
                    ),
                    "note": (
                        "La columna existe en el dataset dominante, pero su "
                        "propio SQL virtual la consume vía filter_values()/"
                        "get_filters() en un WHERE/CASE interno — usar "
                        "'jinja_filters', NO un WHERE literal sobre esta "
                        "columna (el valor de salida ya viene pre-filtrado/"
                        "calculado por el Jinja interno)."
                        if consumed_via_jinja
                        else "Columna real del dataset — usar en 'filters' normal."
                        if direct
                        else "NO es columna de este dataset (target de OTRO "
                        "dataset del mismo dashboard) — solo sirve para "
                        "'jinja_filters' SI el SQL virtual de este dataset "
                        "referencia este nombre vía filter_values()/"
                        "get_filters(). No asumir que funciona sin haber "
                        "visto esa referencia en el SQL."
                    ),
                }
            )
    return targets


def _dashboard_tabs(
    dashboard_id: int, slice_datasets: dict[int, int]
) -> list[dict[str, Any]] | None:
    """Mapea cada pestaña (nodo TAB de dashboard.position_json) a los
    dataset_id usados por los charts que contiene — genérico, no asume nada
    sobre nombres/temas de pestañas. Sirve para dashboards donde distintas
    pestañas usan datasets distintos: el 'dataset dominante' (por cantidad de
    charts en TODO el dashboard) puede no ser el relevante para una pregunta
    que corresponde a una pestaña minoritaria."""
    import json as _json

    from superset.daos.dashboard import DashboardDAO

    try:
        dashboard = DashboardDAO.find_by_id(dashboard_id)
    except Exception:
        return None
    if dashboard is None or not dashboard.position_json:
        return None
    try:
        position = _json.loads(dashboard.position_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(position, dict):
        return None

    def collect_chart_ids(node_id: str, acc: list[int]) -> None:
        node = position.get(node_id)
        if not isinstance(node, dict):
            return
        if node.get("type") == "CHART":
            chart_id = (node.get("meta") or {}).get("chartId")
            if isinstance(chart_id, int):
                acc.append(chart_id)
        for child in node.get("children") or []:
            collect_chart_ids(child, acc)

    tabs: list[dict[str, Any]] = []
    for node_id, node in position.items():
        if not isinstance(node, dict) or node.get("type") != "TAB":
            continue
        tab_name = (node.get("meta") or {}).get("text") or node_id
        chart_ids: list[int] = []
        collect_chart_ids(node_id, chart_ids)
        dataset_ids = sorted(
            {slice_datasets[cid] for cid in chart_ids if cid in slice_datasets}
        )
        if dataset_ids:
            tabs.append({"tab_name": tab_name, "dataset_ids": dataset_ids})
    return tabs or None


def _dataset_summary(dataset: Any) -> dict[str, Any]:
    # Columnas con '#no-ia' en su 'Description' (Editar Dataset > Columnas)
    # son de uso interno y se excluyen del schema que ve el LLM — mismo
    # marcador y motivo que en native filters (ver _HIDDEN_FILTER_MARKER).
    visible_columns = [
        c
        for c in dataset.columns
        if c.column_name and not _is_hidden_from_ia(c.description)
    ]
    # 'Label' de columna (Editar Dataset > Columnas > columna > Label, guardado
    # en TableColumn.verbose_name) — nombre de negocio para columnas con nombre
    # técnico/genérico (ej. 'area_c' -> 'Área Comercial'). Se expone SOLO como
    # mapa de traducción separado de 'columns': el LLM debe seguir usando la
    # CLAVE (nombre real) en metrics/groupby/filters, nunca el label.
    column_labels = {
        c.column_name: c.verbose_name for c in visible_columns if c.verbose_name
    }
    # 'Description' de columna (Editar Dataset > Columnas > columna >
    # Description) — contexto de negocio en texto libre (ej. "excluye
    # devoluciones", "vigente desde 2025"). Este campo ya se leía para
    # detectar el marcador '#no-ia' (ver arriba); acá se expone su
    # CONTENIDO real — solo llegan columnas visibles (las marcadas ya se
    # filtraron), así que no hace falta re-chequear el marcador.
    column_descriptions = {
        c.column_name: c.description for c in visible_columns if c.description
    }

    summary: dict[str, Any] = {
        "dataset_id": dataset.id,
        "table_name": dataset.table_name,
        "columns": sorted(c.column_name for c in visible_columns),
        "metrics": [
            {
                "metric_name": m.metric_name,
                "expression": m.expression,
                "description": m.description,
            }
            for m in dataset.metrics
        ],
    }
    # 'Description' del dataset (Editar Dataset > pestaña Settings) —
    # contexto general de negocio sobre TODO el dataset (ej. "excluye
    # clientes dados de baja", "se actualiza diariamente a las 6am").
    if dataset.description:
        summary["dataset_description"] = dataset.description
    if column_labels:
        summary["column_labels"] = column_labels
    if column_descriptions:
        summary["column_descriptions"] = column_descriptions
    return summary


@tool(
    name="irex.get_dashboard_dataset_context",
    description=(
        "FALLBACK — usar solo si irex.get_query_context no fue llamado o no "
        "devolvió 'dataset_id'/'dataset'. En condiciones normales, "
        "get_query_context con dashboard_id ya incluye el dataset dominante "
        "con columnas y métricas. "
        "Resuelve el dataset REAL detrás de un dashboard y devuelve columnas "
        "y métricas guardadas. Si ya existe una métrica guardada con el "
        "cálculo que se necesita, usar su 'expression' en vez de "
        "reconstruirla con RATIO(...). "
        "'column_labels' (si viene): mapa nombre_real -> nombre de negocio para "
        "columnas con nombre técnico. Usar SOLO para traducir un término del "
        "usuario a la columna real — nunca usar el label como nombre de "
        "columna en una consulta. "
        "'dataset_description' (si viene) y 'column_descriptions' (si viene, "
        "mapa nombre_real -> texto): notas de negocio en texto libre que un "
        "admin de Superset escribió para el dataset completo o para una "
        "columna puntual (ej. 'excluye devoluciones', 'vigente desde 2025') "
        "— leer ANTES de interpretar esas columnas o de responder preguntas "
        "sobre alcance/limitaciones del dataset, tienen prioridad sobre "
        "suposiciones basadas solo en el nombre de la columna."
    ),
    tags=["irex", "dashboard", "dataset", "contexto"],
)
def get_dashboard_dataset_context(
    request: GetDashboardDatasetContextRequest,
) -> dict[str, Any]:
    return get_dashboard_dataset_context_data(
        request.dashboard_id, request.max_datasets
    )


def get_dashboard_dataset_context_data(
    dashboard_id: int, max_datasets: int = 3
) -> dict[str, Any]:
    """Lógica reusable de irex.get_dashboard_dataset_context — usada también
    por irex.get_query_context para consolidar varias llamadas en una."""
    from superset.daos.dashboard import DashboardDAO
    from superset.daos.dataset import DatasetDAO

    try:
        slices = DashboardDAO.get_charts_for_dashboard(str(dashboard_id))
    except Exception as exc:  # dashboard not found/no access
        return {
            "status": "error",
            "error": f"No se pudo leer el dashboard {dashboard_id}: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    dataset_ids = [s.datasource_id for s in slices if s.datasource_id]
    counts = Counter(dataset_ids)

    if not counts:
        return {
            "status": "success",
            "datasets_used": [],
            "dominant_dataset_id": None,
            "note": "El dashboard no tiene charts con dataset asociado.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    ranked = counts.most_common()
    dominant_dataset_id = ranked[0][0]

    datasets_used = [
        {"dataset_id": dataset_id, "chart_count": count}
        for dataset_id, count in ranked
    ]

    datasets_detail = []
    dominant_columns: set[str] = set()
    dominant_sql: str | None = None
    for dataset_id, _count in ranked[:max_datasets]:
        dataset = DatasetDAO.find_by_id(dataset_id)
        if dataset is not None:
            summary = _dataset_summary(dataset)
            datasets_detail.append(summary)
            if dataset_id == dominant_dataset_id:
                dominant_columns = set(summary["columns"])
                dominant_sql = dataset.sql

    response: dict[str, Any] = {
        "status": "success",
        "datasets_used": datasets_used,
        "dominant_dataset_id": dominant_dataset_id,
        "datasets": datasets_detail,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    native_filter_targets = _native_filter_targets(
        dashboard_id, dominant_columns, dominant_sql
    )
    if native_filter_targets:
        response["native_filter_targets"] = native_filter_targets
        response["native_filter_targets_note"] = (
            "Filtros nativos configurados en el dashboard. Entries con "
            "usable_as='jinja_filters' son la ÚNICA fuente confirmada de "
            "nombres de columna para el parámetro 'jinja_filters' de "
            "irex.query_dataset/chart_option/query_dataset_sql — NO adivinar "
            "otros nombres."
        )

    slice_datasets = {s.id: s.datasource_id for s in slices if s.datasource_id}
    dashboard_tabs = _dashboard_tabs(dashboard_id, slice_datasets)
    if dashboard_tabs and len({tuple(t["dataset_ids"]) for t in dashboard_tabs}) > 1:
        # Solo se muestra cuando hay AMBIGÜEDAD real (2+ pestañas con
        # combinaciones de dataset distintas) — un dashboard normal de un
        # solo dataset no necesita este campo.
        response["dashboard_tabs"] = dashboard_tabs
        response["dashboard_tabs_warning"] = (
            "Este dashboard tiene pestañas que usan datasets distintos entre "
            "sí. 'dataset_id'/'dominant_dataset_id' de esta respuesta es el "
            "más usado en TODO el dashboard — puede NO ser el correcto para "
            "la pregunta si esta corresponde temáticamente a otra pestaña. "
            "Antes de consultar, comparar el texto de la pregunta contra "
            "'dashboard_tabs[].tab_name' — si alguna coincide claramente "
            "(ej. pregunta sobre 'desperdicio' y existe una pestaña "
            "'Desperdicio'), usar el/los 'dataset_ids' de ESA pestaña en vez "
            "del dataset dominante."
        )

    return response
