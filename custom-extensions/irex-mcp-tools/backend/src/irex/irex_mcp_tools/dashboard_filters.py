import json
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool


class GetAppliedFiltersRequest(BaseModel):
    dashboard_id: int = Field(
        ..., description="ID del dashboard (el mismo que dashboard_id de contexto)"
    )
    native_filters_key: str = Field(
        ...,
        description="El valor de 'native_filters_key' en la URL de la página "
        "actual (ej. en page_url '...dashboard/57/?native_filters_key=8bna"
        "UT3Y6mU' la key es '8bnaUT3Y6mU'). Representa los valores de "
        "filtro que el usuario tiene seleccionados AHORA en pantalla.",
    )


@tool(
    name="irex.get_applied_filters",
    description=(
        "FALLBACK — usar solo si irex.get_query_context no fue llamado o no "
        "devolvió 'applied_filters'. En condiciones normales, get_query_context "
        "con dashboard_id + native_filters_key ya incluye esta información. "
        "Devuelve los filtros nativos activos en el dashboard. Cada entry "
        "incluye column/op/value listos para copiar como elemento de 'filters' "
        "en irex.query_dataset/irex.chart_option, sin transformación adicional."
    ),
    tags=["irex", "dashboard", "filtros", "contexto"],
)
def get_applied_filters(request: GetAppliedFiltersRequest) -> dict[str, Any]:
    return get_applied_filters_data(request.dashboard_id, request.native_filters_key)


def get_applied_filters_data(
    dashboard_id: int, native_filters_key: str
) -> dict[str, Any]:
    """Lógica reusable de irex.get_applied_filters — usada también por
    irex.get_query_context para consolidar varias llamadas en una."""
    from superset.commands.dashboard.filter_state.get import GetFilterStateCommand
    from superset.commands.temporary_cache.exceptions import (
        TemporaryCacheAccessDeniedError,
        TemporaryCacheResourceNotFoundError,
    )
    from superset.commands.temporary_cache.parameters import CommandParameters

    params = CommandParameters(resource_id=dashboard_id, key=native_filters_key)
    try:
        raw = GetFilterStateCommand(params).run()
    except TemporaryCacheResourceNotFoundError:
        return {
            "status": "error",
            "error": (
                "native_filters_key expirada o no encontrada. "
                "El estado de filtros del dashboard es temporal y expira. "
                "Recargar el dashboard en el navegador y obtener la nueva key "
                "de la URL (parámetro 'native_filters_key=...'). "
                "IMPORTANTE: sin esta key los filtros activos del dashboard "
                "NO se aplicarán — las consultas devolverán datos sin filtrar."
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except TemporaryCacheAccessDeniedError as exc:
        return {
            "status": "error",
            "error": f"Acceso denegado al estado de filtros del dashboard: {exc}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    if not raw:
        return {
            "status": "success",
            "filters": [],
            "note": "No hay valores de filtro guardados para esa key — puede "
            "que el usuario no haya aplicado ningún filtro nativo todavía, o "
            "que la key haya expirado.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    try:
        state = json.loads(raw)
    except (TypeError, ValueError):
        state = raw

    from .dashboard_dataset_context import get_hidden_native_filter_ids

    hidden_ids = get_hidden_native_filter_ids(dashboard_id)
    if hidden_ids and isinstance(state, dict):
        state = {k: v for k, v in state.items() if k not in hidden_ids}

    filters_summary: list[dict[str, Any]] = []
    if isinstance(state, dict):
        for filter_id, mask in state.items():
            if not isinstance(mask, dict):
                continue
            filter_state = mask.get("filterState")
            value = (
                filter_state.get("value")
                if isinstance(filter_state, dict)
                else None
            )
            if value is None:
                continue
            extra_form_data = mask.get("extraFormData") or {}
            clauses = extra_form_data.get("filters") or []
            entry: dict[str, Any] = {"filter_id": filter_id, "label": value}
            if clauses:
                # Listo para usar tal cual como entrada de 'filters' en
                # irex.query_dataset/irex.chart_option (column/op/value) —
                # sin adivinar columna ni operador.
                entry["column"] = clauses[0].get("col")
                entry["op"] = clauses[0].get("op")
                entry["value"] = clauses[0].get("val")
            filters_summary.append(entry)

    return {
        "status": "success",
        "filters": filters_summary,
        "raw": state,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
