// static/js_personal/handsontable_transform.js?v=1.0.14
(function(){
  const VERSION = '1.0.24';
  console.log(`[HT] v${VERSION} iniciando pivot con fila combinada de 'Kg producidos'`);

  // Inyectar CSS para encabezados sticky y scroll horizontal
  (function(){
    const css = `
      .table-container { 
      overflow-x: auto; 
      position: relative;
    }

    .table-container .custom-table th {
      position: sticky; 
      top: 0;
      background: #00BFC4; 
      color: #fff; 
      z-index: 3;
    }

    /* Fijar la primera columna (Proceso) */
    .table-container .custom-table th:first-child,
    .table-container .custom-table td:first-child {
      position: sticky;
      left: 0;
      background: #00BFC4; /* Fondo neutro para que se distinga */
      z-index: 4; /* Más alto para que quede por encima del scroll */
      font-weight: bold;
    }

    /* Opcional: bordes para mejor separación */
    .table-container .custom-table td,
    .table-container .custom-table th {
      border: 1px solid #ddd;
      white-space: nowrap;
    }
  `;
    const style = document.createElement('style');
    style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);
    console.log('[HT] CSS sticky inyectado');
  })();

  // Formatea timestamp a "mmm-yy"
  function formatMonth(ts) {
    const d = new Date(Number(ts));
    let s = d.toLocaleDateString('es-ES',{ month:'short', year:'2-digit'});
    return s.replace('.', '').replace(' ', '-');
  }

  function transformContainer(container) {
    if (container.dataset.htTransformed) return;
    console.log('[HT] transformContainer en', container);

    const table = container.querySelector('table.custom-table');
    if (!table) { console.log('[HT] no encontré table.custom-table'); return; }

    // Parsear filas originales
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const items = rows.map(r => {
      const [mes, prodStr, provStr, bptStr, bmpStr, bodegasStr, totalStr] =
        Array.from(r.cells).map(td=>td.innerText.replace(/,/g,'').trim());
      return {
        mes,
        production: parseFloat(prodStr)||0,
        Proveeduría: parseFloat(provStr)||0,
        BPT: parseFloat(bptStr)||0,
        BMP: parseFloat(bmpStr)||0,
        'Bodegas General': parseFloat(bodegasStr)||0,
        totalKg: parseFloat(totalStr)||0
      };
    });
    console.log('[HT] items parseados:', items);

    // Meses únicos y etiquetas
    const months = [...new Set(items.map(i=>i.mes))];
    const labels = months.map(formatMonth);

    // Reconstruir tabla
    let html = '';
    // Encabezados
    html += '<thead><tr><th>Proceso</th>';
    labels.forEach(lbl=> html+=`<th colspan="3" style="text-align:center;">${lbl}</th>`);
    html += '</tr><tr><th></th>';
    labels.forEach(_=> html+=
      '<th style="text-align:right;">Kg producidos</th>'+
      '<th style="text-align:right;">Kg</th>'+
      '<th style="text-align:right;">PNC</th>'
    );
    html += '</tr></thead>';

    // Cuerpo: fila combinada Kg producidos + filas de procesos
    html += '<tbody>';
    // Fila única para Kg producidos
    html += '<tr><td><b>Kg producidos</b></td>';
    months.forEach(m => {
      const item = items.find(x=>x.mes===m);
      const prodVal = item ? item.production : 0;
      const prodFmt = prodVal.toLocaleString(undefined,{minimumFractionDigits:0});
      html += `<td style="text-align:right; font-weight:bold;">${prodFmt}</td><td></td><td></td>`;
    });
    html += '</tr>';

    // Filas de cada proceso
    const processes = ['BMP','BPT','Bodegas General','Proveeduría'];
    
    // Definir metas por categoría
    const metasPorCategoria = {
      'Proveeduría': { max: 9.07, sat: 7.78, min: 6.49 },
      'BMP': { max: 3.64, sat: 3.44, min: 3.24 },
      'BPT': { max: 3.64, sat: 3.44, min: 3.24 },
      'Bodegas General': { max: 3.64, sat: 3.44, min: 3.24 }
    };
    
    processes.forEach(proc=>{
      html+=`<tr><td>${proc}</td>`;
      months.forEach(m=>{
        const item = items.find(x=>x.mes===m);
        const kg = item ? item[proc] : 0;
        const totalKg = item ? item.totalKg : 0;
        const pnc = totalKg ? (kg/totalKg*10000).toFixed(3) : '0.000';
        
        // Obtener metas según la categoría
        const metas = metasPorCategoria[proc];
        let bg = '#72adfaff'; // color por defecto (azul - mínimo)
        if (pnc >= metas.max) {
          bg = '#f8696b'; // rojo - máximo
        } else if (pnc >= metas.sat) {
          bg = '#eff171ff'; // amarillo - satisfactorio
        }
        
        html +=
          '<td></td>' +
          `<td style="text-align:right;">${Number(kg).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>`+
          `<td style="text-align:right; background:${bg};">${pnc}</td>`;
      });
      html+='</tr>';
    });
    html += '</tbody>';

    table.innerHTML = html;
    container.dataset.htTransformed = '1';
    console.log('[HT] tabla pivot transformada v1.0.14');
  }

  // Observer
  const obs = new MutationObserver(ms=>{
    ms.forEach(m=> m.addedNodes.forEach(n=>{
      if(n.nodeType!==1) return;
      if(n.matches&&n.matches('.handlebars .table-container')) transformContainer(n);
      else if(n.querySelectorAll) n.querySelectorAll('.handlebars .table-container').forEach(transformContainer);
    }));
  });
  obs.observe(document.body,{ childList:true, subtree:true });
  console.log('[HT] MutationObserver activo');

  // Primera pasada
  window.addEventListener('load',()=>{
    console.log('[HT] load → transform en 500ms');
    setTimeout(()=> document.querySelectorAll('.handlebars .table-container').forEach(transformContainer), 500);
  });
})();
