#!/usr/bin/env python3
"""Validación previa al despliegue de irex-mcp-tools (Fases 9 y 10 de
PLAN_ASISTENTE_SQL_LAB.md). Solo lee: no modifica config ni .supx.

Chequea un `superset_config*.py` (y opcionalmente el `.supx` que se va a
desplegar con él) contra reglas que ya causaron o podrían causar
incidentes reales:

- MCP_AUTH_ENABLED debe ser True y MCP_RBAC_ENABLED no puede ser False
  (sin esto, los decoradores `class_permission_name` de las tools no
  frenan nada).
- MCP_DEV_USERNAME no debe estar definido: es el usuario al que cae una
  request sin identidad.
- `irex.create_chart` debe seguir excluida (`exclude_tags` con "guardar") y
  fuera de `always_visible`: escribe en la metadata de Superset.
- `always_visible` debe listar exactamente las tools irex registradas
  (paso 6 de CLAUDE.md). Una tool registrada que falta ahí no aparece en
  tools/list y el modelo no la ve (caso `rank_partitions` en test,
  2026-09-23).
- Con --supx: toda tool de `always_visible` debe existir en ese .supx. Si
  no existe, el MCP responde `Unknown tool` (caso de producción, entrada
  17 del Registro de cambios).

Nunca imprime valores de secretos.

Uso (con el venv de Superset, porque el config importa módulos de Superset):
  superset_v6_1_0/.venv/bin/python \\
    custom-extensions/irex-mcp-tools/scripts/check_deploy_config.py \\
    --config superset_config_test.py \\
    --supx extensions_test/irex-mcp-tools-0.1.0.supx

Sale con código 1 si hay algún ERROR.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import runpy
import sys
import zipfile

PREFIX = "extensions.irex.irex-mcp-tools.irex."
DISABLED_TOOLS = {"create_chart"}
TOOL_NAME_RE = re.compile(r'name="irex\.([a-z_]+)"')
SOURCE_DIR = pathlib.Path(__file__).resolve().parent.parent / "backend" / "src" / "irex" / "irex_mcp_tools"


def tools_in_source() -> set[str]:
    names: set[str] = set()
    for path in SOURCE_DIR.glob("*.py"):
        names.update(TOOL_NAME_RE.findall(path.read_text(encoding="utf-8")))
    return names


def tools_in_supx(supx: pathlib.Path) -> set[str]:
    names: set[str] = set()
    with zipfile.ZipFile(supx) as archive:
        for entry in archive.namelist():
            if entry.startswith("backend/src/irex/irex_mcp_tools/") and entry.endswith(".py"):
                names.update(TOOL_NAME_RE.findall(archive.read(entry).decode("utf-8")))
    return names


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True, type=pathlib.Path)
    parser.add_argument("--supx", type=pathlib.Path)
    args = parser.parse_args()

    config = runpy.run_path(str(args.config))
    errors: list[str] = []
    warnings: list[str] = []

    if config.get("MCP_AUTH_ENABLED") is not True:
        errors.append(f"MCP_AUTH_ENABLED={config.get('MCP_AUTH_ENABLED')!r}: debe ser True.")
    if config.get("MCP_RBAC_ENABLED", True) is False:
        errors.append("MCP_RBAC_ENABLED=False: los permisos por tool (SQLLab) quedan sin efecto.")
    if config.get("MCP_DEV_USERNAME"):
        errors.append("MCP_DEV_USERNAME está definido: una request sin identidad caería en ese usuario.")
    secret = config.get("MCP_JWT_SECRET") or ""
    if not secret:
        errors.append("MCP_JWT_SECRET vacío o ausente.")
    elif len(secret) < 32:
        warnings.append(f"MCP_JWT_SECRET tiene menos de 32 caracteres ({len(secret)}).")

    factory = config.get("MCP_FACTORY_CONFIG") or {}
    if "irex" not in (factory.get("include_tags") or []):
        errors.append("MCP_FACTORY_CONFIG.include_tags no incluye 'irex'.")
    if "guardar" not in (factory.get("exclude_tags") or []):
        errors.append("MCP_FACTORY_CONFIG.exclude_tags no incluye 'guardar': irex.create_chart quedaría habilitada.")

    visible_entries = (config.get("MCP_TOOL_SEARCH_CONFIG") or {}).get("always_visible") or []
    visible = {entry.removeprefix(PREFIX) for entry in visible_entries if entry.startswith(PREFIX)}

    source = tools_in_source() - DISABLED_TOOLS
    for tool in sorted(visible & DISABLED_TOOLS):
        errors.append(f"irex.{tool} está en always_visible y debe permanecer deshabilitada.")
    for tool in sorted(source - visible):
        errors.append(f"irex.{tool} está registrada en la fuente pero falta en always_visible (el modelo no la ve).")
    for tool in sorted(visible - source - DISABLED_TOOLS):
        errors.append(f"irex.{tool} está en always_visible pero no existe en la fuente canónica.")

    if args.supx:
        packaged = tools_in_supx(args.supx)
        for tool in sorted(visible - packaged):
            errors.append(f"irex.{tool} está en always_visible pero NO está en {args.supx.name}: el MCP respondería 'Unknown tool'.")
        for tool in sorted(source - packaged):
            warnings.append(f"irex.{tool} existe en la fuente pero no en {args.supx.name} (.supx desactualizado).")

    print(f"Config: {args.config}")
    if args.supx:
        print(f".supx:  {args.supx}")
    for message in errors:
        print(f"ERROR    {message}")
    for message in warnings:
        print(f"AVISO    {message}")
    if not errors and not warnings:
        print("OK       sin observaciones.")
    print(f"\n{len(errors)} errores, {len(warnings)} avisos")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
