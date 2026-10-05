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
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SqlDiff } from '../assistant/SqlDiff';

// `SqlCode` resalta sintaxis partiendo el texto en varios `<span>` (uno por
// token) -- `getByText` de una línea entera no matchea nada, así que estas
// pruebas verifican sobre `container.textContent` (concatena todos los
// spans de la línea) en vez de buscar el texto completo como un nodo único.
describe('SqlDiff', () => {
  test('con before/after ya multilínea, no reformatea nada (comportamiento de siempre)', () => {
    const { container } = render(<SqlDiff before={'SELECT a\nFROM t'} after={'SELECT a,b\nFROM t'} />);

    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('−1')).toBeInTheDocument();
    expect(container.textContent).toContain('SELECT a');
    expect(container.textContent).toContain('SELECT a,b');
  });

  test('hallazgo real 2026-10-05 (sesión sqllab-a14b0f7c...): `after` propuesto en una sola línea se formatea antes de diffear, en vez de mostrarse como "se borra todo, se agrega 1 línea"', () => {
    const before = 'SELECT x,y\nFROM t\nGROUP BY x,y';
    // Mismo SQL lógico que `before`, pero el modelo lo entregó todo junto
    // (caso real: 6500+ caracteres sin ningún salto) -- intencionalmente
    // más largo que el umbral de `looksUnformattedSql` (80 caracteres).
    const after =
      'SELECT x,y,extra_column_para_superar_el_umbral_de_longitud_del_formateador_de_sql FROM t GROUP BY x,y';

    const { container } = render(<SqlDiff before={before} after={after} />);

    // Si NO se hubiera formateado, el diff vería "after" como una sola
    // línea gigante -- un solo renglón "agregado" con todo el texto, sin
    // "FROM t"/"GROUP BY" como líneas propias reconocibles.
    const lineDivs = Array.from(container.querySelectorAll('.irex-sqldiff-body > div'));
    const lineTexts = lineDivs.map(el => el.textContent?.trim());
    expect(lineTexts).toContain('FROM t');
    expect(lineTexts.some(t => t?.startsWith('GROUP BY x,'))).toBe(true);
    // Ninguna línea mezcla la columna nueva CON "GROUP BY" -- si no se
    // hubiera formateado, "after" entero caería en una sola línea.
    expect(lineTexts.some(t => t?.includes('extra_column') && t?.includes('GROUP BY'))).toBe(false);
  });

  test('"after" corto sin salto de línea no se toca -- no hace falta reformatear un SQL chico', () => {
    const { container } = render(<SqlDiff before="SELECT 1" after="SELECT 2" />);
    expect(container.textContent).toContain('SELECT 1');
    expect(container.textContent).toContain('SELECT 2');
  });

  test('"before" vacío (SQL nuevo) sigue mostrando el badge "SQL NUEVO" después de normalizar', () => {
    render(<SqlDiff before="" after={'a,'.repeat(60) + 'z FROM t'} />);
    expect(screen.getByText('SQL NUEVO')).toBeInTheDocument();
  });
});
