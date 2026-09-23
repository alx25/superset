# REST API del asistente de SQL Lab (Fase 6). Va PRIMERO y aislada:
# - En el servicio web (gunicorn), el PYTHONPATH de la unidad systemd incluye
#   `$SUPERSET_DIR/superset`, así que `superset/key_value/` tapa al paquete
#   pip `key_value` que necesita fastmcp. Superset se salta la inyección del
#   decorador MCP y el primer `@tool` de abajo lanza "MCP tool decorator not
#   initialized", lo que aborta el resto de este archivo (pasa desde
#   2026-09-18; el web no usa las tools, así que no se notaba). Si la API
#   fuera al final, nunca se registraría en el web.
# - A la vez, un fallo de la API HTTP no debe dejar sin tools al proceso MCP.
try:
    from . import assistant_api  # noqa: F401
except Exception:  # noqa: BLE001
    import logging

    logging.getLogger(__name__).exception(
        "irex: no se pudo registrar la REST API del asistente de SQL Lab; "
        "el panel usará el proxy /api/chat-widget como fallback"
    )

from . import business_context  # noqa: F401,E402
from . import query_dataset  # noqa: F401,E402
from . import create_chart  # noqa: F401,E402
from . import chart_option  # noqa: F401,E402
from . import forecast  # noqa: F401,E402
from . import dashboard_filters  # noqa: F401,E402
from . import column_values  # noqa: F401,E402
from . import dashboard_dataset_context  # noqa: F401,E402
from . import query_context  # noqa: F401,E402
from . import search_dashboards  # noqa: F401,E402
from . import compare_periods  # noqa: F401,E402
from . import export_excel  # noqa: F401,E402
from . import sql_analysis  # noqa: F401,E402
from . import rank_partitions  # noqa: F401,E402
from . import sql_schema_context  # noqa: F401,E402
from . import explain_query  # noqa: F401,E402
from . import check_query_nulls  # noqa: F401,E402
from .auth_bridge import install_auth_bridge  # noqa: E402

install_auth_bridge()
print("Irex MCP Tools extension registered")
