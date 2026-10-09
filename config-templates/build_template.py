#!/usr/bin/env python3
"""Genera `superset_config.template.py` a partir del superset_config.py REAL
de producción, sin secretos ni datos propios del servidor.

Por qué: la config de producción vive fuera del repo
(/home/imercados/.superset/superset_config.py) y es la que define casi todo
(MCP, widget de chat, tema, caches, Celery, extensiones). Un servidor nuevo
no puede reconstruirla. Esta plantilla es esa misma config, con:

- secretos leídos de variables de entorno (sin valor por defecto: si falta
  uno, Superset no arranca, en vez de arrancar con un secreto conocido);
- URLs/rutas propias del servidor leídas de variables de entorno;
- los pocos valores que en este servidor viven en superset/config.py (núcleo)
  y la config de producción no redefine — así el núcleo puede quedar como el
  de Superset más los parches de migrate-plugins.sh.

Uso (mantenimiento, en este servidor):
  python3 config-templates/build_template.py \
      /home/imercados/.superset/superset_config.py \
      superset_v6_1_0/superset/config.py
Falla si después de transformar queda algún secreto conocido en el texto.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "superset_config.template.py"

# nombre -> (variable de entorno, obligatoria)
SECRETS = {
    "GLOBAL_ASYNC_QUERIES_JWT_SECRET": "SUPERSET_GLOBAL_ASYNC_QUERIES_JWT_SECRET",
    "MCP_JWT_SECRET": "IREX_MCP_JWT_SECRET",
    "CHAT_BACKEND_SECRET": "IREX_CHAT_BACKEND_SECRET",
}
SERVER_VALUES = {
    "CHAT_WIDGET_URL": "IREX_CHAT_WIDGET_URL",
    "CHAT_WIDGET_API_URL": "IREX_CHAT_WIDGET_API_URL",
    "MCP_WIDGET_URL": "IREX_MCP_WIDGET_URL",
    "WEBDRIVER_BASEURL_USER_FRIENDLY": "SUPERSET_WEBDRIVER_BASEURL_USER_FRIENDLY",
    "EXTENSIONS_PATH": "IREX_EXTENSIONS_PATH",
    "MCP_EXPORT_BASE_URL": "IREX_MCP_EXPORT_BASE_URL",
}
# Definidos en superset/config.py de este servidor y no en la config de prod.
FROM_CORE = ["SupersetDashboardIndexView", "FAB_INDEX_VIEW", "MCP_DEV_USERNAME"]

HEADER = '''# --------------------------------------------------------------------------
# superset_config.py — plantilla irex, GENERADA por config-templates/build_template.py
# a partir de la config real de producción. No editar a mano: editar la config
# de producción y regenerar. Secretos y datos del servidor: variables de entorno
# (ver config-templates/superset.env.example).
# --------------------------------------------------------------------------
import os as _irex_os


def _irex_env(name: str) -> str:
    value = _irex_os.environ.get(name)
    if not value:
        raise RuntimeError(f"Falta la variable de entorno {name} (ver config-templates/superset.env.example)")
    return value


'''


def _top_level_assign_line(source: str, name: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(name)}(\s*:[^=\n]+)?\s*=\s*(?P<value>.+?)\s*(#.*)?$", re.M)


def transform(prod_source: str) -> tuple[str, list[str]]:
    secrets_found: list[str] = []
    out = prod_source
    for name, env in {**SECRETS, **SERVER_VALUES}.items():
        pattern = _top_level_assign_line(out, name)
        matches = list(pattern.finditer(out))
        if len(matches) != 1:
            raise SystemExit(f"[error] {name}: se esperaba 1 asignación de nivel superior, hay {len(matches)}")
        match = matches[0]
        literal = ast.literal_eval(match.group("value"))
        if name in SECRETS:
            secrets_found.append(literal)
        annotation = match.group(1) or ""
        out = out[: match.start()] + f'{name}{annotation} = _irex_env("{env}")' + out[match.end():]

    db = re.compile(r'^SQLALCHEMY_DATABASE_URI = os\.environ\.get\("SUPERSET_DB_URI"\) or .+$', re.M)
    if len(db.findall(out)) != 1:
        raise SystemExit("[error] SQLALCHEMY_DATABASE_URI: formato inesperado")
    secrets_found.append(re.search(r"'([^']+)'", db.search(out).group(0)).group(1))
    out = db.sub('SQLALCHEMY_DATABASE_URI = _irex_env("SUPERSET_DB_URI")', out)
    return out, secrets_found


def core_block(core_source: str) -> str:
    tree = ast.parse(core_source)
    lines = core_source.splitlines()
    parts = []
    for node in tree.body:
        names = []
        if isinstance(node, ast.ClassDef):
            names = [node.name]
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names = [ast.unparse(t) for t in targets]
        if any(n in FROM_CORE for n in names):
            parts.append("\n".join(lines[node.lineno - 1 : node.end_lineno]))
    found = " ".join(parts)
    missing = [n for n in FROM_CORE if n not in found]
    if missing:
        raise SystemExit(f"[error] no se encontraron en superset/config.py: {missing}")
    return (
        "\n\n# --- Valores que en el servidor original estaban en superset/config.py (núcleo) ---\n"
        "from flask import redirect  # noqa: E402\n"
        "from flask_appbuilder import expose, IndexView  # noqa: E402\n"
        "from superset.superset_typing import FlaskResponse  # noqa: E402\n\n\n"
        + "\n\n\n".join(parts)
        + "\n"
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__)
        return 2
    prod_source = Path(argv[0]).read_text()
    core_source = Path(argv[1]).read_text()
    body, secrets = transform(prod_source)
    # El helper va después de los `from __future__`, que deben ir primero.
    future = list(re.finditer(r"^from __future__ import .+$", body, re.M))
    cut = future[-1].end() + 1 if future else 0
    result = body[:cut] + "\n" + HEADER + body[cut:].rstrip() + "\n" + core_block(core_source)
    leaked = [s for s in secrets if s and s in result]
    if leaked:
        print(f"[error] quedaron {len(leaked)} secretos en la plantilla")
        return 1
    compile(result, str(OUT), "exec")
    OUT.write_text(result)
    print(f"[ok] {OUT} ({len(result.splitlines())} líneas, {len(secrets)} secretos reemplazados por variables de entorno)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
