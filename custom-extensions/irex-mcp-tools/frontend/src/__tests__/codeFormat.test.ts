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
import { CSS_CONTROLS, formatCodeForDiff, formatCss, formatHtml, HTML_CONTROLS } from '../assistant/codeFormat';

describe('formatCss', () => {
  test('indenta reglas simples por profundidad de llaves', () => {
    const input = '.a{color:red;background:blue}.b{padding:1px}';
    const result = formatCss(input);
    expect(result).toBe('.a {\n  color:red;\n  background:blue\n}\n\n.b {\n  padding:1px\n}');
  });

  test('preserva contenido de strings con llaves literales sin romperlo', () => {
    const input = '.a{content:"x{y}z";color:red}';
    const result = formatCss(input);
    expect(result).toContain('content:"x{y}z"');
    // no cuenta las llaves DENTRO del string como estructurales
    expect(result.split('\n').filter(l => l.trim() === '}')).toHaveLength(1);
  });

  test('anida reglas correctamente (ej. @container/@media)', () => {
    const input = '@media (max-width:900px){.a{color:red}}';
    const result = formatCss(input);
    expect(result).toBe('@media (max-width:900px) {\n  .a {\n    color:red\n  }\n}');
  });

  test('colapsa espacios/saltos ya existentes en el CSS de entrada', () => {
    const input = '.a {\n\n  color:   red;\n\n\n}';
    const result = formatCss(input);
    expect(result).toBe('.a {\n  color: red;\n}');
  });

  test('string vacío o solo espacios da string vacío, sin romper', () => {
    expect(formatCss('')).toBe('');
    expect(formatCss('   \n  ')).toBe('');
  });

  test('no deja llaves de más ni de menos con anidamiento profundo (rgba con paréntesis, no llaves)', () => {
    const input = '.a{box-shadow:0 0 4px rgba(0,0,0,.2)}';
    const result = formatCss(input);
    expect(result).toBe('.a {\n  box-shadow:0 0 4px rgba(0,0,0,.2)\n}');
  });
});

describe('formatHtml', () => {
  test('indenta tags HTML simples por profundidad', () => {
    const input = '<div><span>hola</span></div>';
    const result = formatHtml(input);
    expect(result).toBe('<div>\n  <span>\n    hola\n  </span>\n</div>');
  });

  test('elementos vacíos (br, img) no aumentan la profundidad', () => {
    const input = '<div><br><img src="x.png"></div>';
    const result = formatHtml(input);
    expect(result.split('\n')).toEqual([
      '<div>',
      '  <br>',
      '  <img src="x.png">',
      '</div>',
    ]);
  });

  test('tags autocerrados (/>) no aumentan la profundidad', () => {
    const input = '<div><hr/></div>';
    const result = formatHtml(input);
    expect(result.split('\n')).toEqual(['<div>', '  <hr/>', '</div>']);
  });

  test('bloques Handlebars {{#if}}/{{else}}/{{/if}} indentan igual que HTML', () => {
    const input = '{{#if x}}<span>si</span>{{else}}<span>no</span>{{/if}}';
    const result = formatHtml(input);
    expect(result.split('\n')).toEqual([
      '{{#if x}}',
      '  <span>',
      '    si',
      '  </span>',
      '{{else}}',
      '  <span>',
      '    no',
      '  </span>',
      '{{/if}}',
    ]);
  });

  test('{{#each}} anidado con HTML adentro', () => {
    const input = '<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>';
    const result = formatHtml(input);
    expect(result.split('\n')).toEqual([
      '<ul>',
      '  {{#each items}}',
      '    <li>',
      '      {{this}}',
      '    </li>',
      '  {{/each}}',
      '</ul>',
    ]);
  });

  test('atributos con ">" dentro de comillas no cortan la etiqueta antes de tiempo', () => {
    const input = '<div title="a > b"><span>x</span></div>';
    const result = formatHtml(input);
    expect(result.split('\n')[0]).toBe('<div title="a > b">');
  });

  test('string vacío da string vacío', () => {
    expect(formatHtml('')).toBe('');
  });
});

describe('formatCodeForDiff', () => {
  test('formatea styleTemplate como CSS', () => {
    const result = formatCodeForDiff('styleTemplate', '.a{color:red}');
    expect(result).toBe('.a {\n  color:red\n}');
  });

  test('formatea handlebarsTemplate como HTML', () => {
    const result = formatCodeForDiff('handlebarsTemplate', '<div>{{value}}</div>');
    expect(result).toBe('<div>\n  {{value}}\n</div>');
  });

  test('otros controles devuelven undefined (formateo genérico de siempre)', () => {
    expect(formatCodeForDiff('groupby', ['col_a'])).toBeUndefined();
    expect(formatCodeForDiff('row_limit', 1000)).toBeUndefined();
  });

  test('un valor que no es string (undefined, objeto) no se formatea', () => {
    expect(formatCodeForDiff('styleTemplate', undefined)).toBeUndefined();
    expect(formatCodeForDiff('styleTemplate', { a: 1 })).toBeUndefined();
  });

  test('string vacío o solo espacios en un control CSS/HTML tampoco se formatea (no hay nada que mostrar formateado)', () => {
    expect(formatCodeForDiff('styleTemplate', '')).toBeUndefined();
    expect(formatCodeForDiff('styleTemplate', '   ')).toBeUndefined();
  });

  test('el registro de controles CSS/HTML no se solapa', () => {
    CSS_CONTROLS.forEach(name => {
      expect(HTML_CONTROLS.has(name)).toBe(false);
    });
  });
});
