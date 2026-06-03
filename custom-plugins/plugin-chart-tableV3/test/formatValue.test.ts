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
import { GenericDataType } from '@superset-ui/core';
import {
  formatColumnValue,
  getHtmlTemplateScopeClass,
  getScopedHtmlTemplateCss,
} from '../src/utils/formatValue';

describe('formatColumnValue', () => {
  it('applies CSS from a separate field to the rendered HTML template', () => {
    const column = {
      key: 'sum__num',
      label: 'sum__num',
      dataType: GenericDataType.Numeric,
      config: {
        enableHtmlTemplate: true,
        htmlTemplate:
          '<span class="pill"><span class="value">{{ value }}</span></span>',
        htmlCss:
          '.pill { background: #eef2ff; color: #1e3a8a; } .value { text-transform: uppercase; }',
      },
    };
    const [isHtml, rendered] = formatColumnValue(column, 10, { sum__num: 10 });
    const scopeClass = getHtmlTemplateScopeClass(column as any);
    const scopedCss = getScopedHtmlTemplateCss(column as any);

    expect(isHtml).toBe(true);
    expect(rendered).toContain('class="pill"');
    expect(scopedCss).toContain(`.${scopeClass} .pill`);
    expect(scopedCss).toContain('background: #eef2ff');
    expect(scopedCss).toContain('text-transform: uppercase');
  });

  it('keeps keyframes and scopes animation selectors for HTML template CSS', () => {
    const column = {
      key: 'sum__num',
      label: 'sum__num',
      dataType: GenericDataType.Numeric,
      config: {
        enableHtmlTemplate: true,
        htmlCss:
          '@keyframes shimmer { 0% { opacity: 0.2; } 100% { opacity: 1; } } .badge-positive { animation: shimmer 3s infinite linear; }',
      },
    };
    const scopeClass = getHtmlTemplateScopeClass(column as any);
    const scopedCss = getScopedHtmlTemplateCss(column as any);

    expect(scopedCss).toContain('@keyframes shimmer');
    expect(scopedCss).toContain(
      `.${scopeClass} .badge-positive { animation: shimmer 3s infinite linear; }`,
    );
  });
});
