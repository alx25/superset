#!/usr/bin/env python3
"""
Patch script for superset/common/query_context_processor.py
Adds:
  - import ast, json
  - import numpy as np
  - All helper methods for CSV/Excel export with pivot_table_rx1 formula support
  - Updated get_data method
"""
import re
import sys

if len(sys.argv) < 2:
    print("Usage: patch_8b_qcp.py <path_to_query_context_processor.py>")
    sys.exit(1)

f = sys.argv[1]
with open(f) as fh:
    c = fh.read()

# Already patched?
if "_get_pivot_rx1_export_formulas" in c:
    print("  [skip] already patched")
    sys.exit(0)

# ── Add imports ──────────────────────────────────────────────────────────────
if "import ast" not in c:
    c = c.replace(
        "from __future__ import annotations\n",
        "from __future__ import annotations\n\nimport ast\n",
    )
if "import json" not in c:
    c = c.replace(
        "from __future__ import annotations\n",
        "from __future__ import annotations\n\nimport json\n",
    )
if "import numpy" not in c:
    c = re.sub(r"(import pandas as pd\n)", r"\1import numpy as np\n", c, count=1)

# ── New methods block (inserted before get_data) ─────────────────────────────
NEW_METHODS = (
    "\n"
    "    _SCOPED_REF_RE = re.compile(\n"
    '        r"\\b(?:total|row|col|previous|next)\\.\\{\\{", re.IGNORECASE\n'
    "    )\n"
    "\n"
    "    @staticmethod\n"
    "    def _export_is_blank(value) -> bool:\n"
    "        if value is None: return True\n"
    "        if isinstance(value, float) and np.isnan(value): return True\n"
    '        if isinstance(value, str) and value.strip() == "": return True\n'
    "        return False\n"
    "\n"
    "    @staticmethod\n"
    "    def _export_round(value, digits: int = 0) -> float:\n"
    "        try: return round(float(value), int(digits))\n"
    "        except Exception: return float('nan')  # noqa: BLE001\n"
    "\n"
    "    @staticmethod\n"
    "    def _validate_formula_ast(tree) -> None:\n"
    "        allowed = {ast.Expression,ast.BoolOp,ast.BinOp,ast.UnaryOp,ast.Compare,\n"
    "                   ast.Call,ast.Constant,ast.Name,ast.Load,ast.Add,ast.Sub,\n"
    "                   ast.Mult,ast.Div,ast.Mod,ast.Pow,ast.USub,ast.UAdd,ast.Not,\n"
    "                   ast.Eq,ast.NotEq,ast.Lt,ast.LtE,ast.Gt,ast.GtE,\n"
    "                   ast.And,ast.Or,ast.IfExp,ast.Tuple,ast.List,ast.Subscript,\n"
    "                   ast.Index,ast.Slice}\n"
    "        for node in ast.walk(tree):\n"
    "            if type(node) not in allowed:\n"
    '                raise ValueError(f"Disallowed AST node: {type(node).__name__}")\n'
    "\n"
    "    @staticmethod\n"
    "    def _build_formula_expression(expression: str, row) -> str:\n"
    "        import re as _re\n"
    '        logical_map = {r"\\bOR\\b":"__OR",r"\\bAND\\b":"__AND",r"\\bNOT\\b":"__NOT",\n'
    '                       r"\\bIF\\b":"__IF",r"\\bISBLANK\\b":"__ISBLANK",\n'
    '                       r"\\bABS\\b":"__ABS",r"\\bROUND\\b":"__ROUND",\n'
    '                       r"\\bMAX\\b":"__MAX",r"\\bMIN\\b":"__MIN"}\n'
    "        result = expression\n"
    "        for p, r in logical_map.items():\n"
    "            result = _re.sub(p, r, result)\n"
    "        for col, val in row.items():\n"
    "            if isinstance(val, str):\n"
    "                result = result.replace(f'{{{{{{col}}}}}}',"
    " f\"'{val.replace(chr(39), chr(92)+chr(39))}'\")\n"
    "            elif val is None:\n"
    "                result = result.replace(f'{{{{{{col}}}}}}}', 'None')\n"
    "            elif isinstance(val, float) and np.isnan(val):\n"
    "                result = result.replace(f'{{{{{{col}}}}}}}', 'NaN')\n"
    "            else:\n"
    "                result = result.replace(f'{{{{{{col}}}}}}}', str(val))\n"
    "        return result\n"
    "\n"
    "    @classmethod\n"
    "    def _evaluate_export_formula(cls, expression: str, row):\n"
    "        try:\n"
    '            compiled = cls._build_formula_expression(expression, row)\n'
    '            tree = ast.parse(compiled, mode="eval")\n'
    "            cls._validate_formula_ast(tree)\n"
    '            result = eval(compile(tree,"<table-export-formula>","eval"),{"__builtins__":{}},  # noqa: S307\n'
    '                {"__IF":lambda c,t,f:t if c else f,"__OR":lambda*a:any(a),\n'
    '                 "__AND":lambda*a:all(a),"__NOT":lambda v:not v,\n'
    '                 "__ISBLANK":cls._export_is_blank,"__ABS":abs,\n'
    '                 "__ROUND":cls._export_round,"__MAX":max,"__MIN":min,\n'
    '                 "True":True,"False":False,"None":None,"NaN":np.nan})\n'
    "            if result is None: return None\n"
    "            r = float(result)\n"
    "            return None if not np.isfinite(r) else r\n"
    "        except Exception: return None  # noqa: BLE001\n"
    "\n"
    "    @classmethod\n"
    "    def _apply_export_calculated_columns(cls, df, coltypes, calculated_columns):\n"
    "        if not calculated_columns: return df, coltypes\n"
    "        result_df, result_ct, seen = df.copy(), list(coltypes), set(df.columns)\n"
    "        for item in calculated_columns:\n"
    '            label = str(item.get("label","")).strip()\n'
    '            expression = str(item.get("expression","")).strip()\n'
    "            if not label or not expression or label in seen: continue\n"
    "            result_df[label] = result_df.apply(\n"
    "                lambda row, expr=expression: cls._evaluate_export_formula(expr, row.to_dict()), axis=1)\n"
    "            seen.add(label); result_ct.append(GenericDataType.NUMERIC)\n"
    "        return result_df, result_ct\n"
    "\n"
    "    @staticmethod\n"
    "    def _apply_export_column_order(df, coltypes, preferred_order):\n"
    "        if not preferred_order: return df, coltypes\n"
    "        current = list(df.columns)\n"
    "        seen, ordered = set(), []\n"
    "        for col in preferred_order:\n"
    "            if col in df.columns and col not in seen:\n"
    "                seen.add(col); ordered.append(col)\n"
    "        ordered.extend([c for c in current if c not in seen])\n"
    "        ct_map = {c: coltypes[i] for i, c in enumerate(current) if i < len(coltypes)}\n"
    "        return df.loc[:, ordered], [ct_map.get(c, GenericDataType.STRING) for c in ordered]\n"
    "\n"
    "    @staticmethod\n"
    "    def _evaluate_pivot_formula_for_row(expression, row_dict, col_totals, prev_values):\n"
    "        import re as _re\n"
    '        _SCOPE = _re.compile(r"\\b(col|row|total|previous|next)\\.\\{\\{([^}]+)\\}\\}")\n'
    "        def _scope(m):\n"
    "            scope, name = m.group(1), m.group(2).strip()\n"
    '            val = col_totals.get(name) if scope in ("col","row","total") else prev_values.get(name, 0) if scope == "previous" else None\n'
    '            if scope == "next": return "NaN"\n'
    '            if val is None: return "0"\n'
    "            try:\n"
    "                fv = float(val)\n"
    '                return "NaN" if not np.isfinite(fv) else str(fv)\n'
    "            except Exception: return 'NaN'  # noqa: BLE001\n"
    "        expr = _SCOPE.sub(_scope, expression)\n"
    "        for col_name, val in sorted(row_dict.items(), key=lambda kv: -len(kv[0])):\n"
    '            ph = "{{" + col_name + "}}"\n'
    "            if ph not in expr: continue\n"
    '            if val is None: expr = expr.replace(ph, "None")\n'
    '            elif isinstance(val, float) and np.isnan(val): expr = expr.replace(ph, "NaN")\n'
    "            elif isinstance(val, str):\n"
    "                expr = expr.replace(ph, f\"'{val.replace(chr(39), chr(92)+chr(39))}'\")\n"
    "            else: expr = expr.replace(ph, str(val))\n"
    "        try:\n"
    '            tree = ast.parse(expr, mode="eval")\n'
    '            result = eval(compile(tree,"<pivot-export-formula>","eval"),{"__builtins__":{}},  # noqa: S307\n'
    '                {"NaN":np.nan,"None":None,"True":True,"False":False,\n'
    '                 "__IF":lambda c,t,f:t if c else f,"__OR":lambda*a:any(a),\n'
    '                 "__AND":lambda*a:all(a),"__NOT":lambda v:not v,\n'
    '                 "__ISBLANK":lambda v:v is None or (isinstance(v,float) and np.isnan(v)) or str(v).strip()=="",\n'
    '                 "__ABS":abs,"__ROUND":round,"__MAX":max,"__MIN":min})\n'
    "            if result is None: return None\n"
    "            r = float(result)\n"
    "            return None if not np.isfinite(r) else r\n"
    "        except Exception: return None  # noqa: BLE001\n"
    "\n"
    "    def _apply_pivot_rx1_formulas(self, df, coltypes, formulas):\n"
    "        if not formulas or df.empty: return df, coltypes\n"
    "        result_df = df.copy(); result_ct = list(coltypes); col_totals = {}\n"
    "        for col in result_df.columns:\n"
    "            try: col_totals[col] = float(result_df[col].sum())\n"
    "            except Exception: col_totals[col] = float('nan')  # noqa: BLE001\n"
    "        for formula in formulas:\n"
    '            label, expression = formula["label"], formula["expression"]\n'
    "            values, prev_row_values = [], {}\n"
    "            for _, row in result_df.iterrows():\n"
    "                row_dict = row.to_dict()\n"
    "                val = self._evaluate_pivot_formula_for_row(expression, row_dict, col_totals, prev_row_values)\n"
    "                values.append(val)\n"
    "                prev_row_values = {**row_dict, label: val}\n"
    "            result_df[label] = values\n"
    "            try: col_totals[label] = float(result_df[label].sum())\n"
    "            except Exception: col_totals[label] = float('nan')  # noqa: BLE001\n"
    "            result_ct.append(GenericDataType.NUMERIC)\n"
    "        return result_df, result_ct\n"
    "\n"
    "    def _get_pivot_rx1_export_formulas(self):\n"
    "        form_data = self._query_context.form_data or {}\n"
    '        if form_data.get("viz_type") != "pivot_table_rx1": return [], []\n'
    "        def _parse(raw):\n"
    "            if isinstance(raw, list): return raw\n"
    "            if isinstance(raw, str):\n"
    "                try:\n"
    "                    p = json.loads(raw)\n"
    "                    return p if isinstance(p, list) else []\n"
    "                except Exception: return []  # noqa: BLE001\n"
    "            return []\n"
    "        formulas, hidden_labels = [], []\n"
    '        for item in _parse(form_data.get("metricFormulas")):\n'
    "            if not isinstance(item, dict): continue\n"
    '            label = str(item.get("label") or "").strip()\n'
    '            expression = str(item.get("expression") or "").strip()\n'
    "            if not label or not expression: continue\n"
    '            formulas.append({"label": label, "expression": expression})\n'
    '            if item.get("hidden"): hidden_labels.append(label)\n'
    "        exclude_labels = list(hidden_labels)\n"
    '        for item in _parse(form_data.get("jinjaFields") or form_data.get("jinja_fields")):\n'
    '            if isinstance(item, str): lbl = item.strip()\n'
    '            elif isinstance(item, dict): lbl = str(item.get("label") or item.get("metric_name") or "").strip()\n'
    "            else: continue\n"
    "            if lbl and lbl not in exclude_labels: exclude_labels.append(lbl)\n"
    "        return formulas, exclude_labels\n"
    "\n"
    "    def get_data(self, df, coltypes):\n"
    "        if self._query_context.result_format in ChartDataResultFormat.table_like():\n"
    "            df = df.copy()\n"
    "            include_index = not isinstance(df.index, pd.RangeIndex)\n"
    '            verbose_map = self._qc_datasource.data.get("verbose_map", {})\n'
    "            cdn, excl, calc_exp, col_ord = {}, [], [], []\n"
    "            for query in self._query_context.queries:\n"
    "                if hasattr(query, 'extras') and query.extras:\n"
    '                    cdn = query.extras.get("column_display_names", {})\n'
    '                    excl = query.extras.get("excluded_columns", [])\n'
    '                    calc_exp = query.extras.get("calculated_columns_export", [])\n'
    '                    col_ord = query.extras.get("column_export_order", [])\n'
    "                    if cdn or excl or calc_exp or col_ord: break\n"
    "            if verbose_map:\n"
    "                df.columns = [verbose_map.get(c, c) for c in df.columns]\n"
    "            columns = list(df.columns)\n"
    "            pivot_formulas, pivot_excl = self._get_pivot_rx1_export_formulas()\n"
    "            if pivot_excl and not excl: excl = pivot_excl\n"
    "            if pivot_formulas:\n"
    "                df, coltypes = self._apply_pivot_rx1_formulas(df, coltypes, pivot_formulas)\n"
    "                columns = list(df.columns)\n"
    "            elif calc_exp:\n"
    "                df, coltypes = self._apply_export_calculated_columns(df, coltypes, calc_exp)\n"
    "                columns = list(df.columns)\n"
    "            if cdn and not df.empty:\n"
    "                first_row = df.iloc[0].to_dict()\n"
    "                processed = {}\n"
    "                for col_name, display_name in cdn.items():\n"
    "                    if not display_name or not isinstance(display_name, str):\n"
    "                        processed[col_name] = display_name; continue\n"
    "                    def _repl(m, _r=first_row):\n"
    "                        v = _r.get(m.group(1).strip())\n"
    "                        return 'NULL' if v is None else str(v) if v is not None else m.group(0)\n"
    r"                    processed[col_name] = re.sub(r'\{\{([^}]+)\}\}', _repl, display_name)"
    "\n"
    "                cdn = processed\n"
    "            if excl:\n"
    "                df = df.drop(columns=[c for c in excl if c in df.columns], errors='ignore')\n"
    "                columns = list(df.columns)\n"
    "            if col_ord:\n"
    "                df, coltypes = self._apply_export_column_order(df, coltypes, col_ord)\n"
    "                columns = list(df.columns)\n"
    "            if cdn:\n"
    "                df.columns = [cdn.get(c, c) for c in columns]\n"
    "            result = None\n"
    "            if self._query_context.result_format == ChartDataResultFormat.CSV:\n"
    "                result = csv.df_to_escaped_csv(df, index=include_index, **current_app.config['CSV_EXPORT'])\n"
    "            elif self._query_context.result_format == ChartDataResultFormat.XLSX:\n"
    "                excel.apply_column_types(df, coltypes)\n"
    "                result = excel.df_to_excel(df, index=include_index, **current_app.config['EXCEL_EXPORT'])\n"
    "            return result or ''\n"
    "        return df.to_dict(orient='records')\n"
)

# Target: the original simple get_data from vanilla Superset
OLD_GET_DATA = (
    "    def get_data(\n"
    "        self, df: pd.DataFrame, coltypes: list[GenericDataType]\n"
    "    ) -> str | list[dict[str, Any]]:\n"
    "        if self._query_context.result_format in ChartDataResultFormat.table_like():\n"
    "            include_index = not isinstance(df.index, pd.RangeIndex)\n"
    "            columns = list(df.columns)\n"
    '            verbose_map = self._qc_datasource.data.get("verbose_map", {})\n'
    "            if verbose_map:\n"
    "                df.columns = [verbose_map.get(column, column) for column in columns]\n"
    "\n"
    "            result = None\n"
    "            if self._query_context.result_format == ChartDataResultFormat.CSV:\n"
    "                result = csv.df_to_escaped_csv(\n"
    '                    df, index=include_index, **current_app.config["CSV_EXPORT"]\n'
    "                )\n"
    "            elif self._query_context.result_format == ChartDataResultFormat.XLSX:\n"
    "                excel.apply_column_types(df, coltypes)\n"
    "                result = excel.df_to_excel(\n"
    '                    df, index=include_index, **current_app.config["EXCEL_EXPORT"]\n'
    "                )\n"
    "            return result or ''\n"
    "\n"
    "        return df.to_dict(orient='records')"
)

if OLD_GET_DATA in c:
    c = c.replace(OLD_GET_DATA, NEW_METHODS, 1)
    with open(f, "w") as fh:
        fh.write(c)
    print("  [ok] 8b query_context_processor.py: todos los métodos aplicados")
else:
    print("  [warn] 8b: patrón get_data no encontrado (el archivo puede haber cambiado).")
    print("         Revisar manualmente comparando con custom-src/backend/query_context_processor.py")
