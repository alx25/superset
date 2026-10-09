#!/usr/bin/env python3
"""Overlay de archivos completos de Superset para migrate-plugins.sh.

Para archivos de Superset que irex modifica sin un paso de parche propio, se
guarda la versión personalizada completa en `files/<ruta>` y, en
`manifest.json`, el sha256 del original de la versión de Superset para la que
se armó (`upstream_sha256`) y el de la copia (`overlay_sha256`).

`apply` NUNCA pisa a ciegas: copia solo si el archivo destino es exactamente
el original esperado; si ya es la copia, no hace nada; si es otra cosa (otra
versión de Superset, o un cambio local), falla y lo lista — en ese caso hay
que portar el cambio a mano.

Uso:
  overlay.py build <superset_dir> <tag>   # mantenimiento: regenera files/ y manifest.json
  overlay.py apply <superset_dir>         # instala (lo llama migrate-plugins.sh)
  overlay.py check <superset_dir>         # verifica que todo esté aplicado
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES_DIR = HERE / "files"
MANIFEST = HERE / "manifest.json"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def listed_files() -> list[str]:
    lines = (HERE / "FILES").read_text().splitlines()
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def build(superset_dir: Path, tag: str) -> int:
    entries = {}
    for rel in listed_files():
        current = (superset_dir / rel).read_bytes()
        upstream = subprocess.run(
            ["git", "-C", str(superset_dir), "show", f"{tag}:{rel}"],
            check=True, capture_output=True,
        ).stdout
        if current == upstream:
            print(f"  [error] {rel}: igual al original de {tag}, no es una personalización")
            return 1
        dest = FILES_DIR / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(current)
        entries[rel] = {"upstream_sha256": sha256(upstream), "overlay_sha256": sha256(current)}
    MANIFEST.write_text(json.dumps({"superset_version": tag, "files": entries}, indent=2) + "\n")
    print(f"  manifest: {len(entries)} archivos para Superset {tag}")
    return 0


def _status(target: Path, rel: str, entry: dict) -> str:
    path = target / rel
    if not path.is_file():
        return "missing"
    digest = sha256(path.read_bytes())
    if digest == entry["overlay_sha256"]:
        return "applied"
    if digest == entry["upstream_sha256"]:
        return "pristine"
    return "conflict"


def apply(target: Path, *, check_only: bool) -> int:
    manifest = json.loads(MANIFEST.read_text())
    failures = 0
    for rel, entry in manifest["files"].items():
        status = _status(target, rel, entry)
        if status == "applied":
            print(f"  [ok] {rel}")
        elif status == "pristine" and not check_only:
            overlay = FILES_DIR / rel
            if sha256(overlay.read_bytes()) != entry["overlay_sha256"]:
                print(f"  [error] {rel}: files/ no coincide con manifest.json (correr build)")
                failures += 1
                continue
            shutil.copyfile(overlay, target / rel)
            print(f"  [ok] {rel} (instalado)")
        else:
            reason = {
                "pristine": "sin aplicar",
                "missing": "no existe en el destino",
                "conflict": f"no es el original de Superset {manifest['superset_version']} ni la copia irex: portar a mano",
            }[status]
            print(f"  [error] {rel}: {reason}")
            failures += 1
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[0] == "build":
        return build(Path(argv[1]), argv[2])
    if len(argv) == 2 and argv[0] in {"apply", "check"}:
        return apply(Path(argv[1]), check_only=argv[0] == "check")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
