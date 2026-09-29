# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.
"""Pruebas del catálogo de controles por viz_type de irex.get_viz_controls."""

import pytest

from irex.irex_mcp_tools.explore_viz_controls_core import (
    COMMON_CONTROLS,
    CUSTOM_PLUGIN_CONTROL_INFO,
    CUSTOM_PLUGIN_CONTROLS,
    GENERIC_CONTROL_INFO,
    KNOWN_VIZ_TYPES,
    control_info_for,
    resolve_viz_controls,
)


class TestPluginsPropios:
    @pytest.mark.parametrize("viz_type", ["table_v3", "html_cards", "pivot_table_rx1"])
    def test_source_specific_para_los_tres_plugins_propios(self, viz_type):
        result = resolve_viz_controls(viz_type)
        assert result["source"] == "specific"
        assert result["viz_type"] == viz_type
        if viz_type == "html_cards":
            # Única excepción: la ayuda de interactividad declarativa
            # (data-hc-on/data-hc-action) no entra en el presupuesto de
            # 2000 caracteres de control_info.handlebarsTemplate, así que
            # viaja en "note" en vez de description -- ver
            # _HTML_CARDS_INTERACTIVITY_HELP.
            assert "note" in result
            assert "data-hc-on" in result["note"]
        else:
            assert "note" not in result

    def test_table_v3_incluye_sus_controles_propios_y_no_los_genericos_ajenos(self):
        result = resolve_viz_controls("table_v3")
        # propios de table_v3 (verificados en su controlPanel.tsx real)
        assert "column_config" in result["controls"]
        assert "server_pagination" in result["controls"]
        assert "row_grouping_column" in result["controls"]
        # controles genéricos de series temporales que table_v3 NO tiene —
        # no deben colarse por estar en COMMON_CONTROLS.
        assert "x_axis" not in result["controls"]
        assert "series" not in result["controls"]

    def test_html_cards_incluye_su_control_propio_handlebarstemplate(self):
        result = resolve_viz_controls("html_cards")
        assert "handlebarsTemplate" in result["controls"]
        assert "styleTemplate" in result["controls"]
        # no tiene paginación de servidor (eso es de table_v3)
        assert "server_pagination" not in result["controls"]

    def test_pivot_table_rx1_incluye_sus_controles_propios_de_tema(self):
        result = resolve_viz_controls("pivot_table_rx1")
        assert "table_theme_header_bg" in result["controls"]
        assert "metricFormulas" in result["controls"]
        assert "groupbyColumns" in result["controls"]
        assert "groupbyRows" in result["controls"]

    def test_las_listas_no_tienen_duplicados_y_estan_ordenadas(self):
        for viz_type in CUSTOM_PLUGIN_CONTROLS:
            controls = resolve_viz_controls(viz_type)["controls"]
            assert controls == sorted(set(controls))


class TestTiposNoVerificados:
    def test_tipo_nativo_devuelve_generico_con_nota(self):
        result = resolve_viz_controls("mixed_timeseries")
        assert result["source"] == "generic"
        assert result["viz_type"] == "mixed_timeseries"
        assert "no verificado específicamente" in result["note"]
        assert "mixed_timeseries" in result["note"]

    def test_generico_incluye_los_controles_compartidos_mas_comunes(self):
        result = resolve_viz_controls("echarts_timeseries_bar")
        for expected in ("metrics", "groupby", "adhoc_filters", "row_limit", "time_range", "x_axis"):
            assert expected in result["controls"]

    def test_generico_es_exactamente_common_controls_ordenado(self):
        result = resolve_viz_controls("table")
        assert result["controls"] == sorted(COMMON_CONTROLS)


class TestVizTypeInventado:
    """Hallazgo del backend del chat (entrada 79 del Registro de cambios):
    antes, CUALQUIER string caía al catálogo genérico como si fuera un
    tipo real, así que `get_viz_controls` no servía para rechazar un
    `change_viz_type` a un tipo inventado por el modelo."""

    def test_viz_type_inventado_devuelve_unknown_sin_controles(self):
        result = resolve_viz_controls("algo_que_no_existe")
        assert result["source"] == "unknown"
        assert result["controls"] == []
        assert "algo_que_no_existe" in result["note"]

    def test_unknown_es_distinto_de_generic_no_se_confunden(self):
        inventado = resolve_viz_controls("tipo_inventado_por_el_modelo")
        real_no_verificado = resolve_viz_controls("mixed_timeseries")
        assert inventado["source"] != real_no_verificado["source"]

    @pytest.mark.parametrize(
        "viz_type",
        ["echarts_timeseries_bar", "big_number", "pie", "table", "pivot_table_v2", "heatmap_v2", "waterfall"],
    )
    def test_tipos_nativos_reales_no_caen_en_unknown(self, viz_type):
        assert resolve_viz_controls(viz_type)["source"] == "generic"

    def test_los_tres_plugins_propios_estan_en_known_viz_types(self):
        # KNOWN_VIZ_TYPES es el enum COMPLETO (incluye los propios) — no
        # debería faltar ninguno, aunque en la práctica CUSTOM_PLUGIN_CONTROLS
        # los intercepta antes con source="specific".
        for viz_type in CUSTOM_PLUGIN_CONTROLS:
            assert viz_type in KNOWN_VIZ_TYPES


def test_common_controls_no_esta_vacio_y_no_tiene_nombres_de_plugins_propios():
    assert len(COMMON_CONTROLS) > 20
    # column_config/handlebarsTemplate/etc. son propios, no compartidos por Superset.
    assert "column_config" not in COMMON_CONTROLS
    assert "handlebarsTemplate" not in COMMON_CONTROLS


def test_known_viz_types_tiene_los_50_tipos_del_enum_de_superset():
    assert len(KNOWN_VIZ_TYPES) == 50


class TestControlInfo:
    """Descripciones por control (2026-09-25) — extraídas del código fuente
    real (sharedControls.tsx/dndControls.tsx de Superset para lo genérico;
    los controlPanel.tsx de cada plugin propio para lo específico), no
    inventadas. `control_info_for` decide cuál gana cuando un nombre
    aparece en los dos lados."""

    def test_especifico_gana_sobre_generico_para_el_mismo_nombre(self):
        # row_limit existe en ambos lados, pero pivot_table_rx1 le da una
        # semántica propia ("límite de CELDAS, no de filas").
        info = control_info_for("pivot_table_rx1", ["row_limit"])
        assert "celdas" in info["row_limit"]["description"].lower()

    def test_cae_al_generico_cuando_el_plugin_no_lo_redefine(self):
        # adhoc_filters no está en _TABLE_V3_CONTROL_INFO — debe salir
        # igual, desde GENERIC_CONTROL_INFO.
        info = control_info_for("table_v3", ["adhoc_filters"])
        assert info["adhoc_filters"] == GENERIC_CONTROL_INFO["adhoc_filters"]

    def test_nombre_sin_descripcion_en_ningun_lado_se_omite_sin_reventar(self):
        info = control_info_for("table_v3", ["control_que_no_existe"])
        assert info == {}

    @pytest.mark.parametrize("viz_type", ["table_v3", "html_cards", "pivot_table_rx1"])
    def test_cobertura_completa_de_control_info_para_cada_plugin_propio(self, viz_type):
        # Si un control nuevo se agrega a CUSTOM_PLUGIN_CONTROLS sin agregar
        # su descripción (acá o en el genérico), esta prueba lo detecta.
        result = resolve_viz_controls(viz_type)
        missing = [c for c in result["controls"] if c not in result["control_info"]]
        assert missing == [], f"Sin descripción para: {missing}"

    def test_cobertura_completa_de_generic_control_info(self):
        missing = [c for c in COMMON_CONTROLS if c not in GENERIC_CONTROL_INFO]
        assert missing == [], f"Sin descripción genérica para: {missing}"

    def test_tipo_generico_no_verificado_tambien_trae_control_info(self):
        result = resolve_viz_controls("mixed_timeseries")
        assert result["control_info"]["metrics"] == GENERIC_CONTROL_INFO["metrics"]

    def test_tipo_inventado_no_trae_control_info(self):
        result = resolve_viz_controls("algo_que_no_existe")
        assert "control_info" not in result

    def test_calculated_columns_advierte_que_no_es_sql_y_menciona_la_tool_de_validacion(self):
        description = CUSTOM_PLUGIN_CONTROL_INFO["table_v3"]["calculated_columns"]["description"]
        assert "NO es SQL" in description
        assert "irex.validate_calculated_column_formula" in description

    def test_jinja_fields_de_table_v3_y_pivot_aclaran_que_si_son_sql(self):
        for viz_type in ("table_v3", "pivot_table_rx1"):
            description = CUSTOM_PLUGIN_CONTROL_INFO[viz_type]["jinja_fields"]["description"]
            assert "irex.validate_expression" in description

    def test_metricformulas_de_pivot_aclara_que_no_es_el_mismo_compilador_confirmado(self):
        description = CUSTOM_PLUGIN_CONTROL_INFO["pivot_table_rx1"]["metricFormulas"]["description"]
        assert "NO confirmado" in description

    def test_column_config_de_los_tres_plugins_tiene_descripcion_propia(self):
        for viz_type in ("table_v3", "html_cards", "pivot_table_rx1"):
            assert "column_config" in CUSTOM_PLUGIN_CONTROL_INFO[viz_type]

    def test_calculated_columns_aclara_que_row_y_col_son_alias_del_mismo_valor_y_solo_total_difiere(self):
        # Portado de calculatedColumns.ts::SCOPE_GETTERS — row./col. son el
        # MISMO getter que la fila actual, un error real sería fácil de
        # cometer si el modelo asumiera que difieren entre sí.
        description = CUSTOM_PLUGIN_CONTROL_INFO["table_v3"]["calculated_columns"]["description"]
        assert "EQUIVALENTES" in description
        assert "total.{{Columna}}" in description

    def test_column_config_de_table_v3_distingue_su_lenguaje_del_de_calculated_columns(self):
        description = CUSTOM_PLUGIN_CONTROL_INFO["table_v3"]["column_config"]["description"]
        assert "CASE WHEN" in description
        assert "{{ value }}" in description or "raw_value" in description
        assert "htmlCss" in description

    def test_column_config_advierte_sobre_nulos_en_plantillas_de_rangos(self):
        # Recomendación real del agente del backend (sesión explore-57def4...,
        # 2026-09-28): una plantilla de rangos sin guard de nulo mandaba un
        # valor vacío a ELSE, mostrándolo como el extremo del rango en vez
        # de "sin dato" — confirmado leyendo formatValue.ts.
        for viz_type in ("table_v3", "pivot_table_rx1"):
            description = CUSTOM_PLUGIN_CONTROL_INFO[viz_type]["column_config"]["description"]
            assert "raw_value" in description
            assert "= ''" in description
            assert "PRIMER WHEN" in description

    def test_column_config_de_pivot_no_promete_htmlcss_ni_formato_numerico_a_diferencia_de_table_v3(self):
        # Corrección real: la versión anterior de esta descripción decía
        # "formato numérico D3", que no existe en el layout real de pivot
        # (HTML_COLUMN_CONFIG_LAYOUT solo trae displayName + HTML, sin
        # htmlCss ni d3NumberFormat) — este test fija la corrección.
        pivot_description = CUSTOM_PLUGIN_CONTROL_INFO["pivot_table_rx1"]["column_config"]["description"]
        assert "NO expone" in pivot_description
        assert "htmlCss" in pivot_description  # mencionado, pero para decir que NO está
        table_v3_description = CUSTOM_PLUGIN_CONTROL_INFO["table_v3"]["column_config"]["description"]
        assert pivot_description != table_v3_description

    def test_handlebarstemplate_incluye_la_lista_completa_de_helpers_no_solo_los_de_formato(self):
        # La versión anterior solo mencionaba 5 helpers de formato — la
        # lista real (tooltip de ayuda del propio control) tiene 18,
        # incluidos varios de manejo de arrays/estructura no obvios.
        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["handlebarsTemplate"]["description"]
        for helper in ("coalesce", "pluck", "sum", "hasValue", "parseJson", "rowCount", "scopeId", "themeVars"):
            assert helper in description, f"Falta el helper '{helper}'"

    def test_styletemplate_advierte_sobre_la_sanitizacion_de_html(self):
        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["styleTemplate"]["description"]
        assert "sanitización" in description

    def test_handlebarstemplate_documenta_group_y_division_con_su_sintaxis_real(self):
        # Hallazgo reportado por el backend del chat (sesión
        # explore-fa693d0e..., 2026-09-28): el asistente rechazó proponer
        # una tarjeta por familia con tabla de marcas anidada porque la
        # descripción no documentaba `group` (handlebars-group-by) ni
        # `division` (just-handlebars-helpers), ambos registrados en
        # HandlebarsViewer.tsx pero ausentes del listado.
        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["handlebarsTemplate"]["description"]
        assert "{{#group " in description
        assert "templateKey" in description
        # division no tiene guard de denominador 0 en el helper real
        # (just-handlebars-helpers/lib/helpers/math.js) — la descripción
        # debe advertirlo explícitamente, no solo listar el helper.
        assert "division" in description
        assert "{{#if b}}" in description or "SIN protección" in description

    def test_handlebarstemplate_metadata_cubre_los_helpers_registrados_en_el_plugin_real(self):
        # Compara la metadata contra el registro REAL de helpers en
        # HandlebarsViewer.tsx (custom-plugins/plugin-chart-html-cards) en
        # vez de una lista copiada a mano — si alguien agrega un
        # `Handlebars.registerHelper(...)` nuevo sin documentarlo acá, esta
        # prueba lo detecta.
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        viewer_path = (
            repo_root
            / "custom-plugins"
            / "plugin-chart-html-cards"
            / "src"
            / "components"
            / "Handlebars"
            / "HandlebarsViewer.tsx"
        )
        assert viewer_path.is_file(), f"No se encontró {viewer_path}"
        source = viewer_path.read_text(encoding="utf-8")

        registered = set(re.findall(r"Handlebars\.registerHelper\(\s*['\"]([A-Za-z0-9_]+)['\"]", source))
        assert "dateFormat" in registered  # sanity check de que el regex matchea algo real

        # `group` (handlebars-group-by) y `division` (just-handlebars-helpers,
        # vía Helpers.registerHelpers) no se registran con
        # Handlebars.registerHelper literal — el regex de arriba no los ve —
        # así que se agregan a mano, condicionados a que el plugin siga
        # registrando esas dos librerías.
        assert "HandlebarsGroupBy.register(Handlebars)" in source
        assert "Helpers.registerHelpers(Handlebars)" in source
        registered |= {"group", "division"}

        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["handlebarsTemplate"]["description"]
        missing = sorted(name for name in registered if name not in description)
        assert missing == [], f"Helpers registrados en el plugin pero no documentados en control_info: {missing}"

    def test_tooltip_de_la_ui_y_control_info_del_mcp_describen_los_mismos_helpers(self):
        # El tooltip de ayuda del control (handlebarTemplate.tsx) y la
        # descripción que ve el LLM (control_info) deben cubrir la misma
        # capacidad — si uno menciona un helper que el otro omite, el
        # asistente y un usuario humano terminan con información distinta.
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        control_path = (
            repo_root
            / "custom-plugins"
            / "plugin-chart-html-cards"
            / "src"
            / "plugin"
            / "controls"
            / "handlebarTemplate.tsx"
        )
        assert control_path.is_file(), f"No se encontró {control_path}"
        source = control_path.read_text(encoding="utf-8")

        tooltip_keys = set(re.findall(r"key:\s*'([^']+)'", source))
        assert "group" in tooltip_keys
        assert "division" in tooltip_keys

        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["handlebarsTemplate"]["description"]
        # data-hc-sort/data-hc-resize y data-hc-on/data-hc-action/
        # data-hc-target viven en el "note" del resultado (no en esta
        # description) -- no entraban en el presupuesto de 2000 caracteres,
        # ver _HTML_CARDS_INTERACTIVITY_HELP.
        note = resolve_viz_controls("html_cards")["note"]
        # 'width / height' y 'scopeId / scopeSelector' son claves compuestas
        # del tooltip (dos nombres en un solo key) — se listan por separado
        # en control_info, así que se dividen antes de comparar.
        expanded = set()
        for key in tooltip_keys:
            expanded.update(part.strip() for part in key.split("/"))

        missing = sorted(
            name for name in expanded if name not in description and name not in note
        )
        assert missing == [], f"El tooltip de la UI menciona helpers ausentes de control_info/note: {missing}"

    def test_styletemplate_documenta_las_variables_css_del_tema_real_y_no_colores_de_navegador(self):
        # Reportado por el usuario (sesión explore-d362e3c9..., 2026-09-28):
        # el asistente usó colores de sistema del navegador/SO (Canvas,
        # CanvasText, light-dark()) en vez del tema real de Superset —
        # porque las variables de tema reales solo estaban documentadas
        # bajo el helper themeVars de handlebarsTemplate, no en
        # styleTemplate (el control donde en verdad se escribe CSS).
        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["styleTemplate"]["description"]
        assert "--html-cards-theme-color-primary" in description
        # el resto de los tokens se listan abreviados (sin repetir el
        # prefijo completo) para entrar en el límite de caracteres.
        for token in ("-color-text", "-color-border", "-color-error", "-color-success", "-color-warning"):
            assert token in description, f"Falta el token de tema '{token}'"
        assert "Canvas" in description  # se nombra explícitamente para advertir en contra
        assert "navegador" in description.lower()

    @pytest.mark.parametrize(
        ("viz_type", "css_var_prefix"),
        [("table_v3", "--table-v3-theme-color-"), ("pivot_table_rx1", "--pivot-table-rx1-theme-color-")],
    )
    def test_column_config_documenta_variables_css_del_tema_real_con_el_prefijo_correcto(self, viz_type, css_var_prefix):
        # Mismo hallazgo que arriba, pero para column_config.htmlTemplate/
        # htmlCss de table_v3 y pivot_table_rx1 — estos dos plugins NO
        # tenían NINGÚN mecanismo de tema real hasta esta ampliación
        # (TableChart.tsx/PivotTableChart.tsx ganan themeCssVars, mismo
        # patrón que plugin-chart-html-cards). Cada plugin usa su propio
        # prefijo — un control_info que mencione el prefijo de OTRO plugin
        # (copy-paste) sería un error real, no solo un hueco.
        description = CUSTOM_PLUGIN_CONTROL_INFO[viz_type]["column_config"]["description"]
        assert css_var_prefix + "primary" in description
        assert "/-error" in description
        assert "light-dark" in description  # advertencia explícita contra colores de sistema

        other_prefix = "--pivot-table-rx1-theme-color-" if viz_type == "table_v3" else "--table-v3-theme-color-"
        assert other_prefix not in description

    def test_styletemplate_cubre_todas_las_variables_css_de_themecssvars_en_htmlcards_tsx(self):
        # Recomendación del backend del chat (2026-09-28): cotejar la lista
        # publicada contra el objeto themeCssVars REAL de HtmlCards.tsx en
        # vez de una lista a mano — si se agrega/renombra un token ahí sin
        # actualizar esta descripción, esta prueba lo detecta.
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        html_cards_path = (
            repo_root / "custom-plugins" / "plugin-chart-html-cards" / "src" / "HtmlCards.tsx"
        )
        assert html_cards_path.is_file(), f"No se encontró {html_cards_path}"
        source = html_cards_path.read_text(encoding="utf-8")

        theme_vars = re.findall(r"'(--html-cards-theme-[a-z0-9-]+)':", source)
        assert len(theme_vars) >= 10  # sanity check de que el regex matchea algo real

        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["styleTemplate"]["description"]
        prefix = "--html-cards-theme"
        # la descripción abrevia todas menos la primera (quita el prefijo
        # compartido), así que se compara por el sufijo — es substring del
        # nombre completo tanto en su forma abreviada como en la completa.
        missing = sorted(
            var for var in theme_vars if var.removeprefix(prefix) not in description
        )
        assert missing == [], f"Variables de tema en HtmlCards.tsx sin documentar en styleTemplate: {missing}"

    def test_las_3_descripciones_css_advierten_sobre_rgba_mal_formado(self):
        # Hallazgo real (sesión explore-22cae395..., 2026-09-28): el modelo
        # (gpt-6-luna) escribió rgba(99 245 200,.18) — canales separados por
        # espacio pero con coma antes del alfa, mezcla inválida de las dos
        # sintaxis de color CSS. El navegador descarta la declaración entera
        # sin ningún error visible; encontrado en DOS sesiones distintas con
        # colores distintos (patrón recurrente del modelo, no un error
        # aislado). Las 3 descripciones que permiten escribir CSS deben
        # advertirlo explícitamente.
        for viz_type, control in (
            ("html_cards", "styleTemplate"),
            ("table_v3", "column_config"),
            ("pivot_table_rx1", "column_config"),
        ):
            description = CUSTOM_PLUGIN_CONTROL_INFO[viz_type][control]["description"]
            assert "rgba" in description, f"{viz_type}.{control} no menciona rgba()"
            assert "coma" in description.lower(), f"{viz_type}.{control} no aclara que hace falta coma"

    def test_las_descripciones_con_variables_de_tema_siguen_bajo_el_limite_de_2000_caracteres(self):
        # El backend del chat recorta control_info a 2000 caracteres —
        # estas tres son las que más al límite quedaron después de sumar
        # la documentación de colores/tema; test de regresión explícito
        # para no volver a pasarse sin darse cuenta.
        for viz_type, control in (
            ("html_cards", "styleTemplate"),
            ("table_v3", "column_config"),
            ("pivot_table_rx1", "column_config"),
        ):
            description = CUSTOM_PLUGIN_CONTROL_INFO[viz_type][control]["description"]
            assert len(description) <= 2000, f"{viz_type}.{control}: {len(description)} caracteres"

    def test_styletemplate_documenta_el_mecanismo_responsivo_real_container_queries(self):
        # Reportado por el usuario (2026-09-28): lo generado en html_cards
        # debe ser responsivo. El plugin YA tiene el mecanismo correcto
        # (container queries sobre el tamaño real del gráfico, no @media
        # que mide el viewport del navegador) pero no estaba documentado en
        # styleTemplate — mismo tipo de hueco que el de las variables de
        # tema (capacidad real, sin documentar donde se escribe CSS).
        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["styleTemplate"]["description"]
        assert "@container html-cards-chart" in description
        assert "container-name: html-cards-chart" in description
        assert "NO @media" in description
        assert "viewport" in description

    def test_note_de_html_cards_documenta_todas_las_acciones_reales_de_dynamicactions_ts(self):
        # Cruza contra el registro ACTIONS real de dynamicActions.ts (2026-09-29,
        # generalización de data-hc-sort/data-hc-resize a un vocabulario
        # declarativo de interactividad) -- si se agrega una acción nueva al
        # plugin sin documentarla acá, esta prueba lo detecta.
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        actions_path = (
            repo_root
            / "custom-plugins"
            / "plugin-chart-html-cards"
            / "src"
            / "utils"
            / "dynamicActions.ts"
        )
        assert actions_path.is_file(), f"No se encontró {actions_path}"
        source = actions_path.read_text(encoding="utf-8")

        match = re.search(r"const ACTIONS: Record<string, ActionHandler> = \{(.*?)\n\};", source, re.S)
        assert match, "No se encontró el registro ACTIONS en dynamicActions.ts"
        # Exactamente 2 espacios de indentación -- son las claves de
        # PRIMER NIVEL del objeto ACTIONS; con \s* también matchearían
        # claves anidadas dentro del cuerpo de cada handler (ej. el
        # `behavior:`/`block:` del scrollIntoView({...}) de scrollTo).
        action_names = set(re.findall(r"^  ([A-Za-z]+):", match.group(1), re.M))
        assert action_names >= {"toggleClass", "scrollTo", "copyText", "countUp"}  # sanity check

        note = resolve_viz_controls("html_cards")["note"]
        missing = sorted(name for name in action_names if name not in note)
        assert missing == [], f"Acciones reales de dynamicActions.ts sin documentar en note: {missing}"

    def test_note_de_html_cards_documenta_los_eventos_reales_de_dynamicactions_ts(self):
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        actions_path = (
            repo_root
            / "custom-plugins"
            / "plugin-chart-html-cards"
            / "src"
            / "utils"
            / "dynamicActions.ts"
        )
        source = actions_path.read_text(encoding="utf-8")
        match = re.search(r"const ALLOWED_EVENTS = new Set\(\[(.*?)\]\);", source, re.S)
        assert match, "No se encontró ALLOWED_EVENTS en dynamicActions.ts"
        events = set(re.findall(r"'([a-z]+)'", match.group(1)))
        assert events == {"click", "dblclick", "mouseenter", "mouseleave", "change", "submit", "load"}

        note = resolve_viz_controls("html_cards")["note"]
        missing = sorted(name for name in events if name not in note)
        assert missing == [], f"Eventos reales de dynamicActions.ts sin documentar en note: {missing}"

    def test_note_de_html_cards_advierte_no_usar_script_inline_pese_a_html_sanitization_off(self):
        # El hallazgo clave que motiva este mecanismo: con
        # HTML_SANITIZATION=False (confirmado en este deployment), un
        # <script>/onClick= inline en handlebarsTemplate SÍ ejecutaría --
        # sin ningún compilador de por medio, a diferencia del bug de
        # calculated_columns. El "note" debe dejar esto explícito para que
        # el modelo prefiera las acciones declarativas en vez de HTML crudo.
        note = resolve_viz_controls("html_cards")["note"]
        assert "script" in note.lower()
        assert "HTML_SANITIZATION" in note

    def test_styletemplate_container_name_y_umbrales_coinciden_con_htmlcards_tsx_real(self):
        # Cotejo contra el código real (recomendación del backend del chat,
        # aplicada acá también): container-name en HtmlCards.tsx, y los
        # umbrales isNarrow/isTiny/isCompact en templateContext.ts (los
        # mismos que expone handlebarsTemplate.layout) — si alguno cambia
        # ahí sin actualizar esta descripción, esta prueba lo detecta.
        import re
        from pathlib import Path

        repo_root = Path(__file__).resolve().parents[4]
        plugin_src = repo_root / "custom-plugins" / "plugin-chart-html-cards" / "src"

        html_cards_source = (plugin_src / "HtmlCards.tsx").read_text(encoding="utf-8")
        container_name_match = re.search(r"container-name:\s*([\w-]+);", html_cards_source)
        assert container_name_match, "No se encontró container-name en HtmlCards.tsx"
        container_name = container_name_match.group(1)

        context_source = (plugin_src / "utils" / "templateContext.ts").read_text(encoding="utf-8")
        is_narrow = re.search(r"isNarrow:\s*width\s*<\s*(\d+)", context_source)
        is_tiny = re.search(r"isTiny:\s*width\s*<\s*(\d+)", context_source)
        is_compact = re.search(r"isCompact:\s*width\s*<\s*(\d+)\s*\|\|\s*height\s*<\s*(\d+)", context_source)
        assert is_narrow and is_tiny and is_compact, "No se encontraron los umbrales de layout en templateContext.ts"

        description = CUSTOM_PLUGIN_CONTROL_INFO["html_cards"]["styleTemplate"]["description"]
        assert f"@container {container_name}" in description
        assert f"isNarrow width<{is_narrow.group(1)}" in description
        assert f"isTiny width<{is_tiny.group(1)}" in description
        assert f"isCompact width<{is_compact.group(1)} o height<{is_compact.group(2)}" in description
