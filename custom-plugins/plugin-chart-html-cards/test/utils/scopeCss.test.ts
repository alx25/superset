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
import { scopeCss } from '../../src/utils/scopeCss';

describe('scopeCss', () => {
  it('prefixes regular selectors with the chart scope', () => {
    const scoped = scopeCss(
      '.title, .value { color: red; }',
      '[data-html-cards-scope="abc123"]',
    );

    expect(scoped).toContain(
      '[data-html-cards-scope="abc123"] .title, [data-html-cards-scope="abc123"] .value',
    );
  });

  it('keeps keyframe steps untouched while scoping container rules', () => {
    const scoped = scopeCss(
      `
      @container html-cards-chart (max-width: 500px) {
        .card { padding: 8px; }
      }

      @keyframes pulse {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      `,
      '[data-html-cards-scope="abc123"]',
    );

    expect(scoped).toContain(
      '[data-html-cards-scope="abc123"] .card { padding: 8px; }',
    );
    expect(scoped).toContain('from { opacity: 0; }');
    expect(scoped).toContain('to { opacity: 1; }');
  });
});
