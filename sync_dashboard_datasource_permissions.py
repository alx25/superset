"""Sincroniza permisos de datasource con el RBAC de dashboards existente.

Para cada rol que tenga acceso explícito a uno o más dashboards (RBAC de
"Acceso" en las propiedades del dashboard), otorga el permiso
`datasource access on [...]` sobre los datasets que usan los charts de
ESOS MISMOS dashboards. No otorga acceso a nada que el rol no pudiera ya
ver en pantalla — solo destraba la consulta de esos mismos datos vía
API/MCP (incluyendo el chat), que es un permiso separado del RBAC de
dashboard en Superset.

Idempotente: correrlo de nuevo no duplica permisos ya otorgados. Volver a
correrlo cada vez que se cree un dashboard o rol nuevo con RBAC de acceso.

Uso:
    set -a; source .env_superset; set +a
    SUPERSET_CONFIG_PATH=/path/to/superset_config.py .venv/bin/python \
        sync_dashboard_datasource_permissions.py [--dry-run]
"""

import sys
from collections import Counter

sys.path.insert(0, "/home/imercados/superset_proyecto/superset_v6_1_0")
from superset.app import create_app  # noqa: E402

app = create_app()
with app.app_context():
    from superset.extensions import security_manager, db
    from superset.models.dashboard import Dashboard
    from superset.connectors.sqla.models import SqlaTable

    dry_run = "--dry-run" in sys.argv

    dashboards = db.session.query(Dashboard).filter(Dashboard.roles.any()).all()

    role_to_datasets: dict[str, set[int]] = {}
    for dash in dashboards:
        dataset_ids = {s.datasource_id for s in dash.slices if s.datasource_id}
        for role in dash.roles:
            role_to_datasets.setdefault(role.name, set()).update(dataset_ids)

    all_access_pv = security_manager.find_permission_view_menu(
        "all_datasource_access", "all_datasource_access"
    )

    granted = 0
    skipped_existing = 0
    skipped_no_dataset = 0

    for role_name, dataset_ids in sorted(role_to_datasets.items()):
        role = security_manager.find_role(role_name)
        if role is None:
            continue
        if all_access_pv in role.permissions:
            print(f"[skip] '{role_name}' ya tiene all_datasource_access")
            continue

        for dataset_id in sorted(dataset_ids):
            dataset = db.session.query(SqlaTable).filter_by(id=dataset_id).first()
            if dataset is None:
                skipped_no_dataset += 1
                continue

            view_menu_name = dataset.perm  # "[db].[schema].[table](id:N)"
            pv = security_manager.find_permission_view_menu(
                "datasource_access", view_menu_name
            )
            if pv is None:
                pv = security_manager.add_permission_view_menu(
                    "datasource_access", view_menu_name
                )

            if pv in role.permissions:
                skipped_existing += 1
                continue

            action = "otorgaría" if dry_run else "otorgado"
            print(
                f"[{action}] '{role_name}' -> datasource_access on "
                f"'{dataset.table_name}' (dataset {dataset_id})"
            )
            if not dry_run:
                security_manager.add_permission_role(role, pv)
            granted += 1

    if not dry_run:
        db.session.commit()

    print(
        f"\nResumen: {granted} permisos {'a otorgar (dry-run)' if dry_run else 'otorgados'}, "
        f"{skipped_existing} ya existían, {skipped_no_dataset} datasets no encontrados."
    )
