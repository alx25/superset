"""Puente JWT -> usuario real de Superset para el servicio MCP.

Apache Superset open source NO incluye un mecanismo que traduzca el claim
'sub' de un JWT validado en un usuario real de Superset — esa pieza
("WorkspaceContextMiddleware") es propietaria de Preset. Sin este puente,
TODAS las llamadas MCP autenticadas por JWT terminan resolviéndose a
MCP_DEV_USERNAME (default "admin" en superset/config.py), sin importar
quién mandó el token.

Este módulo:
1. Agrega un middleware de FastMCP que lee el 'sub' del JWT validado y lo
   guarda en un contextvar (propaga correctamente a través de await/async,
   a diferencia de flask.g que se resetea con cada nuevo app_context()).
2. Reemplaza superset.mcp_service.auth.get_user_from_request para que,
   si hay un 'sub' de JWT en el contextvar, busque ESE usuario real en
   vez de caer en MCP_DEV_USERNAME. Si el 'sub' no matchea ningún usuario,
   RECHAZA la request (no cae en admin por error).
3. Si no hay JWT (ej. el MCP de producción en modo MCP_DEV_USERNAME puro),
   el comportamiento original queda intacto.

No modifica ningún archivo del core de Superset — se instala 100% desde
esta extensión, así que sobrevive futuras actualizaciones sin necesitar
ningún paso de migración.
"""

from __future__ import annotations

import contextvars
import logging
from typing import Any

from fastmcp.server.middleware import Middleware, MiddlewareContext
from fastmcp.server.middleware.middleware import CallNext

logger = logging.getLogger(__name__)

_jwt_sub_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "irex_jwt_sub", default=None
)

_original_get_user_from_request: Any = None


class JwtUserBridgeMiddleware(Middleware):
    """Extrae el 'sub' del JWT validado por FastMCP y lo expone via contextvar."""

    async def on_call_tool(
        self, context: MiddlewareContext[Any], call_next: CallNext[Any, Any]
    ) -> Any:
        from fastmcp.server.dependencies import get_access_token

        sub: str | None = None
        try:
            token = get_access_token()
        except Exception:
            token = None

        if token is not None:
            claims = getattr(token, "claims", None) or {}
            sub = claims.get("sub") or getattr(token, "client_id", None)

        reset_token = _jwt_sub_var.set(sub)
        try:
            return await call_next(context)
        finally:
            _jwt_sub_var.reset(reset_token)


def _patched_get_user_from_request() -> Any:
    """Reemplazo de get_user_from_request que prioriza el 'sub' del JWT."""
    from flask import g

    if hasattr(g, "user") and g.user:
        return g.user

    sub = _jwt_sub_var.get()
    if sub:
        from superset.extensions import security_manager
        from superset.mcp_service.auth import load_user_with_relationships

        user = load_user_with_relationships(sub)
        if user is None:
            user_by_email = security_manager.find_user(email=sub)
            if user_by_email is not None:
                user = load_user_with_relationships(user_by_email.username)
        if user is None:
            logger.warning(
                "JWT sub=%r no coincide con ningún usuario de Superset — "
                "denegando request (NO se cae a MCP_DEV_USERNAME)",
                sub,
            )
            raise ValueError(
                f"Usuario '{sub}' (del JWT) no existe en Superset. "
                "Verificá que el 'sub' del token coincida con un username real."
            )
        return user

    # Sin JWT (ej. MCP en modo MCP_DEV_USERNAME puro) — comportamiento original.
    assert _original_get_user_from_request is not None
    return _original_get_user_from_request()


def install_auth_bridge() -> None:
    """Instala el monkeypatch y registra el middleware en la instancia MCP."""
    global _original_get_user_from_request

    import superset.mcp_service.auth as auth_module

    if _original_get_user_from_request is None:
        _original_get_user_from_request = auth_module.get_user_from_request
        auth_module.get_user_from_request = _patched_get_user_from_request
        logger.info("irex.auth_bridge: get_user_from_request parcheado (JWT->usuario)")

    from superset.mcp_service.app import mcp

    mcp.add_middleware(JwtUserBridgeMiddleware())
    logger.info("irex.auth_bridge: JwtUserBridgeMiddleware registrado")
