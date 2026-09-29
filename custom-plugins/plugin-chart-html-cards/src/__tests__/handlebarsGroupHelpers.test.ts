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
import Handlebars from 'handlebars';
// Importado solo por su efecto de registrar los helpers reales
// (Handlebars.registerHelper + Helpers.registerHelpers + HandlebarsGroupBy.register)
// contra la MISMA instancia de `handlebars` que usa el componente real —
// evita reimplementar los helpers acá y que la prueba quede desincronizada
// del plugin real. Ver HandlebarsViewer.tsx.
import '../components/Handlebars/HandlebarsViewer';

// Reportado por el backend del chat (sesión explore-fa693d0e...,
// 2026-09-28): el asistente rechazó proponer una tarjeta por familia con
// una tabla de marcas anidada porque no tenía documentado cómo agrupar
// filas dentro de la plantilla. Esta prueba reproduce exactamente ese caso
// de uso con datos sintéticos (sin fijar nombres reales de familia/marca)
// contra los helpers REALES registrados por el plugin.
describe('group + pluck + sum + division combinados (tabla anidada por grupo)', () => {
  const displayRows = [
    { group_key: 'Grupo A', item_key: 'Item 1', value_key: 100 },
    { group_key: 'Grupo A', item_key: 'Item 2', value_key: 50 },
    { group_key: 'Grupo B', item_key: 'Item 3', value_key: 30 },
  ];

  it('agrupa displayRows por una propiedad arbitraria y expone value + items', () => {
    const template = Handlebars.compile(
      '{{#group displayRows by="group_key"}}' +
        '[{{value}}:{{#each items}}{{item_key}}={{value_key}};{{/each}}]' +
        '{{/group}}',
    );

    const result = template({ displayRows });

    expect(result).toContain('[Grupo A:Item 1=100;Item 2=50;]');
    expect(result).toContain('[Grupo B:Item 3=30;]');
  });

  it('agrega valores dentro de cada grupo con sum + pluck, como una tarjeta con tabla anidada', () => {
    const template = Handlebars.compile(
      '{{#group displayRows by="group_key"}}' +
        '<h3>{{value}}</h3><p>total: {{sum (pluck items "value_key")}}</p>' +
        '{{/group}}',
    );

    const result = template({ displayRows });

    expect(result).toContain('<h3>Grupo A</h3><p>total: 150</p>');
    expect(result).toContain('<h3>Grupo B</h3><p>total: 30</p>');
  });

  it('division no protege contra denominador 0/null por sí sola', () => {
    const template = Handlebars.compile('{{division a b}}');

    expect(template({ a: 10, b: 2 })).toBe('5');
    expect(template({ a: 10, b: 0 })).toBe('Infinity');
    expect(template({ a: 10, b: undefined })).toBe('NaN');
  });

  it('el guard recomendado en la documentación ({{#if b}}) sí evita el 0/null', () => {
    const template = Handlebars.compile(
      '{{#if b}}{{division a b}}{{else}}—{{/if}}',
    );

    expect(template({ a: 10, b: 2 })).toBe('5');
    expect(template({ a: 10, b: 0 })).toBe('—');
    expect(template({ a: 10, b: undefined })).toBe('—');
    expect(template({ a: 10, b: null })).toBe('—');
  });

  it('combina group + sum + division con protección de denominador 0, caso completo del reporte', () => {
    // Reproduce el caso pedido: cumplimiento agregado (sell_in/planv) por
    // grupo, con tabla anidada de items y protección de denominador 0.
    //
    // Deliberadamente NO usa {{#with ... as |x|}} para precalcular el
    // denominador: dentro de un {{#with}} anidado, referencias sin `../`
    // como {{value}} o `items` dejan de apuntar al contexto del {{#group}}
    // exterior (pasan a resolverse contra el nuevo contexto del `with`) y
    // el resultado se rompe en silencio (se comprobó al escribir esta
    // prueba: {{value}} salía vacío e `items` vacío sin ningún error).
    // Repetir `(sum (pluck items "planv_key"))` es más verboso pero evita
    // esa trampa de scope — el patrón documentado en control_info usa esta
    // misma forma repetida a propósito.
    const rows = [
      { group_key: 'Grupo A', sell_in_key: 100, planv_key: 200 },
      { group_key: 'Grupo A', sell_in_key: 50, planv_key: 0 },
      { group_key: 'Grupo B', sell_in_key: 0, planv_key: 0 },
    ];
    const template = Handlebars.compile(
      '{{#group displayRows by="group_key"}}' +
        '<span>{{value}}: {{#if (sum (pluck items "planv_key"))}}' +
        '{{division (sum (pluck items "sell_in_key")) (sum (pluck items "planv_key"))}}' +
        '{{else}}—{{/if}}</span>' +
        '{{/group}}',
    );

    const result = template({ displayRows: rows });

    // Grupo A: sell_in=150, planv=200 -> 0.75
    expect(result).toContain('<span>Grupo A: 0.75</span>');
    // Grupo B: planv=0 -> guard evita la división por cero
    expect(result).toContain('<span>Grupo B: —</span>');
  });
});
