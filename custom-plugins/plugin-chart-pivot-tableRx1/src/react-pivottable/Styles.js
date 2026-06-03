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

import { css, styled } from '@superset-ui/core';

export const Styles = styled.div`
  ${({ theme, isDashboardEditMode, stickyHeaders, tableTheme }) => {
    const headerBg = tableTheme?.headerBg || theme.colorBgBase;
    const headerText = tableTheme?.headerText || theme.colorText;
    const rowHeaderBg = tableTheme?.rowHeaderBg || theme.colorBgBase;
    const rowHeaderText = tableTheme?.rowHeaderText || theme.colorText;
    const totalBg = tableTheme?.totalBg || theme.colorBgBase;
    const totalText = tableTheme?.totalText || theme.colorText;
    const subtotalBg = tableTheme?.subtotalBg;
    const subtotalText = tableTheme?.subtotalText;
    const cellBg = tableTheme?.cellBg || theme.colorBgBase;
    const cellText = tableTheme?.cellText || theme.colorPrimaryText;
    const borderColor = tableTheme?.borderColor || theme.colorSplit;

    return css`
    table.pvtTable {
      position: ${isDashboardEditMode ? 'inherit' : 'relative'};
      width: calc(100% - ${theme.sizeUnit}px);
      font-size: ${theme.fontSizeSM}px;
      text-align: left;
      margin: ${theme.sizeUnit}px;
      border-collapse: separate;
      border-spacing: 0;
      font-family: ${theme.fontFamily};
      line-height: 1.4;
    }

    .pvtToolbar {
      align-items: center;
      display: flex;
      gap: ${theme.sizeUnit}px;
      margin: ${theme.sizeUnit}px;
    }

    .pvtToolbarButton {
      background: ${theme.colorBgContainer};
      border: 1px solid ${borderColor};
      border-radius: ${theme.borderRadiusSM}px;
      color: ${theme.colorText};
      cursor: pointer;
      font-family: ${theme.fontFamily};
      font-size: ${theme.fontSize}px;
      font-weight: ${theme.fontWeightStrong};
      height: ${theme.sizeUnit * 6}px;
      line-height: 1.4;
      padding: 0;
      width: ${theme.sizeUnit * 6}px;
    }

    .pvtToolbarButton:hover {
      background: ${theme.colorPrimaryBgHover};
      border-color: ${theme.colorPrimaryBorderHover};
    }

    table thead {
      background-color: ${headerBg};
      color: ${headerText};
      position: ${isDashboardEditMode ? 'inherit' : 'sticky'};
      top: 0;
      z-index: 4;
    }

    table tbody tr {
      font-feature-settings: 'tnum' 1;
    }

    table.pvtTable thead tr th,
    table.pvtTable tbody tr th {
      border-top: 1px solid ${borderColor};
      border-left: 1px solid ${borderColor};
      font-size: ${theme.fontSizeSM}px;
      padding: ${theme.sizeUnit}px;
      font-weight: ${theme.fontWeightNormal};
    }

    table.pvtTable thead tr th {
      background-color: ${headerBg};
      color: ${headerText};
    }

    table.pvtTable tbody tr th.pvtRowLabel {
      background-color: ${rowHeaderBg};
      color: ${rowHeaderText};
    }

    ${
      !isDashboardEditMode && stickyHeaders
        ? `
    table.pvtTable tbody tr th.pvtStickyRowLabel,
    table.pvtTable tbody tr.pvtRowTotals th.pvtRowTotalLabel {
      left: ${theme.sizeUnit}px;
      position: sticky;
      z-index: 3;
    }

    table.pvtTable thead th.pvtStickyCorner {
      background-color: ${headerBg};
      left: ${theme.sizeUnit}px;
      position: sticky;
      z-index: 6;
    }

    table.pvtTable thead th.pvtStickyColAxisLabel {
      background-color: ${headerBg};
      left: ${theme.sizeUnit}px;
      position: sticky;
      z-index: 7;
    }

    table.pvtTable thead th.pvtStickyRowAxisLabel {
      background-color: ${headerBg};
      left: ${theme.sizeUnit}px;
      position: sticky;
      z-index: 7;
    }
    `
        : ''
    }

    table.pvtTable tbody tr.pvtRowTotals {
      position: ${isDashboardEditMode ? 'inherit' : 'sticky'};
      bottom: 0;
      background-color: ${totalBg};
    }

    table.pvtTable tbody tr.pvtRowTotals th,
    table.pvtTable tbody tr.pvtRowTotals td {
      background-color: ${totalBg};
      color: ${totalText};
    }

    table.pvtTable thead tr:last-of-type th,
    table.pvtTable thead tr:first-of-type th.pvtTotalLabel,
    table.pvtTable thead tr:nth-last-of-type(2) th.pvtColLabel,
    table.pvtTable thead th.pvtSubtotalLabel,
    table.pvtTable tbody tr:last-of-type th,
    table.pvtTable tbody tr:last-of-type td {
      border-bottom: 1px solid ${borderColor};
    }

    table.pvtTable
      thead
      tr:last-of-type:not(:only-child)
      th.pvtAxisLabel
      ~ th.pvtColLabel,
    table.pvtTable tbody tr:first-of-type th,
    table.pvtTable tbody tr:first-of-type td {
      border-top: none;
    }

    table.pvtTable tbody tr td:last-of-type,
    table.pvtTable thead tr th:last-of-type:not(.pvtSubtotalLabel) {
      border-right: 1px solid ${borderColor};
    }

    table.pvtTable
      thead
      tr:last-of-type:not(:only-child)
      th.pvtAxisLabel
      + .pvtTotalLabel {
      border-right: none;
    }

    table.pvtTable tr th.active {
      background-color: ${theme.colorPrimaryBg};
    }

    table.pvtTable .pvtTotalLabel {
      text-align: right;
      font-weight: ${theme.fontWeightStrong};
      background-color: ${totalBg};
      color: ${totalText};
    }

    table.pvtTable .pvtSubtotalLabel {
      font-weight: ${theme.fontWeightStrong};
    }

    ${
      subtotalBg
        ? `
    table.pvtTable .pvtSubtotalLabel,
    table.pvtTable tbody tr td.pvtSubtotal {
      background-color: ${subtotalBg};
    }
    `
        : ''
    }

    ${
      subtotalText
        ? `
    table.pvtTable .pvtSubtotalLabel,
    table.pvtTable tbody tr td.pvtSubtotal {
      color: ${subtotalText};
    }
    `
        : ''
    }

    table.pvtTable tbody tr td {
      color: ${cellText};
      padding: ${theme.sizeUnit}px;
      background-color: ${cellBg};
      border-top: 1px solid ${borderColor};
      border-left: 1px solid ${borderColor};
      vertical-align: top;
      text-align: right;
    }

    table.pvtTable tbody tr th.pvtRowLabel {
      vertical-align: baseline;
    }

    table.pvtTable tbody tr:not(.pvtRowTotals):hover th,
    table.pvtTable tbody tr:not(.pvtRowTotals):hover td {
      background-color: ${theme.colorPrimaryBgHover} !important;
    }

    .pvtTotal,
    .pvtGrandTotal {
      font-weight: ${theme.fontWeightStrong};
    }

    table.pvtTable tbody tr td.pvtRowTotal {
      vertical-align: middle;
    }

    .toggle-wrapper {
      white-space: nowrap;
    }

    .toggle-wrapper > .toggle-val {
      white-space: normal;
    }

    .toggle {
      padding-right: ${theme.sizeUnit}px;
      cursor: pointer;
    }

    .hoverable:hover {
      background-color: ${theme.colorPrimaryBgHover};
      cursor: pointer;
    }
  `;
  }}
`;
