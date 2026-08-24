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
import { CSSProperties, useMemo } from 'react';
import { styled, useTheme } from '@superset-ui/core';
import { HandlebarsViewer } from './components/Handlebars/HandlebarsViewer';
import { HtmlCardsProps, HtmlCardsStylesProps } from './types';
import { scopeCss } from './utils/scopeCss';

const TABLE_INTERACTION_STYLES = `
.hc-resize-handle {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
  z-index: 1;
}

.hc-resize-handle:hover,
.hc-resize-handle:active {
  background: var(--html-cards-theme-color-primary);
  opacity: 0.4;
}

table[data-hc-sort] thead th:not([data-hc-sort="false"]) {
  cursor: pointer;
  user-select: none;
}

table[data-hc-sort] thead th[aria-sort="ascending"]::after {
  content: " \\25B2";
  font-size: 0.75em;
  color: var(--html-cards-theme-color-primary);
}

table[data-hc-sort] thead th[aria-sort="descending"]::after {
  content: " \\25BC";
  font-size: 0.75em;
  color: var(--html-cards-theme-color-primary);
}
`;

const Styles = styled.div<HtmlCardsStylesProps>`
  position: relative;
  z-index: 0;
  display: flex;
  padding: 0;
  border-radius: ${({ theme }) => theme.borderRadius}px;
  height: ${({ height }) => height}px;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  container-type: size;
  container-name: html-cards-chart;
  --html-cards-chart-width: ${({ width }) => width}px;
  --html-cards-chart-height: ${({ height }) => height}px;
  overflow: visible;
  isolation: isolate;

  &:hover {
    z-index: 2;
  }
`;

export default function HtmlCards(props: HtmlCardsProps) {
  const theme = useTheme();
  const {
    columns,
    data,
    displayRows,
    firstDisplayRow,
    formData,
    height,
    layout,
    width,
  } = props;
  const scopeId = useMemo(
    () => `html-cards-${Math.random().toString(36).slice(2, 10)}`,
    [],
  );
  const scopeSelector = `[data-html-cards-scope="${scopeId}"]`;
  const themeVars = {
    colorPrimary: theme.colorPrimary,
    colorPrimaryBg: theme.colorPrimaryBg,
    colorBgContainer: theme.colorBgContainer,
    colorBgElevated: theme.colorBgElevated,
    colorBorder: theme.colorBorder,
    colorText: theme.colorText,
    colorTextSecondary: theme.colorTextSecondary,
    colorSuccess: theme.colorSuccess,
    colorWarning: theme.colorWarning,
    colorError: theme.colorError,
    borderRadius: theme.borderRadius,
    fontFamily: theme.fontFamily,
    fontSize: theme.fontSize,
    fontSizeSM: theme.fontSizeSM,
  };
  const styleTemplate =
    formData.styleTemplate ?? formData.style_template ?? '';
  const handlebarsTemplate =
    formData.handlebarsTemplate ??
    formData.handlebars_template ??
    '{{data}}';
  const styleTemplateSource = useMemo(() => {
    const userStyles = styleTemplate ? scopeCss(styleTemplate, scopeSelector) : '';
    const interactionStyles = scopeCss(TABLE_INTERACTION_STYLES, scopeSelector);
    return `<style>${userStyles}${interactionStyles}</style>`;
  }, [styleTemplate, scopeSelector]);
  const templateSource = `${handlebarsTemplate}\n${styleTemplateSource} `;
  const templateData = {
    columns,
    data,
    displayRows,
    firstDisplayRow,
    rows: data,
    rowCount: data.length,
    width,
    height,
    firstRow: data[0] ?? null,
    layout,
    scopeId,
    scopeSelector,
    themeVars,
  };
  const themeCssVars = {
    '--html-cards-theme-color-primary': themeVars.colorPrimary,
    '--html-cards-theme-color-primary-bg': themeVars.colorPrimaryBg,
    '--html-cards-theme-color-bg-container': themeVars.colorBgContainer,
    '--html-cards-theme-color-bg-elevated': themeVars.colorBgElevated,
    '--html-cards-theme-color-border': themeVars.colorBorder,
    '--html-cards-theme-color-text': themeVars.colorText,
    '--html-cards-theme-color-text-secondary': themeVars.colorTextSecondary,
    '--html-cards-theme-color-success': themeVars.colorSuccess,
    '--html-cards-theme-color-warning': themeVars.colorWarning,
    '--html-cards-theme-color-error': themeVars.colorError,
    '--html-cards-theme-border-radius': `${themeVars.borderRadius}px`,
    '--html-cards-theme-font-family': themeVars.fontFamily,
    '--html-cards-theme-font-size': `${themeVars.fontSize}px`,
    '--html-cards-theme-font-size-sm': `${themeVars.fontSizeSM}px`,
  } as CSSProperties;

  return (
    <Styles
      className="html-cards-chart"
      data-html-cards-scope={scopeId}
      height={height}
      style={themeCssVars}
      width={width}
    >
      <HandlebarsViewer data={templateData} templateSource={templateSource} />
    </Styles>
  );
}
