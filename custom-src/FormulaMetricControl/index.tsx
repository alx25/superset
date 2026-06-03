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
import { ChangeEvent, Component, KeyboardEvent, MouseEvent } from 'react';
import PropTypes from 'prop-types';
import {
  Button,
  Checkbox,
  FormItem,
  Input,
  Modal,
  SQLEditor,
} from '@superset-ui/core/components';
import { t, styled } from '@superset-ui/core';
import { Icons } from '@superset-ui/core/components/Icons';
import { getTooltipHTML } from '@superset-ui/core/components/AsyncAceEditor';
import { COLUMN_AUTOCOMPLETE_SCORE } from 'src/SqlLab/constants';
import sqlKeywords from 'src/SqlLab/utils/sqlKeywords';
import { getColumnKeywords } from 'src/explore/controlUtils/getColumnKeywords';
import ControlPopover from 'src/explore/components/controls/ControlPopover/ControlPopover';

const StyledSummary = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const EditorWrapper = styled.div`
  border: 1px solid ${({ theme }) => theme.colorBorder};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  padding: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const ButtonBar = styled.div`
  margin-top: ${({ theme }) => theme.sizeUnit * 4}px;
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.sizeUnit * 2}px;
`;

const HelpText = styled.div`
  margin-top: ${({ theme }) => theme.sizeUnit * 2}px;
  color: ${({ theme }) => theme.colorTextSecondary};
  font-size: ${({ theme }) => theme.fontSizeSM}px;
  display: grid;
  gap: ${({ theme }) => theme.sizeUnit}px;
`;

const ExampleLine = styled.div`
  font-family: ${({ theme }) => theme.fontFamilyCode};
`;

const HelpModalContent = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.sizeUnit * 3}px;
`;

const HelpSection = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.sizeUnit}px;
`;

const HelpTitle = styled.div`
  font-weight: ${({ theme }) => theme.fontWeightStrong};
`;

const HelpItem = styled.div`
  display: grid;
  gap: ${({ theme }) => theme.sizeUnit}px;
`;

const HelpExample = styled.div`
  font-family: ${({ theme }) => theme.fontFamilyCode};
  color: ${({ theme }) => theme.colorTextSecondary};
`;

const popoverWidth = 520;

type MetricLike = {
  label?: string;
  metric_name?: string;
};

type FormulaMetricControlProps = {
  label?: string;
  expression?: string;
  d3format?: string;
  hidden?: boolean;
  onChange?: (value: {
    label: string;
    expression: string;
    d3format?: string;
    hidden: boolean;
  }) => void;
  columns?: any[];
  metrics?: Array<string | MetricLike>;
};

type FormulaMetricControlState = {
  label: string;
  expression: string;
  d3format: string;
  hidden: boolean;
  popoverVisible: boolean;
  showHelpModal: boolean;
};

const propTypes = {
  label: PropTypes.string,
  expression: PropTypes.string,
  d3format: PropTypes.string,
  onChange: PropTypes.func,
  columns: PropTypes.array,
  metrics: PropTypes.array,
};

const defaultProps: FormulaMetricControlProps = {
  label: '',
  expression: '',
  d3format: '',
  hidden: false,
  onChange: () => {},
  columns: [],
  metrics: [],
};

export default class FormulaMetricControl extends Component<
  FormulaMetricControlProps,
  FormulaMetricControlState
> {
  static propTypes = propTypes;

  static defaultProps = defaultProps;

  constructor(props: FormulaMetricControlProps) {
    super(props);

    this.onSave = this.onSave.bind(this);
    this.onClose = this.onClose.bind(this);
    this.resetState = this.resetState.bind(this);
    this.onPopoverVisibleChange = this.onPopoverVisibleChange.bind(this);
    this.onLabelChange = this.onLabelChange.bind(this);
    this.onFormatChange = this.onFormatChange.bind(this);
    this.onExpressionChange = this.onExpressionChange.bind(this);
    this.openHelpModal = this.openHelpModal.bind(this);
    this.closeHelpModal = this.closeHelpModal.bind(this);

    this.state = this.initialState();
  }

  initialState(): FormulaMetricControlState {
    return {
      label: this.props.label || '',
      expression: this.props.expression || '',
      d3format: this.props.d3format || '',
      hidden: this.props.hidden ?? false,
      popoverVisible: false,
      showHelpModal: false,
    };
  }

  resetState() {
    this.setState(this.initialState());
  }

  onSave() {
    this.props.onChange?.({
      label: this.state.label,
      expression: this.state.expression,
      d3format: this.state.d3format,
      hidden: this.state.hidden,
    });
    this.setState({ popoverVisible: false });
  }

  onClose() {
    this.resetState();
  }

  onPopoverVisibleChange(popoverVisible: boolean) {
    if (!popoverVisible) {
      this.resetState();
      return;
    }
    this.setState({ popoverVisible });
  }

  onLabelChange(event: ChangeEvent<HTMLInputElement>) {
    this.setState({ label: event.target.value });
  }

  onFormatChange(event: ChangeEvent<HTMLInputElement>) {
    this.setState({ d3format: event.target.value });
  }

  normalizeExpression(expression: string) {
    return expression
      .replace(/\{\{\{+/g, '{{')
      .replace(/\}\}\}+/g, '}}');
  }

  shouldIgnorePopoverClose(
    event?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLDivElement>,
  ) {
    if (!event || !event.target || !(event.target instanceof HTMLElement)) {
      return false;
    }
    const target = event.target;
    const aceTarget = target.closest(
      '.ace_editor, .ace_autocomplete, .ace_tooltip, .ace_search',
    );
    if (aceTarget) {
      return true;
    }
    if ('key' in event && event.key === 'Enter') {
      return !!target.closest('.ace_editor');
    }
    return false;
  }

  onExpressionChange(expression: string) {
    const normalized = this.normalizeExpression(expression);
    this.setState({ expression: normalized });
  }

  openHelpModal() {
    this.setState({ showHelpModal: true, popoverVisible: false });
  }

  closeHelpModal() {
    this.setState({ showHelpModal: false });
  }

  getMetricLabels(): string[] {
    return (this.props.metrics || [])
      .map((metric: string | MetricLike) => {
        if (typeof metric === 'string') {
          return metric;
        }
        return metric.label || metric.metric_name || '';
      })
      .filter(Boolean);
  }

  getKeywords() {
    const metricLabels = this.getMetricLabels();
    const metricKeywords = metricLabels.map(name => ({
      meta: 'metric',
      name,
      value: `{{${name}}}`,
      score: COLUMN_AUTOCOMPLETE_SCORE,
      docHTML: getTooltipHTML({
        title: name,
        body: t('Metric placeholder'),
      }),
    }));
    const scopedMetricKeywords = metricLabels.flatMap(name => [
      {
        meta: 'total',
        name: `total.{{${name}}}`,
        value: `total.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `total.{{${name}}}`,
          body: t('Total across all rows and columns.'),
        }),
      },
      {
        meta: 'row',
        name: `row.{{${name}}}`,
        value: `row.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `row.{{${name}}}`,
          body: t('Total for the current row.'),
        }),
      },
      {
        meta: 'col',
        name: `col.{{${name}}}`,
        value: `col.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `col.{{${name}}}`,
          body: t('Total for the current column.'),
        }),
      },
      {
        meta: 'previous',
        name: `previous.{{${name}}}`,
        value: `previous.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `previous.{{${name}}}`,
          body: t('Value of this metric in the previous row. Returns null on the first row.'),
        }),
      },
      {
        meta: 'next',
        name: `next.{{${name}}}`,
        value: `next.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `next.{{${name}}}`,
          body: t('Value of this metric in the next row. Returns null on the last row.'),
        }),
      },
    ]);
    const functionKeywords = [
      {
        meta: 'function',
        name: 'IF',
        value: 'IF(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'IF',
          body: t('IF(condition, value_if_true, value_if_false)'),
        }),
      },
      {
        meta: 'function',
        name: 'OR',
        value: 'OR(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'OR',
          body: t('OR(condition1, condition2, ...)'),
        }),
      },
      {
        meta: 'function',
        name: 'AND',
        value: 'AND(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'AND',
          body: t('AND(condition1, condition2, ...)'),
        }),
      },
      {
        meta: 'function',
        name: 'NOT',
        value: 'NOT(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'NOT',
          body: t('NOT(condition)'),
        }),
      },
      {
        meta: 'function',
        name: 'ISBLANK',
        value: 'ISBLANK(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'ISBLANK',
          body: t('ISBLANK(value)'),
        }),
      },
      {
        meta: 'function',
        name: 'ABS',
        value: 'ABS(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'ABS',
          body: t('ABS(value)'),
        }),
      },
      {
        meta: 'function',
        name: 'ROUND',
        value: 'ROUND(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'ROUND',
          body: t('ROUND(value, decimals)'),
        }),
      },
      {
        meta: 'function',
        name: 'MAX',
        value: 'MAX(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'MAX',
          body: t('MAX(value1, value2, ...)'),
        }),
      },
      {
        meta: 'function',
        name: 'MIN',
        value: 'MIN(',
        score: COLUMN_AUTOCOMPLETE_SCORE + 1,
        docHTML: getTooltipHTML({
          title: 'MIN',
          body: t('MIN(value1, value2, ...)'),
        }),
      },
    ];

    return sqlKeywords.concat(
      getColumnKeywords(this.props.columns || []),
      metricKeywords,
      scopedMetricKeywords,
      functionKeywords,
    );
  }

  textSummary() {
    const base = this.props.label || this.props.expression || t('Formula metric');
    return this.props.hidden ? `[aux] ${base}` : base;
  }

  renderPopover() {
    const keywords = this.getKeywords();
    return (
      <div style={{ width: popoverWidth }}>
        <FormItem
          label={t('Label')}
          tooltip={t(
            'Supports Jinja placeholders from Jinja fields, for example Ratio {{Mes}}.',
          )}
        >
          <Input
            placeholder={t('Metric label, e.g. Ratio {{Mes}}')}
            value={this.state.label}
            onChange={this.onLabelChange}
          />
        </FormItem>
        <FormItem
          label={t('Formula')}
          tooltip={t(
            'Use {{Metric}} placeholders, e.g. {{Venta}}/{{Plan}}. ' +
              'Scopes: total.{{Venta}}, row.{{Venta}}, col.{{Venta}}, ' +
              'previous.{{Venta}} (row anterior), next.{{Venta}} (row siguiente).',
          )}
        >
          <EditorWrapper>
            <SQLEditor
              data-test="formula-metric-editor"
              showLoadingForImport
              keywords={keywords}
              height="140px"
              onChange={this.onExpressionChange}
              width="100%"
              showGutter={false}
              value={this.state.expression}
              editorProps={{ $blockScrolling: true }}
              enableLiveAutocompletion
              wrapEnabled
            />
          </EditorWrapper>
          <HelpText>
            <div>{t('Examples')}</div>
            <ExampleLine>{'{{Venta}}/{{Plan}}'}</ExampleLine>
            <ExampleLine>{'{{Venta}}/total.{{Venta}}'}</ExampleLine>
            <ExampleLine>{'{{Venta}} - previous.{{Venta}}'}</ExampleLine>
            <ExampleLine>
              {
                'IF(OR({{Kg Rech.}} = 0, {{Kg Rech.}} = ""), "", {{Kg Rech.}}/total.{{Kg Rech.}})'
              }
            </ExampleLine>
            <div>{t('Scopes')}</div>
            <ExampleLine>{'total / row / col / previous / next'}</ExampleLine>
            <div>{t('Functions')}</div>
            <ExampleLine>{'IF, OR, AND, NOT, ISBLANK, ABS, ROUND, MAX, MIN'}</ExampleLine>
            <Button
              buttonStyle="link"
              buttonSize="small"
              onClick={() => this.openHelpModal()}
              cta
            >
              {t('View all functions')}
            </Button>
          </HelpText>
        </FormItem>
        <FormItem
          label={t('D3 format')}
          tooltip={t('Overrides the table format for this metric.')}
        >
          <Input
            placeholder={t('e.g. .2%')}
            value={this.state.d3format}
            onChange={this.onFormatChange}
          />
        </FormItem>
        <FormItem
          tooltip={t(
            'The metric is computed and available for other formulas but is not shown as a column in the table or in CSV/Excel exports.',
          )}
        >
          <Checkbox
            checked={this.state.hidden}
            onChange={e => this.setState({ hidden: e.target.checked })}
          >
            {t('Auxiliar (no mostrar en tabla)')}
          </Checkbox>
        </FormItem>
        <ButtonBar>
          <Button buttonSize="small" onClick={this.onClose} cta>
            {t('Close')}
          </Button>
          <Button buttonStyle="primary" buttonSize="small" onClick={this.onSave} cta>
            {t('Save')}
          </Button>
        </ButtonBar>
      </div>
    );
  }

  render() {
    return (
      <>
        <StyledSummary>
          <span>{this.textSummary()}</span>
          <ControlPopover
            trigger="click"
            content={this.renderPopover()}
            title={t('Formula metric')}
            open={this.state.popoverVisible}
            onOpenChange={(visible, event) => {
              if (!visible && this.shouldIgnorePopoverClose(event)) {
                return;
              }
              this.onPopoverVisibleChange(visible);
            }}
          >
            <span
              css={theme => ({
                display: 'inline-block',
                cursor: 'pointer',
                '& svg path': {
                  fill: theme.colorIcon,
                  transition: `fill ${theme.motionDurationMid} ease-out`,
                },
                '&:hover svg path': {
                  fill: theme.colorPrimary,
                },
              })}
            >
              <Icons.EditOutlined iconSize="s" />
            </span>
          </ControlPopover>
        </StyledSummary>
        <Modal
          show={this.state.showHelpModal}
          onHide={() => this.closeHelpModal()}
          title={t('Formula functions')}
          primaryButtonName={t('Close')}
          onHandledPrimaryAction={() => this.closeHelpModal()}
          zIndex={2000}
          responsive
        >
          <HelpModalContent>
            <HelpSection>
              <HelpTitle>{t('Scopes')}</HelpTitle>
              <HelpItem>
                <div>{t('Totals across all rows/cols')}</div>
                <HelpExample>{'total.{{Metric}}'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('Totals for the current row')}</div>
                <HelpExample>{'row.{{Metric}}'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('Totals for the current column')}</div>
                <HelpExample>{'col.{{Metric}}'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>
                  {t('Value in the previous row (null on the first row)')}
                </div>
                <HelpExample>{'previous.{{Metric}}'}</HelpExample>
                <HelpExample>{'{{Venta}} - previous.{{Venta}}'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>
                  {t('Value in the next row (null on the last row)')}
                </div>
                <HelpExample>{'next.{{Metric}}'}</HelpExample>
                <HelpExample>{'next.{{Venta}} - {{Venta}}'}</HelpExample>
              </HelpItem>
            </HelpSection>
            <HelpSection>
              <HelpTitle>{t('Functions')}</HelpTitle>
              <HelpItem>
                <div>{t('IF(condition, value_if_true, value_if_false)')}</div>
                <HelpExample>
                  {
                    'IF({{Venta}} = 0, "", {{Venta}}/total.{{Venta}})'
                  }
                </HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('OR(condition1, condition2, ...)')}</div>
                <HelpExample>
                  {
                    'OR({{Kg Rech.}} = 0, ISBLANK({{Kg Rech.}}))'
                  }
                </HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('AND(condition1, condition2, ...)')}</div>
                <HelpExample>
                  {
                    'AND({{Venta}} > 0, {{Plan}} > 0)'
                  }
                </HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('NOT(condition)')}</div>
                <HelpExample>{'NOT(ISBLANK({{Venta}}))'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('ISBLANK(value)')}</div>
                <HelpExample>{'ISBLANK({{Kg Rech.}})'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('ABS(value)')}</div>
                <HelpExample>{'ABS({{Venta}} - {{Plan}})'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('ROUND(value, decimals)')}</div>
                <HelpExample>{'ROUND({{Venta}}/total.{{Venta}}, 4)'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('MAX(value1, value2, ...)')}</div>
                <HelpExample>{'MAX({{Venta}}, {{Plan}})'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>{t('MIN(value1, value2, ...)')}</div>
                <HelpExample>{'MIN({{Venta}}, {{Plan}})'}</HelpExample>
              </HelpItem>
            </HelpSection>
          </HelpModalContent>
        </Modal>
      </>
    );
  }
}
