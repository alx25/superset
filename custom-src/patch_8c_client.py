#!/usr/bin/env python3
"""
Patch script for superset/charts/client_processing.py
Adds pivot_table_rx1 post-processor with:
  - Formula metrics included in pivot output
  - Original row order preserved (respects Sort rows by)
"""
import json
import sys

if len(sys.argv) < 2:
    print("Usage: patch_8c_client.py <path_to_client_processing.py>")
    sys.exit(1)

f = sys.argv[1]
with open(f) as fh:
    c = fh.read()

if '"pivot_table_rx1": pivot_table_rx1' in c:
    print("  [skip] already patched")
    sys.exit(0)

PIVOT_TABLE_RX1_FUNC = '''

def pivot_table_rx1(
    df,
    form_data,
    datasource=None,
):
    """Post-processor for pivot_table_rx1.

    Extends pivot_table_v2 with:
    - Visible formula metrics included in the pivot output.
    - Original row order (Sort rows by) preserved after pivoting.
    """
    import json as _json

    verbose_map = datasource.data["verbose_map"] if datasource else None
    base_metrics = get_metric_names(form_data.get("metrics", []), verbose_map)

    raw_formulas = form_data.get("metricFormulas") or []
    if isinstance(raw_formulas, str):
        try:
            raw_formulas = _json.loads(raw_formulas)
        except Exception:  # noqa: BLE001
            raw_formulas = []

    formula_metric_labels = [
        str(f.get("label") or "").strip()
        for f in raw_formulas
        if isinstance(f, dict)
        and not f.get("hidden")
        and str(f.get("label") or "").strip()
        and str(f.get("label") or "").strip() in df.columns
    ]

    all_metrics = base_metrics + [m for m in formula_metric_labels if m not in base_metrics]

    rows = get_column_names(form_data.get("groupbyRows"), verbose_map)
    columns = get_column_names(form_data.get("groupbyColumns"), verbose_map)

    # Capture original row order before pivoting (preserves Sort rows by)
    original_row_order = []
    if rows:
        seen = set()
        if len(rows) == 1:
            for val in df[rows[0]]:
                if val not in seen:
                    seen.add(val)
                    original_row_order.append(val)
        else:
            for val in df[rows].itertuples(index=False, name=None):
                if val not in seen:
                    seen.add(val)
                    original_row_order.append(val)

    result = pivot_df(
        df,
        rows=rows,
        columns=columns,
        metrics=all_metrics,
        aggfunc=form_data.get("aggregateFunction", "Sum"),
        transpose_pivot=bool(form_data.get("transposePivot")),
        combine_metrics=bool(form_data.get("combineMetric")),
        show_rows_total=bool(form_data.get("rowTotals")),
        show_columns_total=bool(form_data.get("colTotals")),
        apply_metrics_on_rows=form_data.get("metricsLayout") == "ROWS",
    )

    # Restore original row order
    if original_row_order and rows and not result.empty:
        try:
            existing = set(result.index.tolist())
            reindex = [v for v in original_row_order if v in existing]
            reindex += [v for v in result.index if v not in set(reindex)]
            if len(reindex) == len(result):
                result = result.loc[reindex]
        except Exception:  # noqa: BLE001
            pass

    return result

'''

# Insert before post_processors dict and update registry
anchor = "\npost_processors = {"
if anchor in c:
    c = c.replace(anchor, PIVOT_TABLE_RX1_FUNC + anchor, 1)
    c = c.replace(
        '"pivot_table_v2": pivot_table_v2,',
        '"pivot_table_v2": pivot_table_v2,\n    "pivot_table_rx1": pivot_table_rx1,',
        1,
    )
    with open(f, "w") as fh:
        fh.write(c)
    print("  [ok] 8c client_processing.py: pivot_table_rx1 con post-processor propio")
else:
    print("  [warn] 8c: patrón post_processors no encontrado.")
    print("         Revisar manualmente comparando con custom-src/backend/client_processing.py")
