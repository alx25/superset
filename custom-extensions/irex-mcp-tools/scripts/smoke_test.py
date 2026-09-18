#!/usr/bin/env python3
"""Smoke test: confirma que un .supx carga sin errores dentro de un app
context real de Superset, sin necesidad de levantar el servidor ni el
navegador. Detecta lo que build-extension.sh no puede ver por sí solo:
manifest inválido, remoteEntry ausente del zip, o errores de import en el
backend al registrarse.

Uso:
  SUPERSET_CONFIG_PATH=<config.py> \
  PYTHONPATH=<superset_dir>:<superset_dir>/superset \
  <superset_dir>/.venv/bin/python3 scripts/smoke_test.py <ruta.supx>

Ejemplo (entorno de test, ver COMPATIBILITY.md):
  SUPERSET_CONFIG_PATH=/home/imercados/superset_proyecto/superset_config_test.py \
  PYTHONPATH=/home/imercados/superset_proyecto/superset_v6_1_0:/home/imercados/superset_proyecto/superset_v6_1_0/superset \
  /home/imercados/superset_proyecto/superset_v6_1_0/.venv/bin/python3 scripts/smoke_test.py \
    /home/imercados/superset_proyecto/extensions_test/irex-mcp-tools-0.1.0.supx
"""
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Uso: {sys.argv[0]} <ruta.supx>", file=sys.stderr)
        return 1

    supx_path = Path(sys.argv[1]).resolve()
    if not supx_path.is_file():
        print(f"No existe: {supx_path}", file=sys.stderr)
        return 1

    from superset.app import create_app

    app = create_app()
    with app.app_context():
        from superset.extensions.discovery import discover_and_load_extensions

        extensions = list(discover_and_load_extensions(str(supx_path.parent)))
        matches = [e for e in extensions if e.id == "irex.irex-mcp-tools"]
        if not matches:
            print(
                "FALLO: no se encontró la extensión irex.irex-mcp-tools "
                f"en {supx_path.parent}",
                file=sys.stderr,
            )
            return 1

        ext = matches[0]
        remote_entry = ext.manifest.frontend.remoteEntry if ext.manifest.frontend else None
        if not remote_entry or remote_entry not in ext.frontend:
            print(
                f"FALLO: manifest.frontend.remoteEntry={remote_entry!r} no está "
                "entre los archivos de frontend empaquetados: "
                f"{list(ext.frontend.keys())}",
                file=sys.stderr,
            )
            return 1

        expected_tools = 14
        if len(ext.backend) < expected_tools:
            print(
                f"AVISO: se esperaban al menos {expected_tools} archivos backend, "
                f"se encontraron {len(ext.backend)}.",
                file=sys.stderr,
            )

        print(f"OK: {ext.id} — {len(ext.frontend)} archivos frontend, "
              f"{len(ext.backend)} archivos backend, remoteEntry={remote_entry}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
