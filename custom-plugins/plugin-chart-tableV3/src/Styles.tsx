/*
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

export default styled.div`
  ${({ theme }) => css`
    /* Base table styles */
    table {
      width: 100%;
      min-width: auto;
      max-width: none;
      margin: 0;
      border-collapse: collapse;
    }

    /* Cell styling */
    th,
    td {
      min-width: 4.3em;
      padding: 0.75rem;
      vertical-align: top;
    }

    /* Header styling */
    thead > tr > th {
      padding-right: 0;
      position: relative;
      background-color: ${theme.colorBgBase};
      text-align: left;
      border-bottom: 2px solid ${theme.colorSplit};
      color: ${theme.colorText};
      vertical-align: bottom;
    }

    /* Icons in header */
    th svg {
      margin: 1px ${theme.sizeUnit / 2}px;
      fill-opacity: 0.2;
    }

    th.is-sorted svg {
      color: ${theme.colorText};
      fill-opacity: 1;
    }

    /* Table body styling */
    .table > tbody > tr:first-of-type > td,
    .table > tbody > tr:first-of-type > th {
      border-top: 0;
    }

    .table > tbody tr td {
      font-feature-settings: 'tnum' 1;
      border-top: 1px solid ${theme.colorSplit};
    }

    /* Bootstrap-like condensed table styles */
    table.table-condensed,
    table.table-sm {
      font-size: ${theme.fontSizeSM}px;
    }

    table.table-condensed th,
    table.table-condensed td,
    table.table-sm th,
    table.table-sm td {
      padding: 0.3rem;
    }

    table.table-bordered {
      border: 1px solid ${theme.colorSplit};
    }

    table.table-bordered th,
    table.table-bordered td {
      border: 1px solid ${theme.colorSplit};
    }

    table.table-striped tbody tr:nth-of-type(odd) {
      background-color: ${theme.colorBgLayout};
    }

    /* Controls and metrics */
    .dt-controls {
      padding-bottom: ${theme.paddingSM}px;
    }

    .dt-topn-row {
      margin-top: ${theme.marginXS}px;
    }

    .dt-controls > .row:first-child {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
    }

    .dt-controls > .row:first-child > [class*='col-sm-'] {
      display: flex;
      align-items: center;
      min-height: ${theme.controlHeightSM}px;
      width: auto;
      max-width: none;
      flex: 0 0 auto;
    }

    .dt-controls > .row:first-child > .col-sm-6:last-child,
    .dt-controls > .row:first-child > .col-sm-5:last-child {
      margin-left: auto;
      justify-content: flex-end;
    }

    .dt-topn-row {
      margin-top: ${theme.marginXXS}px;
    }

    .dt-topn-row .col-sm-12 {
      display: flex;
      align-items: center;
      gap: ${theme.marginSM}px;
      padding: ${theme.paddingXS}px ${theme.paddingSM}px;
      border: 1px solid ${theme.colorSplit};
      border-radius: ${theme.borderRadius}px;
      background: ${theme.colorBgElevated};
      box-shadow: 0 2px 8px ${theme.colorFillSecondary};
    }

    .dt-topn-row label {
      margin: 0;
      color: ${theme.colorText};
      font-weight: ${theme.fontWeightStrong};
    }

    .dt-topn-row input,
    .dt-topn-row select {
      height: ${theme.controlHeightSM}px;
      padding: 0 ${theme.paddingSM}px;
      border: 1px solid ${theme.colorBorder};
      border-radius: ${theme.borderRadius}px;
      background: ${theme.colorBgBase};
      color: ${theme.colorText};
      font-size: ${theme.fontSizeSM}px;
    }

    /* Top N Control específico */
    .dt-topn-control {
      display: flex;
      align-items: center;
      gap: ${theme.marginXS}px;
    }

    .dt-topn-control label {
      margin: 0;
      color: ${theme.colorText};
      font-size: ${theme.fontSizeSM}px;
      font-weight: ${theme.fontWeightNormal};
      white-space: nowrap;
    }

    .dt-topn-control input {
      width: 80px;
      height: ${theme.controlHeightSM}px;
      padding: 0 ${theme.paddingXS}px;
      border: 1px solid ${theme.colorBorder};
      border-radius: ${theme.borderRadius}px;
      background: ${theme.colorBgContainer};
      color: ${theme.colorText};
      font-size: ${theme.fontSizeSM}px;
      text-align: center;
      transition: all 0.2s ease;
    }

    .dt-topn-control input:hover {
      border-color: ${theme.colorPrimaryBorder};
    }

    .dt-topn-control input:focus {
      outline: none;
      border-color: ${theme.colorPrimary};
    }

    .dt-topn-hint {
      color: ${theme.colorTextSecondary};
      font-size: ${theme.fontSizeSM}px;
      font-style: italic;
      white-space: nowrap;
    }

    /* Select Page Size */
    .dt-select-page-size {
      padding: 0;
    }

    .dt-metric {
      text-align: right;
    }

    .dt-totals {
      font-weight: ${theme.fontWeightStrong};
    }

    tfoot th,
    tfoot td {
      font-weight: ${theme.fontWeightStrong};
    }

    tbody tr.dt-others-row {
      background: ${theme.colorWarningBg || theme.colorFillSecondary};
      box-shadow: inset 3px 0 0
        ${theme.colorWarning || theme.colorTextSecondary};
    }

    tbody tr.dt-others-row td,
    tbody tr.dt-others-row th {
      background: ${theme.colorWarningBg ||
      theme.colorFillSecondary} !important;
    }

    tbody tr.dt-others-row:hover {
      background: ${theme.colorWarningBgHover || theme.colorFillSecondary};
    }

    /* ── Feature 6: Row grouping ─────────────────────────── */
    tbody tr.dt-group-header-row {
      background: ${theme.colorFillQuaternary};
      border-top: 2px solid ${theme.colorBorderSecondary};
    }

    tbody tr.dt-group-header-row:first-of-type {
      border-top: none;
    }

    tbody tr.dt-group-header-row > td,
    tbody tr.dt-group-header-row > th {
      padding-top: ${theme.paddingSM}px;
      padding-bottom: ${theme.paddingSM}px;
      background: ${theme.colorFillQuaternary} !important;
      border-top: 1px solid ${theme.colorBorderSecondary};
      border-bottom: 1px solid ${theme.colorBorderSecondary};
    }

    tbody tr.dt-group-header-row > td:first-of-type,
    tbody tr.dt-group-header-row > th:first-of-type {
      box-shadow: inset 4px 0 0 ${theme.colorPrimary};
    }

    tbody tr.dt-group-header-row > td.dt-sticky-col,
    tbody tr.dt-group-header-row > th.dt-sticky-col {
      background: ${theme.colorFillQuaternary} !important;
      background-clip: padding-box;
    }

    .dt-group-header-main {
      display: inline-flex;
      align-items: center;
      gap: ${theme.marginXS}px;
      min-width: 0;
      flex: 0 1 auto;
      font-weight: ${theme.fontWeightStrong};
      color: ${theme.colorText};
      overflow: hidden;
    }

    .dt-group-header-main svg {
      font-size: ${theme.fontSizeSM}px;
      color: ${theme.colorTextSecondary};
      flex: 0 0 auto;
    }

    .dt-group-header-title {
      flex: 1 1 auto;
      min-width: 0;
      display: inline-block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dt-group-row-main {
      display: flex;
      align-items: center;
      width: 100%;
      cursor: pointer;
      user-select: none;
    }

    tbody tr.dt-group-header-row > td.dt-group-header-main-cell {
      min-width: 0;
    }

    tbody tr.dt-group-header-row > td.dt-group-header-summary-cell {
      font-feature-settings: 'tnum' 1;
      color: ${theme.colorText};
      overflow: hidden;
    }

    tbody tr.dt-group-header-row > td.dt-group-header-empty-cell {
      color: transparent;
    }

    .dt-group-row-summary-value {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      width: 100%;
      min-width: 0;
      white-space: nowrap;
      color: ${theme.colorText};
      font-weight: ${theme.fontWeightNormal};
      font-size: ${theme.fontSize}px;
      letter-spacing: 0.02em;
      padding-bottom: ${theme.sizeUnit / 2}px;
      border-bottom: 3px solid ${theme.colorPrimary};
      box-shadow: inset 0 -1px 0 ${theme.colorPrimaryBorder};
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .dt-group-row-summary-html {
      display: block;
      width: 100%;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: inherit;
      letter-spacing: inherit;
    }

    .dt-group-row-summary-html > * {
      max-width: 100%;
      margin: 0;
      font-size: inherit !important;
      letter-spacing: inherit !important;
    }

    .dt-group-row-summary-html * {
      font-size: inherit !important;
      letter-spacing: inherit !important;
    }

    .dt-group-badge {
      display: inline-flex;
      align-items: center;
      padding: 0 ${theme.paddingXS}px;
      min-height: ${theme.controlHeightSM}px;
      border-radius: ${theme.borderRadiusSM}px;
      border: 1px solid ${theme.colorBorderSecondary};
      background: ${theme.colorBgElevated};
      color: ${theme.colorTextSecondary};
      font-size: ${theme.fontSizeSM}px;
      white-space: nowrap;
    }

    .dt-group-badge-subtle {
      background: ${theme.colorPrimaryBg};
      border-color: ${theme.colorPrimaryBorder};
      color: ${theme.colorPrimary};
      font-weight: ${theme.fontWeightStrong};
    }

    .dt-grouping-header-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: ${theme.controlHeightSM}px;
      height: ${theme.controlHeightSM}px;
      padding: 0;
      border: 1px solid ${theme.colorPrimaryBorder};
      border-radius: ${theme.borderRadiusSM}px;
      background: ${theme.colorPrimaryBg};
      color: ${theme.colorPrimary};
      cursor: pointer;
      transition:
        background 0.2s ease,
        color 0.2s ease,
        border-color 0.2s ease,
        box-shadow 0.2s ease;
      box-shadow: inset 0 0 0 1px ${theme.colorPrimaryBorder};
    }

    .dt-grouping-header-toggle:hover,
    .dt-grouping-header-toggle:focus-visible {
      background: ${theme.colorPrimaryBorder};
      border-color: ${theme.colorPrimary};
      color: ${theme.colorPrimaryText || theme.colorText};
      box-shadow: 0 0 0 2px ${theme.colorPrimaryBg};
      outline: none;
    }

    .dt-grouping-header-toggle svg {
      margin: 0;
    }

    .dt-group-placeholder-cell {
      width: 1%;
      min-width: ${theme.sizeUnit * 6}px;
      padding-left: ${theme.paddingXS}px;
      padding-right: ${theme.paddingXS}px;
    }

    tbody tr.dt-grouped-row td.dt-grouping-key-cell {
      position: relative;
      padding-left: calc(${theme.paddingSM}px + ${theme.sizeUnit * 5}px);
    }

    tbody tr.dt-grouped-row td.dt-grouping-key-cell::before {
      content: '';
      position: absolute;
      left: ${theme.paddingSM}px;
      top: 50%;
      width: ${theme.sizeUnit * 3}px;
      border-top: 1px solid ${theme.colorBorderSecondary};
      transform: translateY(-50%);
      opacity: 0.9;
    }

    /* ── Feature 10: Top N improved control ─────────────── */
    .dt-topn-control {
      display: inline-flex;
      align-items: center;
      gap: ${theme.marginXS}px;
    }

    .dt-grouping-control {
      display: inline-flex;
      align-items: center;
      gap: ${theme.marginXS}px;
    }

    .dt-secondary-controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: ${theme.marginSM}px;
    }

    .dt-topn-label {
      color: ${theme.colorText};
      font-size: ${theme.fontSizeSM}px;
      white-space: nowrap;
    }

    .dt-is-null {
      color: ${theme.colorTextTertiary};
    }

    td.dt-is-filter {
      cursor: pointer;
    }

    td.dt-is-filter:hover {
      background-color: ${theme.colorPrimaryBgHover};
    }

    td.dt-is-active-filter,
    td.dt-is-active-filter:hover {
      background-color: ${theme.colorPrimaryBgHover};
    }

    .dt-global-filter {
      float: none;
      display: inline-flex;
      align-items: center;
      gap: ${theme.marginXXS}px;
      margin: 0;
      white-space: nowrap;
    }

    /* Cell truncation */
    .dt-truncate-cell {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dt-truncate-cell:hover {
      overflow: visible;
      white-space: normal;
      height: auto;
    }

    /* Pagination styling */
    .dt-pagination {
      text-align: right;
      /* use padding instead of margin so clientHeight can capture it */
      padding: ${theme.paddingXXS}px 0px;
    }

    .dt-pagination .pagination > li {
      display: inline;
      margin: 0 ${theme.marginXXS}px;
    }

    .dt-pagination .pagination > li > a,
    .dt-pagination .pagination > li > span {
      background-color: ${theme.colorBgBase};
      color: ${theme.colorText};
      border-color: ${theme.colorBorderSecondary};
      padding: ${theme.paddingXXS}px ${theme.paddingXS}px;
      border-radius: ${theme.borderRadius}px;
    }

    .dt-pagination .pagination > li.active > a,
    .dt-pagination .pagination > li.active > span,
    .dt-pagination .pagination > li.active > a:focus,
    .dt-pagination .pagination > li.active > a:hover,
    .dt-pagination .pagination > li.active > span:focus,
    .dt-pagination .pagination > li.active > span:hover {
      background-color: ${theme.colorPrimary};
      color: ${theme.colorBgContainer};
      border-color: ${theme.colorBorderSecondary};
    }

    .pagination > li > span.dt-pagination-ellipsis:focus,
    .pagination > li > span.dt-pagination-ellipsis:hover {
      background: ${theme.colorBgLayout};
      border-color: ${theme.colorBorderSecondary};
    }

    .dt-no-results {
      text-align: center;
      padding: 1em 0.6em;
    }

    .dt-sticky-col {
      box-shadow: 2px 0 0 ${theme.colorSplit};
    }

    tbody .dt-sticky-col,
    tfoot .dt-sticky-col {
      background: ${theme.colorBgContainer};
    }

    table.table-striped tbody tr:nth-of-type(odd) .dt-sticky-col {
      background-color: ${theme.colorBgLayout};
    }

    tbody > tr:hover .dt-sticky-col {
      background: ${theme.colorFillSecondary};
    }

    .right-border-only {
      border-right: 2px solid ${theme.colorSplit};
    }

    table .right-border-only:last-child {
      border-right: none;
    }
  `}
`;
