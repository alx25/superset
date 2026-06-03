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
import { ControlSetItem } from '@superset-ui/chart-controls';
import {
  DEFAULT_STYLE_TEMPLATE,
  styleControlSetItem,
} from '../../src/plugin/controls/style';

describe('HTML Cards style control', () => {
  it('provides a default CSS template to the chart form data', () => {
    const control = styleControlSetItem as ControlSetItem & {
      config: { default: string };
    };

    expect(control.config.default).toBe(DEFAULT_STYLE_TEMPLATE);
    expect(String(control.config.default)).toContain(
      '.kpi-mini-grid',
    );
    expect(String(control.config.default)).toContain('height: 100%');
    expect(String(control.config.default)).toContain(
      'overflow: visible',
    );
    expect(String(control.config.default)).toContain(
      'isolation: isolate',
    );
    expect(String(control.config.default)).toContain(
      '@container html-cards-chart (max-height: 420px)',
    );
  });
});
