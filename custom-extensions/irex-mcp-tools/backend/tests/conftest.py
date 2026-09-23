"""Carga el parser SQL REAL de Superset antes de que cualquier test
reemplace `sys.modules["superset"]` por un stub. `_sql_safety` lo importa
de forma diferida (`from superset.sql.parse import SQLScript`) y, como
`superset.sql.parse` ya queda cacheado en `sys.modules`, la importación
resuelve al módulo real aunque el paquete `superset` esté stubbeado — así
la validación de solo-lectura se prueba contra el parser de verdad, no
contra un doble.
"""

import superset.sql.parse  # noqa: F401
