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
import { render } from 'spec/helpers/testing-library';
import { normalizeRenderedTemplate } from '../../src/utils/normalizeRenderedTemplate';
import { HandlebarsViewer } from '../../src/components/Handlebars/HandlebarsViewer';

function setBootstrapConfig(htmlSanitization: boolean) {
  document.body.innerHTML = '<div id="app"></div>';
  document.getElementById('app')?.setAttribute(
    'data-bootstrap',
    JSON.stringify({
      common: {
        conf: {
          HTML_SANITIZATION: htmlSanitization,
        },
      },
    }),
  );
}

describe('HTML Cards HandlebarsViewer', () => {
  it('removes common indentation so HTML is not treated as markdown code', () => {
    const template = `
        <div class="card-grid">
          <article class="card">
            <strong>Example</strong>
          </article>
        </div>
    `;

    expect(normalizeRenderedTemplate(template)).toBe(
      [
        '<div class="card-grid">',
        '  <article class="card">',
        '    <strong>Example</strong>',
        '  </article>',
        '</div>',
      ].join('\n'),
    );
  });

  it('renders compiled markup as HTML when sanitization is disabled', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: `
          <div class="card-grid">
            <article class="card">
              <strong>{{value}}</strong>
            </article>
          </div>
        `,
        data: { value: 'Example card' },
      }),
    );

    expect(container.querySelector('.card-grid')).toBeInTheDocument();
    expect(container.querySelector('.card strong')?.textContent).toBe(
      'Example card',
    );
  });

  it('sanitizes unsafe tags when sanitization is enabled', () => {
    setBootstrapConfig(true);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource:
          '<div class="card-grid"><strong>{{value}}</strong></div><script>alert("x")</script>',
        data: { value: 'Safe card' },
      }),
    );

    expect(container.querySelector('.card-grid')).toBeInTheDocument();
    expect(container.querySelector('script')).not.toBeInTheDocument();
    expect(container.querySelector('.card-grid strong')?.textContent).toBe(
      'Safe card',
    );
  });

  it('formats values with Superset native number and time formatters', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: `
          <div class="formatted-card">
            <span class="formatted-card__number">{{numberFormatD3 percent ".1%"}}</span>
            <span class="formatted-card__time">{{timeFormatD3 date "%Y-%m"}}</span>
          </div>
        `,
        data: {
          percent: 0.832,
          date: '2026-04-16T00:00:00Z',
        },
      }),
    );

    expect(
      container.querySelector('.formatted-card__number')?.textContent,
    ).toBe('83.2%');
    expect(container.querySelector('.formatted-card__time')?.textContent).toBe(
      '2026-04',
    );
  });

  it('supports pluck and array-aware sum helpers', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: `
          <div class="aggregate-card">
            <span class="aggregate-card__total">{{sum (pluck rows "ventas")}}</span>
            <span class="aggregate-card__direct">{{sum 10 20 5}}</span>
          </div>
        `,
        data: {
          rows: [{ ventas: 10 }, { ventas: '20' }, { ventas: null }, {}],
        },
      }),
    );

    expect(container.querySelector('.aggregate-card__total')?.textContent).toBe(
      '30',
    );
    expect(container.querySelector('.aggregate-card__direct')?.textContent).toBe(
      '35',
    );
  });

  it('wires up sort and resize on tables opted in via data-hc-* attributes', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: `
          <table data-hc-sort data-hc-resize>
            <colgroup><col style="width: 100px"></colgroup>
            <thead><tr><th data-hc-key="n">Num</th></tr></thead>
            <tbody>
              <tr><td>2</td></tr>
              <tr><td>1</td></tr>
            </tbody>
          </table>
        `,
        data: {},
      }),
    );

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('.hc-resize-handle')).toBeInTheDocument();

    container.querySelector('th')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    const firstCells = Array.from(
      container.querySelectorAll('tbody tr td:first-child'),
    ).map(cell => cell.textContent);
    expect(firstCells).toEqual(['1', '2']);
  });

  it('leaves plain tables without data-hc-* attributes untouched', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: `
          <table>
            <thead><tr><th>Num</th></tr></thead>
            <tbody><tr><td>2</td></tr><tr><td>1</td></tr></tbody>
          </table>
        `,
        data: {},
      }),
    );

    expect(container.querySelector('.hc-resize-handle')).not.toBeInTheDocument();
  });

  it('renders helper errors instead of crashing when a template helper throws', () => {
    setBootstrapConfig(false);

    const { container } = render(
      React.createElement(HandlebarsViewer, {
        templateSource: '<div>{{stringify}}</div>',
        data: {},
      }),
    );

    expect(container.textContent).toContain('Please call with an object');
  });
});
