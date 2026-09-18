import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field
from superset_core.mcp.decorators import tool

_STOPWORDS_ES = {
    "de", "del", "la", "el", "los", "las", "en", "y", "a", "para", "con", "por",
}


def _normalize(s: str) -> str:
    """Minúsculas y sin tildes/diacríticos (á->a, é->e, ...) — comparación
    tolerante a cómo la gente recuerda/escribe un nombre, no el título literal."""
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def _significant_words(s: str) -> list[str]:
    """Palabras de 2+ letras, sin stopwords en español — 'Análisis de EF' ->
    ['analisis', 'ef'] (se descarta 'de'). Así una palabra de más/de menos
    entre medio no rompe la búsqueda."""
    words = re.findall(r"\w+", _normalize(s))
    return [w for w in words if w not in _STOPWORDS_ES and len(w) >= 2]


class SearchDashboardsRequest(BaseModel):
    title: str = Field(
        ...,
        description="Texto a buscar en el título del dashboard (parcial, "
        "sin distinguir mayúsculas/minúsculas). Ej. 'actividades comerciales'. "
        "Usar al menos 3 caracteres para evitar demasiadas coincidencias.",
        min_length=2,
    )
    max_results: int = Field(
        10,
        ge=1,
        le=25,
        description="Cantidad máxima de resultados a devolver.",
    )


@tool(
    name="irex.search_dashboards",
    description=(
        "Busca dashboards de Superset cuyo título contenga el texto indicado "
        "(búsqueda parcial, sin distinguir mayúsculas/minúsculas). Usar esta "
        "tool cuando el usuario menciona el nombre de otro dashboard para "
        "cruzar datos y no se conoce su ID numérico.\n\n"
        "Según el resultado:\n"
        "- **0 coincidencias**: informar al usuario que no se encontró ese "
        "dashboard y pedirle que verifique o corrija el nombre.\n"
        "- **1 coincidencia**: usar ese 'id' directamente en "
        "irex.get_query_context para obtener el dataset del otro dashboard.\n"
        "- **Varias coincidencias**: SIEMPRE mostrarle la lista al usuario y "
        "pedirle que confirme cuál es el dashboard correcto ANTES de proceder "
        "— nunca elegir uno al azar para evitar cruzar con datos equivocados."
    ),
    tags=["irex", "dashboard", "buscar"],
)
def search_dashboards(request: SearchDashboardsRequest) -> dict[str, Any]:
    from superset.models.dashboard import Dashboard
    from superset import db

    rows = (
        db.session.query(Dashboard.id, Dashboard.dashboard_title)
        .filter(Dashboard.dashboard_title.ilike(f"%{request.title}%"))
        .order_by(Dashboard.dashboard_title)
        .limit(request.max_results)
        .all()
    )

    matches = [{"id": row.id, "title": row.dashboard_title} for row in rows]
    fuzzy_fallback = False

    # La búsqueda exacta (ILIKE) no tolera tildes faltantes ni una palabra de
    # más/de menos (ej. 'Analisis de EF' no matchea 'Análisis EF' — falla por
    # el acento Y por el 'de' que no está en el título real). Si no hubo
    # ningún resultado, reintentar en Python: exigir que TODAS las palabras
    # significativas del término de búsqueda aparezcan en el título,
    # normalizando tildes — pocos dashboards (decenas), sin costo relevante.
    if not matches:
        search_words = _significant_words(request.title)
        if search_words:
            all_dashboards = (
                db.session.query(Dashboard.id, Dashboard.dashboard_title)
                .order_by(Dashboard.dashboard_title)
                .all()
            )
            fuzzy_matches = [
                {"id": row.id, "title": row.dashboard_title}
                for row in all_dashboards
                if row.dashboard_title
                and all(
                    w in _normalize(row.dashboard_title) for w in search_words
                )
            ]
            if fuzzy_matches:
                matches = fuzzy_matches[: request.max_results]
                fuzzy_fallback = True

    truncated = len(matches) >= request.max_results

    response: dict[str, Any] = {
        "status": "success",
        "matches": matches,
        "match_count": len(matches),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if fuzzy_fallback:
        response["fuzzy_fallback"] = True

    if len(matches) == 0:
        response["note"] = (
            "No se encontró ningún dashboard que contenga ese texto en el "
            "título. Informar al usuario e invitarlo a verificar o corregir "
            "el nombre. Se puede intentar con un término más corto o diferente."
        )
    elif fuzzy_fallback and len(matches) == 1:
        response["note"] = (
            f"Coincidencia por búsqueda aproximada (no exacta) — id="
            f"{matches[0]['id']} (\"{matches[0]['title']}\"). El título real "
            "difiere ligeramente del texto buscado (tildes o palabras de más/"
            "menos) — confirmar con el usuario antes de usar este id si hay "
            "alguna duda."
        )
    elif len(matches) == 1:
        response["note"] = (
            f"Coincidencia única — id={matches[0]['id']} "
            f"(\"{matches[0]['title']}\"). Usar ese id en "
            "irex.get_query_context para cruzar datos del otro dashboard."
        )
    else:
        response["note"] = (
            f"Se encontraron {len(matches)} dashboards que coinciden con "
            f"\"{request.title}\". Mostrar la lista al usuario y pedirle que "
            "confirme cuál es el correcto antes de continuar."
        )

    if truncated:
        response["warning"] = (
            f"Se devolvieron los primeros {request.max_results} resultados — "
            "puede haber más. Usar un término más específico para acotar."
        )

    return response
