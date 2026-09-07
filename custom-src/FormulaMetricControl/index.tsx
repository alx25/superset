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
import { ChangeEvent, Component } from 'react';
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
  datasourceColumns?: any[];
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
  datasourceColumns: PropTypes.array,
  metrics: PropTypes.array,
};

const defaultProps: FormulaMetricControlProps = {
  label: '',
  expression: '',
  d3format: '',
  hidden: false,
  onChange: () => {},
  datasourceColumns: [],
  metrics: [],
};

export default class FormulaMetricControl extends Component<
  FormulaMetricControlProps,
  FormulaMetricControlState
> {
  static propTypes = propTypes;

  static defaultProps = defaultProps;

  // ControlPopover (componente core de Superset) no reenvía el evento nativo
  // a onOpenChange -- solo pasa el booleano `visible`. Sin el evento no hay
  // forma de saber si el clic que "cerró" el popover en realidad ocurrió
  // dentro del dropdown de autocompletado de Ace (que se monta en
  // document.body, fuera del árbol del popover, por lo que Ant Design lo
  // trata como "clic afuera"). Para evitarlo, rastreamos nosotros mismos el
  // último mousedown/keydown en fase de captura, que siempre corre antes que
  // los listeners de cierre de Ant Design.
  lastPointerDownTarget: HTMLElement | null = null;

  lastKeyDownTarget: HTMLElement | null = null;

  lastKeyDownKey: string | null = null;

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
    this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
    this.handleDocumentKeyDown = this.handleDocumentKeyDown.bind(this);

    this.state = this.initialState();
  }

  componentDidMount() {
    // Bubble-phase listeners (registered on mount, before the popover has
    // ever opened) run before rc-trigger's own document-level "click
    // outside" listener, which it only attaches once the popover opens.
    // That ordering is what lets stopImmediatePropagation() below win.
    document.addEventListener('mousedown', this.handleDocumentPointerDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleDocumentPointerDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
  }

  handleDocumentPointerDown(event: globalThis.MouseEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    this.lastPointerDownTarget = target;
    // ControlPopover (core Superset component) closes its own internal
    // `visible` state unconditionally as soon as Ant Design's Popover
    // detects a "click outside" -- it does this *before* calling
    // onOpenChange, so vetoing the close from FormulaMetricControl's side is
    // too late; the popover has already closed visually by then. Ace's
    // autocomplete dropdown mounts in document.body, outside the popover's
    // own DOM, so Ant Design treats clicking a suggestion as "outside".
    // Since the event already reached its target normally during the
    // capture/target phase (Ace has processed the click), stopping it here
    // in the bubble phase, before it reaches Ant Design's document
    // listener, keeps the suggestion selection working while preventing the
    // popover from ever finding out about the click.
    if (this.state.popoverVisible && this.isAceTarget(target)) {
      event.stopImmediatePropagation();
    }
  }

  handleDocumentKeyDown(event: globalThis.KeyboardEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null;
    this.lastKeyDownTarget = target;
    this.lastKeyDownKey = event.key;
    if (
      this.state.popoverVisible &&
      event.key === 'Enter' &&
      this.isAceTarget(target)
    ) {
      event.stopImmediatePropagation();
    }
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

  isAceTarget(target: HTMLElement | null) {
    if (!target) {
      return false;
    }
    return !!target.closest(
      '.ace_editor, .ace_autocomplete, .ace_tooltip, .ace_search',
    );
  }

  shouldIgnorePopoverClose() {
    // ControlPopover no reenvía el evento del clic que disparó el cierre, así
    // que usamos el último mousedown/keydown capturados por nuestros propios
    // listeners (ver componentDidMount) en lugar de un evento recibido acá.
    if (this.isAceTarget(this.lastPointerDownTarget)) {
      return true;
    }
    if (
      this.lastKeyDownKey === 'Enter' &&
      this.isAceTarget(this.lastKeyDownTarget)
    ) {
      return true;
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
          body: t('Grand total of this metric across the whole table.'),
        }),
      },
      {
        meta: 'row',
        name: `row.{{${name}}}`,
        value: `row.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `row.{{${name}}}`,
          body: t('Same as {{Metric}}: the value in the current row.'),
        }),
      },
      {
        meta: 'col',
        name: `col.{{${name}}}`,
        value: `col.{{${name}}}`,
        score: COLUMN_AUTOCOMPLETE_SCORE - 1,
        docHTML: getTooltipHTML({
          title: `col.{{${name}}}`,
          body: t('Same as {{Metric}}: the value in the current row.'),
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
      getColumnKeywords(this.props.datasourceColumns || []),
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
              'Scopes: total.{{Venta}} (grand total), row.{{Venta}} / ' +
              'col.{{Venta}} (same as {{Venta}}).',
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
            <ExampleLine>
              {
                'IF(OR({{Kg Rech.}} = 0, {{Kg Rech.}} = ""), "", {{Kg Rech.}}/total.{{Kg Rech.}})'
              }
            </ExampleLine>
            <div>{t('Scopes')}</div>
            <ExampleLine>{'total (grand total) / row, col (same as {{Metric}})'}</ExampleLine>
            <div>
              {t(
                'A formula can reference another calculated column defined above it in this list.',
              )}
            </div>
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
            onOpenChange={visible => {
              if (!visible && this.shouldIgnorePopoverClose()) {
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
                <div>{t('Grand total across the whole table')}</div>
                <HelpExample>{'total.{{Metric}}'}</HelpExample>
                <HelpExample>{'{{Venta}}/total.{{Venta}}'}</HelpExample>
              </HelpItem>
              <HelpItem>
                <div>
                  {t(
                    'row.{{Metric}} and col.{{Metric}} are aliases: same value as {{Metric}} in the current row.',
                  )}
                </div>
                <HelpExample>{'row.{{Metric}} = col.{{Metric}} = {{Metric}}'}</HelpExample>
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
