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
import {
  initTableInteractions,
  MIN_COLUMN_WIDTH,
  TableInteractionStore,
} from '../../src/utils/tableInteractions';

function mockWidth(el: Element, width: number) {
  (el as unknown as { __mockWidth: number }).__mockWidth = width;
}

// jsdom (as bundled by jest-environment-jsdom in this repo) has no PointerEvent
// constructor. A MouseEvent dispatched with a pointer-event type string is a
// faithful stand-in here: the handlers only read `clientX` (`pointerId` is
// best-effort/optional and guarded by a try/catch in the implementation).
function firePointer(
  target: EventTarget,
  type: string,
  init: Partial<MouseEventInit> = {},
) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 0,
      ...init,
    }),
  );
}

function drag(handle: Element, fromX: number, toX: number) {
  firePointer(handle, 'pointerdown', { clientX: fromX });
  firePointer(document, 'pointermove', { clientX: toX });
  firePointer(document, 'pointerup', { clientX: toX });
}

beforeAll(() => {
  jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function mockRect(this: HTMLElement) {
      const width = (this as unknown as { __mockWidth?: number }).__mockWidth ?? 0;
      return {
        width,
        height: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
});

afterAll(() => {
  jest.restoreAllMocks();
});

function renderTable(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('initTableInteractions — opt-in', () => {
  it('leaves plain tables untouched (no handles, no listeners)', () => {
    const container = renderTable(`
      <table>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>2</td><td>x</td></tr><tr><td>1</td><td>y</td></tr></tbody>
      </table>
    `);
    const cleanup = initTableInteractions(container, new Map());

    expect(container.querySelector('.hc-resize-handle')).toBeNull();
    const th = container.querySelector('th')!;
    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('2');

    cleanup();
  });
});

describe('initTableInteractions — sort', () => {
  function renderSortableTable() {
    return renderTable(`
      <table data-hc-sort>
        <thead><tr><th data-hc-key="n">Num</th><th data-hc-sort="false">Excluded</th></tr></thead>
        <tbody>
          <tr><td>3</td><td>c</td></tr>
          <tr><td>1</td><td>a</td></tr>
          <tr><td>2</td><td>b</td></tr>
        </tbody>
      </table>
    `);
  }

  it('cycles asc -> desc -> original order on click, updating aria-sort', () => {
    const container = renderSortableTable();
    const cleanup = initTableInteractions(container, new Map());
    const th = container.querySelector('th')!;

    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    let firstCells = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      cell => cell.textContent,
    );
    expect(firstCells).toEqual(['1', '2', '3']);

    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(th.getAttribute('aria-sort')).toBe('descending');
    firstCells = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      cell => cell.textContent,
    );
    expect(firstCells).toEqual(['3', '2', '1']);

    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(th.getAttribute('aria-sort')).toBeNull();
    firstCells = Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      cell => cell.textContent,
    );
    expect(firstCells).toEqual(['3', '1', '2']);

    cleanup();
  });

  it('does not attach a click handler to a th marked data-hc-sort="false"', () => {
    const container = renderSortableTable();
    const cleanup = initTableInteractions(container, new Map());
    const excludedTh = container.querySelectorAll('th')[1];

    excludedTh.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(excludedTh.getAttribute('aria-sort')).toBeNull();
    const firstCells = Array.from(
      container.querySelectorAll('tbody tr td:first-child'),
    ).map(cell => cell.textContent);
    expect(firstCells).toEqual(['3', '1', '2']);

    cleanup();
  });

  it('sorts using data-hc-value instead of formatted textContent', () => {
    const container = renderTable(`
      <table data-hc-sort>
        <thead><tr><th data-hc-key="d">Date</th></tr></thead>
        <tbody>
          <tr><td data-hc-value="20">Feb</td></tr>
          <tr><td data-hc-value="1">Jan</td></tr>
        </tbody>
      </table>
    `);
    const cleanup = initTableInteractions(container, new Map());
    const th = container.querySelector('th')!;

    th.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const firstCells = Array.from(container.querySelectorAll('tbody tr td')).map(
      cell => cell.textContent,
    );
    expect(firstCells).toEqual(['Jan', 'Feb']);

    cleanup();
  });
});

describe('initTableInteractions — resize', () => {
  function renderResizableTable(resizeAttr = '') {
    return renderTable(`
      <table data-hc-resize="${resizeAttr}">
        <colgroup><col style="width: 100px"><col style="width: 100px"></colgroup>
        <thead><tr><th data-hc-key="a">A</th><th data-hc-key="b">B</th></tr></thead>
        <tbody><tr><td>1</td><td>2</td></tr></tbody>
      </table>
    `);
  }

  it('injects a resize handle and resizes the column on drag', () => {
    const container = renderResizableTable();
    const cleanup = initTableInteractions(container, new Map());
    const handle = container.querySelector('.hc-resize-handle')!;
    expect(handle).not.toBeNull();

    const col = container.querySelectorAll('col')[0] as HTMLElement;
    drag(handle, 0, 40);

    expect(col.style.width).toBe('140px');
    cleanup();
  });

  it('clamps the resized width at MIN_COLUMN_WIDTH', () => {
    const container = renderResizableTable();
    const cleanup = initTableInteractions(container, new Map());
    const handle = container.querySelector('.hc-resize-handle')!;
    const col = container.querySelectorAll('col')[0] as HTMLElement;

    drag(handle, 0, -1000);

    expect(col.style.width).toBe(`${MIN_COLUMN_WIDTH}px`);
    cleanup();
  });

  it('only injects handles for the first N columns when data-hc-resize="N"', () => {
    const container = renderResizableTable('1');
    const cleanup = initTableInteractions(container, new Map());
    const ths = container.querySelectorAll('th');

    expect(ths[0].querySelector('.hc-resize-handle')).not.toBeNull();
    expect(ths[1].querySelector('.hc-resize-handle')).toBeNull();
    cleanup();
  });

  it('warns and disables resize when the table has no colgroup', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const container = renderTable(`
      <table data-hc-resize>
        <thead><tr><th>A</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    `);

    const cleanup = initTableInteractions(container, new Map());

    expect(container.querySelector('.hc-resize-handle')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    cleanup();
  });
});

describe('initTableInteractions — sticky offset recalculation', () => {
  it('recomputes the left offset of trailing sticky columns after a resize', () => {
    const container = renderTable(`
      <table data-hc-resize>
        <colgroup><col style="width: 100px"><col style="width: 80px"></colgroup>
        <thead>
          <tr>
            <th data-hc-key="a" style="position: sticky; left: 0px">A</th>
            <th data-hc-key="b" style="position: sticky; left: 0px">B</th>
          </tr>
        </thead>
        <tbody><tr><td style="position: sticky; left: 0px">1</td><td style="position: sticky; left: 0px">2</td></tr></tbody>
      </table>
    `);
    const ths = container.querySelectorAll('th');
    const tds = container.querySelectorAll('td');
    mockWidth(ths[0], 100);
    mockWidth(tds[0], 100);

    const cleanup = initTableInteractions(container, new Map());
    const handle = ths[0].querySelector('.hc-resize-handle')!;

    drag(handle, 0, 50);
    // after the drag, column A is 150px wide; column B's sticky offset
    // should shift to match the real rendered width of column A
    mockWidth(ths[0], 150);
    mockWidth(tds[0], 150);
    firePointer(handle, 'pointerdown', { clientX: 0 });
    firePointer(document, 'pointerup', { clientX: 0 });

    expect(ths[1].style.left).toBe('150px');
    expect(tds[1].style.left).toBe('150px');

    cleanup();
  });
});

describe('initTableInteractions — state persistence across re-renders', () => {
  it('reapplies stored width and sort when the same columns re-render', () => {
    const store: TableInteractionStore = new Map();

    const first = renderTable(`
      <table data-hc-sort data-hc-resize>
        <colgroup><col style="width: 100px"></colgroup>
        <thead><tr><th data-hc-key="n">Num</th></tr></thead>
        <tbody><tr><td>2</td></tr><tr><td>1</td></tr></tbody>
      </table>
    `);
    const cleanupFirst = initTableInteractions(first, store);
    const firstHandle = first.querySelector('.hc-resize-handle')!;
    drag(firstHandle, 0, 30);
    first.querySelector('th')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    cleanupFirst();
    document.body.removeChild(first);

    const second = renderTable(`
      <table data-hc-sort data-hc-resize>
        <colgroup><col style="width: 100px"></colgroup>
        <thead><tr><th data-hc-key="n">Num</th></tr></thead>
        <tbody><tr><td>5</td></tr><tr><td>4</td></tr></tbody>
      </table>
    `);
    const cleanupSecond = initTableInteractions(second, store);

    const col = second.querySelector('col') as HTMLElement;
    expect(col.style.width).toBe('130px');
    expect(second.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
    const firstCells = Array.from(second.querySelectorAll('tbody tr td')).map(
      cell => cell.textContent,
    );
    expect(firstCells).toEqual(['4', '5']);

    cleanupSecond();
  });

  it('discards stored state when the set of columns changes', () => {
    const store: TableInteractionStore = new Map();

    const first = renderTable(`
      <table data-hc-resize>
        <colgroup><col style="width: 100px"></colgroup>
        <thead><tr><th data-hc-key="n">Num</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    `);
    const cleanupFirst = initTableInteractions(first, store);
    drag(first.querySelector('.hc-resize-handle')!, 0, 30);
    cleanupFirst();
    document.body.removeChild(first);

    const second = renderTable(`
      <table data-hc-resize>
        <colgroup><col style="width: 100px"></colgroup>
        <thead><tr><th data-hc-key="different">Other</th></tr></thead>
        <tbody><tr><td>1</td></tr></tbody>
      </table>
    `);
    const cleanupSecond = initTableInteractions(second, store);

    const col = second.querySelector('col') as HTMLElement;
    expect(col.style.width).toBe('100px');

    cleanupSecond();
  });
});
