/*
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
import { PivotData, aggregatorTemplates } from '../../src/react-pivottable/utilities';

const data = [
  { division: 'LIMPIEZA', tipo: 'Administrativos', cc: 'CC1', valor: 100 },
  { division: 'LIMPIEZA', tipo: 'Administrativos', cc: 'CC2', valor: 50 },
  { division: 'LIMPIEZA', tipo: 'Ventas', cc: 'CC3', valor: 10 },
  { division: 'COMERCIAL', tipo: 'Logistica', cc: 'CC4', valor: 9999 },
  { division: 'COMERCIAL', tipo: 'Ventas', cc: 'CC5', valor: 1 },
  { division: 'ALIMENTOS', tipo: 'Mercadeo', cc: 'CC6', valor: 500 },
];

const aggregatorsFactory = formatter => ({ Sum: aggregatorTemplates.sum(formatter) });
const formatter = v => String(v);

function buildPivotData(rowOrder, rowPartialOnTop) {
  return new PivotData(
    {
      data,
      rows: ['division', 'tipo', 'cc'],
      cols: [],
      vals: ['valor'],
      aggregatorName: 'Sum',
      aggregatorsFactory,
      defaultFormatter: formatter,
      rowOrder,
      colOrder: 'key_a_to_z',
    },
    { rowEnabled: true, colEnabled: false, rowPartialOnTop, colPartialOnTop: false },
  );
}

// Every node's full set of descendants must form one contiguous block
// immediately adjacent to it (before or after, depending on whether
// subtotals display on top or on bottom) -- that's what renderTableRow and
// the "compact row tree" collapse/expand logic require to build the visual
// tree. A flat sort by value that ignores the parent-child relationship
// breaks this and a group renders expanded but with its children missing.
function isHierarchicallyValid(rowKeys) {
  for (let i = 0; i < rowKeys.length; i += 1) {
    const node = rowKeys[i];
    const descendantIdx = [];
    rowKeys.forEach((k, idx) => {
      if (k.length > node.length && node.every((v, j) => k[j] === v)) {
        descendantIdx.push(idx);
      }
    });
    if (descendantIdx.length === 0) continue;
    const minIdx = Math.min(...descendantIdx);
    const maxIdx = Math.max(...descendantIdx);
    const blockIsContiguous = maxIdx - minIdx + 1 === descendantIdx.length;
    const nodeIsAdjacent = minIdx === i + 1 || maxIdx === i - 1;
    if (!blockIsContiguous || !nodeIsAdjacent) {
      return false;
    }
  }
  return true;
}

describe('PivotData.sortKeys with hierarchical row grouping', () => {
  it.each(['key_a_to_z', 'value_a_to_z', 'value_z_to_a'])(
    'keeps every group contiguous with its own descendants for rowOrder=%s, subtotal on top',
    rowOrder => {
      const rowKeys = buildPivotData(rowOrder, true).getRowKeys();
      expect(isHierarchicallyValid(rowKeys)).toBe(true);
    },
  );

  it.each(['key_a_to_z', 'value_a_to_z', 'value_z_to_a'])(
    'keeps every group contiguous with its own descendants for rowOrder=%s, subtotal on bottom',
    rowOrder => {
      const rowKeys = buildPivotData(rowOrder, false).getRowKeys();
      expect(isHierarchicallyValid(rowKeys)).toBe(true);
    },
  );

  it('orders top-level groups by their own aggregated total, descending', () => {
    const rowKeys = buildPivotData('value_z_to_a', true).getRowKeys();
    const topLevelOrder = rowKeys.filter(k => k.length === 1).map(k => k[0]);
    // COMERCIAL = 9999 + 1 = 10000, ALIMENTOS = 500, LIMPIEZA = 100 + 50 + 10 = 160
    expect(topLevelOrder).toEqual(['COMERCIAL', 'ALIMENTOS', 'LIMPIEZA']);
  });

  it('orders siblings within a group by their own total, not the global total', () => {
    const rowKeys = buildPivotData('value_z_to_a', true).getRowKeys();
    const comercialChildren = rowKeys
      .filter(k => k.length === 2 && k[0] === 'COMERCIAL')
      .map(k => k[1]);
    // Logistica = 9999 > Ventas = 1
    expect(comercialChildren).toEqual(['Logistica', 'Ventas']);
  });

  it('orders ascending the opposite way of descending', () => {
    const ascKeys = buildPivotData('value_a_to_z', true).getRowKeys();
    const topLevelAsc = ascKeys.filter(k => k.length === 1).map(k => k[0]);
    expect(topLevelAsc).toEqual(['LIMPIEZA', 'ALIMENTOS', 'COMERCIAL']);
  });
});
