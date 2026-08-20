/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

export const MIN_COLUMN_WIDTH = 48;

export interface TableInteractionState {
  width?: number;
  sortDirection?: 'asc' | 'desc';
}

export type TableInteractionStore = Map<string, TableInteractionState>;

export function resolveColumnKey(
  th: HTMLTableCellElement,
  index: number,
): string {
  const explicit = th.dataset.hcKey?.trim();
  if (explicit) {
    return explicit;
  }
  const text = th.textContent?.trim();
  if (text) {
    return text;
  }
  return `col-${index}`;
}

export function parseCellValue(cell: HTMLTableCellElement | undefined): string {
  if (!cell) {
    return '';
  }
  const raw = cell.dataset.hcValue;
  if (raw !== undefined) {
    return raw;
  }
  return cell.textContent?.trim() ?? '';
}

function compareValues(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  const bothNumeric =
    a.trim() !== '' && b.trim() !== '' && !Number.isNaN(numA) && !Number.isNaN(numB);
  if (bothNumeric) {
    return numA - numB;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function pruneStaleColumnState(
  store: TableInteractionStore,
  tableIndex: number,
  columnKeys: string[],
): void {
  const prefix = `${tableIndex}:`;
  const storedKeys = Array.from(store.keys()).filter(key => key.startsWith(prefix));
  if (!storedKeys.length) {
    return;
  }

  const currentKeys = new Set(columnKeys.map(key => `${prefix}${key}`));
  const changed =
    storedKeys.length !== currentKeys.size || storedKeys.some(key => !currentKeys.has(key));
  if (changed) {
    storedKeys.forEach(key => store.delete(key));
  }
}

/**
 * Recomputes the sticky offset (`left` for leading frozen columns, `right` for
 * trailing ones) as the cumulative real width of the preceding sticky columns.
 * Only the contiguous sticky run from each edge participates, matching the
 * standard frozen-column pattern (leading/trailing columns marked sticky in CSS).
 */
export function recalcStickyOffsets(table: HTMLTableElement): void {
  const headerRow = table.tHead?.rows[0];
  if (!headerRow) {
    return;
  }
  const ths = Array.from(headerRow.cells);
  const bodyRows = table.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];

  let runningLeft = 0;
  let leftChainActive = true;
  ths.forEach((th, index) => {
    if (!leftChainActive) {
      return;
    }
    const style = getComputedStyle(th);
    if (style.position !== 'sticky' || style.left === 'auto') {
      leftChainActive = false;
      return;
    }
    th.style.left = `${runningLeft}px`;
    bodyRows.forEach(row => {
      const cell = row.cells[index];
      if (cell) {
        cell.style.left = `${runningLeft}px`;
      }
    });
    runningLeft += th.getBoundingClientRect().width;
  });

  let runningRight = 0;
  let rightChainActive = true;
  for (let index = ths.length - 1; index >= 0; index -= 1) {
    if (!rightChainActive) {
      break;
    }
    const th = ths[index];
    const style = getComputedStyle(th);
    if (style.position !== 'sticky' || style.right === 'auto') {
      rightChainActive = false;
      break;
    }
    th.style.right = `${runningRight}px`;
    bodyRows.forEach(row => {
      const cell = row.cells[index];
      if (cell) {
        cell.style.right = `${runningRight}px`;
      }
    });
    runningRight += th.getBoundingClientRect().width;
  }
}

export type RegisterCleanup = (dispose: () => void) => void;

export function setupResize(
  table: HTMLTableElement,
  tableIndex: number,
  store: TableInteractionStore,
  registerCleanup: RegisterCleanup,
  ths: HTMLTableCellElement[],
  columnKeys: string[],
): void {
  const resizeAttr = table.dataset.hcResize;
  if (resizeAttr === undefined) {
    return;
  }

  const colgroup = table.querySelector('colgroup');
  const cols = colgroup ? Array.from(colgroup.querySelectorAll('col')) : [];
  if (!colgroup || cols.length !== ths.length) {
    // eslint-disable-next-line no-console
    console.warn(
      '[html-cards] data-hc-resize requiere un <colgroup> con una <col> por columna. ' +
        'Resize deshabilitado para esta tabla.',
    );
    return;
  }

  table.style.tableLayout = 'fixed';

  const resizeCount = resizeAttr === '' ? undefined : Number.parseInt(resizeAttr, 10);
  const eligibleIndices = ths
    .map((_, index) => index)
    .filter(index => {
      const th = ths[index];
      if (th.dataset.hcResize === 'false') {
        return false;
      }
      if (resizeCount === undefined || Number.isNaN(resizeCount)) {
        return true;
      }
      return index < resizeCount;
    });

  eligibleIndices.forEach(index => {
    const th = ths[index];
    const col = cols[index];
    const key = `${tableIndex}:${columnKeys[index]}`;

    const stored = store.get(key);
    if (stored?.width) {
      col.style.width = `${stored.width}px`;
    }

    if (getComputedStyle(th).position === 'static') {
      th.style.position = 'relative';
    }

    let handle = Array.from(th.children).find(el =>
      el.classList.contains('hc-resize-handle'),
    ) as HTMLDivElement | undefined;
    if (!handle) {
      handle = document.createElement('div');
      handle.className = 'hc-resize-handle';
      th.appendChild(handle);
    }

    const onPointerDown = (event: PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth =
        col.getBoundingClientRect().width ||
        Number.parseFloat(col.style.width) ||
        th.getBoundingClientRect().width;
      try {
        handle!.setPointerCapture(event.pointerId);
      } catch {
        // pointer capture isn't available in every environment; safe to skip
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = Math.max(
          MIN_COLUMN_WIDTH,
          startWidth + (moveEvent.clientX - startX),
        );
        col.style.width = `${nextWidth}px`;
      };
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      const stopDrag = () => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
      };
      const onPointerUp = () => {
        const finalWidth = Number.parseFloat(col.style.width) || startWidth;
        store.set(key, { ...store.get(key), width: finalWidth });
        recalcStickyOffsets(table);
        stopDrag();
      };

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      // if the table gets torn down (re-render) mid-drag, make sure the
      // transient document listeners don't outlive it
      registerCleanup(stopDrag);
    };

    handle.addEventListener('pointerdown', onPointerDown);
    registerCleanup(() => handle!.removeEventListener('pointerdown', onPointerDown));
  });

  recalcStickyOffsets(table);
}

export function setupSort(
  table: HTMLTableElement,
  tableIndex: number,
  store: TableInteractionStore,
  registerCleanup: RegisterCleanup,
  ths: HTMLTableCellElement[],
  columnKeys: string[],
): void {
  if (table.dataset.hcSort === undefined) {
    return;
  }
  const tbody = table.tBodies[0];
  if (!tbody) {
    return;
  }

  const originalOrder = Array.from(tbody.rows);

  const applySort = (columnIndex: number, direction: 'asc' | 'desc') => {
    const sorted = Array.from(tbody.rows).sort((rowA, rowB) => {
      const result = compareValues(
        parseCellValue(rowA.cells[columnIndex]),
        parseCellValue(rowB.cells[columnIndex]),
      );
      return direction === 'asc' ? result : -result;
    });
    tbody.append(...sorted);
  };

  const setAriaSort = (activeIndex: number | null, direction?: 'asc' | 'desc') => {
    ths.forEach((th, index) => {
      if (index === activeIndex && direction) {
        th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      } else {
        th.removeAttribute('aria-sort');
      }
    });
  };

  const clearStoredSortDirection = () => {
    columnKeys.forEach(columnKey => {
      const storeKey = `${tableIndex}:${columnKey}`;
      const existing = store.get(storeKey);
      if (!existing?.sortDirection) {
        return;
      }
      if (existing.width !== undefined) {
        store.set(storeKey, { width: existing.width });
      } else {
        store.delete(storeKey);
      }
    });
  };

  ths.forEach((th, index) => {
    if (th.dataset.hcSort === 'false') {
      return;
    }

    const key = `${tableIndex}:${columnKeys[index]}`;
    const stored = store.get(key)?.sortDirection;
    if (stored) {
      applySort(index, stored);
      setAriaSort(index, stored);
    }

    const onClick = () => {
      const current = th.getAttribute('aria-sort');
      const next: 'asc' | 'desc' | null =
        current === 'ascending' ? 'desc' : current === 'descending' ? null : 'asc';

      clearStoredSortDirection();

      if (next) {
        store.set(key, { ...store.get(key), sortDirection: next });
        applySort(index, next);
        setAriaSort(index, next);
      } else {
        store.delete(key);
        tbody.append(...originalOrder);
        setAriaSort(null);
      }
    };

    th.addEventListener('click', onClick);
    registerCleanup(() => th.removeEventListener('click', onClick));
  });
}

/**
 * Scans `container` for `<table data-hc-sort>` / `<table data-hc-resize>` elements
 * and wires up click-to-sort and drag-to-resize behavior. Tables without these
 * attributes are left untouched. Returns a cleanup function that removes every
 * listener this call attached (safe to call again on the next render).
 */
export function initTableInteractions(
  container: HTMLElement | null,
  store: TableInteractionStore,
): () => void {
  const disposers: Array<() => void> = [];
  const registerCleanup: RegisterCleanup = dispose => disposers.push(dispose);

  if (container) {
    const tables = Array.from(
      container.querySelectorAll<HTMLTableElement>(
        'table[data-hc-sort], table[data-hc-resize]',
      ),
    );

    tables.forEach((table, tableIndex) => {
      const ths = Array.from(table.tHead?.rows[0]?.cells ?? []) as HTMLTableCellElement[];
      if (!ths.length) {
        return;
      }

      const columnKeys = ths.map((th, index) => resolveColumnKey(th, index));
      pruneStaleColumnState(store, tableIndex, columnKeys);

      if (table.hasAttribute('data-hc-sort')) {
        setupSort(table, tableIndex, store, registerCleanup, ths, columnKeys);
      }
      if (table.hasAttribute('data-hc-resize')) {
        setupResize(table, tableIndex, store, registerCleanup, ths, columnKeys);
      }
    });
  }

  return () => disposers.forEach(dispose => dispose());
}
