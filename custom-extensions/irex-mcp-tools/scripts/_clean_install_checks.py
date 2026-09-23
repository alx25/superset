"""Verificaciones dentro de un Superset LIMPIO (lo invoca
check_clean_install.sh). Solo en este proceso: autentica por el header
X-IT-User vía request_loader, porque no se conocen las contraseñas."""
import json, sys
from superset.app import create_app
app = create_app(); res = []
def check(label, ok, detail=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + label + (f"  [{detail}]" if detail else ""))
ctx = app.app_context(); ctx.push()
from superset import security_manager
@app.login_manager.request_loader
def _l(req):
    n = req.headers.get("X-IT-User"); return security_manager.find_user(username=n) if n else None
from superset.extensions.utils import get_extensions
exts = get_extensions()
check("extensión cargada desde EXTENSIONS_PATH", "irex.irex-mcp-tools" in exts, ",".join(exts))
check("backend: módulo assistant_api", "irex.irex_mcp_tools.assistant_api" in sys.modules)
check("backend: entrypoint completo (auth_bridge)", "irex.irex_mcp_tools.auth_bridge" in sys.modules)
from superset.mcp_service.app import mcp
import asyncio
names = [t.name for t in asyncio.run(mcp.list_tools())] if hasattr(mcp, "list_tools") else []
irex = sorted(n.split(".")[-1] for n in names if "irex-mcp-tools" in n)
check("MCP: 17 tools irex registradas", len(irex) == 17, str(len(irex)))
view = security_manager.find_view_menu("IrexSqlLabAssistant")
check("vista propia sin permisos", view is not None and not security_manager.find_permissions_view_menu(view))
ctx.pop()
c = app.test_client()
r = c.get("/api/v1/extensions/", headers={"X-IT-User": "admin"})
body = r.get_json() or {}
items = body.get("result", [])
check("/api/v1/extensions/ lista la extensión", r.status_code == 200 and any("irex" in json.dumps(i) for i in items), str(r.status_code))
remote = next((i.get("remoteEntry") for i in items if "irex" in json.dumps(i)), None)
entry_url = remote
if entry_url:
    rr = c.get(entry_url, headers={"X-IT-User": "admin"})
    check("frontend: remoteEntry servido", rr.status_code == 200 and b"irex_irexMcpTools" in rr.get_data(), f"{entry_url} {rr.status_code}")
else:
    check("frontend: remoteEntry en el listado", False, json.dumps(items)[:200])
URL = "/extensions/irex/irex-mcp-tools/assistant/sql-lab"
tok = c.get("/api/v1/security/csrf_token/", headers={"X-IT-User": "admin"}).get_json()["result"]
r = c.post(URL, data="{}", headers={"X-IT-User": "admin", "Content-Type": "application/json", "X-CSRFToken": tok})
check("API admin sin CHAT_WIDGET_API_URL → 503 explícito", r.status_code == 503, f"{r.status_code} {r.get_data()[:80]}")
g = app.test_client()
gt = g.get("/api/v1/security/csrf_token/", headers={"X-IT-User": "gamma"})
app.config["WTF_CSRF_ENABLED"] = False
r = g.post(URL, data="{}", headers={"X-IT-User": "gamma", "Content-Type": "application/json"})
app.config["WTF_CSRF_ENABLED"] = True
check("API Gamma (sin SQL Lab) → 403", r.status_code == 403, str(r.status_code))
r = c.get("/sqllab/", headers={"X-IT-User": "admin"})
check("SQL Lab abre", r.status_code == 200, str(r.status_code))
print(f"\n{sum(res)}/{len(res)} PASS")
sys.exit(0 if all(res) else 1)
