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
import { GenericDataType, t, useTheme } from '@superset-ui/core';
import Tabs from '@superset-ui/core/components/Tabs';
import copyTextToClipboard from 'src/utils/copy';
import { useToasts } from 'src/components/MessageToasts/withToasts';
import {
  HTML_TEMPLATE_AI_PROMPT,
  HTML_TEMPLATE_EXAMPLES,
  HtmlTemplateExample,
  SHARED_COLUMN_CONFIG_PROPS,
  SharedColumnConfigProp,
} from './constants';
import {
  ColumnConfig,
  ColumnConfigFormItem,
  ColumnConfigFormLayout,
  ColumnConfigInfo,
  ControlFormItemDefaultSpec,
  isTabLayoutItem,
  TabLayoutItem,
} from './types';
import ControlForm, { ControlFormItem, ControlFormRow } from './ControlForm';

export type ColumnConfigPopoverProps = {
  column: ColumnConfigInfo;
  configFormLayout: ColumnConfigFormLayout;
  onChange: (value: ColumnConfig) => void;
  width?: number | string;
  height?: number | string;
  columnNames?: string[];
};

type HtmlTemplateHelpPanelProps = {
  value: ColumnConfig;
  onChange: (value: ColumnConfig) => void;
};

function HtmlTemplateHelpPanel({
  value,
  onChange,
}: HtmlTemplateHelpPanelProps) {
  const theme = useTheme();
  const { sizeUnit } = theme;
  const { addSuccessToast, addDangerToast } = useToasts();

  const cardCss = {
    border: `1px solid ${theme.colorBorder}`,
    borderRadius: sizeUnit * 2,
    background: theme.colorBgContainer,
    padding: sizeUnit * 3,
    overflow: 'hidden' as const,
  };

  const buttonCss = {
    padding: `${sizeUnit / 2}px ${sizeUnit * 1.5}px`,
    borderRadius: sizeUnit,
    border: `1px solid ${theme.colorBorder}`,
    background: theme.colorBgContainer,
    cursor: 'pointer',
    fontSize: theme.fontSizeSM,
  };

  const codeBlockCss = {
    margin: 0,
    padding: sizeUnit * 2,
    borderRadius: sizeUnit * 1.5,
    border: `1px solid ${theme.colorBorder}`,
    background: theme.colorBgElevated,
    color: theme.colorText,
    whiteSpace: 'pre-wrap' as const,
    overflowX: 'auto' as const,
    overflowY: 'auto' as const,
    maxHeight: sizeUnit * 26,
    fontSize: theme.fontSizeSM,
    fontFamily: 'monospace',
    lineHeight: 1.5,
  };

  const copyText = async (text: string) => {
    try {
      await copyTextToClipboard(() => Promise.resolve(text));
      addSuccessToast(t('Copied to clipboard!'));
    } catch {
      addDangerToast(t('Sorry, something went wrong. Try again later.'));
    }
  };

  const applyExample = (example: HtmlTemplateExample) => {
    onChange({
      ...value,
      enableHtmlTemplate: true,
      htmlTemplate: example.htmlTemplate,
      htmlCss: example.css,
    });
    addSuccessToast(t('Example applied'));
  };

  return (
    <div
      css={{
        display: 'grid',
        gap: sizeUnit * 2,
        marginTop: sizeUnit * 2,
        maxHeight: 'min(54vh, 460px)',
        overflowY: 'auto',
        paddingRight: sizeUnit / 2,
      }}
    >
      <div css={cardCss}>
        <div
          css={{
            fontWeight: 600,
            marginBottom: sizeUnit / 2,
          }}
        >
          {t('Examples')}
        </div>
        <div
          css={{
            color: theme.colorTextSecondary,
            fontSize: theme.fontSizeSM,
          }}
        >
          {t(
            'Use these as working starting points. "Apply example" replaces both the HTML and CSS editors for this column.',
          )}
        </div>
      </div>
      {HTML_TEMPLATE_EXAMPLES.map(example => (
        <details key={example.key} css={cardCss}>
          <summary
            css={{
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {example.title}
          </summary>
          <div
            css={{
              display: 'grid',
              gap: sizeUnit * 2,
              marginTop: sizeUnit * 2,
            }}
          >
            <div
              css={{
                color: theme.colorTextSecondary,
                fontSize: theme.fontSizeSM,
              }}
            >
              {example.summary}
              {example.note ? ` ${example.note}` : ''}
            </div>
            <div
              css={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: sizeUnit,
              }}
            >
              <button
                type="button"
                onClick={() => applyExample(example)}
                css={{
                  ...buttonCss,
                  borderColor: theme.colorPrimaryBorder,
                  color: theme.colorPrimary,
                }}
              >
                {t('Apply example')}
              </button>
              <button
                type="button"
                onClick={() => {
                  copyText(example.htmlTemplate);
                }}
                css={buttonCss}
              >
                {t('Copy HTML')}
              </button>
              <button
                type="button"
                onClick={() => {
                  copyText(example.css);
                }}
                css={buttonCss}
              >
                {t('Copy CSS')}
              </button>
            </div>
            <Tabs
              items={[
                {
                  key: `${example.key}-html`,
                  label: t('HTML'),
                  children: (
                    <div>
                      <div
                        css={{
                          fontWeight: 600,
                          fontSize: theme.fontSizeSM,
                          marginBottom: sizeUnit,
                        }}
                      >
                        {t('HTML template')}
                      </div>
                      <pre css={codeBlockCss}>{example.htmlTemplate}</pre>
                    </div>
                  ),
                },
                {
                  key: `${example.key}-css`,
                  label: t('CSS'),
                  children: (
                    <div>
                      <div
                        css={{
                          fontWeight: 600,
                          fontSize: theme.fontSizeSM,
                          marginBottom: sizeUnit,
                        }}
                      >
                        {t('CSS')}
                      </div>
                      <pre css={codeBlockCss}>{example.css}</pre>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </details>
      ))}
      <details css={cardCss}>
        <summary
          css={{
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {t('AI prompt')}
        </summary>
        <div
          css={{
            display: 'grid',
            gap: sizeUnit * 2,
            marginTop: sizeUnit * 2,
          }}
        >
          <div
            css={{
              color: theme.colorTextSecondary,
              fontSize: theme.fontSizeSM,
            }}
          >
            {t(
              'Copy this prompt into another AI, replace the placeholders, and ask for a format compatible with this plugin.',
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => {
                copyText(HTML_TEMPLATE_AI_PROMPT);
              }}
              css={buttonCss}
            >
              {t('Copy prompt')}
            </button>
          </div>
          <pre
            css={{
              ...codeBlockCss,
              maxHeight: sizeUnit * 30,
            }}
          >
            {HTML_TEMPLATE_AI_PROMPT}
          </pre>
        </div>
      </details>
    </div>
  );
}

export default function ColumnConfigPopover({
  column,
  configFormLayout,
  onChange,
  columnNames,
}: ColumnConfigPopoverProps) {
  const getItemKey = (meta: ColumnConfigFormItem) =>
    typeof meta === 'string' ? meta : meta.name;

  const renderRow = (row: ColumnConfigFormItem[], i: number) => (
    <ControlFormRow key={i}>
      {row.map(meta => {
        const key = getItemKey(meta);
        const override =
          typeof meta === 'string'
            ? {}
            : 'override' in meta
              ? meta.override
              : meta.config;
        const props = {
          ...(key in SHARED_COLUMN_CONFIG_PROPS
            ? SHARED_COLUMN_CONFIG_PROPS[key as SharedColumnConfigProp]
            : undefined),
          ...override,
        } as ControlFormItemDefaultSpec;
        const helperProps =
          key === 'htmlTemplate'
            ? { templateVariables: columnNames }
            : undefined;
        return (
          <ControlFormItem key={key} name={key} {...props} {...helperProps} />
        );
      })}
    </ControlFormRow>
  );

  const layout =
    configFormLayout[
      column.type === undefined ? GenericDataType.String : column.type
    ];

  if (isTabLayoutItem(layout[0])) {
    const tabItems = (layout as TabLayoutItem[])
      .filter(isTabLayoutItem)
      .map((item: TabLayoutItem, i: number) => ({
        key: i.toString(),
        label: item.tab,
        children: (() => {
          const hasHtmlEditors = item.children.some(row =>
            row.some(meta => {
              const key = getItemKey(meta);
              return key === 'htmlTemplate' || key === 'htmlCss';
            }),
          );
          const isHtmlTab = item.tab === t('HTML');

          if (!isHtmlTab || !hasHtmlEditors) {
            return (
              <ControlForm onChange={onChange} value={column.config}>
                {item.children.map(
                  (row: ColumnConfigFormItem[], rowIndex: number) =>
                    renderRow(row, rowIndex),
                )}
              </ControlForm>
            );
          }

          const baseRows = item.children.filter(
            row =>
              !row.some(meta => {
                const key = getItemKey(meta);
                return key === 'htmlTemplate' || key === 'htmlCss';
              }),
          );
          const htmlRow = item.children.find(row =>
            row.some(meta => getItemKey(meta) === 'htmlTemplate'),
          );
          const cssRow = item.children.find(row =>
            row.some(meta => getItemKey(meta) === 'htmlCss'),
          );

          return (
            <>
              <ControlForm onChange={onChange} value={column.config}>
                {baseRows.map((row: ColumnConfigFormItem[], rowIndex: number) =>
                  renderRow(row, rowIndex),
                )}
              </ControlForm>
              <Tabs
                items={[
                  ...(htmlRow
                    ? [
                        {
                          key: 'html-markup',
                          label: t('HTML'),
                          children: (
                            <>
                              <ControlForm
                                onChange={onChange}
                                value={column.config}
                              >
                                {renderRow(htmlRow, 0)}
                              </ControlForm>
                              <HtmlTemplateHelpPanel
                                value={column.config as ColumnConfig}
                                onChange={onChange}
                              />
                            </>
                          ),
                        },
                      ]
                    : []),
                  ...(cssRow
                    ? [
                        {
                          key: 'html-css',
                          label: t('CSS'),
                          children: (
                            <ControlForm
                              onChange={onChange}
                              value={column.config}
                            >
                              {renderRow(cssRow, 1)}
                            </ControlForm>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </>
          );
        })(),
      }));

    return <Tabs items={tabItems} />;
  }
  return (
    <ControlForm onChange={onChange} value={column.config}>
      {(layout as ColumnConfigFormItem[][]).map(
        (row: ColumnConfigFormItem[], i: number) => renderRow(row, i),
      )}
    </ControlForm>
  );
}
