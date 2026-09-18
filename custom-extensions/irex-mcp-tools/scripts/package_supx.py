#!/usr/bin/env python3
"""Empaqueta irex-mcp-tools en un .supx reproducible.

Reconstruye el zip desde cero (nunca `zip -u`, que puede conservar archivos
obsoletos): manifest.json generado a partir de extension.json + el hash real
de remoteEntry, todo backend/src/*.py, y frontend/dist/* (excluyendo
map/licence files). Ver COMPATIBILITY.md para por qué este script existe en
vez de `superset-extensions bundle`.
"""
import json
import sys
import zipfile
from pathlib import Path

EXT_ROOT = Path(__file__).resolve().parent.parent
EXTENSION_JSON = EXT_ROOT / "extension.json"
BACKEND_SRC = EXT_ROOT / "backend" / "src" / "irex" / "irex_mcp_tools"
FRONTEND_DIST = EXT_ROOT / "frontend" / "dist"


def find_remote_entry() -> str:
    matches = sorted(FRONTEND_DIST.glob("remoteEntry.*.js"))
    if not matches:
        raise SystemExit(
            f"No se encontró remoteEntry.*.js en {FRONTEND_DIST}. "
            "Corré 'npm run build' en frontend/ antes de empaquetar."
        )
    if len(matches) > 1:
        raise SystemExit(
            f"Hay más de un remoteEntry.*.js en {FRONTEND_DIST} "
            "(¿dist/ no se limpió entre builds?): "
            f"{[m.name for m in matches]}"
        )
    return matches[0].name


def build_manifest(remote_entry: str) -> dict:
    ext = json.loads(EXTENSION_JSON.read_text())
    return {
        "publisher": ext["publisher"],
        "name": ext["name"],
        "displayName": ext["displayName"],
        "version": ext["version"],
        "dependencies": [],
        "permissions": ext.get("permissions", []),
        "id": f"{ext['publisher']}.{ext['name']}",
        "frontend": {
            "remoteEntry": remote_entry,
            "moduleFederationName": "irex_irexMcpTools",
        },
        "backend": {
            "entrypoint": "irex.irex_mcp_tools.entrypoint",
        },
    }


def package(out_path: Path) -> None:
    remote_entry = find_remote_entry()
    manifest = build_manifest(remote_entry)

    backend_files = sorted(BACKEND_SRC.glob("*.py"))
    if not backend_files:
        raise SystemExit(f"No se encontraron .py en {BACKEND_SRC}")

    frontend_files = sorted(
        f for f in FRONTEND_DIST.iterdir() if f.is_file() and f.suffix == ".js"
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        for f in backend_files:
            zf.write(f, f"backend/src/irex/irex_mcp_tools/{f.name}")
        for f in frontend_files:
            zf.write(f, f"frontend/dist/{f.name}")

    print(f"Empaquetado: {out_path}")
    with zipfile.ZipFile(out_path) as zf:
        for name in sorted(zf.namelist()):
            print(" -", name)


def validate(supx_path: Path) -> None:
    """Valida manifest.json y que las rutas internas sigan el patrón esperado
    por superset/extensions/utils.py (FRONTEND_REGEX/BACKEND_REGEX)."""
    with zipfile.ZipFile(supx_path) as zf:
        names = zf.namelist()
        if "manifest.json" not in names:
            raise SystemExit("Falta manifest.json en el .supx")
        manifest = json.loads(zf.read("manifest.json"))
        for required in ("id", "publisher", "name", "frontend", "backend"):
            if required not in manifest:
                raise SystemExit(f"manifest.json sin campo requerido: {required}")

        remote_entry = manifest["frontend"]["remoteEntry"]
        if f"frontend/dist/{remote_entry}" not in names:
            raise SystemExit(
                f"manifest.frontend.remoteEntry={remote_entry!r} no está en el "
                "zip bajo frontend/dist/ — el bundle quedaría roto en runtime."
            )

        for name in names:
            if name == "manifest.json":
                continue
            if not (
                name.startswith("backend/src/") or name.startswith("frontend/dist/")
            ):
                raise SystemExit(f"Ruta inesperada dentro del .supx: {name}")

    print("Validación OK:", supx_path)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(f"Uso: {sys.argv[0]} <ruta_salida.supx>")
    target = Path(sys.argv[1]).resolve()
    package(target)
    validate(target)
