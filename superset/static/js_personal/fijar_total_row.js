window.addEventListener('load', () => {
  console.log('[FIX-FILA-TOTAL] Script cargado 1.9.2');

  let totalRow = null;
  let thead = null;

  const applyStickyRow = () => {
    const chart = document.querySelector('#chart-id-489');
    if (!chart) {
      console.log('[FIX-FILA-TOTAL] No se encontró el chart #489');
      return;
    }

    const table = chart.querySelector('table');
    thead = table?.querySelector('thead');
    if (!thead) {
      console.log('[FIX-FILA-TOTAL] No se encontró el thead');
      return;
    }

    totalRow = [...table.querySelectorAll('tbody tr')]
      .find(tr => tr.innerText.includes('TOTAL GENENERAL'));

    if (!totalRow) {
      console.log('[FIX-FILA-TOTAL] No se encontró la fila TOTAL GENENERAL');
      return;
    }

    const headHeight = thead.offsetHeight;

    // Estilos generales para la fila sticky
    totalRow.style.position = 'sticky';
    totalRow.style.top = `${headHeight}px`;
    totalRow.style.backgroundColor = '#f0f0f0';
    totalRow.style.fontWeight = 'bold';
    totalRow.style.zIndex = '99';
    totalRow.style.borderTop = '2px solid #ccc';
    totalRow.style.borderBottom = '2px solid #ccc';
    totalRow.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.05)';

    // Estilo adicional para la celda que contiene el texto
    const totalCell = [...totalRow.querySelectorAll('th, td')].find(cell =>
      cell.innerText.includes('TOTAL GENENERAL')
    );
    if (totalCell) {
      totalCell.style.fontWeight = 'bold';
      totalCell.style.backgroundColor = '#f0f0f0';
      totalCell.style.color = '#000';
      totalCell.style.textAlign = 'center';
    }

    console.log('[FIX-FILA-TOTAL] Estilos aplicados a la fila y texto de TOTAL GENENERAL');
  };

  const observer = new MutationObserver(() => {
    applyStickyRow();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('resize', () => {
    if (thead && totalRow) {
      const newHeight = thead.offsetHeight;
      totalRow.style.top = `${newHeight}px`;
      console.log('[FIX-FILA-TOTAL] Altura recalculada tras resize:', newHeight);
    }
  });
});
