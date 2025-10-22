// static/js_personal/totals_transform.js?v=1.14
(function(){
  console.log('[Totals] v1.14 inicializando Totals Transform con toggles basados en clases únicas');

  /** Crear controles dinámicos para visibilidad de columnas */
  function initColumnToggles(container) {
    if (container.querySelector('.col-toggles')) return;
    const table = container.querySelector('table.data-table');
    if (!table) return;

    const controls = document.createElement('div');
    controls.className = 'col-toggles';
    Object.assign(controls.style, {
      display: 'flex', flexWrap: 'wrap', gap: '8px',
      padding: '12px', background: '#f7fafc', borderRadius: '6px',
      marginBottom: '10px', alignItems: 'center'
    });

    // Master toggle
    const master = document.createElement('input');
    master.type = 'checkbox'; master.checked = true;
    master.dataset.colKey = '__all__';
    Object.assign(master.style, { marginRight: '6px', cursor: 'pointer' });
    const masterLabel = document.createElement('label');
    masterLabel.style = 'display:flex;align-items:center;font-weight:bold;';
    masterLabel.append(master, document.createTextNode('Mostrar todas las columnas'));
    controls.append(masterLabel);

    // Crear checkbox para cada encabezado con clase hdr-
    table.querySelectorAll('thead th').forEach((th, idx) => {
      const cls = Array.from(th.classList).find(c => c.startsWith('hdr-'));
      if (!cls) return;
      const key = cls.replace('hdr-', '');
      const text = th.innerText.trim();

      const chk = document.createElement('input');
      chk.type = 'checkbox'; chk.checked = true;
      chk.dataset.colKey = key;
      Object.assign(chk.style, { marginRight: '4px', cursor: 'pointer' });

      const lbl = document.createElement('label');
      Object.assign(lbl.style, {
        display: 'flex', alignItems: 'center', padding: '4px 8px',
        background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '4px',
        cursor: 'pointer', fontSize: '0.9em'
      });
      lbl.addEventListener('mouseenter', () => lbl.style.background = '#e2e8f0');
      lbl.addEventListener('mouseleave', () => lbl.style.background = '#ffffff');
      lbl.append(chk, document.createTextNode(text));
      controls.append(lbl);
    });

    container.insertBefore(controls, table);

    controls.addEventListener('change', e => {
      const key = e.target.dataset.colKey;
      if (!key) return;
      if (key === '__all__') {
        const show = e.target.checked;
        controls.querySelectorAll('input[data-col-key]').forEach(cb => {
          if (cb.dataset.colKey !== '__all__') {
            cb.checked = show;
            toggleColumn(container, cb.dataset.colKey, show);
          }
        });
      } else {
        toggleColumn(container, key, e.target.checked);
        const allBoxes = Array.from(controls.querySelectorAll('input[data-col-key]'))
          .filter(cb => cb.dataset.colKey !== '__all__');
        controls.querySelector('input[data-col-key="__all__"]').checked =
          allBoxes.every(cb => cb.checked);
      }
    });
  }

  /** Oculta o muestra columna según clase hdr-key */
  function toggleColumn(container, key, visible) {
    const table = container.querySelector('table.data-table');
    if (!table) return;
    const th = table.querySelector(`thead th.hdr-${key}`);
    if (!th) return;
    const idx = Array.from(th.parentNode.children).indexOf(th);
    th.style.display = visible ? '' : 'none';
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cell = tr.children[idx];
      if (cell) cell.style.display = visible ? '' : 'none';
    });
    const totalRow = table.querySelector('tr.row-totals');
    if (totalRow) {
      const td = totalRow.children[idx];
      if (td) td.style.display = visible ? '' : 'none';
    }
  }

  /** Calcula totales y añade fila sticky */
  function applyTotals(container) {
    const table = container.querySelector('table.data-table');
    if (!table || table.dataset.totalsApplied) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const idx = { v3:1, v2:2, pa:4, vp:6, ps:8 };
    const sums = { v3:0, v2:0, pa:0, vp:0, ps:0 };
    rows.forEach(tr => {
      const c = tr.children;
      sums.v3 += +c[idx.v3].textContent.replace(/,/g,'') || 0;
      sums.v2 += +c[idx.v2].textContent.replace(/,/g,'') || 0;
      sums.pa += +c[idx.pa].textContent.replace(/,/g,'') || 0;
      sums.vp += +c[idx.vp].textContent.replace(/,/g,'') || 0;
      sums.ps += +c[idx.ps].textContent.replace(/,/g,'') || 0;
    });
    const pctVarReal = sums.v2 ? (sums.v2 / sums.v3 - 1) * 100 : 0;
    const pctPlanAntReal = sums.v2 ? (sums.pa / sums.v2 - 1) * 100 : 0;
    const pctPlanAntProy = sums.vp ? (sums.vp / sums.pa - 1) * 100 : 0;
    const pctPlanProy = sums.vp ? (sums.ps / sums.vp - 1) * 100 : 0;
    const pctPlanPlanAnt = sums.pa ? (sums.ps / sums.pa - 1) * 100 : 0;
    const planMenosProy = (sums.ps - sums.vp)
    const trTotal = document.createElement('tr');
    trTotal.className = 'row-totals';
    Object.assign(trTotal.style, { position:'sticky', bottom:'0', background:'#c5d9f1', fontWeight:'bold', zIndex:'5' });
    trTotal.innerHTML = `
      <td><strong>Total</strong></td>
      <td style="text-align:right"><strong>${sums.v3.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${sums.v2.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${pctVarReal.toFixed(2)}%</strong></td>
      <td style="text-align:right"><strong>${sums.pa.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${pctPlanAntReal.toFixed(2)}%</strong></td>
      <td style="text-align:right"><strong>${sums.vp.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${pctPlanAntProy.toFixed(2)}%</strong></td>
      <td style="text-align:right"><strong>${sums.ps.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${pctPlanProy.toFixed(2)}%</strong></td>
      <td style="text-align:right"><strong>${planMenosProy.toLocaleString()}</strong></td>
      <td style="text-align:right"><strong>${pctPlanPlanAnt.toFixed(2)}%</strong></td>
    `;
    tbody.appendChild(trTotal);
    table.dataset.totalsApplied = '1';
  }

  function processContainer(c) { initColumnToggles(c); applyTotals(c); }

  const observer = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches('.table-container[data-enable-totals]')) processContainer(n);
    else if (n.querySelectorAll) n.querySelectorAll('.table-container[data-enable-totals]').forEach(processContainer);
  })));
  observer.observe(document.body,{ childList:true, subtree:true });

  window.addEventListener('load', ()=>document.querySelectorAll('.table-container[data-enable-totals]').forEach(processContainer));
})();
