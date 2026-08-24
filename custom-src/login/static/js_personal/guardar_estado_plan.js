/**
 * guardar_estado_plan.js — versión v1.13.2
 *
 * Crea una vista materializada con nombre único, solicita identificación,
 * muestra un indicador visual de carga (spinner) y registra el nombre en estados_revision_plan.
 */

let csrfToken = null;
let availableDatabases = [];

// Inyectar estilos del spinner
(function injectSpinnerStyles() {
  const style = document.createElement('style');
  style.textContent = `
  .loader {
    border: 2px solid rgba(255,255,255,0.3);
    border-top: 2px solid #fff;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    animation: spin 0.8s linear infinite;
    display: inline-block;
    vertical-align: middle;
    margin-right: 8px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
})();

// 1) Obtener token CSRF
async function fetchCsrfToken() {
  const resp = await fetch('/api/v1/security/csrf_token/', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  });
  const data = await resp.json();
  csrfToken = data.result;
  console.log('[CSRF] Token obtenido:', csrfToken);
}

// 2) Listar conexiones de Superset
async function listSupersetDatabases() {
  if (!csrfToken) return;
  const resp = await fetch('/api/v1/database/?q=%7B%7D&limit=1000', {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', 'X-CSRFToken': csrfToken },
  });
  const data = await resp.json();
  availableDatabases = data.result || [];
  console.log('[DB] Conexiones disponibles:', availableDatabases.map(d => ({ id: d.id, name: d.database_name })));
}

// 3) Obtener info de dataset (dataset ID)
async function fetchDatasetInfo(datasetId) {
  const resp = await fetch(`/api/v1/dataset/${datasetId}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json', 'X-CSRFToken': csrfToken },
  });
  const data = await resp.json();
  const ds = data.result;
  return { database_id: ds.database.id, schema: ds.schema };
}

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  console.log('[guardar] Iniciando v1.13.2');
  fetchCsrfToken().then(listSupersetDatabases);
});

// Función principal con spinner visual
async function guardarEstadoPlan() {
  const btn = document.getElementById('btn-guardar-plan');
  const originalText = btn.textContent;

  // Mostrar spinner y deshabilitar botón
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span>Creando vista...';

  try {
    // 1) Año y cálculos
    const añoInput = prompt('Ingrese el año deseado (YYYY):', new Date().getFullYear());
    const selected = parseInt(añoInput, 10);
    if (isNaN(selected)) throw new Error('Año no válido');
    const prev1 = selected - 1, prev2 = selected - 2, prev3 = selected - 3;
    const current = new Date().getFullYear();

    // 2) Configuración del botón
    let dbId = Number(btn.dataset.dbId);
    let schema = btn.dataset.schema || 'dbo';
    if (!availableDatabases.some(d => d.id === dbId)) {
      const info = await fetchDatasetInfo(dbId);
      dbId = info.database_id;
      schema = info.schema;
    }
    if (!availableDatabases.some(d => d.id === dbId)) throw new Error(`Connection ID (${dbId}) inválido`);

    // 3) Generar nombre único y pedir identificación
    const timestamp = Date.now();
    const viewName = `vista_estado_plan_${selected}_${timestamp}`;
    const identificacion = prompt('Ingrese nombre de identificación para esta vista:');
    if (!identificacion || !identificacion.trim()) throw new Error('Nombre de identificación requerido');

    // 4) SQL de creación e inserción
    const sql=`
DROP MATERIALIZED VIEW IF EXISTS dbo.${viewName};
CREATE MATERIALIZED VIEW dbo.${viewName} AS
SELECT
  EXTRACT(Month FROM CURRENT_DATE) AS mes_actual,
  EXTRACT(YEAR FROM CURRENT_DATE) AS anio_actual,
  
a.mes_id,
a.anio_id,
a.medida,
SUM(a.sell_in) as sell_in,
SUM(a.enfirme) as enfirme,
SUM(a.planv) as planv,

  CASE WHEN A.anio_id = ${selected} THEN NULLIF(SUM(a.sell_in),0) ELSE NULL END AS sell_in_anio_seleccion,
  CASE WHEN A.anio_id = ${prev1} THEN NULLIF(SUM(a.sell_in),0) ELSE NULL END AS sell_in_anio_seleccion_ant,
  CASE WHEN A.anio_id = ${prev2} THEN NULLIF(SUM(a.sell_in),0) ELSE NULL END AS sell_in_anio_seleccion_ant_ant,
  CASE WHEN A.anio_id = ${prev3} THEN NULLIF(SUM(a.sell_in),0) ELSE NULL END AS sell_in_3_anos_atras,
  CASE WHEN A.anio_id = ${selected} THEN NULLIF(SUM(a.planv),0) ELSE NULL END AS plan_anio_seleccion,
  CASE WHEN A.anio_id = ${prev1} THEN NULLIF(SUM(a.planv),0) ELSE NULL END AS plan_anio_seleccion_ant,
  CASE WHEN A.anio_id = ${prev2} THEN NULLIF(SUM(a.planv),0) ELSE NULL END AS plan_anio_seleccion_ant_ant,
  ${selected} AS ano_seleccion,
  ${prev1} AS ano_anterior,
  ${prev2} AS ano_trasanterior,
  ${prev3} AS ano_3_atras,
  CASE WHEN ${selected} < ${current} AND ${selected} = A.anio_id THEN SUM(a.sell_in)
       WHEN ${selected} > ${current} AND ${selected} = A.anio_id THEN SUM(a.enfirme)
       WHEN ${selected} = ${current} AND DATE_TRUNC('month', A.fecha_id) >= DATE_TRUNC('month', NOW()) THEN SUM(a.enfirme)
       WHEN ${selected} = ${current} AND DATE_TRUNC('month', A.fecha_id) < DATE_TRUNC('month', NOW()) THEN SUM(a.sell_in)
       ELSE NULL
  END AS vnt_proyeccion,
  CASE WHEN ${selected} < EXTRACT(YEAR FROM A.fecha_id) AND ${selected} = A.anio_id THEN SUM(a.sell_in)
       WHEN ${selected} > EXTRACT(YEAR FROM A.fecha_id) THEN SUM(a.enfirme)
       WHEN ${selected} = EXTRACT(YEAR FROM A.fecha_id) AND DATE_TRUNC('month', A.fecha_id) = DATE_TRUNC('month', NOW()) THEN NULL
       WHEN ${selected} = EXTRACT(YEAR FROM A.fecha_id) AND DATE_TRUNC('month', A.fecha_id) < DATE_TRUNC('month', NOW()) THEN SUM(a.sell_in)
       ELSE NULL
  END AS vnt_proyeccion_acumulada,
  CASE WHEN ${prev1} = EXTRACT(YEAR FROM A.fecha_id) AND DATE_TRUNC('month', A.fecha_id) >= DATE_TRUNC('month', NOW()) THEN SUM(a.enfirme)
       WHEN ${prev1} = EXTRACT(YEAR FROM A.fecha_id) AND DATE_TRUNC('month', A.fecha_id) < DATE_TRUNC('month', NOW()) THEN SUM(a.sell_in)
       ELSE NULL
  END AS vnt_proyeccion_ano_ant_seleccion,
  
  c.nombre_cliente,
    c.empresa_nombre,
    upper(c.area_comercial_nombre::text) AS area_comercial_nombre,
    c.pais_nombre,
    g.jefe_pais,
    c.supervisor_id,
    c.supervisor_nombre,
    c.vendedor_id,
    c.vendedor_nombre,
    d.familia_nombre,
    d.marca_nombre,
    d.segmento_nombre,
    d.marca_familia_nombre,
    d.tipo_marca,
    d.tipo_venta,
    f.jefe_marca,
        CASE
            WHEN upper(c.pais_nombre::text) = 'COSTA RICA'::text AND (upper(c.area_comercial_nombre::text) = ANY (ARRAY['CANAL TRADICIONAL'::text, 'CADENAS ORGANIZADAS'::text, 'WAL-MART'::text])) THEN COALESCE(f.jefe_marca, 'Sin Jefe Marca'::text)
            ELSE 'Sin Jefe Marca'::text
        END AS jefe_marca_ac
        
FROM dbo.base_consolidada A
LEFT JOIN dbo.ldbi_dimcliente C ON A.cliente_id=C.cliente_id AND A.emp_id=C.emp_id
LEFT JOIN dbo.ldbi_dimproducto D ON A.producto_id=D.producto_id
LEFT JOIN dbo.jefes_marca F ON D.marca_familia_nombre=F.marca_familia_nombre
LEFT JOIN dbo.jefes_pais G ON A.emp_id=G.emp_id AND C.pais_nombre=G.pais_nombre AND C.area_comercial_nombre=G.area_comercial_nombre
WHERE D.clase_id IN ('01','03')
  AND A.anio_id IN (${prev3},${prev2},${prev1},${selected})
  GROUP BY

	a.fecha_id,
    a.mes_id,
    a.anio_id,
    a.medida,
  	c.nombre_cliente,
    c.empresa_nombre,
    upper(c.area_comercial_nombre::text),
    c.pais_nombre,
    g.jefe_pais,
    c.supervisor_id,
    c.supervisor_nombre,
    c.vendedor_id,
    c.vendedor_nombre,
    d.familia_nombre,
    d.marca_nombre,
    d.segmento_nombre,
    d.marca_familia_nombre,
    d.tipo_marca,
    d.tipo_venta,
    f.jefe_marca,
        CASE
            WHEN upper(c.pais_nombre::text) = 'COSTA RICA'::text AND (upper(c.area_comercial_nombre::text) = ANY (ARRAY['CANAL TRADICIONAL'::text, 'CADENAS ORGANIZADAS'::text, 'WAL-MART'::text])) THEN COALESCE(f.jefe_marca, 'Sin Jefe Marca'::text)
            ELSE 'Sin Jefe Marca'::text
        END;
  
-- Crear índices
CREATE INDEX IF NOT EXISTS idx_${viewName}_empresa_nombre ON dbo.${viewName}(empresa_nombre);
CREATE INDEX IF NOT EXISTS idx_${viewName}_area_comercial_nombre ON dbo.${viewName}(area_comercial_nombre);
CREATE INDEX IF NOT EXISTS idx_${viewName}_pais_nombre ON dbo.${viewName}(pais_nombre);
CREATE INDEX IF NOT EXISTS idx_${viewName}_segmento_nombre ON dbo.${viewName}(segmento_nombre);
CREATE INDEX IF NOT EXISTS idx_${viewName}_marca_familia_nombre ON dbo.${viewName}(marca_familia_nombre);  

INSERT INTO dbo.estados_revision_plan (id, nombre_vista, nombre_identificacion)
VALUES ('${viewName}', '${viewName}', '${identificacion}');
`;  


    // 5) Preparar payload
    const payload = {
      client_id: Math.random().toString(36).slice(2,10),
      database_id: dbId,
      schema,
      sql,
      json: true,
      runAsync: false,
      tmp_table_name: '',
      select_as_cta: false,
      ctas_method: 'TABLE',
      queryLimit: 10000,
      expand_data: false,
      sql_editor_id: 'guardar_estado_plan',
      tab: 'Guardar Estado Plan'
    };
    console.log('[guardar] Payload:', payload);

    // 6) Ejecutar petición
    const resp = await fetch('/api/v1/sqllab/execute/', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRFToken': csrfToken
      },
      body: JSON.stringify(payload)
    });
    const result = await resp.json();
    console.log('[guardar] Respuesta:', result);
    if (!(resp.ok && result.status === 'success')) throw new Error(result.error_msg || result.errors?.[0]?.message);

    alert(`✅ Vista '${viewName}' creada y registrada con identificación '${identificacion}'`);
  } catch (err) {
    console.error('[guardar] Error:', err);
    alert(`❌ Error: ${err.message}`);
  } finally {
    // Restaurar estado del botón
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Asignar listener al botón
new MutationObserver(() => {
  const btn = document.getElementById('btn-guardar-plan');
  if (btn && !btn.dataset.listenerAttached) {
    btn.addEventListener('click', guardarEstadoPlan);
    btn.dataset.listenerAttached = 'true';
    console.log('[guardar] Listener asignado');
  }
}).observe(document.body, { childList: true, subtree: true });
