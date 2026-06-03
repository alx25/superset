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
import { ControlSetItem } from '@superset-ui/chart-controls';
import { DataRecord, GenericDataType, VizType } from '@superset-ui/core';
import { render } from 'spec/helpers/testing-library';
import HtmlCards from '../src/HtmlCards';
import { HtmlCardsProps, HtmlCardsQueryFormData } from '../src/types';
import { handlebarsTemplateControlSetItem } from '../src/plugin/controls/handlebarTemplate';
import { styleControlSetItem } from '../src/plugin/controls/style';

function setBootstrapConfig() {
  document.body.innerHTML = '<div id="app"></div>';
  document.getElementById('app')?.setAttribute(
    'data-bootstrap',
    JSON.stringify({
      common: {
        conf: {
          HTML_SANITIZATION: false,
        },
      },
    }),
  );
}

describe('HTML Cards', () => {
  const styleControl = styleControlSetItem as ControlSetItem & {
    config: { default: string };
  };
  const templateControl = handlebarsTemplateControlSetItem as ControlSetItem & {
    config: { default: string };
  };

  beforeEach(() => {
    setBootstrapConfig();
  });

  it('renders templates and styles from snake_case form data keys', () => {
    const formData: HtmlCardsQueryFormData = {
      datasource: '3__table',
      width: 640,
      height: 320,
      viz_type: VizType.HtmlCards,
      style_template: '.html-card { color: rgb(255, 0, 0); }',
      handlebars_template:
        '<section class="html-cards"><article class="html-card">{{firstRow.label}} {{firstDisplayRow.revenue}}</article></section>',
    };
    const props: HtmlCardsProps = {
      columns: [
        {
          key: 'value',
          displayName: 'Revenue',
          templateKey: 'revenue',
          type: GenericDataType.Numeric,
          isMetric: true,
          isPercentMetric: false,
        },
      ],
      width: 640,
      height: 320,
      data: [{ label: 'Revenue', value: 123 } as DataRecord],
      displayRows: [{ revenue: 123 } as DataRecord],
      firstDisplayRow: { revenue: 123 } as DataRecord,
      formData,
      layout: {
        width: 640,
        height: 320,
        isNarrow: true,
        isTiny: false,
        isShort: true,
        isCompact: true,
      },
    };

    const { container } = render(React.createElement(HtmlCards, props));

    expect(container.querySelector('.html-cards')).toBeInTheDocument();
    expect(container.querySelector('.html-card')?.textContent).toBe(
      'Revenue 123',
    );
    expect(container.querySelector('style')?.textContent).toContain(
      '.html-card { color: rgb(255, 0, 0); }',
    );
    expect(
      container.querySelector('.html-cards-chart'),
    ).toHaveAttribute('data-html-cards-scope');
    expect(container.querySelector('style')?.textContent).toMatch(
      /\[data-html-cards-scope="html-cards-[^"]+"\] \.html-card \{ color: rgb\(255, 0, 0\); \}/,
    );
  });

  it('renders the default starter template for datasets without KPI-specific fields', () => {
    const formData: HtmlCardsQueryFormData = {
      datasource: '3__table',
      width: 320,
      height: 220,
      viz_type: VizType.HtmlCards,
      style_template: String(styleControl.config.default),
      handlebars_template: String(templateControl.config.default),
    };
    const props: HtmlCardsProps = {
      columns: [
        {
          key: 'ventas_hash_123',
          displayName: 'Ventas',
          templateKey: 'ventas',
          type: GenericDataType.Numeric,
          isMetric: true,
          isPercentMetric: false,
        },
      ],
      width: 320,
      height: 220,
      data: [{ ventas_hash_123: 4567 } as DataRecord],
      displayRows: [{ ventas: 4567 } as DataRecord],
      firstDisplayRow: { ventas: 4567 } as DataRecord,
      formData,
      layout: {
        width: 320,
        height: 220,
        isNarrow: true,
        isTiny: true,
        isShort: true,
        isCompact: true,
      },
    };

    const { container } = render(React.createElement(HtmlCards, props));

    expect(container.querySelector('.kpi-mini')).toBeInTheDocument();
    expect(container.querySelector('.kpi-mini__title')?.textContent?.trim()).toBe(
      'Ventas',
    );
    expect(container.querySelector('.kpi-mini__value')?.textContent).toContain(
      '4,567',
    );
  });

  it('injects theme CSS variables on the chart container', () => {
    const formData: HtmlCardsQueryFormData = {
      datasource: '3__table',
      width: 320,
      height: 220,
      viz_type: VizType.HtmlCards,
      style_template:
        '.html-card { color: var(--html-cards-theme-color-primary); }',
      handlebars_template: '<section class="html-card">Demo</section>',
    };
    const props: HtmlCardsProps = {
      columns: [],
      width: 320,
      height: 220,
      data: [],
      displayRows: [],
      firstDisplayRow: null,
      formData,
      layout: {
        width: 320,
        height: 220,
        isNarrow: true,
        isTiny: true,
        isShort: true,
        isCompact: true,
      },
    };

    const { container } = render(React.createElement(HtmlCards, props));
    const chart = container.querySelector('.html-cards-chart') as HTMLElement;

    expect(chart.style.getPropertyValue('--html-cards-theme-color-primary')).toBeTruthy();
    expect(chart.style.getPropertyValue('--html-cards-theme-font-family')).toBeTruthy();
  });
});
