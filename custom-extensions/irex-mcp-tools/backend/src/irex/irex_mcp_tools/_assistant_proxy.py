"""Lógica pura del reenvío de SQL Lab y Explore al backend del chat.

Separada de `assistant_api.py` (la vista Flask) para poder testearla sin
levantar Superset. Ver PLAN_ASISTENTE_SQL_LAB.md, Fase 6 (portabilidad).

Diferencias deliberadas con el proxy genérico viejo
(`custom-src/login/mcp_widget.py::chat_widget_api_proxy`):
- Reenvía una lista BLANCA de headers del navegador (`Content-Type`,
  `Accept`). El proxy viejo reenvía todo salvo unos pocos, incluida la
  cookie de sesión de Superset, que el backend del chat no necesita.
- Solo dos rutas fijas aguas arriba (`/api/sql-lab-assistant` y
  `/api/explore-assistant`), nunca un `<path:subpath>` arbitrario.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Mapping

UPSTREAM_PATH = "/api/sql-lab-assistant"
EXPLORE_UPSTREAM_PATH = "/api/explore-assistant"
FORWARDED_REQUEST_HEADERS = ("content-type", "accept")
EXCLUDED_RESPONSE_HEADERS = {
    "content-encoding",
    "transfer-encoding",
    "connection",
    "content-length",
}


def upstream_url(base_url: str | None, path: str = UPSTREAM_PATH) -> str | None:
    """URL del endpoint del backend del chat, o None si no está configurado."""
    base = (base_url or "").strip().rstrip("/")
    if path not in (UPSTREAM_PATH, EXPLORE_UPSTREAM_PATH):
        raise ValueError("Ruta de asistente no permitida")
    return f"{base}{path}" if base else None


def has_required_role(required_role: str | None, role_names: Iterable[str]) -> bool:
    """Mismo criterio que `_user_has_chat_access` del widget: sin rol
    configurado no hay restricción adicional; con rol, hay que tenerlo."""
    if not required_role:
        return True
    return required_role in set(role_names)


def build_upstream_headers(
    incoming: Mapping[str, str],
    *,
    service_secret: str | None,
    username: str,
    email: str | None,
    display_name: str | None,
) -> dict[str, str]:
    """Headers para el backend del chat. La identidad sale SIEMPRE de la
    sesión del servidor, nunca de lo que mande el navegador: cualquier
    `X-Superset-User*` o `X-Service-Secret` entrante se descarta porque no
    está en la lista blanca."""
    headers = {
        name: value
        for name, value in incoming.items()
        if name.lower() in FORWARDED_REQUEST_HEADERS
    }
    if service_secret:
        headers["X-Service-Secret"] = service_secret
    headers["X-Superset-User"] = username
    headers["X-Superset-User-Email"] = email or ""
    headers["X-Superset-User-Display-Name"] = display_name or ""
    return headers


def filter_response_headers(
    headers: Iterable[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Quita los headers hop-by-hop o que dejan de ser ciertos al re-streamear
    (`requests` ya decodificó gzip, así que `Content-Length` tampoco vale)."""
    return [
        (name, value)
        for name, value in headers
        if name.lower() not in EXCLUDED_RESPONSE_HEADERS
    ]


def with_environment_mcp_url(body: bytes, mcp_url: str | None) -> bytes:
    """Fija `mcp_url` en el body con el MCP de ESTE entorno (`MCP_WIDGET_URL`),
    igual que hace el widget de dashboards en cada pedido.

    Test y producción comparten el mismo backend del chat. Sin este campo, el
    backend usa su URL por defecto para SQL Lab, que apuntaba al MCP de test:
    un pedido de producción terminaba consultando la metadata de test
    ("Database with ID 11 not found", 2026-09-23). Siempre pisa lo que mande
    el navegador: el MCP de destino no lo decide el cliente. Si el body no es
    un objeto JSON se deja intacto (el backend lo rechazará igual)."""
    if not mcp_url:
        return body
    try:
        payload = json.loads(body)
    except ValueError:
        return body
    if not isinstance(payload, dict):
        return body
    payload["mcp_url"] = mcp_url.rstrip("/")
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def prepare_explore_body(body: bytes, *, is_admin: bool, mcp_url: str) -> bytes:
    """Fija Admin y MCP desde la sesión/configuración, nunca desde el navegador.

    Rechaza JSON inválido u objetos de otra superficie antes de contactar al
    backend de chat. No acepta una URL MCP implícita ni la suministrada por
    el navegador. El backend vuelve a verificar estado y rol mediante MCP.
    """
    if not mcp_url or not mcp_url.strip():
        raise ValueError("MCP_WIDGET_URL no configurado")
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise ValueError("Body JSON inválido") from exc
    if not isinstance(payload, dict) or payload.get("source") != "superset_explore":
        raise ValueError("Contrato Explore inválido")
    payload["user"] = {"is_admin": is_admin}
    payload["mcp_url"] = mcp_url.strip().rstrip("/")
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def has_explore_permissions(can_access: Callable[[str, str], bool]) -> bool:
    """Permisos mínimos de la superficie Explore, antes de cualquier relay."""
    return all(
        can_access(permission, view)
        for permission, view in (
            ("can_explore", "Superset"),
            ("can_read", "Chart"),
            ("can_read", "Dataset"),
        )
    )


def explore_datasource_id(body: bytes) -> int:
    """Obtiene el id del dataset declarado para bloquear el relay sin acceso."""
    payload = json.loads(body)
    datasource = payload.get("chart", {}).get("datasource", {})
    dataset_id = datasource.get("id") if isinstance(datasource, dict) else None
    if (
        isinstance(dataset_id, bool)
        or not isinstance(dataset_id, int)
        or dataset_id <= 0
    ):
        raise ValueError("Dataset Explore inválido")
    return dataset_id


def has_explore_dataset_access(
    dataset_id: int,
    find_dataset: Callable[[int], object | None],
    can_access_datasource: Callable[[object], bool],
) -> bool:
    """Impide el relay si el dataset no existe o el usuario no puede leerlo."""
    dataset = find_dataset(dataset_id)
    return dataset is not None and can_access_datasource(dataset)
