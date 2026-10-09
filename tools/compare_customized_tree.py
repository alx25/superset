"""Compara un Superset limpio + migrate-plugins.sh contra el árbol de referencia.

Uso: compare_customized_tree.py <arbol_referencia> <arbol_instalado> <tag>
Recorre todos los archivos que el árbol de referencia cambia respecto del tag
oficial (git diff --name-status <tag> HEAD) más los estáticos ignorados por git,
y sale con error si alguno difiere y no está en ACCEPTED (diferencias revisadas
a mano, con su motivo).
"""
import filecmp, os, subprocess, sys
A, B, TAG = sys.argv[1], sys.argv[2], sys.argv[3]

ACCEPTED = {
    "superset/config.py": "valores del entorno movidos a config-templates/ (verificado por build_template.py)",
    "superset/charts/client_processing.py": "mismo código; solo orden de funciones y anotaciones de tipo",
    "superset/charts/schemas.py": "mismos campos; solo el texto de las descripciones",
    "superset/mcp_service/middleware.py": "solo formato (mismo AST)",
    "superset-frontend/packages/superset-ui-core/src/chart/types/VizType.ts": "mismo enum, otro orden",
    "superset-frontend/packages/superset-ui-core/src/index.ts": "una línea en blanco",
    "superset-frontend/webpack.config.js": "solo el texto de un comentario",
    "superset-frontend/package-lock.json": "lo regenera npm install",
    "=0.13.0": "basura de un pip install mal escrito, no se instala",
    "scripts/mcp_list_dashboards.py": "script de desarrollo, no se instala",
    "irex-mcp-tools": "symlink de desarrollo a custom-extensions/; la extensión se instala como .supx",
    "superset/static/video_superset/Presentacion Superset.mp4": "90 MB, copia manual documentada",
}
SKIP = {"node_modules", "lib", "esm", "__pycache__", ".swc", "dist", "tsconfig.tsbuildinfo", "coverage"}
delta = subprocess.run(["git", "-C", A, "diff", "--name-status", TAG, "HEAD"], check=True, capture_output=True, text=True).stdout
paths = [l.split("\t", 1)[1].strip() for l in delta.splitlines() if l.strip()]
paths += ["superset/static/custom_spinner", "superset/static/customcss", "superset/static/js_personal", "superset/static/video_superset"]
def kind(p):
    if os.path.islink(p): return "link"
    if os.path.isdir(p): return "dir"
    if os.path.isfile(p): return "file"
    return "missing"
res = {"ok": [], "diff": [], "missing_in_clean": [], "type": []}
def cmp(rel):
    a, b = os.path.join(A, rel), os.path.join(B, rel)
    ka, kb = kind(a), kind(b)
    if kb == "missing":
        res["missing_in_clean"].append(f"{rel} ({ka})"); return
    if ka == "link" or kb == "link":
        ta = os.path.realpath(a); tb = os.path.realpath(b)
        if ka != kb:
            res["type"].append(f"{rel}: actual={ka}->{os.readlink(a) if ka=='link' else ''} limpio={kb}->{os.readlink(b) if kb=='link' else ''}")
            # compara contenido de todos modos
        if ta == tb: res["ok"].append(rel); return
        a, b = ta, tb; ka, kb = kind(a), kind(b)
    if ka == "dir" and kb == "dir":
        for root, dirs, files in os.walk(a):
            dirs[:] = [d for d in dirs if d not in SKIP]
            for f in files:
                if f in SKIP or f.endswith(".pyc"): continue
                ra = os.path.join(root, f); rb = os.path.join(b, os.path.relpath(ra, a))
                if not os.path.exists(rb): res["missing_in_clean"].append(os.path.join(rel, os.path.relpath(ra, a)))
                elif not filecmp.cmp(ra, rb, shallow=False): res["diff"].append(os.path.join(rel, os.path.relpath(ra, a)))
        res["ok"].append(rel + "/ (recorrido)")
        return
    if ka == "file" and kb == "file":
        (res["ok"] if filecmp.cmp(a, b, shallow=False) else res["diff"]).append(rel); return
    res["type"].append(f"{rel}: actual={ka} limpio={kb}")
for p in paths: cmp(p)
def key(entry):
    return entry.split(" (")[0].split(":")[0]
problems = 0
for k in ("diff", "missing_in_clean", "type"):
    for x in res[k]:
        reason = ACCEPTED.get(key(x))
        if reason:
            print(f"  [aceptado] {x}: {reason}")
        else:
            print(f"  [ERROR] {k}: {x}")
            problems += 1
print(f"== {len(res['ok'])} rutas idénticas, {problems} diferencias no aceptadas")
sys.exit(1 if problems else 0)
