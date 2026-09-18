from . import business_context  # noqa: F401
from . import query_dataset  # noqa: F401
from . import create_chart  # noqa: F401
from . import chart_option  # noqa: F401
from . import forecast  # noqa: F401
from . import dashboard_filters  # noqa: F401
from . import column_values  # noqa: F401
from . import dashboard_dataset_context  # noqa: F401
from . import query_context  # noqa: F401
from . import search_dashboards  # noqa: F401
from . import compare_periods  # noqa: F401
from . import export_excel  # noqa: F401
from . import sql_analysis  # noqa: F401
from . import rank_partitions  # noqa: F401
from . import sql_schema_context  # noqa: F401
from .auth_bridge import install_auth_bridge

install_auth_bridge()
print("Irex MCP Tools extension registered")