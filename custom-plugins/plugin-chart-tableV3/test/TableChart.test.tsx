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
import type { CommonWrapper } from 'enzyme';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GenericDataType, QueryMode } from '@superset-ui/core';
import TableChart from '../src/TableChart';
import transformProps from '../src/transformProps';
import DateWithFormatter from '../src/utils/DateWithFormatter';
import testData from './testData';
import { mount, ProviderWrapper } from './enzyme';

describe('plugin-chart-table', () => {
  describe('transformProps', () => {
    it('should parse pageLength to pageSize', () => {
      expect(transformProps(testData.basic).pageSize).toBe(20);
      expect(
        transformProps({
          ...testData.basic,
          rawFormData: { ...testData.basic.rawFormData, page_length: '20' },
        }).pageSize,
      ).toBe(20);
      expect(
        transformProps({
          ...testData.basic,
          rawFormData: { ...testData.basic.rawFormData, page_length: '' },
        }).pageSize,
      ).toBe(0);
    });

    it('should memoize data records', () => {
      expect(transformProps(testData.basic).data).toBe(
        transformProps(testData.basic).data,
      );
    });

    it('should memoize columns meta', () => {
      expect(transformProps(testData.basic).columns).toBe(
        transformProps({
          ...testData.basic,
          rawFormData: { ...testData.basic.rawFormData, pageLength: null },
        }).columns,
      );
    });

    it('should format timestamp', () => {
      // eslint-disable-next-line no-underscore-dangle
      const parsedDate = transformProps(testData.basic).data[0]
        .__timestamp as DateWithFormatter;
      expect(String(parsedDate)).toBe('2020-01-01 12:34:56');
      expect(parsedDate.getTime()).toBe(1577882096000);
    });

    it('should restrict Top N metrics to visible metrics and use display names', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          metrics: ['sum__num', 'sum__denom'],
          show_top: true,
          top_show_in_chart: true,
          top_metric: null,
          column_config: {
            ...testData.advanced.rawFormData.column_config,
            sum__num: {
              ...testData.advanced.rawFormData.column_config?.sum__num,
              displayName: 'Venta',
            },
            sum__denom: {
              d3NumberFormat: '.3s',
              displayName: 'Plan venta',
            },
          },
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num', 'sum__denom'],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
            ],
            data: [
              { name: 'Team A', sum__num: 100, sum__denom: 200 },
              { name: 'Team B', sum__num: 50, sum__denom: 80 },
            ],
          },
        ],
      });

      expect(props.topConfig?.metric).toBe('sum__num');
      expect(props.topConfig?.topMetrics).toEqual([
        { value: 'sum__num', label: 'Venta' },
        { value: 'sum__denom', label: 'Plan venta' },
      ]);
    });

    it('should pass column order through to the chart props', () => {
      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            column_order: ['sum__num', 'ratio', 'name'],
          },
        }).columnOrder,
      ).toEqual(['sum__num', 'ratio', 'name']);
    });

    it('should ignore invalid row grouping columns and keep valid ones', () => {
      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            groupby: ['name'],
            enable_row_grouping: true,
            row_grouping_column: 'sum__num',
            show_row_group_totals: true,
          },
        }).rowGroupingColumn,
      ).toBeUndefined();

      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            groupby: ['name'],
            enable_row_grouping: true,
            row_grouping_column: '#',
            show_row_numbers: true,
            show_row_group_totals: true,
          },
        }).rowGroupingColumn,
      ).toBeUndefined();

      const groupedProps = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_row_group_totals: true,
        },
      });

      expect(groupedProps.rowGroupingColumn).toBe('name');
      expect(groupedProps.showRowGroupTotals).toBe(true);
    });

    it('should enable default collapsed groups only for valid grouping columns', () => {
      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            groupby: ['name'],
            enable_row_grouping: true,
            row_grouping_column: 'sum__num',
            row_grouping_default_collapsed: true,
          },
        }).rowGroupingDefaultCollapsed,
      ).toBe(false);

      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            groupby: ['name'],
            enable_row_grouping: true,
            row_grouping_column: 'name',
            row_grouping_default_collapsed: true,
          },
        }).rowGroupingDefaultCollapsed,
      ).toBe(true);

      expect(
        transformProps({
          ...testData.advanced,
          rawFormData: {
            ...testData.advanced.rawFormData,
            groupby: ['name'],
            enable_row_grouping: true,
            row_grouping_column: 'name',
            row_grouping_compact_view: true,
          },
        }).rowGroupingCompactView,
      ).toBe(true);
    });
  });

  describe('TableChart', () => {
    let wrap: CommonWrapper; // the ReactDataTable wrapper
    type RenderedTree = ReturnType<CommonWrapper['render']>;
    let tree: RenderedTree;

    it('render basic data', () => {
      wrap = mount(
        <TableChart {...transformProps(testData.basic)} sticky={false} />,
      );

      tree = wrap.render(); // returns a CheerioWrapper with jQuery-like API
      const cells = tree.find('td');
      expect(cells).toHaveLength(12);
      expect(cells.eq(0).text()).toEqual('2020-01-01 12:34:56');
      expect(cells.eq(1).text()).toEqual('Michael');
      // number is not in `metrics` list, so it should output raw value
      // (in real world Superset, this would mean the column is used in GROUP BY)
      expect(cells.eq(2).text()).toEqual('2467063');
      // should not render column with `.` in name as `undefined`
      expect(cells.eq(3).text()).toEqual('foo');
      expect(cells.eq(6).text()).toEqual('2467');
      expect(cells.eq(8).text()).toEqual('N/A');
    });

    it('render advanced data', () => {
      wrap = mount(
        <TableChart {...transformProps(testData.advanced)} sticky={false} />,
      );
      tree = wrap.render();
      // should successful rerender with new props
      const cells = tree.find('td');
      expect(tree.find('th').eq(1).text()).toEqual('Sum of Num');
      expect(cells.eq(0).text()).toEqual('Michael');
      expect(cells.eq(2).text()).toEqual('12.346%');
      expect(cells.eq(4).text()).toEqual('2.47k');
    });

    it('keeps the selected Top N metric column visible in the table', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          show_top: true,
          top_metric: 'sum__num',
          top_count: 1,
        },
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const headers = Array.from(document.querySelectorAll('th')).map(header =>
        header.textContent?.trim(),
      );

      expect(headers).toContain('Sum of Num');
      expect(screen.getByText('Michael')).toBeInTheDocument();
    });

    it('render advanced data with currencies', () => {
      render(
        ProviderWrapper({
          children: (
            <TableChart
              {...transformProps(testData.advancedWithCurrency)}
              sticky={false}
            />
          ),
        }),
      );
      const cells = document.querySelectorAll('td');
      expect(document.querySelectorAll('th')[1]).toHaveTextContent(
        'Sum of Num',
      );
      expect(cells[0]).toHaveTextContent('Michael');
      expect(cells[2]).toHaveTextContent('12.346%');
      expect(cells[4]).toHaveTextContent('$ 2.47k');
    });

    it('render raw data', () => {
      const props = transformProps({
        ...testData.raw,
        rawFormData: { ...testData.raw.rawFormData },
      });
      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );
      const cells = document.querySelectorAll('td');
      expect(document.querySelectorAll('th')[0]).toHaveTextContent('num');
      expect(cells[0]).toHaveTextContent('1234');
      expect(cells[1]).toHaveTextContent('10000');
      expect(cells[1]).toHaveTextContent('0');
    });

    it('render raw data with currencies', () => {
      const props = transformProps({
        ...testData.raw,
        rawFormData: {
          ...testData.raw.rawFormData,
          column_config: {
            num: {
              currencyFormat: { symbol: 'USD', symbolPosition: 'prefix' },
            },
          },
        },
      });
      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );
      const cells = document.querySelectorAll('td');

      expect(document.querySelectorAll('th')[0]).toHaveTextContent('num');
      expect(cells[0]).toHaveTextContent('$ 1.23k');
      expect(cells[1]).toHaveTextContent('$ 10k');
      expect(cells[2]).toHaveTextContent('$ 0');
    });

    it('renders grouped rows with inline subtotal summary', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_row_group_totals: true,
          show_cell_bars: false,
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            data: [
              { name: 'Team A', sum__num: 100, '%pct_nice': 0.1 },
              { name: 'Team A', sum__num: 50, '%pct_nice': 0.2 },
              { name: 'Team B', sum__num: 20, '%pct_nice': 0.3 },
            ],
          },
        ],
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(screen.getByText('Team A')).toBeInTheDocument();
      expect(screen.getByText('2 rows')).toBeInTheDocument();
      expect(screen.getByText('Subtotal')).toBeInTheDocument();
      expect(screen.getByText('Sum of Num')).toBeInTheDocument();
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(document.querySelector('.dt-group-total-row')).toBeNull();
      expect(document.querySelector('.dt-grouping-key-cell')).not.toBeNull();
    });

    it('evaluates calculated column subtotals from aggregated metric totals', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          metrics: ['sum__num', 'sum__denom'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_row_group_totals: true,
          show_cell_bars: false,
          calculated_columns: [
            {
              key: 'calc_ratio',
              label: 'ratio',
              expression: '{{sum__num}} / {{sum__denom}}',
              d3format: '.1%',
            },
          ],
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num', 'sum__denom'],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
            ],
            data: [
              { name: 'Team A', sum__num: 90, sum__denom: 100 },
              { name: 'Team A', sum__num: 10, sum__denom: 100 },
              { name: 'Team B', sum__num: 25, sum__denom: 50 },
            ],
          },
        ],
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const groupHeaderRows = container.querySelectorAll(
        'tbody tr.dt-group-header-row',
      );
      expect(groupHeaderRows[0]).toHaveTextContent('Team A');
      expect(groupHeaderRows[0]).toHaveTextContent('100');
      expect(groupHeaderRows[0]).toHaveTextContent('200');
      expect(groupHeaderRows[0]).toHaveTextContent('50.0%');
      expect(groupHeaderRows[0]).not.toHaveTextContent('100.0%');
    });

    it('evaluates calculated columns in the global summary from aggregated totals', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          query_mode: QueryMode.Aggregate,
          metrics: ['sum__num', 'sum__denom'],
          show_totals: true,
          show_cell_bars: false,
          calculated_columns: [
            {
              key: 'calc_ratio',
              label: 'ratio',
              expression: '{{sum__num}} / {{sum__denom}}',
              d3format: '.1%',
            },
          ],
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num', 'sum__denom'],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.Numeric,
            ],
            data: [
              { name: 'Team A', sum__num: 90, sum__denom: 100 },
              { name: 'Team B', sum__num: 10, sum__denom: 100 },
            ],
          },
          {
            ...testData.advanced.queriesData[0],
            colnames: ['sum__num', 'sum__denom'],
            coltypes: [GenericDataType.Numeric, GenericDataType.Numeric],
            data: [{ sum__num: 100, sum__denom: 200 }],
          },
        ],
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const footer = container.querySelector('tfoot');
      expect(footer).not.toBeNull();
      expect(footer).toHaveTextContent('Resumen');
      expect(footer).toHaveTextContent('100');
      expect(footer).toHaveTextContent('200');
      expect(footer).toHaveTextContent('50.0%');
      expect(footer).not.toHaveTextContent('100.0%');
    });

    it('applies Customize columns display names to calculated columns', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          metrics: ['sum__num'],
          show_cell_bars: false,
          calculated_columns: [
            {
              key: 'calc_ratio',
              label: 'ratio',
              expression: '{{sum__num}}',
              d3format: '.0f',
            },
          ],
          column_config: {
            ratio: {
              displayName: 'Ratio visible',
            },
          },
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num'],
            coltypes: [GenericDataType.String, GenericDataType.Numeric],
            data: [{ name: 'Team A', sum__num: 10 }],
          },
        ],
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const headers = Array.from(document.querySelectorAll('thead th')).map(
        header => header.textContent?.trim() ?? '',
      );

      expect(headers.some(header => header.includes('Ratio visible'))).toBe(
        true,
      );
    });

    it('resolves jinja templates in calculated column labels', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          metrics: ['sum__num'],
          jinja_fields: ['current_period'],
          show_cell_bars: false,
          calculated_columns: [
            {
              key: 'calc_ratio',
              label: 'ratio {{current_period}}',
              expression: '{{sum__num}}',
              d3format: '.0f',
            },
          ],
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num', 'current_period'],
            coltypes: [
              GenericDataType.String,
              GenericDataType.Numeric,
              GenericDataType.String,
            ],
            data: [
              {
                name: 'Team A',
                sum__num: 10,
                current_period: '2024-Q1',
              },
            ],
          },
        ],
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const headers = Array.from(document.querySelectorAll('thead th')).map(
        header => header.textContent?.trim() ?? '',
      );

      expect(headers.some(header => header.includes('ratio 2024-Q1'))).toBe(
        true,
      );
    });

    it('applies configured column order across base and calculated columns', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          metrics: ['sum__num'],
          calculated_columns: [
            {
              key: 'calc_ratio',
              label: 'ratio',
              expression: '{{sum__num}}',
              d3format: '.0f',
            },
          ],
          column_order: ['sum__num', 'ratio', 'name'],
          show_cell_bars: false,
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num'],
            coltypes: [GenericDataType.String, GenericDataType.Numeric],
            data: [
              { name: 'Team A', sum__num: 10 },
              { name: 'Team B', sum__num: 20 },
            ],
          },
        ],
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const headers = Array.from(document.querySelectorAll('thead th')).map(
        header => header.textContent?.trim() ?? '',
      );

      expect(headers[0]).toContain('Sum of Num');
      expect(headers[1]).toContain('ratio');
      expect(headers[2]).toContain('name');
    });

    it('keeps grouped rows attached to their header after sorting', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_cell_bars: false,
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            data: [
              { name: 'Team A', sum__num: 100, '%pct_nice': 0.1 },
              { name: 'Team A', sum__num: 50, '%pct_nice': 0.2 },
              { name: 'Team B', sum__num: 20, '%pct_nice': 0.3 },
              { name: 'Team B', sum__num: 10, '%pct_nice': 0.4 },
            ],
          },
        ],
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      fireEvent.click(
        screen.getByText('Sum of Num').closest('th') as HTMLElement,
      );

      const bodyRows = Array.from(container.querySelectorAll('tbody tr')).map(
        row => ({
          className: row.className,
          text: row.textContent ?? '',
        }),
      );

      expect(bodyRows[0].className).toContain('dt-group-header-row');
      expect(bodyRows[0].text).toContain('Team B');
      expect(bodyRows[1].className).toContain('dt-grouped-row');
      expect(bodyRows[1].text).toContain('10');
      expect(bodyRows[2].className).toContain('dt-grouped-row');
      expect(bodyRows[2].text).toContain('20');
      expect(bodyRows[3].className).toContain('dt-group-header-row');
      expect(bodyRows[3].text).toContain('Team A');
      expect(bodyRows[4].className).toContain('dt-grouped-row');
      expect(bodyRows[4].text).toContain('50');
    });

    it('sorts row groups by subtotal and rows within each group by row value', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_row_group_totals: true,
          show_cell_bars: false,
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            data: [
              { name: 'Team A', sum__num: 1, '%pct_nice': 0.1 },
              { name: 'Team A', sum__num: 200, '%pct_nice': 0.2 },
              { name: 'Team B', sum__num: 50, '%pct_nice': 0.3 },
              { name: 'Team B', sum__num: 60, '%pct_nice': 0.4 },
            ],
          },
        ],
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      fireEvent.click(
        screen.getByText('Sum of Num').closest('th') as HTMLElement,
      );

      const bodyRows = Array.from(container.querySelectorAll('tbody tr')).map(
        row => ({
          className: row.className,
          text: row.textContent ?? '',
        }),
      );

      expect(bodyRows[0].className).toContain('dt-group-header-row');
      expect(bodyRows[0].text).toContain('Team B');
      expect(bodyRows[0].text).toContain('110');
      expect(bodyRows[1].className).toContain('dt-grouped-row');
      expect(bodyRows[1].text).toContain('50');
      expect(bodyRows[2].className).toContain('dt-grouped-row');
      expect(bodyRows[2].text).toContain('60');
      expect(bodyRows[3].className).toContain('dt-group-header-row');
      expect(bodyRows[3].text).toContain('Team A');
      expect(bodyRows[3].text).toContain('201');
      expect(bodyRows[4].className).toContain('dt-grouped-row');
      expect(bodyRows[4].text).toContain('1');
      expect(bodyRows[5].className).toContain('dt-grouped-row');
      expect(bodyRows[5].text).toContain('200');
    });

    it('renders HTML subtotal values inside the summary wrapper', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          metrics: ['sum__num'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          show_row_group_totals: true,
          show_cell_bars: false,
          column_config: {
            ...(testData.advanced.rawFormData.column_config ?? {}),
            sum__num: {
              enableHtmlTemplate: true,
              htmlTemplate:
                '<span style="color: red; font-weight: 400;">{{ value }}</span>',
            },
          },
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            colnames: ['name', 'sum__num'],
            coltypes: [GenericDataType.String, GenericDataType.Numeric],
            data: [
              { name: 'Team A', sum__num: 10 },
              { name: 'Team B', sum__num: 20 },
            ],
          },
        ],
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const subtotalHtml = container.querySelector(
        'tbody tr.dt-group-header-row td.dt-group-header-summary-cell .dt-group-row-summary-html',
      );

      expect(subtotalHtml).not.toBeNull();
      expect(subtotalHtml?.innerHTML).toContain('color: red');
      expect(subtotalHtml).toHaveTextContent('10');
    });

    it('does not group rows when row grouping is disabled', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: false,
          row_grouping_column: undefined,
        },
      });

      const { container } = render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(
        container.querySelectorAll('tbody tr.dt-group-header-row'),
      ).toHaveLength(0);
    });

    it('supports default collapsed groups and expand/collapse all actions', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          row_grouping_default_collapsed: true,
          show_cell_bars: false,
        },
        queriesData: [
          {
            ...testData.advanced.queriesData[0],
            data: [
              { name: 'Team A', sum__num: 100, '%pct_nice': 0.1 },
              { name: 'Team A', sum__num: 50, '%pct_nice': 0.2 },
              { name: 'Team B', sum__num: 20, '%pct_nice': 0.3 },
            ],
          },
        ],
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(
        screen.getByRole('button', { name: 'Expand all groups' }),
      ).toBeEnabled();
      expect(
        screen.queryByRole('button', { name: 'Collapse all groups' }),
      ).not.toBeInTheDocument();
      expect(document.querySelector('.dt-grouping-key-cell')).toBeNull();

      fireEvent.click(
        screen.getByRole('button', { name: 'Expand all groups' }),
      );
      expect(document.querySelector('.dt-grouping-key-cell')).not.toBeNull();
      expect(
        screen.getByRole('button', { name: 'Collapse all groups' }),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole('button', { name: 'Collapse all groups' }),
      );
      expect(document.querySelector('.dt-grouping-key-cell')).toBeNull();
    });

    it('hides the grouped column in compact view', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          row_grouping_compact_view: true,
          show_cell_bars: false,
        },
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(screen.queryByText('name')).not.toBeInTheDocument();
      expect(screen.getByText('name / Sum of Num')).toBeInTheDocument();
      expect(screen.getByText('Sum of Num')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Collapse all groups' }),
      ).toBeInTheDocument();
      expect(document.querySelector('.dt-grouping-key-cell')).not.toBeNull();
    });

    it('keeps row numbers separate from the compact grouped header', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          row_grouping_compact_view: true,
          show_row_numbers: true,
          show_cell_bars: false,
        },
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(screen.getByText('name / Sum of Num')).toBeInTheDocument();
      expect(screen.queryByText('name / #')).not.toBeInTheDocument();
    });

    it('does not show row numbers as a selectable grouping option', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          groupby: ['name'],
          enable_row_grouping: true,
          row_grouping_column: 'name',
          allow_row_grouping_change: true,
          show_row_numbers: true,
          show_cell_bars: false,
        },
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      expect(
        screen.queryByLabelText('Grouping column'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Agrupar por:')).not.toBeInTheDocument();
    });

    it('applies sticky to first N columns when sticky_columns is set', () => {
      const props = transformProps({
        ...testData.advanced,
        rawFormData: {
          ...testData.advanced.rawFormData,
          sticky_columns: 2,
        },
      });

      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );

      const firstHeader = screen.getByText('name').closest('th') as HTMLElement;
      const secondHeader = screen
        .getByText('Sum of Num')
        .closest('th') as HTMLElement;
      const thirdHeader = screen
        .getByText('%pct_nice')
        .closest('th') as HTMLElement;

      expect(firstHeader).toHaveClass('dt-sticky-col');
      expect(secondHeader).toHaveClass('dt-sticky-col');
      expect(thirdHeader).not.toHaveClass('dt-sticky-col');
    });

    it('render small formatted data with currencies', () => {
      const props = transformProps({
        ...testData.raw,
        rawFormData: {
          ...testData.raw.rawFormData,
          column_config: {
            num: {
              d3SmallNumberFormat: '.2r',
              currencyFormat: { symbol: 'USD', symbolPosition: 'prefix' },
            },
          },
        },
        queriesData: [
          {
            ...testData.raw.queriesData[0],
            data: [
              {
                num: 1234,
              },
              {
                num: 0.5,
              },
              {
                num: 0.61234,
              },
            ],
          },
        ],
      });
      render(
        ProviderWrapper({
          children: <TableChart {...props} sticky={false} />,
        }),
      );
      const cells = document.querySelectorAll('td');

      expect(document.querySelectorAll('th')[0]).toHaveTextContent('num');
      expect(cells[0]).toHaveTextContent('$ 1.23k');
      expect(cells[1]).toHaveTextContent('$ 0.50');
      expect(cells[2]).toHaveTextContent('$ 0.61');
    });

    it('render empty data', () => {
      wrap.setProps({ ...transformProps(testData.empty), sticky: false });
      tree = wrap.render();
      expect(tree.text()).toContain('No records found');
    });

    it('render color with column color formatter', () => {
      render(
        ProviderWrapper({
          children: (
            <TableChart
              {...transformProps({
                ...testData.advanced,
                rawFormData: {
                  ...testData.advanced.rawFormData,
                  conditional_formatting: [
                    {
                      colorScheme: '#ACE1C4',
                      column: 'sum__num',
                      operator: '>',
                      targetValue: 2467,
                    },
                  ],
                },
              })}
            />
          ),
        }),
      );

      expect(
        getComputedStyle(screen.getByTitle('2467063')).backgroundColor,
      ).toBe('rgba(172, 225, 196, 1)');
      expect(getComputedStyle(screen.getByTitle('2467')).backgroundColor).toBe(
        'rgba(0, 0, 0, 0)',
      );
    });

    it('render cell without color', () => {
      const dataWithEmptyCell = testData.advanced.queriesData[0];
      dataWithEmptyCell.data.push({
        __timestamp: null,
        name: 'Noah',
        sum__num: null,
        '%pct_nice': 0.643,
        'abc.com': 'bazzinga',
      });

      render(
        ProviderWrapper({
          children: (
            <TableChart
              {...transformProps({
                ...testData.advanced,
                queriesData: [dataWithEmptyCell],
                rawFormData: {
                  ...testData.advanced.rawFormData,
                  conditional_formatting: [
                    {
                      colorScheme: '#ACE1C4',
                      column: 'sum__num',
                      operator: '<',
                      targetValue: 12342,
                    },
                  ],
                },
              })}
            />
          ),
        }),
      );
      expect(getComputedStyle(screen.getByTitle('2467')).backgroundColor).toBe(
        'rgba(172, 225, 196, 0.812)',
      );
      expect(
        getComputedStyle(screen.getByTitle('2467063')).backgroundColor,
      ).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(screen.getByText('N/A')).backgroundColor).toBe(
        'rgba(0, 0, 0, 0)',
      );
    });

    it('render uniform color when colorMode is uniform', () => {
      render(
        ProviderWrapper({
          children: (
            <TableChart
              {...transformProps({
                ...testData.advanced,
                rawFormData: {
                  ...testData.advanced.rawFormData,
                  conditional_formatting: [
                    {
                      colorScheme: '#ACE1C4',
                      column: 'sum__num',
                      operator: '>',
                      targetValue: 2467,
                      colorMode: 'uniform',
                    },
                  ],
                },
              })}
            />
          ),
        }),
      );

      expect(
        getComputedStyle(screen.getByTitle('2467063')).backgroundColor,
      ).toMatch(/rgb(a)?\(172, 225, 196(, 1)?\)/);
      expect(
        getComputedStyle(screen.getByTitle('2467')).backgroundColor,
      ).toMatch(/rgb(a)?\(172, 225, 196(, 1)?\)/);
    });
  });

  it('render cell bars properly, and only when it is toggled on in both regular and percent metrics', () => {
    const props = transformProps({
      ...testData.raw,
      rawFormData: { ...testData.raw.rawFormData },
    });

    props.columns[0].isMetric = true;

    render(
      ProviderWrapper({
        children: <TableChart {...props} sticky={false} />,
      }),
    );
    let cells = document.querySelectorAll('div.cell-bar');
    cells.forEach(cell => {
      expect(cell).toHaveClass('positive');
    });
    props.columns[0].isMetric = false;
    props.columns[0].isPercentMetric = true;

    render(
      ProviderWrapper({
        children: <TableChart {...props} sticky={false} />,
      }),
    );
    cells = document.querySelectorAll('div.cell-bar');
    cells.forEach(cell => {
      expect(cell).toHaveClass('positive');
    });

    props.showCellBars = false;

    render(
      ProviderWrapper({
        children: <TableChart {...props} sticky={false} />,
      }),
    );
    cells = document.querySelectorAll('td');

    cells.forEach(cell => {
      expect(cell).toHaveClass('test-c7w8t3');
    });

    props.columns[0].isPercentMetric = false;
    props.columns[0].isMetric = true;

    render(
      ProviderWrapper({
        children: <TableChart {...props} sticky={false} />,
      }),
    );
    cells = document.querySelectorAll('td');
    cells.forEach(cell => {
      expect(cell).toHaveClass('test-c7w8t3');
    });
  });
});
