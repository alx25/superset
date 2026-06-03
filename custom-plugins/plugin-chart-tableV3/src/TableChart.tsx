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
import {
  CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  MouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  ColumnInstance,
  ColumnWithLooseAccessor,
  DefaultSortTypes,
  Row,
  SortingRule,
} from 'react-table';
import { extent as d3Extent, max as d3Max } from 'd3-array';
import { FaSort } from '@react-icons/all-files/fa/FaSort';
import { FaSortDown as FaSortDesc } from '@react-icons/all-files/fa/FaSortDown';
import { FaSortUp as FaSortAsc } from '@react-icons/all-files/fa/FaSortUp';
import cx from 'classnames';
import {
  CurrencyFormatter,
  DataRecord,
  DataRecordValue,
  DTTM_ALIAS,
  ensureIsArray,
  GenericDataType,
  getNumberFormatter,
  getSelectedText,
  getTimeFormatterForGranularity,
  BinaryQueryObjectFilterClause,
  styled,
  css,
  t,
  tn,
  useTheme,
  SupersetTheme,
} from '@superset-ui/core';
import { Dropdown, Menu } from '@superset-ui/chart-controls';
import {
  Input,
  Tooltip,
  RawAntdSelect as Select,
} from '@superset-ui/core/components';
import {
  CheckOutlined,
  InfoCircleOutlined,
  DownOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  RightOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { isEmpty, isEqual, isNumber } from 'lodash';
import {
  CalculatedColumnConfig,
  ColorSchemeEnum,
  DataColumnMeta,
  TableChartTransformedProps,
} from './types';
import DataTable, {
  DataTableProps,
  SearchInputProps,
  SelectPageSizeRendererProps,
  SizeOption,
} from './DataTable';

import Styles from './Styles';
import {
  formatColumnValue,
  getHtmlTemplateScopeClass,
  getScopedHtmlTemplateCss,
} from './utils/formatValue';
import { PAGE_SIZE_OPTIONS } from './consts';
import { updateExternalFormData } from './DataTable/utils/externalAPIs';
import getScrollBarSize from './DataTable/utils/getScrollBarSize';
import { processTopData } from './utils/topN';
import {
  applyCalculatedColumns,
  evaluateFormula,
} from './utils/calculatedColumns';

type ValueRange = [number, number];

interface TableSize {
  width: number;
  height: number;
}

const ACTION_KEYS = {
  enter: 'Enter',
  spacebar: 'Spacebar',
  space: ' ',
};

const stripHtmlTags = (value: string) => value.replace(/<[^>]+>/g, '');

type TableTheme = SupersetTheme & {
  colors?: any;
  gridUnit?: number;
  typography?: any;
  fontSizeSM?: number;
};

type GroupRowMetadata = {
  __isGroupHeader?: boolean;
  __groupKey?: string;
  __groupLabel?: string;
  __groupCount?: number;
  __groupSummaryValues?: Record<string, DataRecordValue>;
  __isCollapsed?: boolean;
  __groupParentKey?: string;
  __sourceRowIndex?: number;
};

const EMPTY_GROUP_LABEL = t('(Empty)');
const GROUP_PLACEHOLDER_COLUMN_KEY = '__row_group_placeholder__';
const ROW_NUMBER_COLUMN_KEY = '#';

function applyPreferredColumnOrder(
  columns: DataColumnMeta[],
  preferredOrder: string[],
): DataColumnMeta[] {
  if (!preferredOrder.length) {
    return columns;
  }

  const fixedLeadingColumns = columns.filter(
    column => column.key === ROW_NUMBER_COLUMN_KEY,
  );
  const sortableColumns = columns.filter(
    column => column.key !== ROW_NUMBER_COLUMN_KEY,
  );
  const byKey = new Map(sortableColumns.map(column => [column.key, column]));
  const seen = new Set<string>();
  const orderedColumns: DataColumnMeta[] = [];

  preferredOrder.forEach(rawKey => {
    const key = String(rawKey ?? '').trim();
    const column = byKey.get(key);
    if (!key || !column || seen.has(key)) {
      return;
    }
    seen.add(key);
    orderedColumns.push(column);
  });

  const remainingColumns = sortableColumns.filter(
    column => !seen.has(column.key),
  );

  return [...fixedLeadingColumns, ...orderedColumns, ...remainingColumns];
}

function getGroupLabel(value: DataRecordValue) {
  if (value == null || value === '') {
    return EMPTY_GROUP_LABEL;
  }
  return String(value);
}

function buildGroupAggregateRow(
  rows: DataRecord[],
  calculatedColumns: CalculatedColumnConfig[] = [],
): DataRecord {
  const aggregateRow: DataRecord = {};
  const rowKeys = new Set<string>();

  rows.forEach(row => {
    Object.keys(row).forEach(key => {
      rowKeys.add(key);
    });
  });

  rowKeys.forEach(key => {
    if (calculatedColumns.some(column => column.label === key)) {
      return;
    }

    let hasNumericValue = false;
    const sum = rows.reduce((acc, row) => {
      const currentValue = row[key];
      if (typeof currentValue === 'number' && Number.isFinite(currentValue)) {
        hasNumericValue = true;
        return acc + currentValue;
      }
      return acc;
    }, 0);

    if (hasNumericValue) {
      aggregateRow[key] = sum;
    }
  });

  return buildAggregateSummaryRow(aggregateRow, calculatedColumns);
}

function buildSummaryValuesFromAggregateRow(
  aggregateRowInput: DataRecord,
  columns: DataColumnMeta[],
  calculatedColumns: CalculatedColumnConfig[] = [],
  fillMissingNumericColumns = false,
): Record<string, DataRecordValue> {
  const summaryValues: Record<string, DataRecordValue> = {};
  const aggregateRow = buildAggregateSummaryRow(
    aggregateRowInput,
    calculatedColumns,
  );
  const calculatedColumnKeys = new Set(
    calculatedColumns.map(column => column.label),
  );

  columns.forEach(column => {
    const summaryValue = aggregateRow[column.key];
    if (typeof summaryValue === 'number' && Number.isFinite(summaryValue)) {
      summaryValues[column.key] = summaryValue;
    } else if (
      fillMissingNumericColumns &&
      column.isNumeric &&
      !calculatedColumnKeys.has(column.key)
    ) {
      summaryValues[column.key] = 0;
    }
  });

  return summaryValues;
}

function buildAggregateSummaryRow(
  aggregateRowInput: DataRecord,
  calculatedColumns: CalculatedColumnConfig[] = [],
): DataRecord {
  const aggregateRow: DataRecord = { ...aggregateRowInput };

  if (calculatedColumns.length > 0) {
    const availableKeys = Array.from(
      new Set([
        ...Object.keys(aggregateRow),
        ...calculatedColumns.map(column => column.label),
      ]),
    );
    calculatedColumns.forEach(({ label, expression }) => {
      aggregateRow[label] = evaluateFormula(
        expression,
        aggregateRow,
        availableKeys,
      );
    });
  }

  return aggregateRow;
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

function compareSortValues(
  left: DataRecordValue,
  right: DataRecordValue,
  dataType?: GenericDataType,
) {
  const isLeftEmpty = left == null || left === '';
  const isRightEmpty = right == null || right === '';

  if (isLeftEmpty && isRightEmpty) {
    return 0;
  }
  if (isLeftEmpty) {
    return 1;
  }
  if (isRightEmpty) {
    return -1;
  }

  if (dataType === GenericDataType.Temporal) {
    const leftTime =
      left instanceof Date
        ? left.getTime()
        : new Date(left as string).getTime();
    const rightTime =
      right instanceof Date
        ? right.getTime()
        : new Date(right as string).getTime();
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return leftTime - rightTime;
    }
  }

  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    return Number(left) - Number(right);
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function stableSort<T>(
  items: T[],
  compare: (left: T, right: T) => number,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compare(left.item, right.item);
      return result !== 0 ? result : left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * Return sortType based on data type
 */
function getSortTypeByDataType(dataType: GenericDataType): DefaultSortTypes {
  if (dataType === GenericDataType.Temporal) {
    return 'datetime';
  }
  if (dataType === GenericDataType.String) {
    return 'alphanumeric';
  }
  return 'basic';
}

/**
 * Cell background width calculation for horizontal bar chart
 */
function cellWidth({
  value,
  valueRange,
  alignPositiveNegative,
}: {
  value: number;
  valueRange: ValueRange;
  alignPositiveNegative: boolean;
}) {
  const [minValue, maxValue] = valueRange;
  if (alignPositiveNegative) {
    const perc = Math.abs(Math.round((value / maxValue) * 100));
    return perc;
  }
  const posExtent = Math.abs(Math.max(maxValue, 0));
  const negExtent = Math.abs(Math.min(minValue, 0));
  const tot = posExtent + negExtent;
  const perc2 = Math.round((Math.abs(value) / tot) * 100);
  return perc2;
}

/**
 * Cell left margin (offset) calculation for horizontal bar chart elements
 * when alignPositiveNegative is not set
 */
function cellOffset({
  value,
  valueRange,
  alignPositiveNegative,
}: {
  value: number;
  valueRange: ValueRange;
  alignPositiveNegative: boolean;
}) {
  if (alignPositiveNegative) {
    return 0;
  }
  const [minValue, maxValue] = valueRange;
  const posExtent = Math.abs(Math.max(maxValue, 0));
  const negExtent = Math.abs(Math.min(minValue, 0));
  const tot = posExtent + negExtent;
  return Math.round((Math.min(negExtent + value, negExtent) / tot) * 100);
}

/**
 * Cell background color calculation for horizontal bar chart
 */
function cellBackground({
  value,
  colorPositiveNegative = false,
  theme,
}: {
  value: number;
  colorPositiveNegative: boolean;
  theme: SupersetTheme;
}) {
  if (!colorPositiveNegative) {
    return `${theme.colorFill}`;
  }

  if (value < 0) {
    return `${theme.colorError}50`;
  }

  return `${theme.colorSuccess}50`;
}

function SortIcon<D extends object>({ column }: { column: ColumnInstance<D> }) {
  const { isSorted, isSortedDesc } = column;
  let sortIcon = <FaSort />;
  if (isSorted) {
    sortIcon = isSortedDesc ? <FaSortDesc /> : <FaSortAsc />;
  }
  return sortIcon;
}

function SearchInput({ count, value, onChange }: SearchInputProps) {
  return (
    <span className="dt-global-filter">
      {t('Search')}
      <Input
        aria-label={t('Search %s records', count)}
        placeholder={tn('%s record', '%s records...', count, count)}
        size="small"
        value={value}
        onChange={onChange}
      />
    </span>
  );
}

const VisuallyHidden = styled.label`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

function SelectPageSize({
  options,
  current,
  onChange,
}: SelectPageSizeRendererProps) {
  const { Option } = Select;

  return (
    <span className="dt-select-page-size">
      <VisuallyHidden htmlFor="pageSizeSelect">
        {t('Select page size')}
      </VisuallyHidden>
      {t('Show')}{' '}
      <Select<number>
        id="pageSizeSelect"
        value={current}
        onChange={value => onChange(value)}
        size="small"
        css={(theme: SupersetTheme) => css`
          width: ${theme.sizeUnit * 18}px;
        `}
        aria-label={t('Show entries per page')}
      >
        {options.map(option => {
          const [size, text] = Array.isArray(option)
            ? option
            : [option, option];
          return (
            <Option key={size} value={Number(size)}>
              {text}
            </Option>
          );
        })}
      </Select>{' '}
      {t('entries per page')}
    </span>
  );
}

const getNoResultsMessage = (filter: string) =>
  filter ? t('No matching records found') : t('No records found');

export default function TableChart<D extends DataRecord = DataRecord>(
  props: TableChartTransformedProps<D> & {
    sticky?: DataTableProps<D>['sticky'];
  },
) {
  const {
    timeGrain,
    height,
    width,
    data: initialData,
    totals,
    isRawRecords,
    rowCount = 0,
    columns: columnsMeta,
    alignPositiveNegative: defaultAlignPN = false,
    colorPositiveNegative: defaultColorPN = false,
    includeSearch = false,
    pageSize = 0,
    serverPagination = false,
    serverPaginationData,
    setDataMask,
    showCellBars = true,
    sortDesc = false,
    filters,
    sticky = true, // whether to use sticky header
    columnColorFormatters,
    allowRearrangeColumns = false,
    allowRenderHtml = true,
    onContextMenu,
    emitCrossFilters,
    isUsingTimeComparison,
    basicColorFormatters,
    basicColorColumnFormatters,
    topConfig,
    stickyColumnsCount = 0,
    rowGroupingColumn,
    allowRowGroupingChange = false,
    showRowGroupTotals = false,
    rowGroupingDefaultCollapsed = false,
    rowGroupingCompactView = false,
    calculatedColumns = [],
    columnOrder = [],
  } = props;

  const [stickyColumnWidths, setStickyColumnWidths] = useState<number[]>([]);

  const handleStickyColumnWidthsChange = useCallback((widths: number[]) => {
    setStickyColumnWidths(prev => (isEqual(prev, widths) ? prev : widths));
  }, []);

  const [currentTopCount, setCurrentTopCount] = useState<number | undefined>(
    topConfig?.allowUserControl ? topConfig.defaultCount : undefined,
  );

  // Feature 10: runtime metric selector for Top N
  const [currentTopMetric, setCurrentTopMetric] = useState<string | undefined>(
    topConfig?.allowUserControl ? topConfig.metric : undefined,
  );
  const [sortBy, setSortBy] = useState<Array<SortingRule<D>>>([]);

  useEffect(() => {
    if (topConfig?.allowUserControl) {
      setCurrentTopCount(topConfig.defaultCount);
      setCurrentTopMetric(topConfig.metric);
    }
  }, [topConfig?.allowUserControl, topConfig?.defaultCount, topConfig?.metric]);

  const data = useMemo((): D[] => {
    if (topConfig?.allowUserControl && topConfig.enabled) {
      const resolvedCount = Math.max(
        0,
        Math.floor(
          currentTopCount ??
            topConfig.defaultCount ??
            topConfig.baseData.length,
        ),
      );
      // Feature 10: allow user-selected metric for ranking
      const resolvedMetric =
        currentTopMetric &&
        topConfig.topMetrics?.some(metric => metric.value === currentTopMetric)
          ? currentTopMetric
          : topConfig.metric;
      const processedRecords = processTopData(
        topConfig.baseData,
        topConfig.columns,
        resolvedMetric,
        resolvedCount,
      );
      const withRowNumbers = topConfig.showRowNumbers
        ? processedRecords.map(
            (row, index) => ({ '#': index + 1, ...row }) as DataRecord,
          )
        : processedRecords;
      return withRowNumbers as unknown as D[];
    }
    return initialData;
  }, [
    currentTopCount,
    currentTopMetric,
    initialData,
    topConfig?.allowUserControl,
    topConfig?.enabled,
    topConfig?.baseData,
    topConfig?.columns,
    topConfig?.defaultCount,
    topConfig?.metric,
    topConfig?.showRowNumbers,
    topConfig?.topMetrics,
  ]);

  // Feature 9: apply calculated columns to each row
  const dataWithCalcs = useMemo((): D[] => {
    if (!calculatedColumns.length) return data;
    const baseKeys = data.length > 0 ? Object.keys(data[0]) : [];
    return applyCalculatedColumns(
      data as DataRecord[],
      calculatedColumns as CalculatedColumnConfig[],
      baseKeys,
    ) as unknown as D[];
  }, [data, calculatedColumns]);

  // Feature 9: extended column metadata including calculated columns
  // Uses `label` as both key and display name; applies d3format if provided
  const extendedColumnsMeta = useMemo((): typeof columnsMeta => {
    const calcMeta = (calculatedColumns as CalculatedColumnConfig[])
      .filter(cc => cc.label)
      .map(cc => {
        const config = cc.config ?? {};
        const numberFormat = config.d3NumberFormat || cc.d3format;
        const currency = config.currencyFormat?.symbol
          ? config.currencyFormat
          : undefined;
        const formatter = currency
          ? new CurrencyFormatter({
              d3Format: numberFormat,
              currency,
            })
          : numberFormat
            ? getNumberFormatter(numberFormat)
            : undefined;

        return {
          key: cc.label,
          label: cc.displayLabel ?? cc.label,
          dataType: GenericDataType.Numeric,
          isMetric: true,
          isNumeric: true,
          formatter,
          config,
        };
      });
    return applyPreferredColumnOrder(
      [...columnsMeta, ...calcMeta],
      columnOrder,
    ) as typeof columnsMeta;
  }, [columnsMeta, calculatedColumns, columnOrder]);

  const footerSummaryRow = useMemo(
    () =>
      totals
        ? (buildAggregateSummaryRow(
            totals as unknown as DataRecord,
            calculatedColumns as CalculatedColumnConfig[],
          ) as D)
        : undefined,
    [totals, calculatedColumns],
  );

  const footerTotals = useMemo(
    () =>
      footerSummaryRow
        ? (buildSummaryValuesFromAggregateRow(
            footerSummaryRow as unknown as DataRecord,
            extendedColumnsMeta,
          ) as D)
        : undefined,
    [footerSummaryRow, extendedColumnsMeta],
  );

  const availableGroupingColumns = useMemo(
    () =>
      extendedColumnsMeta
        .filter(
          column =>
            column.key !== ROW_NUMBER_COLUMN_KEY &&
            (isRawRecords
              ? !column.isPercentMetric
              : !column.isMetric && !column.isPercentMetric),
        )
        .map(column => ({
          value: column.key,
          label: column.label,
        })),
    [extendedColumnsMeta, isRawRecords],
  );

  const defaultGroupingColumn = useMemo(
    () =>
      rowGroupingColumn &&
      availableGroupingColumns.some(
        option => option.value === rowGroupingColumn,
      )
        ? rowGroupingColumn
        : undefined,
    [availableGroupingColumns, rowGroupingColumn],
  );

  const [currentGroupingColumn, setCurrentGroupingColumn] = useState<
    string | undefined
  >(defaultGroupingColumn);

  useEffect(() => {
    setCurrentGroupingColumn(previous => {
      if (!allowRowGroupingChange) {
        return defaultGroupingColumn;
      }
      if (
        previous &&
        availableGroupingColumns.some(option => option.value === previous)
      ) {
        return previous;
      }
      return defaultGroupingColumn;
    });
  }, [allowRowGroupingChange, availableGroupingColumns, defaultGroupingColumn]);

  const activeRowGroupingColumn = useMemo(
    () =>
      allowRowGroupingChange && currentGroupingColumn
        ? currentGroupingColumn
        : defaultGroupingColumn,
    [allowRowGroupingChange, currentGroupingColumn, defaultGroupingColumn],
  );

  const groupKeys = useMemo(() => {
    if (!activeRowGroupingColumn) {
      return [] as string[];
    }

    const seen = new Set<string>();
    data.forEach(row => {
      const groupKey = String(
        (row as DataRecord)[activeRowGroupingColumn] ?? '',
      );
      seen.add(groupKey);
    });

    return Array.from(seen);
  }, [activeRowGroupingColumn, data]);

  // Feature 6: row grouping collapse state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    rowGroupingDefaultCollapsed ? new Set(groupKeys) : new Set<string>(),
  );

  useEffect(() => {
    const nextCollapsedGroups = rowGroupingDefaultCollapsed
      ? new Set(groupKeys)
      : new Set<string>();

    setCollapsedGroups(prev =>
      areSetsEqual(prev, nextCollapsedGroups) ? prev : nextCollapsedGroups,
    );
  }, [groupKeys, rowGroupingDefaultCollapsed]);

  const toggleGroup = useCallback((groupKey: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const expandAllGroups = useCallback(() => {
    setCollapsedGroups(prev => (prev.size === 0 ? prev : new Set<string>()));
  }, []);

  const collapseAllGroups = useCallback(() => {
    const nextCollapsedGroups = new Set(groupKeys);
    setCollapsedGroups(prev =>
      areSetsEqual(prev, nextCollapsedGroups) ? prev : nextCollapsedGroups,
    );
  }, [groupKeys]);

  const topCountValue = useMemo(() => {
    if (!topConfig?.allowUserControl || !topConfig.enabled) {
      return undefined;
    }
    return currentTopCount ?? topConfig.defaultCount ?? 0;
  }, [
    currentTopCount,
    topConfig?.allowUserControl,
    topConfig?.defaultCount,
    topConfig?.enabled,
  ]);

  const topNCountOptions: [number, string][] = [
    [5, '5'],
    [10, '10'],
    [20, '20'],
    [50, '50'],
    [100, '100'],
    [0, t('Todos')],
  ];

  const topNControl =
    topConfig?.allowUserControl && topConfig.enabled ? (
      <div className="dt-topn-control">
        <span className="dt-topn-label">{t('Top N:')}</span>
        {/* Count selector */}
        <Select<number>
          size="small"
          value={topCountValue ?? topConfig.defaultCount}
          onChange={(val: number) => setCurrentTopCount(val)}
          css={(theme: SupersetTheme) => css`
            width: ${theme.sizeUnit * 18}px;
          `}
          aria-label={t('Top N count')}
        >
          {topNCountOptions.map(([size, label]) => (
            <Select.Option key={size} value={size}>
              {label}
            </Select.Option>
          ))}
        </Select>
        {/* Metric selector – shown only when multiple metrics are available */}
        {topConfig.topMetrics && topConfig.topMetrics.length > 1 && (
          <>
            <span className="dt-topn-label">{t('por')}</span>
            <Select<string>
              size="small"
              value={currentTopMetric ?? topConfig.metric}
              onChange={(val: string) => setCurrentTopMetric(val)}
              css={(theme: SupersetTheme) => css`
                min-width: ${theme.sizeUnit * 30}px;
                max-width: ${theme.sizeUnit * 50}px;
              `}
              aria-label={t('Top N metric')}
            >
              {topConfig.topMetrics.map(metric => (
                <Select.Option key={metric.value} value={metric.value}>
                  {metric.label}
                </Select.Option>
              ))}
            </Select>
          </>
        )}
      </div>
    ) : null;
  const groupingControl =
    allowRowGroupingChange &&
    activeRowGroupingColumn &&
    availableGroupingColumns.length > 1 ? (
      <div className="dt-grouping-control">
        <span className="dt-topn-label">{t('Agrupar por:')}</span>
        <Select<string>
          size="small"
          value={activeRowGroupingColumn}
          onChange={(value: string) => setCurrentGroupingColumn(value)}
          css={(theme: SupersetTheme) => css`
            min-width: ${theme.sizeUnit * 26}px;
            max-width: ${theme.sizeUnit * 44}px;
          `}
          aria-label={t('Grouping column')}
        >
          {availableGroupingColumns.map(option => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      </div>
    ) : null;
  const tableToolbarControl =
    groupingControl || topNControl ? (
      <div className="dt-secondary-controls">
        {groupingControl}
        {topNControl}
      </div>
    ) : null;
  const comparisonColumns = [
    { key: 'all', label: t('Mostrar todo') },
    { key: '#', label: '#' },
    { key: '△', label: '△' },
    { key: '%', label: '%' },
  ];
  const timestampFormatter = useCallback(
    value => getTimeFormatterForGranularity(timeGrain)(value),
    [timeGrain],
  );
  const [tableSize, setTableSize] = useState<TableSize>({
    width: 0,
    height: 0,
  });
  // keep track of whether column order changed, so that column widths can too
  const [columnOrderToggle, setColumnOrderToggle] = useState(false);
  const [showComparisonDropdown, setShowComparisonDropdown] = useState(false);
  const [selectedComparisonColumns, setSelectedComparisonColumns] = useState([
    comparisonColumns[0].key,
  ]);
  const [hideComparisonKeys, setHideComparisonKeys] = useState<string[]>([]);
  const theme = useTheme() as TableTheme;
  const gridUnit = theme.gridUnit ?? theme.sizeUnit ?? 4;
  const smallFontSize = theme.typography?.sizes?.s ?? theme.fontSizeSM ?? 12;
  const colors = theme.colors ?? {};
  const grayscale = colors.grayscale ?? {};
  const successColor = colors.success?.base ?? theme.colorSuccess ?? '#52c41a';
  const errorColor = colors.error?.base ?? theme.colorError ?? '#ff4d4f';

  // only take relevant page size options
  const pageSizeOptions = useMemo(() => {
    const getServerPagination = (n: number) => n <= rowCount;
    return PAGE_SIZE_OPTIONS.filter(([n]) =>
      serverPagination ? getServerPagination(n) : n <= 2 * data.length,
    ) as SizeOption[];
  }, [data.length, rowCount, serverPagination]);

  const getValueRange = useCallback(
    function getValueRange(key: string, alignPositiveNegative: boolean) {
      if (typeof dataWithCalcs?.[0]?.[key] === 'number') {
        const nums = dataWithCalcs.map(row => row[key]) as number[];
        return (
          alignPositiveNegative
            ? [0, d3Max(nums.map(Math.abs))]
            : d3Extent(nums)
        ) as ValueRange;
      }
      return null;
    },
    [dataWithCalcs],
  );

  const isActiveFilterValue = useCallback(
    function isActiveFilterValue(key: string, val: DataRecordValue) {
      return !!filters && filters[key]?.includes(val);
    },
    [filters],
  );

  const getCrossFilterDataMask = (key: string, value: DataRecordValue) => {
    let updatedFilters = { ...(filters || {}) };
    if (filters && isActiveFilterValue(key, value)) {
      updatedFilters = {};
    } else {
      updatedFilters = {
        [key]: [value],
      };
    }
    if (
      Array.isArray(updatedFilters[key]) &&
      updatedFilters[key].length === 0
    ) {
      delete updatedFilters[key];
    }

    const groupBy = Object.keys(updatedFilters);
    const groupByValues = Object.values(updatedFilters);
    const labelElements: string[] = [];
    groupBy.forEach(col => {
      const isTimestamp = col === DTTM_ALIAS;
      const filterValues = ensureIsArray(updatedFilters?.[col]);
      if (filterValues.length) {
        const valueLabels = filterValues.map(value =>
          isTimestamp ? timestampFormatter(value) : value,
        );
        labelElements.push(`${valueLabels.join(', ')}`);
      }
    });

    return {
      dataMask: {
        extraFormData: {
          filters:
            groupBy.length === 0
              ? []
              : groupBy.map(col => {
                  const val = ensureIsArray(updatedFilters?.[col]);
                  if (!val.length)
                    return {
                      col,
                      op: 'IS NULL' as const,
                    };
                  return {
                    col,
                    op: 'IN' as const,
                    val: val.map(el =>
                      el instanceof Date ? el.getTime() : el!,
                    ),
                    grain: col === DTTM_ALIAS ? timeGrain : undefined,
                  };
                }),
        },
        filterState: {
          label: labelElements.join(', '),
          value: groupByValues.length ? groupByValues : null,
          filters:
            updatedFilters && Object.keys(updatedFilters).length
              ? updatedFilters
              : null,
        },
      },
      isCurrentValueSelected: isActiveFilterValue(key, value),
    };
  };

  const toggleFilter = useCallback(
    function toggleFilter(key: string, val: DataRecordValue) {
      if (!emitCrossFilters) {
        return;
      }
      setDataMask(getCrossFilterDataMask(key, val).dataMask);
    },
    [emitCrossFilters, getCrossFilterDataMask, setDataMask],
  );

  const getSharedStyle = (column: DataColumnMeta): CSSProperties => {
    const { isNumeric, config = {} } = column;
    const textAlign =
      config.horizontalAlign ||
      (isNumeric && !isUsingTimeComparison ? 'right' : 'left');
    return {
      textAlign,
    };
  };

  const comparisonLabels = [t('Main'), '#', '△', '%'];
  const filteredColumnsMeta = useMemo(() => {
    let columns = extendedColumnsMeta;

    if (isUsingTimeComparison) {
      const allColumns = comparisonColumns[0].key;
      const main = comparisonLabels[0];
      const showAllColumns = selectedComparisonColumns.includes(allColumns);

      columns = columns.filter(({ label, key }) => {
        // Extract the key portion after the space, assuming the format is always "label key"
        const keyPortion = key.substring(label.length);
        const isKeyHidded = hideComparisonKeys.includes(keyPortion);
        const isLableMain = label === main;

        return (
          isLableMain ||
          (!isKeyHidded &&
            (!comparisonLabels.includes(label) ||
              showAllColumns ||
              selectedComparisonColumns.includes(label)))
        );
      });
    }

    if (rowGroupingCompactView && activeRowGroupingColumn) {
      columns = columns.filter(
        column => column.key !== activeRowGroupingColumn,
      );
      if (columns.length === 0) {
        columns = [
          {
            key: GROUP_PLACEHOLDER_COLUMN_KEY,
            label: '',
            dataType: GenericDataType.String,
            config: { columnWidth: gridUnit * 10 },
          },
        ];
      }
    }

    return columns;
  }, [
    extendedColumnsMeta,
    comparisonColumns,
    comparisonLabels,
    gridUnit,
    isUsingTimeComparison,
    hideComparisonKeys,
    activeRowGroupingColumn,
    rowGroupingCompactView,
    selectedComparisonColumns,
  ]);

  const groupSummaryColumns = useMemo(
    () =>
      !showRowGroupTotals || !activeRowGroupingColumn
        ? []
        : filteredColumnsMeta.filter(
            column =>
              column.key !== activeRowGroupingColumn &&
              column.isNumeric &&
              !column.isPercentMetric &&
              column.label !== '%' &&
              (column.isMetric || isRawRecords),
          ),
    [
      activeRowGroupingColumn,
      filteredColumnsMeta,
      isRawRecords,
      showRowGroupTotals,
    ],
  );

  const sortedColumnsById = useMemo(
    () =>
      new Map(
        filteredColumnsMeta.map((column, index) => [String(index), column]),
      ),
    [filteredColumnsMeta],
  );

  const compareRowsBySortRules = useCallback(
    (left: DataRecord, right: DataRecord) => {
      for (const rule of sortBy) {
        const column = sortedColumnsById.get(String(rule.id));
        if (!column || column.key === GROUP_PLACEHOLDER_COLUMN_KEY) {
          continue;
        }

        const result = compareSortValues(
          left[column.key],
          right[column.key],
          column.dataType,
        );

        if (result !== 0) {
          return rule.desc ? -result : result;
        }
      }

      return 0;
    },
    [sortBy, sortedColumnsById],
  );

  type GroupedEntry = {
    groupKey: string;
    label: string;
    rows: D[];
    aggregateRow: DataRecord;
  };

  const compareGroupsBySortRules = useCallback(
    (left: GroupedEntry, right: GroupedEntry) => {
      for (const rule of sortBy) {
        const column = sortedColumnsById.get(String(rule.id));
        if (!column || column.key === GROUP_PLACEHOLDER_COLUMN_KEY) {
          continue;
        }

        let result = 0;

        if (column.key === activeRowGroupingColumn) {
          result = compareSortValues(left.label, right.label, column.dataType);
        } else if (column.isNumeric && !column.isPercentMetric) {
          result = compareSortValues(
            left.aggregateRow[column.key],
            right.aggregateRow[column.key],
            column.dataType,
          );
        } else {
          const leftLeadRow = left.rows[0] as unknown as DataRecord | undefined;
          const rightLeadRow = right.rows[0] as unknown as DataRecord | undefined;

          if (leftLeadRow && rightLeadRow) {
            result = compareSortValues(
              leftLeadRow[column.key],
              rightLeadRow[column.key],
              column.dataType,
            );
          }
        }

        if (result !== 0) {
          return rule.desc ? -result : result;
        }
      }

      return 0;
    },
    [activeRowGroupingColumn, sortBy, sortedColumnsById],
  );

  // Feature 6: apply row grouping on top of calculated data
  const displayData = useMemo((): D[] => {
    if (!activeRowGroupingColumn || !dataWithCalcs.length) return dataWithCalcs;

    const groupMap = new Map<string, { label: string; rows: D[] }>();

    dataWithCalcs.forEach((row, sourceIndex) => {
      const rawValue = (row as DataRecord)[activeRowGroupingColumn];
      const groupKey = String(rawValue ?? '');
      const groupLabel = getGroupLabel(rawValue);
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { label: groupLabel, rows: [] });
      }
      groupMap.get(groupKey)!.rows.push({
        ...(row as DataRecord),
        __groupParentKey: groupKey,
        __sourceRowIndex: sourceIndex,
      } as unknown as D);
    });

    const groupedEntries = Array.from(groupMap.entries()).map(
      ([groupKey, { label, rows }]) => {
        const sortedRows =
          sortBy.length > 0
            ? stableSort(rows, (left, right) =>
                compareRowsBySortRules(
                  left as unknown as DataRecord,
                  right as unknown as DataRecord,
                ),
              )
            : rows;

        return {
          groupKey,
          label,
          rows: sortedRows,
          aggregateRow: buildGroupAggregateRow(
            sortedRows as unknown as DataRecord[],
            calculatedColumns as CalculatedColumnConfig[],
          ),
        };
      },
    );

    const sortedGroups =
      sortBy.length > 0
        ? stableSort(groupedEntries, compareGroupsBySortRules)
        : groupedEntries;

    const result: D[] = [];
    sortedGroups.forEach(({ groupKey, label, rows, aggregateRow }) => {
      const isCollapsed = collapsedGroups.has(groupKey);
      result.push({
        __isGroupHeader: true,
        __groupKey: groupKey,
        __groupLabel: label,
        __groupCount: rows.length,
        __groupSummaryValues:
          showRowGroupTotals && groupSummaryColumns.length > 0
            ? buildSummaryValuesFromAggregateRow(
                aggregateRow,
                groupSummaryColumns,
                calculatedColumns as CalculatedColumnConfig[],
                true,
              )
            : undefined,
        __isCollapsed: isCollapsed,
      } as unknown as D);
      if (!isCollapsed) {
        result.push(...rows);
      }
    });
    return result;
  }, [
    collapsedGroups,
    compareRowsBySortRules,
    dataWithCalcs,
    calculatedColumns,
    groupSummaryColumns,
    activeRowGroupingColumn,
    sortBy,
    showRowGroupTotals,
  ]);

  const hasGroupedData = Boolean(
    activeRowGroupingColumn && groupKeys.length > 0,
  );
  const hasAnyCollapsedGroups = hasGroupedData && collapsedGroups.size > 0;
  const groupingColumnDisplayLabel =
    activeRowGroupingColumn &&
    extendedColumnsMeta.find(column => column.key === activeRowGroupingColumn)
      ?.label;
  const compactGroupingAnchorColumn =
    hasGroupedData && rowGroupingCompactView
      ? (filteredColumnsMeta.find(
          column =>
            column.key !== GROUP_PLACEHOLDER_COLUMN_KEY &&
            column.key !== ROW_NUMBER_COLUMN_KEY,
        ) ?? filteredColumnsMeta[0])
      : undefined;
  const compactGroupingHeaderLabel =
    compactGroupingAnchorColumn &&
    compactGroupingAnchorColumn.key !== GROUP_PLACEHOLDER_COLUMN_KEY &&
    compactGroupingAnchorColumn.key !== ROW_NUMBER_COLUMN_KEY
      ? compactGroupingAnchorColumn.label
      : undefined;
  const groupingToggleColumnKey =
    hasGroupedData && rowGroupingCompactView
      ? compactGroupingAnchorColumn?.key
      : activeRowGroupingColumn;
  const groupingMarkerColumnKey =
    hasGroupedData && rowGroupingCompactView
      ? compactGroupingAnchorColumn?.key
      : activeRowGroupingColumn;
  const groupingToggleLabel = hasAnyCollapsedGroups
    ? t('Expand all groups')
    : t('Collapse all groups');

  const stickyColumnsLimit = Math.min(Math.max(stickyColumnsCount, 0), 3);

  const stickyColumnKeys = useMemo(() => {
    if (stickyColumnsLimit <= 0) {
      return [];
    }
    return filteredColumnsMeta.slice(0, stickyColumnsLimit).map(col => col.key);
  }, [filteredColumnsMeta, stickyColumnsLimit]);

  const stickyColumnOffsets = useMemo(() => {
    const offsets: Record<string, number> = {};
    let acc = 0;
    stickyColumnKeys.forEach(key => {
      offsets[key] = acc;
      const colIndex = filteredColumnsMeta.findIndex(col => col.key === key);
      const widthFromSticky =
        colIndex >= 0 ? stickyColumnWidths[colIndex] : undefined;
      const fallbackWidth =
        colIndex >= 0
          ? Number(filteredColumnsMeta[colIndex].config?.columnWidth)
          : undefined;
      const widthValue =
        typeof widthFromSticky === 'number' &&
        Number.isFinite(widthFromSticky) &&
        widthFromSticky > 0
          ? widthFromSticky
          : typeof fallbackWidth === 'number' && Number.isFinite(fallbackWidth)
            ? fallbackWidth
            : 0;
      acc += widthValue;
    });
    return offsets;
  }, [filteredColumnsMeta, stickyColumnKeys, stickyColumnWidths]);

  const handleContextMenu =
    onContextMenu && !isRawRecords
      ? (
          value: D,
          cellPoint: {
            key: string;
            value: DataRecordValue;
            isMetric?: boolean;
          },
          clientX: number,
          clientY: number,
        ) => {
          const drillToDetailFilters: BinaryQueryObjectFilterClause[] = [];
          filteredColumnsMeta.forEach(col => {
            if (!col.isMetric) {
              const dataRecordValue = value[col.key];
              drillToDetailFilters.push({
                col: col.key,
                op: '==',
                val: dataRecordValue as string | number | boolean,
                formattedVal: String(
                  formatColumnValue(col, dataRecordValue, value)[1],
                ),
              });
            }
          });
          onContextMenu(clientX, clientY, {
            drillToDetail: drillToDetailFilters,
            crossFilter: cellPoint.isMetric
              ? undefined
              : getCrossFilterDataMask(cellPoint.key, cellPoint.value),
            drillBy: cellPoint.isMetric
              ? undefined
              : {
                  filters: [
                    {
                      col: cellPoint.key,
                      op: '==',
                      val: cellPoint.value as string | number | boolean,
                    },
                  ],
                  groupbyFieldName: 'groupby',
                },
          });
        }
      : undefined;

  const getHeaderColumns = (
    columnsMeta: DataColumnMeta[],
    enableTimeComparison?: boolean,
  ) => {
    const resultMap: Record<string, number[]> = {};

    if (!enableTimeComparison) {
      return resultMap;
    }

    columnsMeta.forEach((element, index) => {
      // Check if element's label is one of the comparison labels
      if (comparisonLabels.includes(element.label)) {
        // Extract the key portion after the space, assuming the format is always "label key"
        const keyPortion = element.key.substring(element.label.length);

        // If the key portion is not in the map, initialize it with the current index
        if (!resultMap[keyPortion]) {
          resultMap[keyPortion] = [index];
        } else {
          // Add the index to the existing array
          resultMap[keyPortion].push(index);
        }
      }
    });

    return resultMap;
  };

  const htmlTemplateStyles = useMemo(
    () =>
      filteredColumnsMeta
        .map(column => {
          const cssText = getScopedHtmlTemplateCss(column);
          if (!cssText) {
            return null;
          }
          return {
            key: column.key,
            scopeClass: getHtmlTemplateScopeClass(column),
            cssText,
          };
        })
        .filter(Boolean) as Array<{
        key: string;
        scopeClass: string;
        cssText: string;
      }>,
    [filteredColumnsMeta],
  );

  const htmlTemplateStyleMap = useMemo(
    () =>
      new Map(
        htmlTemplateStyles.map(item => [
          item.key,
          { scopeClass: item.scopeClass, cssText: item.cssText },
        ]),
      ),
    [htmlTemplateStyles],
  );

  const renderTimeComparisonDropdown = (): JSX.Element => {
    const allKey = comparisonColumns[0].key;
    const handleOnClick = (data: any) => {
      const { key } = data;
      // Toggle 'All' key selection
      if (key === allKey) {
        setSelectedComparisonColumns([allKey]);
      } else if (selectedComparisonColumns.includes(allKey)) {
        setSelectedComparisonColumns([key]);
      } else {
        // Toggle selection for other keys
        setSelectedComparisonColumns(
          selectedComparisonColumns.includes(key)
            ? selectedComparisonColumns.filter(k => k !== key) // Deselect if already selected
            : [...selectedComparisonColumns, key],
        ); // Select if not already selected
      }
    };

    const handleOnBlur = () => {
      if (selectedComparisonColumns.length === 3) {
        setSelectedComparisonColumns([comparisonColumns[0].key]);
      }
    };

    return (
      <Dropdown
        placement="bottomRight"
        visible={showComparisonDropdown}
        onVisibleChange={(flag: boolean) => {
          setShowComparisonDropdown(flag);
        }}
        overlay={
          <Menu
            multiple
            onClick={handleOnClick}
            onBlur={handleOnBlur}
            selectedKeys={selectedComparisonColumns}
          >
            <div
              css={css`
                max-width: 242px;
                padding: 0 ${gridUnit * 2}px;
                color: ${grayscale.base ?? theme.colorText};
                font-size: ${smallFontSize}px;
              `}
            >
              {t(
                'Select columns that will be displayed in the table. You can multiselect columns.',
              )}
            </div>
            {comparisonColumns.map(column => (
              <Menu.Item key={column.key}>
                <span
                  css={css`
                    color: ${grayscale.dark2 ?? theme.colorTextSecondary};
                  `}
                >
                  {column.label}
                </span>
                <span
                  css={css`
                    float: right;
                    font-size: ${smallFontSize}px;
                  `}
                >
                  {selectedComparisonColumns.includes(column.key) && (
                    <CheckOutlined />
                  )}
                </span>
              </Menu.Item>
            ))}
          </Menu>
        }
        trigger={['click']}
      >
        <span>
          <TableOutlined /> <DownOutlined />
        </span>
      </Dropdown>
    );
  };

  const renderGroupingHeaders = (): JSX.Element => {
    // TODO: Make use of ColumnGroup to render the aditional headers
    const headers: any = [];
    let currentColumnIndex = 0;

    Object.entries(groupHeaderColumns || {}).forEach(([key, value]) => {
      // Calculate the number of placeholder columns needed before the current header
      const startPosition = value[0];
      const colSpan = value.length;

      // Add placeholder <th> for columns before this header
      for (let i = currentColumnIndex; i < startPosition; i += 1) {
        headers.push(
          <th
            key={`placeholder-${i}`}
            style={{ borderBottom: 0 }}
            aria-label={`Header-${i}`}
          />,
        );
      }

      // Add the current header <th>
      headers.push(
        <th key={`header-${key}`} colSpan={colSpan} style={{ borderBottom: 0 }}>
          {key}
          <span
            css={css`
              float: right;
              & svg {
                color: ${grayscale.base ?? theme.colorText} !important;
              }
            `}
          >
            {hideComparisonKeys.includes(key) ? (
              <PlusCircleOutlined
                onClick={() =>
                  setHideComparisonKeys(
                    hideComparisonKeys.filter(k => k !== key),
                  )
                }
              />
            ) : (
              <MinusCircleOutlined
                onClick={() =>
                  setHideComparisonKeys([...hideComparisonKeys, key])
                }
              />
            )}
          </span>
        </th>,
      );

      // Update the current column index
      currentColumnIndex = startPosition + colSpan;
    });

    return (
      <tr
        css={css`
          th {
            border-right: 2px solid ${grayscale.light2 ?? theme.colorSplit};
          }
          th:first-child {
            border-left: none;
          }
          th:last-child {
            border-right: none;
          }
        `}
      >
        {headers}
      </tr>
    );
  };

  const groupHeaderColumns = useMemo(
    () => getHeaderColumns(filteredColumnsMeta, isUsingTimeComparison),
    [filteredColumnsMeta, isUsingTimeComparison],
  );

  const getColumnConfigs = useCallback(
    (column: DataColumnMeta, i: number): ColumnWithLooseAccessor<D> => {
      const {
        key,
        label,
        dataType,
        isMetric,
        isPercentMetric,
        config = {},
      } = column;
      const isGroupingPlaceholderColumn = key === GROUP_PLACEHOLDER_COLUMN_KEY;
      const isGroupingToggleColumn =
        hasGroupedData && key === groupingToggleColumnKey;
      const headerLabel =
        rowGroupingCompactView && isGroupingToggleColumn
          ? [groupingColumnDisplayLabel, compactGroupingHeaderLabel]
              .filter(Boolean)
              .join(' / ')
          : label;
      const isSticky = stickyColumnKeys.includes(key);
      const stickyLeft = isSticky ? (stickyColumnOffsets[key] ?? 0) : undefined;
      const columnWidth = Number.isNaN(Number(config.columnWidth))
        ? config.columnWidth
        : Number(config.columnWidth);

      // inline style for both th and td cell
      const sharedStyle: CSSProperties = getSharedStyle(column);

      const alignPositiveNegative =
        config.alignPositiveNegative === undefined
          ? defaultAlignPN
          : config.alignPositiveNegative;
      const colorPositiveNegative =
        config.colorPositiveNegative === undefined
          ? defaultColorPN
          : config.colorPositiveNegative;

      const { truncateLongCells } = config;

      const hasColumnColorFormatters =
        Array.isArray(columnColorFormatters) &&
        columnColorFormatters.length > 0;

      const hasBasicColorFormatters =
        isUsingTimeComparison &&
        Array.isArray(basicColorFormatters) &&
        basicColorFormatters.length > 0;

      const valueRange =
        !hasBasicColorFormatters &&
        !hasColumnColorFormatters &&
        (config.showCellBars === undefined
          ? showCellBars
          : config.showCellBars) &&
        (isMetric || isRawRecords || isPercentMetric) &&
        getValueRange(key, alignPositiveNegative);

      let className = '';
      if (emitCrossFilters && !isMetric) {
        className += ' dt-is-filter';
      }

      if (isSticky) {
        className += ' dt-sticky-col';
      }

      if (!isMetric && !isPercentMetric) {
        className += ' right-border-only';
      } else if (comparisonLabels.includes(label)) {
        const groupinHeader = key.substring(label.length);
        const columnsUnderHeader = groupHeaderColumns[groupinHeader] || [];
        if (i === columnsUnderHeader[columnsUnderHeader.length - 1]) {
          className += ' right-border-only';
        }
      }

      const footerValue = footerTotals?.[key];
      const hasFooterValue =
        typeof footerValue === 'number' && Number.isFinite(footerValue);
      const [isFooterHtml, formattedFooterValue] =
        hasFooterValue && footerSummaryRow
          ? formatColumnValue(column, footerValue, footerSummaryRow as D)
          : [false, ''];
      const footerHtml =
        isFooterHtml && allowRenderHtml
          ? { __html: formattedFooterValue }
          : undefined;
      const footerDisplayText = isFooterHtml
        ? stripHtmlTags(String(formattedFooterValue))
        : String(formattedFooterValue);

      return {
        id: String(i), // to allow duplicate column keys
        // must use custom accessor to allow `.` in column names
        // typing is incorrect in current version of `@types/react-table`
        // so we ask TS not to check.
        accessor: ((datum: D) => datum[key]) as never,
        Cell: ({ value, row }: { value: DataRecordValue; row: Row<D> }) => {
          const originalRow = row.original as D & GroupRowMetadata;
          const isGroupHeader =
            // eslint-disable-next-line no-underscore-dangle
            Boolean(originalRow.__isGroupHeader);
          const isGroupedRow =
            // eslint-disable-next-line no-underscore-dangle
            Boolean(originalRow.__groupParentKey);
          const isGroupHeaderMainCell =
            isGroupHeader &&
            (key === groupingMarkerColumnKey || isGroupingPlaceholderColumn);

          const groupCellStyle: CSSProperties = {
            ...sharedStyle,
            ...(isGroupHeaderMainCell ? { textAlign: 'left' as const } : {}),
            ...(isSticky
              ? {
                  position: 'sticky',
                  left: stickyLeft,
                  zIndex: 2,
                  background: theme.colorFillQuaternary,
                }
              : undefined),
          };

          if (isGroupHeader) {
            // eslint-disable-next-line no-underscore-dangle
            const groupKey = String(originalRow.__groupKey ?? '');
            // eslint-disable-next-line no-underscore-dangle
            const groupLabel = String(originalRow.__groupLabel ?? groupKey);
            // eslint-disable-next-line no-underscore-dangle
            const groupCount = Number(originalRow.__groupCount ?? 0);
            // eslint-disable-next-line no-underscore-dangle
            const isCollapsed = Boolean(originalRow.__isCollapsed);
            // eslint-disable-next-line no-underscore-dangle
            const groupSummaryValues = (originalRow.__groupSummaryValues ??
              {}) as Record<string, DataRecordValue>;
            const groupSummaryValue = groupSummaryValues[key];
            const groupHasSummaries =
              showRowGroupTotals && groupSummaryColumns.length > 0;
            const groupHeaderCellClassName = [
              className,
              'dt-group-header-data-cell',
              isGroupHeaderMainCell ? 'dt-group-header-main-cell' : '',
              typeof groupSummaryValue === 'number'
                ? 'dt-group-header-summary-cell'
                : 'dt-group-header-empty-cell',
            ]
              .filter(Boolean)
              .join(' ');

            if (isGroupHeaderMainCell) {
              return (
                <td
                  aria-labelledby={`header-${column.key}`}
                  className={groupHeaderCellClassName}
                  style={groupCellStyle}
                >
                  <span
                    className="dt-group-header-main dt-group-row-main"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(groupKey)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleGroup(groupKey);
                      }
                    }}
                  >
                    {isCollapsed ? <RightOutlined /> : <DownOutlined />}
                    <span className="dt-group-header-title">{groupLabel}</span>
                    <span className="dt-group-badge">
                      {tn('%s row', '%s rows', groupCount, groupCount)}
                    </span>
                    {groupHasSummaries ? (
                      <span className="dt-group-badge dt-group-badge-subtle">
                        {t('Subtotal')}
                      </span>
                    ) : null}
                  </span>
                </td>
              );
            }

            if (typeof groupSummaryValue === 'number') {
              const groupSummaryRow = {
                ...(originalRow as DataRecord),
                ...groupSummaryValues,
                ...(activeRowGroupingColumn
                  ? { [activeRowGroupingColumn]: groupLabel }
                  : undefined),
              } as D;
              const [isSummaryHtml, formattedSummaryValue] = formatColumnValue(
                column,
                groupSummaryValue,
                groupSummaryRow,
              );
              const summaryHtmlStyle = htmlTemplateStyleMap.get(column.key);
              const summaryHtml =
                isSummaryHtml && allowRenderHtml
                  ? { __html: formattedSummaryValue }
                  : undefined;
              const summaryDisplayText = isSummaryHtml
                ? stripHtmlTags(String(formattedSummaryValue))
                : String(formattedSummaryValue);
              return (
                <td
                  aria-labelledby={`header-${column.key}`}
                  title={String(groupSummaryValue)}
                  className={groupHeaderCellClassName}
                  style={groupCellStyle}
                >
                  {summaryHtml ? (
                    <>
                      <span
                        className={[
                          'dt-group-row-summary-value',
                          'dt-group-row-summary-html',
                          summaryHtmlStyle?.scopeClass ?? '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        // eslint-disable-next-line react/no-danger
                        dangerouslySetInnerHTML={summaryHtml}
                      />
                    </>
                  ) : (
                    <strong className="dt-group-row-summary-value">
                      {summaryDisplayText}
                    </strong>
                  )}
                </td>
              );
            }

            return (
              <td
                aria-labelledby={`header-${column.key}`}
                title=""
                className={groupHeaderCellClassName}
                style={groupCellStyle}
              />
            );
          }

          if (isGroupingPlaceholderColumn) {
            return (
              <td
                aria-labelledby={`header-${column.key}`}
                title=""
                className={
                  isGroupedRow && key === groupingMarkerColumnKey
                    ? 'dt-grouping-key-cell dt-group-placeholder-cell'
                    : 'dt-group-placeholder-cell'
                }
                style={
                  isSticky
                    ? {
                        ...sharedStyle,
                        position: 'sticky',
                        left: stickyLeft,
                        zIndex: 2,
                      }
                    : sharedStyle
                }
              />
            );
          }
          const sourceRowIndex =
            // eslint-disable-next-line no-underscore-dangle
            typeof originalRow.__sourceRowIndex === 'number'
              ? // eslint-disable-next-line no-underscore-dangle
                originalRow.__sourceRowIndex
              : row.index;
          const [isHtml, text] = formatColumnValue(
            column,
            value,
            originalRow as D,
          );
          const htmlStyle = htmlTemplateStyleMap.get(column.key);
          const html = isHtml && allowRenderHtml ? { __html: text } : undefined;
          const displayText = isHtml
            ? stripHtmlTags(String(text))
            : String(text);

          let backgroundColor;
          let arrow = '';
          const originKey = column.key.substring(column.label.length).trim();
          if (
            !hasColumnColorFormatters &&
            hasBasicColorFormatters &&
            sourceRowIndex >= 0 &&
            basicColorFormatters?.[sourceRowIndex]
          ) {
            backgroundColor =
              basicColorFormatters[sourceRowIndex][originKey]?.backgroundColor;
            arrow =
              column.label === comparisonLabels[0]
                ? basicColorFormatters[sourceRowIndex][originKey]?.mainArrow
                : '';
          }

          if (hasColumnColorFormatters) {
            columnColorFormatters!
              .filter(formatter => formatter.column === column.key)
              .forEach(formatter => {
                // Pass the raw value so string-based rules (e.g., LIKE/Equal) still match
                // and numeric values remain numeric. Dates fall back to timestamp to keep
                // comparator behavior consistent.
                const formatterValue =
                  value instanceof Date && typeof value.getTime === 'function'
                    ? value.getTime()
                    : value;
                const hasValue = value !== null && value !== undefined;
                const formatterResult = hasValue
                  ? formatter.getColorFromValue(formatterValue as any)
                  : false;
                if (formatterResult) {
                  backgroundColor = formatterResult;
                }
              });
          }

          if (
            basicColorColumnFormatters &&
            basicColorColumnFormatters?.length > 0 &&
            sourceRowIndex >= 0 &&
            basicColorColumnFormatters?.[sourceRowIndex]
          ) {
            backgroundColor =
              basicColorColumnFormatters[sourceRowIndex][column.key]
                ?.backgroundColor || backgroundColor;
            arrow =
              column.label === comparisonLabels[0]
                ? basicColorColumnFormatters[sourceRowIndex][column.key]
                    ?.mainArrow
                : '';
          }

          const StyledCell = styled.td`
            text-align: ${sharedStyle.textAlign};
            white-space: ${value instanceof Date ? 'nowrap' : undefined};
            position: relative;
            background: ${backgroundColor || undefined};
          `;

          const stickyCellStyle: CSSProperties | undefined = isSticky
            ? {
                position: 'sticky',
                left: stickyLeft,
                zIndex: 2,
                ...(backgroundColor ? { background: backgroundColor } : {}),
              }
            : undefined;

          const cellBarStyles = css`
            position: absolute;
            height: 100%;
            display: block;
            top: 0;
            ${valueRange &&
            `
                width: ${`${cellWidth({
                  value: value as number,
                  valueRange,
                  alignPositiveNegative,
                })}%`};
                left: ${`${cellOffset({
                  value: value as number,
                  valueRange,
                  alignPositiveNegative,
                })}%`};
                background-color: ${cellBackground({
                  value: value as number,
                  colorPositiveNegative,
                  theme,
                })};
              `}
          `;

          let arrowStyles = css`
            color: ${basicColorFormatters &&
            basicColorFormatters?.[sourceRowIndex]?.[originKey]?.arrowColor ===
              ColorSchemeEnum.Green
              ? successColor
              : errorColor};
            margin-right: ${gridUnit}px;
          `;

          if (
            basicColorColumnFormatters &&
            basicColorColumnFormatters?.length > 0 &&
            sourceRowIndex >= 0 &&
            basicColorColumnFormatters?.[sourceRowIndex]
          ) {
            arrowStyles = css`
              color: ${basicColorColumnFormatters[sourceRowIndex][column.key]
                ?.arrowColor === ColorSchemeEnum.Green
                ? successColor
                : errorColor};
              margin-right: ${gridUnit}px;
            `;
          }

          const cellProps = {
            'aria-labelledby': `header-${column.key}`,
            role: 'cell',
            // show raw number in title in case of numeric values
            title: typeof value === 'number' ? String(value) : undefined,
            onClick:
              emitCrossFilters && !valueRange && !isMetric
                ? () => {
                    // allow selecting text in a cell
                    if (!getSelectedText()) {
                      toggleFilter(key, value);
                    }
                  }
                : undefined,
            onContextMenu: (e: MouseEvent) => {
              if (handleContextMenu) {
                e.preventDefault();
                e.stopPropagation();
                handleContextMenu(
                  row.original,
                  { key, value, isMetric },
                  e.nativeEvent.clientX,
                  e.nativeEvent.clientY,
                );
              }
            },
            className: [
              className,
              value == null ? 'dt-is-null' : '',
              isActiveFilterValue(key, value) ? ' dt-is-active-filter' : '',
              isGroupedRow && key === groupingMarkerColumnKey
                ? ' dt-grouping-key-cell'
                : '',
            ].join(' '),
            tabIndex: 0,
          };
          if (html) {
            if (truncateLongCells) {
              // eslint-disable-next-line react/no-danger
              return (
                <StyledCell {...cellProps} style={stickyCellStyle}>
                  <div
                    className={['dt-truncate-cell', htmlStyle?.scopeClass ?? '']
                      .filter(Boolean)
                      .join(' ')}
                    style={columnWidth ? { width: columnWidth } : undefined}
                    dangerouslySetInnerHTML={html}
                  />
                </StyledCell>
              );
            }
            // eslint-disable-next-line react/no-danger
            return (
              <StyledCell {...cellProps} style={stickyCellStyle}>
                <div
                  className={htmlStyle?.scopeClass}
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={html}
                />
              </StyledCell>
            );
          }
          // If cellProps renders textContent already, then we don't have to
          // render `Cell`. This saves some time for large tables.
          return (
            <StyledCell {...cellProps} style={stickyCellStyle}>
              {valueRange && (
                <div
                  /* The following classes are added to support custom CSS styling */
                  className={cx(
                    'cell-bar',
                    isNumber(value) && value < 0 ? 'negative' : 'positive',
                  )}
                  css={cellBarStyles}
                  role="presentation"
                />
              )}
              {truncateLongCells ? (
                <div
                  className="dt-truncate-cell"
                  style={columnWidth ? { width: columnWidth } : undefined}
                >
                  {arrow && <span css={arrowStyles}>{arrow}</span>}
                  {displayText}
                </div>
              ) : (
                <>
                  {arrow && <span css={arrowStyles}>{arrow}</span>}
                  {displayText}
                </>
              )}
            </StyledCell>
          );
        },
        Header: ({ column: col, onClick, style, onDragStart, onDrop }) => (
          <th
            id={`header-${column.key}`}
            title={
              isGroupingPlaceholderColumn
                ? undefined
                : t('Shift + Click to sort by multiple columns')
            }
            className={[className, col.isSorted ? 'is-sorted' : ''].join(' ')}
            style={{
              ...sharedStyle,
              ...style,
              ...(isSticky
                ? { position: 'sticky', left: stickyLeft, zIndex: 3 }
                : undefined),
            }}
            onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
              // programatically sort column on keypress
              if (
                !isGroupingPlaceholderColumn &&
                Object.values(ACTION_KEYS).includes(e.key)
              ) {
                col.toggleSortBy();
              }
            }}
            role={
              isGroupingPlaceholderColumn
                ? 'columnheader'
                : 'columnheader button'
            }
            onClick={isGroupingPlaceholderColumn ? undefined : onClick}
            data-column-name={col.id}
            {...(allowRearrangeColumns && {
              draggable: 'true',
              onDragStart,
              onDragOver: e => e.preventDefault(),
              onDragEnter: e => e.preventDefault(),
              onDrop,
            })}
            tabIndex={0}
          >
            {/* can't use `columnWidth &&` because it may also be zero */}
            {config.columnWidth ? (
              // column width hint
              <div
                style={{
                  width: columnWidth,
                  height: 0.01,
                }}
              />
            ) : null}
            <div
              data-column-name={col.id}
              css={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: gridUnit,
              }}
            >
              {isGroupingToggleColumn ? (
                <Tooltip overlay={groupingToggleLabel}>
                  <button
                    type="button"
                    className="dt-grouping-header-toggle"
                    aria-label={groupingToggleLabel}
                    onMouseDown={event => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onClick={event => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (hasAnyCollapsedGroups) {
                        expandAllGroups();
                      } else {
                        collapseAllGroups();
                      }
                    }}
                    onKeyDown={event => {
                      event.stopPropagation();
                    }}
                  >
                    {hasAnyCollapsedGroups ? (
                      <PlusCircleOutlined />
                    ) : (
                      <MinusCircleOutlined />
                    )}
                  </button>
                </Tooltip>
              ) : null}
              {headerLabel ? (
                <span data-column-name={col.id}>{headerLabel}</span>
              ) : null}
              {!isGroupingPlaceholderColumn ? <SortIcon column={col} /> : null}
            </div>
          </th>
        ),
        Footer: footerTotals ? (
          i === 0 ? (
            <th
              className={isSticky ? 'dt-sticky-col' : undefined}
              style={
                isSticky
                  ? { position: 'sticky', left: stickyLeft, zIndex: 3 }
                  : undefined
              }
            >
              <div
                css={css`
                  display: flex;
                  align-items: center;
                  justify-content: space-between;
                  gap: ${gridUnit * 2}px;
                  & svg {
                    margin-left: ${gridUnit}px;
                    color: ${grayscale.dark1 ??
                    theme.colorTextSecondary} !important;
                  }
                `}
              >
                <span
                  css={css`
                    display: inline-flex;
                    align-items: center;
                  `}
                >
                  {t('Resumen')}
                  <Tooltip
                    overlay={t(
                      'Show total aggregations of selected metrics. Note that row limit does not apply to the result.',
                    )}
                  >
                    <InfoCircleOutlined />
                  </Tooltip>
                </span>
                {hasFooterValue ? (
                  footerHtml ? (
                    <span
                      className="dt-group-row-summary-html"
                      // eslint-disable-next-line react/no-danger
                      dangerouslySetInnerHTML={footerHtml}
                    />
                  ) : (
                    <strong>{footerDisplayText}</strong>
                  )
                ) : null}
              </div>
            </th>
          ) : (
            <td
              className={isSticky ? 'dt-sticky-col' : undefined}
              style={{
                ...sharedStyle,
                ...(isSticky
                  ? { position: 'sticky', left: stickyLeft, zIndex: 2 }
                  : undefined),
              }}
            >
              {footerHtml ? (
                <span
                  className="dt-group-row-summary-html"
                  // eslint-disable-next-line react/no-danger
                  dangerouslySetInnerHTML={footerHtml}
                />
              ) : (
                <strong>{footerDisplayText}</strong>
              )}
            </td>
          )
        ) : undefined,
        sortDescFirst: sortDesc,
        sortType: getSortTypeByDataType(dataType),
        disableSortBy: isGroupingPlaceholderColumn,
      };
    },
    [
      collapseAllGroups,
      defaultAlignPN,
      defaultColorPN,
      emitCrossFilters,
      expandAllGroups,
      getValueRange,
      groupSummaryColumns,
      groupingColumnDisplayLabel,
      groupingMarkerColumnKey,
      groupingToggleColumnKey,
      groupingToggleLabel,
      gridUnit,
      hasAnyCollapsedGroups,
      hasGroupedData,
      isActiveFilterValue,
      isRawRecords,
      showRowGroupTotals,
      showCellBars,
      sortDesc,
      toggleGroup,
      toggleFilter,
      footerTotals,
      footerSummaryRow,
      columnColorFormatters,
      columnOrderToggle,
      compactGroupingHeaderLabel,
      stickyColumnKeys,
      stickyColumnOffsets,
      activeRowGroupingColumn,
    ],
  );

  const columns = useMemo(
    () => filteredColumnsMeta.map(getColumnConfigs),
    [filteredColumnsMeta, getColumnConfigs],
  );

  const handleServerPaginationChange = useCallback(
    (pageNumber: number, pageSize: number) => {
      updateExternalFormData(setDataMask, pageNumber, pageSize);
    },
    [setDataMask],
  );

  const handleSortByChange = useCallback(
    (nextSortBy: Array<SortingRule<D>>) => {
      setSortBy(prev => (isEqual(prev, nextSortBy) ? prev : nextSortBy));
    },
    [],
  );

  const handleSizeChange = useCallback(
    ({ width, height }: { width: number; height: number }) => {
      setTableSize({ width, height });
    },
    [],
  );

  useLayoutEffect(() => {
    // After initial load the table should resize only when the new sizes
    // Are not only scrollbar updates, otherwise, the table would twicth
    const scrollBarSize = getScrollBarSize();
    const { width: tableWidth, height: tableHeight } = tableSize;
    // Table is increasing its original size
    if (
      width - tableWidth > scrollBarSize ||
      height - tableHeight > scrollBarSize
    ) {
      handleSizeChange({
        width: width - scrollBarSize,
        height: height - scrollBarSize,
      });
    } else if (
      tableWidth - width > scrollBarSize ||
      tableHeight - height > scrollBarSize
    ) {
      // Table is decreasing its original size
      handleSizeChange({
        width,
        height,
      });
    }
  }, [width, height, handleSizeChange, tableSize]);

  const { width: widthFromState, height: heightFromState } = tableSize;

  return (
    <Styles>
      {htmlTemplateStyles.map(item => (
        <style key={`html-template-style-${item.scopeClass}`}>
          {item.cssText}
        </style>
      ))}
      <DataTable<D>
        columns={columns}
        data={displayData}
        rowCount={rowCount}
        tableClassName="table table-striped table-condensed"
        pageSize={pageSize}
        serverPaginationData={serverPaginationData}
        pageSizeOptions={pageSizeOptions}
        width={widthFromState}
        height={heightFromState}
        serverPagination={serverPagination}
        onServerPaginationChange={handleServerPaginationChange}
        onColumnOrderChange={() => setColumnOrderToggle(!columnOrderToggle)}
        // 9 page items in > 340px works well even for 100+ pages
        maxPageItemCount={width > 340 ? 9 : 7}
        noResults={getNoResultsMessage}
        searchInput={includeSearch && SearchInput}
        selectPageSize={pageSize !== null && SelectPageSize}
        // not in use in Superset, but needed for unit tests
        sticky={sticky}
        renderGroupingHeaders={
          !isEmpty(groupHeaderColumns) ? renderGroupingHeaders : undefined
        }
        renderTimeComparisonDropdown={
          isUsingTimeComparison ? renderTimeComparisonDropdown : undefined
        }
        topNControl={tableToolbarControl}
        manualSortBy={hasGroupedData}
        onSortByChange={handleSortByChange}
        onStickyColumnWidthsChange={handleStickyColumnWidthsChange}
      />
    </Styles>
  );
}
