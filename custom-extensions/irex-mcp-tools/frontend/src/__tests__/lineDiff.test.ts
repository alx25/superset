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
import { collapseContext, computeLineDiff, hasLineChanges } from '../assistant/lineDiff';

describe('computeLineDiff', () => {
  test('dos textos idénticos -- todo contexto, sin agregados ni removidos', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'context', text: 'a', beforeLineNumber: 1, afterLineNumber: 1 },
      { type: 'context', text: 'b', beforeLineNumber: 2, afterLineNumber: 2 },
      { type: 'context', text: 'c', beforeLineNumber: 3, afterLineNumber: 3 },
    ]);
  });

  test('una línea cambiada en el medio -- se ve como removed+added, no como reemplazo mágico', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nB\nc');
    expect(lines).toEqual([
      { type: 'context', text: 'a', beforeLineNumber: 1, afterLineNumber: 1 },
      { type: 'removed', text: 'b', beforeLineNumber: 2 },
      { type: 'added', text: 'B', afterLineNumber: 2 },
      { type: 'context', text: 'c', beforeLineNumber: 3, afterLineNumber: 3 },
    ]);
  });

  test('una línea agregada al final', () => {
    const lines = computeLineDiff('a\nb', 'a\nb\nc');
    expect(lines).toEqual([
      { type: 'context', text: 'a', beforeLineNumber: 1, afterLineNumber: 1 },
      { type: 'context', text: 'b', beforeLineNumber: 2, afterLineNumber: 2 },
      { type: 'added', text: 'c', afterLineNumber: 3 },
    ]);
  });

  test('una línea removida del medio', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nc');
    expect(lines).toEqual([
      { type: 'context', text: 'a', beforeLineNumber: 1, afterLineNumber: 1 },
      { type: 'removed', text: 'b', beforeLineNumber: 2 },
      { type: 'context', text: 'c', beforeLineNumber: 3, afterLineNumber: 2 },
    ]);
  });

  test('caso real: solo cambia un valor de una propiedad CSS entre mucho contexto', () => {
    const before = '.a {\n  color: red;\n  border-radius: 10px;\n}\n.b {\n  width: 100%;\n}';
    const after = '.a {\n  color: red;\n  border-radius: 14px;\n}\n.b {\n  width: 100%;\n}';
    const lines = computeLineDiff(before, after);
    const changed = lines.filter(l => l.type !== 'context');
    expect(changed).toEqual([
      { type: 'removed', text: '  border-radius: 10px;', beforeLineNumber: 3 },
      { type: 'added', text: '  border-radius: 14px;', afterLineNumber: 3 },
    ]);
  });

  test('string vacío de cualquiera de los dos lados no rompe (String.split dejaría una línea vacía "" -- se ve como remove/add de esa línea)', () => {
    expect(computeLineDiff('', 'a')).toEqual([
      { type: 'removed', text: '', beforeLineNumber: 1 },
      { type: 'added', text: 'a', afterLineNumber: 1 },
    ]);
    expect(computeLineDiff('a', '')).toEqual([
      { type: 'removed', text: 'a', beforeLineNumber: 1 },
      { type: 'added', text: '', afterLineNumber: 1 },
    ]);
  });
});

describe('collapseContext', () => {
  test('sin cambios cerca, colapsa TODO el contexto a un solo marcador', () => {
    const lines = computeLineDiff('1\n2\n3\n4\n5\n6\n7', '1\n2\n3\nX\n5\n6\n7');
    const collapsed = collapseContext(lines, 1);
    // contexto: 1,2 colapsan (lejos del cambio); 3 queda (contexto antes);
    // 4 removed / X added; 5 queda (contexto después); 6,7 colapsan
    expect(collapsed).toEqual([
      { type: 'ellipsis' },
      { type: 'context', text: '3', beforeLineNumber: 3, afterLineNumber: 3 },
      { type: 'removed', text: '4', beforeLineNumber: 4 },
      { type: 'added', text: 'X', afterLineNumber: 4 },
      { type: 'context', text: '5', beforeLineNumber: 5, afterLineNumber: 5 },
      { type: 'ellipsis' },
    ]);
  });

  test('sin ningún cambio, todo el contexto colapsa a un solo marcador', () => {
    const lines = computeLineDiff('a\nb\nc', 'a\nb\nc');
    expect(collapseContext(lines, 1)).toEqual([{ type: 'ellipsis' }]);
  });

  test('cambios muy juntos no generan elipsis entre ellos', () => {
    const lines = computeLineDiff('a\nb\nc\nd', 'a\nB\nC\nd');
    const collapsed = collapseContext(lines, 1);
    // 'a' y 'd' quedan como contexto (adyacentes a los cambios), sin '...' entre b/c
    expect(collapsed.filter(l => l.type === 'ellipsis')).toHaveLength(0);
  });
});

describe('hasLineChanges', () => {
  test('true si hay al menos una línea agregada o removida', () => {
    expect(hasLineChanges(computeLineDiff('a', 'b'))).toBe(true);
  });

  test('false si los dos textos son idénticos', () => {
    expect(hasLineChanges(computeLineDiff('a\nb', 'a\nb'))).toBe(false);
  });
});
