#!/usr/bin/env python3
"""Compatibilidad de irex-mcp-tools con el código fuente de una versión de
Superset (Fase 9, "Compatibilidad", de PLAN_ASISTENTE_SQL_LAB.md).

Análisis estático, sin instalar ni ejecutar nada del Superset objetivo:
sirve contra un checkout de cualquier versión (tag, rama, master).

Uso:
  python3 scripts/check_host_compat.py <directorio_fuente_superset>

Qué verifica:
  1. Símbolos internos `superset.*` que importa el backend de la extensión
     (se descubren leyendo backend/src, no es una lista a mano).
  2. Parámetros de `superset_core.mcp.decorators.tool` y
     `superset_core.rest_api.decorators.api` que usa la extensión.
  3. Los dos supuestos del host que la REST API compensa (ver
     assistant_api.py): `RestApi` sin `csrf_exempt = False` y `@api` llamando
     `_add_permission`. Informativo: si cambian, la extensión sigue
     funcionando.
  4. `auth_bridge`: dónde se llama `get_user_from_request` y si el host ya
     resuelve el `sub` del JWT de forma nativa.
  5. Frontend: símbolos de `@apache-superset/core` que usa el panel, y el
     punto de montaje `sqllab.rightSidebar`.
  6. Texto `Permission denied:` del que depende el chat.

Sale con código 1 si falta algo imprescindible (1, 2 o 5).
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys

EXT = pathlib.Path(__file__).resolve().parent.parent
BACKEND_SRC = EXT / "backend" / "src"

# Tools registradas pero excluidas del MCP por diseño (exclude_tags "guardar").
DISABLED_MODULES = {"create_chart"}

TOOL_KWARGS = {"name", "description", "tags", "class_permission_name", "method_permission_name"}
API_KWARGS = {"id", "name", "description", "resource_name"}

FRONTEND_SYMBOLS = {
    "sqlLab/index.ts": [
        r"(const|function) getCurrentTab\b", r"(const|function) getTabs\b", r"(const|function) createTab\b",
        r"(const|function) executeQuery\b", r"(const|function) cancelQuery\b",
        r"const onDidChangeActiveTab\b", r"const onDidQuerySuccess\b", r"const onDidQueryFail\b",
        r"const onDidQueryStop\b", r"^\s+limit\?: number", r"^\s+clientId: string",
    ],
    "authentication/index.ts": [r"getCSRFToken"],
    "views/index.ts": [r"registerView"],
    "theme/index.tsx": [r"useTheme"],
    "components/index.ts": [r"\bAlert\b"],
    "editors/index.ts": [
        rf"^\s+{m}\(" for m in (
            "insertText", "setValue", "getValue", "getSelectedText", "getCursorPosition",
            "setAnnotations", "clearAnnotations", "setSelection", "scrollToLine", "focus",
        )
    ],
}


def module_file(root: pathlib.Path, module: str) -> pathlib.Path | None:
    base = root.joinpath(*module.split("."))
    for candidate in (base.with_suffix(".py"), base / "__init__.py"):
        if candidate.exists():
            return candidate
    return None


def top_level_names(path: pathlib.Path) -> set[str]:
    names: set[str] = set()
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names.update(t.id for t in targets if isinstance(t, ast.Name))
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            names.update((a.asname or a.name).split(".")[0] for a in node.names)
    return names


def function_params(path: pathlib.Path, func: str) -> set[str] | None:
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.FunctionDef) and node.name == func:
            a = node.args
            return {x.arg for x in a.posonlyargs + a.args + a.kwonlyargs}
    return None


def extension_internal_imports() -> dict[tuple[str, str], dict[str, bool]]:
    """(módulo, símbolo) → {archivo: import a nivel de módulo?}. Un import a
    nivel de módulo que falla aborta el entrypoint entero (todas las tools
    siguientes); uno dentro de una función solo rompe esa tool al llamarla."""
    uses: dict[tuple[str, str], dict[str, bool]] = {}
    for path in BACKEND_SRC.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        top = {id(n) for n in tree.body}
        for node in ast.walk(tree):
            at_top = id(node) in top
            if isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] == "superset":
                for alias in node.names:
                    entry = uses.setdefault((node.module, alias.name), {})
                    entry[path.stem] = entry.get(path.stem, False) or at_top
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.split(".")[0] == "superset":
                        entry = uses.setdefault((alias.name, "*"), {})
                        entry[path.stem] = entry.get(path.stem, False) or at_top
    return uses


def main() -> int:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    root = pathlib.Path(sys.argv[1]).resolve()
    blocking: list[str] = []
    notes: list[str] = []

    print(f"Superset objetivo: {root}\n")

    # 1. Símbolos internos.
    uses = extension_internal_imports()
    missing = 0
    for (module, symbol), users in sorted(uses.items()):
        path = module_file(root, module)
        exists = path is not None and (
            symbol == "*" or symbol in top_level_names(path) or module_file(root, f"{module}.{symbol}") is not None
        )
        if exists:
            continue
        missing += 1
        ref = f"{module}:{symbol}" if symbol != "*" else module
        for user, at_top in sorted(users.items()):
            if at_top:
                blocking.append(f"{ref} importado a nivel de módulo en {user}.py: aborta la carga de la extensión")
                print(f"    FALTA {ref} — {user}.py, nivel de módulo (BLOQUEANTE)")
            elif user in DISABLED_MODULES:
                notes.append(f"{ref} no existe; lo usa {user}.py (tool deshabilitada, solo dentro de la función)")
                print(f"    FALTA {ref} — {user}.py, dentro de función de tool deshabilitada (nota)")
            else:
                blocking.append(f"{ref} usado dentro de {user}.py: esa tool falla al ejecutarse")
                print(f"    FALTA {ref} — {user}.py, dentro de función (BLOQUEANTE para esa tool)")
    print(f"[1] Símbolos internos superset.*: {len(uses) - missing}/{len(uses)} presentes")

    # 2. Decoradores públicos de superset_core.
    core = root / "superset-core" / "src" / "superset_core"
    for label, rel, func, needed in [
        ("tool()", "mcp/decorators.py", "tool", TOOL_KWARGS),
        ("api()", "rest_api/decorators.py", "api", API_KWARGS),
    ]:
        params = function_params(core / rel, func) if (core / rel).exists() else None
        lacking = sorted(needed - (params or set())) if params is not None else ["(no existe)"]
        print(f"[2] superset_core {label}: {'OK' if not lacking else 'FALTA ' + ', '.join(lacking)}")
        if lacking:
            blocking.append(f"superset_core {label}: {lacking}")

    # 3. Supuestos que compensa assistant_api.py.
    rest_api = (core / "rest_api" / "api.py").read_text(encoding="utf-8") if (core / "rest_api" / "api.py").exists() else ""
    injection = root / "superset" / "core" / "api" / "core_api_injection.py"
    csrf_default = "csrf_exempt = False" not in rest_api
    add_perm = injection.exists() and "_add_permission" in injection.read_text(encoding="utf-8")
    print(f"[3] RestApi exento de CSRF por defecto: {'sí (assistant_api fija csrf_exempt=False)' if csrf_default else 'no'}")
    print(f"    @api sincroniza permisos (_add_permission): {'sí (assistant_api usa vista propia)' if add_perm else 'no'}")

    # 4. auth_bridge.
    auth = root / "superset" / "mcp_service" / "auth.py"
    native = auth.exists() and "get_access_token()" in auth.read_text(encoding="utf-8")
    by_name = []
    for path in (root / "superset" / "mcp_service").rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if path.name != "auth.py" and re.search(r"from superset\.mcp_service\.auth import[^\n]*\n?[^)]*get_user_from_request", text):
            by_name.append(path.name)
    print(f"[4] Host resuelve el sub del JWT de forma nativa: {'sí' if native else 'no'}")
    print(f"    Módulos que importan get_user_from_request por nombre: {', '.join(sorted(by_name)) or 'ninguno'}")
    if by_name and not native:
        blocking.append("auth_bridge: el parche no alcanza a " + ", ".join(by_name) + " y el host no resuelve JWT nativo")
    elif by_name:
        notes.append("auth_bridge redundante en esta versión (el host resuelve JWT nativo); inofensivo")

    # 5. Frontend.
    fe = root / "superset-frontend" / "packages" / "superset-core" / "src"
    fe_missing = []
    total = 0
    for rel, patterns in FRONTEND_SYMBOLS.items():
        text = (fe / rel).read_text(encoding="utf-8") if (fe / rel).exists() else ""
        for pattern in patterns:
            total += 1
            if not re.search(pattern, text, re.M):
                fe_missing.append(f"{rel}: {pattern}")
    contributions = root / "superset-frontend" / "src" / "SqlLab" / "contributions.ts"
    mount = contributions.exists() and "rightSidebar" in contributions.read_text(encoding="utf-8")
    print(f"[5] Frontend @apache-superset/core: {total - len(fe_missing)}/{total} símbolos; sqllab.rightSidebar: "
          f"{'sí' if mount else 'NO (o contributions.ts no disponible en el checkout)'}")
    for m in fe_missing:
        print(f"    FALTA {m}")
    blocking += [f"frontend {m}" for m in fe_missing]
    if (fe / "chat" / "index.ts").exists():
        notes.append("existe la API `chat` (registerChat): migrar el adaptador de registro del panel cuando se publique")

    # 6. Contrato de error con el chat.
    has_text = auth.exists() and "Permission denied: " in auth.read_text(encoding="utf-8")
    print(f"[6] Texto 'Permission denied:' en mcp_service/auth.py: {'sí' if has_text else 'NO — avisar al agente del chat'}")
    if not has_text:
        notes.append("cambió el texto de Permission denied del que depende el chat")

    for note in notes:
        print(f"\nNOTA: {note}")
    print(f"\n{'COMPATIBLE' if not blocking else 'INCOMPATIBLE'}: {len(blocking)} bloqueantes")
    for b in blocking:
        print(f"  - {b}")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
