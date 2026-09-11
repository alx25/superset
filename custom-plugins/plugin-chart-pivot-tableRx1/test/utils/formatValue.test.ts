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
import {
  extractJinjaValues,
  resolveJinjaTemplate,
} from '../../src/utils/formatValue';

describe('resolveJinjaTemplate / extractJinjaValues', () => {
  it('extracts the configured jinja fields from the first record only', () => {
    const values = extractJinjaValues(
      [
        { anio_num: 2026, mes_nombre: 'Septiembre', Venta: 100 },
        { anio_num: 2026, mes_nombre: 'Septiembre', Venta: 200 },
      ],
      ['anio_num', 'mes_nombre'],
    );
    expect(values).toEqual({ anio_num: 2026, mes_nombre: 'Septiembre' });
  });

  it('substitutes a {{Jinja Field}} placeholder in a display name', () => {
    const values = extractJinjaValues([{ anio_num: 2026 }], ['anio_num']);
    expect(resolveJinjaTemplate('Ventas {{anio_num}}', values)).toBe(
      'Ventas 2,026',
    );
  });

  it('substitutes multiple placeholders in the same template', () => {
    const values = extractJinjaValues(
      [{ anio_num: 2026, mes_nombre: 'Septiembre' }],
      ['anio_num', 'mes_nombre'],
    );
    expect(
      resolveJinjaTemplate('Ventas {{mes_nombre}} {{anio_num}}', values),
    ).toBe('Ventas Septiembre 2,026');
  });

  it('leaves a placeholder untouched when its field was not selected', () => {
    const values = extractJinjaValues([{ anio_num: 2026 }], ['anio_num']);
    expect(resolveJinjaTemplate('Ventas {{otro_campo}}', values)).toBe(
      'Ventas {{otro_campo}}',
    );
  });

  it('returns an empty mapping when there is no data or no jinja fields', () => {
    expect(extractJinjaValues([], ['anio_num'])).toEqual({});
    expect(extractJinjaValues([{ anio_num: 2026 }], [])).toEqual({});
  });
});
