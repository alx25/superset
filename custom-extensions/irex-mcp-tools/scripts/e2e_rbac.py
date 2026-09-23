#!/usr/bin/env python3
"""Pruebas end-to-end de RBAC/autenticación contra un servidor MCP REAL
(Fase 9 de PLAN_ASISTENTE_SQL_LAB.md, casos "Backend/MCP").

Emite JWT de vida corta (5 min) con los mismos claims que el widget
(`custom-src/login/mcp_widget.py`: sub/iss/aud/exp/nbf/iat/jti), firmados
con el `MCP_JWT_SECRET` leído del config indicado. Nunca imprime el secreto
ni los tokens.

Solo lectura: las llamadas que llegan a ejecutarse son de metadatos
(`get_sql_schema_context`) o EXPLAIN sin ANALYZE. Las tools con gate RBAC se
llaman con un usuario SIN permiso, así que se rechazan antes de ejecutar
nada.

Uso (entorno de test, con el venv de Superset):
  superset_v6_1_0/.venv/bin/python \\
    custom-extensions/irex-mcp-tools/scripts/e2e_rbac.py \\
    --config superset_config_test.py --url http://127.0.0.1:5009/mcp

Usuarios requeridos en la metadata de ese entorno:
  - admin                      (rol con SQL Lab y acceso a todas las bases)
  - test                       (Gamma: dashboards sí, SQL Lab no)
  - irex_e2e_sqllab_sin_base   (solo rol `sql_lab`: SQL Lab sí, ninguna base)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
import uuid
from dataclasses import dataclass
from typing import Any

import jwt
from fastmcp import Client

PREFIX = "extensions.irex.irex-mcp-tools.irex."

# Tools con `class_permission_name="SQLLab", method_permission_name="execute_sql_query"`.
GATED_TOOLS = [
    "query_dataset",
    "query_dataset_sql",
    "compare_periods",
    "rank_partitions",
    "forecast",
    "export_to_excel",
    "list_column_values",
    "get_sql_schema_context",
    "explain_query",
    "check_query_nulls",
]

# Ids por defecto de test; en producción pasarlos por argumento (--clickhouse-db/--postgres-db).
CLICKHOUSE_DB = 3
POSTGRES_DB = 2

# Tools que deben aparecer en tools/list (verificación post-despliegue).
EXPECTED_VISIBLE = set(GATED_TOOLS) | {
    "business_context", "chart_option", "get_applied_filters",
    "get_dashboard_dataset_context", "get_query_context", "search_dashboards",
}


@dataclass
class Outcome:
    case: str
    expected: str
    got: str
    ok: bool | None  # None = no concluyente


def read_secret(config_path: str) -> tuple[str, str, str]:
    text = open(config_path, encoding="utf-8").read()

    def literal(name: str) -> str:
        match = re.search(rf'^{name}\s*=\s*"([^"]+)"', text, re.M)
        if not match:
            sys.exit(f"No se encontró {name} como literal en {config_path}")
        return match.group(1)

    return literal("MCP_JWT_SECRET"), literal("MCP_JWT_ISSUER"), literal("MCP_JWT_AUDIENCE")


class TokenFactory:
    def __init__(self, secret: str, issuer: str, audience: str) -> None:
        self._secret, self._issuer, self._audience = secret, issuer, audience

    def make(self, sub: str, *, exp_offset: int = 300, secret: str | None = None, audience: str | None = None) -> str:
        now = int(time.time())
        claims = {
            "sub": sub,
            "iss": self._issuer,
            "aud": audience or self._audience,
            "exp": now + exp_offset,
            "nbf": now - 600 if exp_offset < 0 else now,
            "iat": now - 600 if exp_offset < 0 else now,
            "jti": str(uuid.uuid4()),
        }
        return jwt.encode(claims, secret or self._secret, algorithm="HS256")


def _minimal_value(schema: dict[str, Any], defs: dict[str, Any]) -> Any:
    """Valor mínimo que pasa la validación de JSON Schema, para llegar al
    gate de permisos sin que la validación de argumentos lo tape."""
    if "$ref" in schema:
        return _minimal_value(defs[schema["$ref"].split("/")[-1]], defs)
    if "anyOf" in schema:
        non_null = [s for s in schema["anyOf"] if s.get("type") != "null"]
        return _minimal_value(non_null[0], defs) if non_null else None
    if "enum" in schema:
        return schema["enum"][0]
    kind = schema.get("type")
    if kind == "object":
        return {
            key: _minimal_value(prop, defs)
            for key, prop in schema.get("properties", {}).items()
            if key in schema.get("required", [])
        }
    if kind == "array":
        min_items = schema.get("minItems", 0)
        return [_minimal_value(schema.get("items", {"type": "string"}), defs) for _ in range(min_items)]
    if kind == "integer":
        return max(1, schema.get("minimum", 1))
    if kind == "number":
        return 1
    if kind == "boolean":
        return False
    return "x"


def minimal_args(input_schema: dict[str, Any]) -> dict[str, Any]:
    return _minimal_value(input_schema, input_schema.get("$defs", {}))


def result_text(result: Any) -> str:
    parts = [getattr(block, "text", "") for block in (result.content or [])]
    text = " ".join(p for p in parts if p)
    if not text and result.structured_content is not None:
        text = json.dumps(result.structured_content, ensure_ascii=False)
    return text


def payload(result: Any) -> dict[str, Any]:
    if isinstance(result.structured_content, dict):
        inner = result.structured_content.get("result", result.structured_content)
        if isinstance(inner, dict):
            return inner
    try:
        return json.loads(result_text(result))
    except (ValueError, TypeError):
        return {}


async def call(url: str, token: str | None, tool: str, args: dict[str, Any]) -> Any:
    async with Client(url, auth=token) as client:
        return await client.call_tool(PREFIX + tool, args, raise_on_error=False)


async def connect_status(url: str, token: str | None) -> str:
    """'ok' si el servidor aceptó la conexión MCP, o la clase de error."""
    try:
        async with Client(url, auth=token) as client:
            await client.list_tools()
        return "ok"
    except Exception as e:  # noqa: BLE001 - se reporta el tipo/mensaje
        message = str(e)
        return "401" if "401" in message or "Unauthorized" in message else f"{type(e).__name__}: {message[:120]}"


async def run(url: str, tokens: TokenFactory, smoke: bool) -> list[Outcome]:
    outcomes: list[Outcome] = []
    admin = tokens.make("admin")

    async with Client(url, auth=admin) as client:
        schemas = {t.name.removeprefix(PREFIX): t.inputSchema for t in await client.list_tools() if t.name.startswith(PREFIX)}

    missing = sorted(EXPECTED_VISIBLE - set(schemas))
    outcomes.append(Outcome("tools/list completo", "sin faltantes", ", ".join(missing) or "completo", not missing))
    leaked = "create_chart" in schemas
    outcomes.append(Outcome("create_chart oculta", "ausente", "PRESENTE" if leaked else "ausente", not leaked))

    # 1. Con SQL Lab y base permitida: acceso.
    r = await call(url, admin, "get_sql_schema_context", {"request": {"database_id": CLICKHOUSE_DB, "schema": "default", "search": "corte"}})
    body = payload(r)
    outcomes.append(Outcome("admin · get_sql_schema_context (ClickHouse)", "success=true", f"success={body.get('success')}", body.get("success") is True))

    if smoke:
        return outcomes + await _auth_and_safety_cases(url, tokens, admin)

    # 2. Con SQL Lab pero sin acceso a la base: pasa RBAC, lo frena el chequeo de base.
    nodb = tokens.make("irex_e2e_sqllab_sin_base")
    for tool, args in [
        ("get_sql_schema_context", {"request": {"database_id": CLICKHOUSE_DB, "schema": "default"}}),
        ("explain_query", {"request": {"database_id": POSTGRES_DB, "schema": "public", "sql": "SELECT 1"}}),
        ("check_query_nulls", {"request": {"database_id": POSTGRES_DB, "schema": "public", "sql": "SELECT 1"}}),
    ]:
        r = await call(url, nodb, tool, args)
        got = payload(r).get("error_type") or result_text(r)[:120]
        outcomes.append(Outcome(f"sql_lab sin base · {tool}", "DATABASE_SECURITY_ACCESS_ERROR", got, got == "DATABASE_SECURITY_ACCESS_ERROR"))

    # 3. Con dashboards pero sin SQL Lab (Gamma): todas las tools de consulta denegadas.
    gamma = tokens.make("test")
    for tool in GATED_TOOLS:
        if tool not in schemas:
            outcomes.append(Outcome(f"Gamma · {tool}", "Permission denied", "no está en tools/list", None))
            continue
        r = await call(url, gamma, tool, minimal_args(schemas[tool]))
        text = result_text(r)
        denied = "Permission denied" in text
        outcomes.append(Outcome(f"Gamma · {tool}", "Permission denied", "Permission denied" if denied else text[:120], denied if r.is_error or denied else False))

    # 3b. Control: Gamma sí puede usar una tool informativa sin gate (el rechazo no es global).
    r = await call(url, gamma, "search_dashboards", minimal_args(schemas["search_dashboards"]))
    text = result_text(r)
    outcomes.append(Outcome("Gamma · search_dashboards (sin gate)", "sin Permission denied", "Permission denied" if "Permission denied" in text else "ok", "Permission denied" not in text))

    return outcomes + await _auth_and_safety_cases(url, tokens, admin)


async def _auth_and_safety_cases(url: str, tokens: TokenFactory, admin: str) -> list[Outcome]:
    """Casos que no necesitan usuarios de prueba: aptos para producción."""
    outcomes: list[Outcome] = []

    # 4. Usuario JWT inexistente: denegado, sin caer en admin.
    ghost = tokens.make("irex_e2e_usuario_inexistente")
    r = await call(url, ghost, "get_sql_schema_context", {"request": {"database_id": CLICKHOUSE_DB, "schema": "default", "search": "corte"}})
    text = result_text(r)
    # El servidor MCP devuelve estos rechazos como contenido de texto con
    # isError=false (mismo contrato de texto libre que "Permission denied:"),
    # así que se valida por el mensaje y porque no vino una respuesta exitosa.
    rejected = "no existe" in text and payload(r).get("success") is not True
    outcomes.append(Outcome("sub inexistente · get_sql_schema_context", "rechazado (no existe)", "rechazado" if rejected else text[:120], rejected))

    # 5. Tokens inválidos: rechazados en la capa HTTP, antes de cualquier tool.
    for label, token in [
        ("sin token", None),
        ("token vencido", tokens.make("admin", exp_offset=-60)),
        ("firma inválida", tokens.make("admin", secret="otro-secreto-" + uuid.uuid4().hex)),
        ("audiencia incorrecta", tokens.make("admin", audience="otra-audiencia")),
    ]:
        status = await connect_status(url, token)
        outcomes.append(Outcome(f"auth · {label}", "401", status, status == "401"))

    # 6. Solo-lectura en explain_query (build con `_sql_safety`, entrada 41).
    # EXPLAIN sin ANALYZE sobre una tabla inexistente: seguro con cualquier build.
    r = await call(url, admin, "explain_query", {"request": {
        "database_id": POSTGRES_DB, "schema": "public", "analyze": False,
        "sql": "WITH d AS (DELETE FROM irex_e2e_tabla_inexistente RETURNING *) SELECT * FROM d",
    }})
    got = payload(r).get("error_type") or result_text(r)[:120]
    outcomes.append(Outcome("admin · explain_query con DELETE en CTE", "INVALID_SQL_ERROR", got, got == "INVALID_SQL_ERROR"))

    return outcomes


def main() -> int:
    global CLICKHOUSE_DB, POSTGRES_DB
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--clickhouse-db", type=int, default=CLICKHOUSE_DB)
    parser.add_argument("--postgres-db", type=int, default=POSTGRES_DB)
    parser.add_argument(
        "--humo",
        action="store_true",
        help="Solo casos sin usuarios de prueba (apto para producción): tools/list, admin, sub inexistente, 401s y solo-lectura.",
    )
    args = parser.parse_args()

    CLICKHOUSE_DB, POSTGRES_DB = args.clickhouse_db, args.postgres_db
    tokens = TokenFactory(*read_secret(args.config))
    outcomes = asyncio.run(run(args.url, tokens, args.humo))

    width = max(len(o.case) for o in outcomes)
    for o in outcomes:
        mark = "PASS" if o.ok else ("????" if o.ok is None else "FAIL")
        print(f"{mark}  {o.case.ljust(width)}  esperado: {o.expected:<32} obtenido: {o.got}")
    failed = [o for o in outcomes if o.ok is False]
    inconclusive = [o for o in outcomes if o.ok is None]
    print(f"\n{len(outcomes) - len(failed) - len(inconclusive)} PASS, {len(failed)} FAIL, {len(inconclusive)} no concluyentes")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
