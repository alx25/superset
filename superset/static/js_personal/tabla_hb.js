// static/js_personal/tabla_hb.js?v=1.0.17
(function(){
  console.log('[TopN] v1.0.17 inicializando delegación global');

  // Función que aplica el Top N a un chart específico
  function applyTop(chart) {
    const select = chart.querySelector('#topN');
    const tbody  = chart.querySelector('table.data-table tbody');
    if (!select || !tbody) return;

    console.log('[TopN] applyTop() valor=', select.value);
    // Elimina filas “Otros” previas
    tbody.querySelectorAll('tr.row-otros').forEach(r => r.remove());

    // Filas originales
    const rows = Array.from(tbody.rows)
      .filter(r => !r.classList.contains('row-otros'));

    // Si “all”, muestro todas
    if (select.value === 'all') {
      rows.forEach(r => r.style.display = '');
      return;
    }

    // Top N
    const n = parseInt(select.value, 10);
    rows.forEach((r, i) => r.style.display = i < n ? '' : 'none');

    // Agrupa ocultas en “Otros”
    const hidden = rows.slice(n);
    if (!hidden.length) return;

    // Sumo por columna
    const sums = new Array(rows[0].cells.length - 1).fill(0);
    hidden.forEach(r =>
      Array.from(r.cells).slice(1).forEach((td,i) => {
        sums[i] += parseFloat(td.textContent) || 0;
      })
    );

    // Creo fila “Otros”
    const tr = document.createElement('tr');
    tr.classList.add('row-otros');
    tr.insertCell().textContent = 'Otros';
    sums.forEach(s => {
      const td = tr.insertCell();
      td.style.textAlign = 'right';
      td.textContent = (Math.round(s * 10) / 10).toString();
    });
    tbody.appendChild(tr);
    console.log('[TopN] fila “Otros” añadida');
  }

  // Delegación global de clicks
  document.body.addEventListener('click', e => {
    // 1) Botón “Aplicar”
    if (e.target.id === 'applyTopBtn') {
      console.log('[TopN] Delegated: botón Aplicar clickeado');
      const chart = e.target.closest('div.handlebars');
      applyTop(chart);
    }

    // 2) Botón “Apply filters” de Superset
    if (e.target.closest('.filter-apply-button')) {
      console.log('[TopN] Delegated: Apply filters pulsado → reset a ALL');
      document.querySelectorAll('div.handlebars').forEach(chart => {
        const select = chart.querySelector('#topN');
        if (select) {
          select.value = 'all';
          applyTop(chart);
        }
      });
    }
  });

  // Al cargar, inicializa todos en “all”
  window.addEventListener('load', () => {
    document.querySelectorAll('div.handlebars').forEach(chart => {
      const select = chart.querySelector('#topN');
      if (select) {
        select.value = 'all';
        applyTop(chart);
      }
    });
  });
})();
