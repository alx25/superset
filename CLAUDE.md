El proyecto

  Apache Superset 6.1.0 corriendo como servicios systemd (no Docker), con una extensión MCP personalizada (irex-mcp-tools) que expone herramientas analíticas para un chat
  de IA. El flujo completo es:

  Usuario en browser → Dashboard Superset → Widget chat (JS)
                                                ↓
                                        superset_mcp.service (puerto 5008)
                                                ↓
                                        irex.query_dataset / irex.chart_option
                                                ↓
                                        ClickHouse (datos reales con RLS)

  Logs

  # MCP (el que más interesa)
  journalctl -u superset_mcp.service -f
  journalctl -u superset_mcp.service -n 100

  # Superset principal
  journalctl -u superset.service -f

  El otro agente (agente programador del chat)

  Es un agente IA que vive del lado del widget de chat — programa y mantiene el frontend/backend del chat que consume el MCP. Tú eres el intermediario entre los dos:

  - Cuando encuentras algo en el MCP que el chat necesita adaptar, me lo dices y yo te doy el texto para él
  - Cuando él encuentra un bug en el comportamiento del MCP, te lo reporta en una sesión y tú me lo traes
  - Se comunica a través de IDs de sesión que tú compartes (como el 4f99c6bd-... de la sesión anterior)

 - Revisar logs del chat widget (reemplazar SESSION_ID con el ID real):

  export CHAT_BACKEND_SECRET=$(grep "CHAT_BACKEND_SECRET" /home/imercados/.superset/superset_config.py | sed 's/.*= *"\(.*\)"/\1/')
  curl -i -sS \
    -H "X-Service-Secret: $CHAT_BACKEND_SECRET" \
    -H "X-Superset-User: admin" \
    "http://186.177.26.27:8008/api/logs/sessions/<SESSION_ID>"

  Rebuild y deploy de la extensión MCP irex

  ⚠️  CRÍTICO — el zip SIEMPRE debe correrse desde superset_v6_1_0/irex-mcp-tools/
  para que los archivos queden en backend/src/... dentro del ZIP.
  Correrlo desde la raíz del proyecto mete los archivos en paths incorrectos
  y el loader de extensiones no los encuentra → todas las tools irex fallan.

  # 1. Ir al directorio raíz de la extensión (OBLIGATORIO)
  cd /home/imercados/superset_proyecto/superset_v6_1_0/irex-mcp-tools

  # 2. Actualizar el .supx con los archivos modificados
  zip -u /home/imercados/superset_proyecto/extensions/irex-mcp-tools-0.1.0.supx \
    backend/src/irex/irex_mcp_tools/<archivo>.py

  # 3. Verificar que los paths dentro del ZIP sean correctos (deben empezar con backend/src/)
  python3 -m zipfile -l /home/imercados/superset_proyecto/extensions/irex-mcp-tools-0.1.0.supx \
    | grep irex_mcp_tools

  # 4. Sincronizar la copia fuente
  cp /home/imercados/superset_proyecto/extensions/irex-mcp-tools-0.1.0.supx \
     /home/imercados/superset_proyecto/superset_v6_1_0/irex-mcp-tools/irex-mcp-tools-0.1.0.supx

  # 5. Reiniciar el servicio
  sudo systemctl restart superset_mcp.service

  Si una entry quedó en path incorrecto, eliminarla con:
  zip -d extensions/irex-mcp-tools-0.1.0.supx "superset_v6_1_0/irex-mcp-tools/backend/src/..."

  ⚠️  CRÍTICO — Paso 6 OBLIGATORIO al agregar un tool NUEVO (no aplica a modificar existentes):
  Agregar el nombre del tool al always_visible en /home/imercados/.superset/superset_config.py
  (buscar MCP_TOOL_SEARCH_CONFIG). Sin este paso el tool se registra pero NO aparece en
  tools/list y el LLM no lo ve. Formato del nombre:
  "extensions.irex.irex-mcp-tools.irex.<nombre_del_tool>"


Lee AGENTS.md
Lee PLUGINS.md