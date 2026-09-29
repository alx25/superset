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
  ControlSetItem,
  CustomControlConfig,
  sharedControls,
} from '@superset-ui/chart-controls';
import { t, validateNonEmpty, useTheme } from '@superset-ui/core';
import { InfoTooltip, SafeMarkdown } from '@superset-ui/core/components';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
import { ControlHeader } from '../../components/ControlHeader/controlHeader';
import { debounceFunc } from '../../consts';

interface HandlebarsCustomControlProps {
  value: string;
}

const HandlebarsTemplateControl = (
  props: CustomControlConfig<HandlebarsCustomControlProps>,
) => {
  const theme = useTheme();

  const val = String(
    props?.value ? props?.value : props?.default ? props?.default : '',
  );

  const helperDescriptionsHeader = t(
    'Available Handlebars helpers and root values in Superset:',
  );

  const helperDescriptions = [
    { key: 'dateFormat', descKey: 'Formats a date using a specified format.' },
    { key: 'stringify', descKey: 'Converts an object to a JSON string.' },
    {
      key: 'formatNumber',
      descKey: 'Formats a number using locale-specific formatting.',
    },
    {
      key: 'numberFormatD3',
      descKey:
        'Formats numbers with Superset D3/native number formatters. Example: {{numberFormatD3 value "$,.2f"}}',
    },
    {
      key: 'timeFormatD3',
      descKey:
        'Formats temporal values with Superset time formatters. Example: {{timeFormatD3 created_at "%Y-%m"}}',
    },
    {
      key: 'coalesce',
      descKey:
        'Returns the first value that is not null, undefined or empty string.',
    },
    {
      key: 'pluck',
      descKey:
        'Extracts one property from every item in an array. Example: {{pluck rows "ventas"}}',
    },
    {
      key: 'sum',
      descKey:
        'Adds numbers or all values in an array. Example: {{sum 10 20}} or {{sum (pluck rows "ventas")}}',
    },
    {
      key: 'division',
      descKey:
        'Divides two numbers. No zero/null guard built in — wrap it: {{#if b}}{{division a b}}{{else}}...{{/if}}, since {{#if 0}} is falsy in Handlebars.',
    },
    {
      key: 'group',
      descKey:
        "Groups a list by a property. Example: {{#group displayRows by=(lookup (lookup @root.columns N) 'templateKey')}}{{value}} is the group key, {{#each items}}...{{/each}} are that group's rows{{/group}}. Use the templateKey from columns[], not the SQL name or displayName. Combine with pluck+sum+division to aggregate values per group (e.g. a nested table inside each card).",
    },
    {
      key: 'hasValue',
      descKey:
        'Checks whether a value exists, treating 0 as a valid value.',
    },
    {
      key: 'parseJson',
      descKey: 'Parses a JSON string into a JavaScript object.',
    },
    {
      key: 'rows',
      descKey: 'Array alias for the query result rows.',
    },
    {
      key: 'displayRows',
      descKey:
        'Array of rows keyed by template-safe aliases derived from Display name.',
    },
    {
      key: 'firstDisplayRow',
      descKey:
        'First aliased row. Useful when the query returns a single KPI record.',
    },
    {
      key: 'columns',
      descKey:
        'Column metadata with `key`, `displayName`, `templateKey` and metric flags.',
    },
    {
      key: 'rowCount',
      descKey: 'Total number of rows returned by the query.',
    },
    {
      key: 'width / height',
      descKey: 'Chart dimensions available at the template root.',
    },
    {
      key: 'layout',
      descKey:
        'Responsive flags such as `layout.isCompact`, `layout.isNarrow` and `layout.isTiny` based on chart size.',
    },
    {
      key: 'scopeId / scopeSelector',
      descKey:
        'Per-chart CSS scope identifiers. CSS entered in Card CSS is automatically prefixed to this chart instance.',
    },
    {
      key: 'themeVars',
      descKey:
        'Subset of Superset theme tokens also exposed as CSS variables on the chart container.',
    },
    {
      key: 'data-hc-sort / data-hc-resize',
      descKey:
        'Add to a <table> (with a <colgroup>/<col> per column for resize) to enable click-to-sort headers and drag-to-resize columns, no JS needed. Per-column opt-out: data-hc-sort="false" / data-hc-resize="false" on a <th>.',
    },
    {
      key: 'data-hc-on / data-hc-action / data-hc-target',
      descKey:
        'Declarative interactivity, no raw <script>/onClick=. data-hc-on="click" (also dblclick/mouseenter/mouseleave/change/submit/load) + data-hc-action="name:arg1,arg2" runs a built-in action on the element (or on data-hc-target="#id"/selector if given). Chain several with ";". "load" is special: fires immediately on render (and again on re-render), no interaction needed — use it for automatic animations. Actions: toggleClass/addClass/removeClass:names (space-separated), toggleAttr:name, scrollTo:smooth|auto, setStyleVar:varName,value, copyText (reads data-hc-copy-value or the text), countUp:toValue,durationMs,suffix (animates the element\'s own number text, from data-hc-count-from or its current text; suffix optional, e.g. "%"). Example: <button data-hc-on="click" data-hc-action="toggleClass:open" data-hc-target="#detail-{{id}}">Ver más</button>. Animate-on-load example: <strong data-hc-on="load" data-hc-action="countUp:{{pct}},1200,%" data-hc-count-from="0">0%</strong>. An unknown action name is ignored (console warning), never executed as code.',
    },
  ];

  const helpersTooltipContent = `
${helperDescriptionsHeader}

${helperDescriptions
  .map(({ key, descKey }) => `- **${key}**: ${t(descKey)}`)
  .join('\n')}
`;

  return (
    <div>
      <ControlHeader>
        <div>
          {props.label}
          <InfoTooltip
            iconStyle={{ marginLeft: theme.sizeUnit }}
            tooltip={<SafeMarkdown source={helpersTooltipContent} />}
          />
        </div>
      </ControlHeader>
      <CodeEditor
        theme="dark"
        value={val}
        modalTitle={String(props.label || t('Card template'))}
        onChange={source => {
          debounceFunc(props.onChange, source || '');
        }}
      />
    </div>
  );
};

export const handlebarsTemplateControlSetItem: ControlSetItem = {
  name: 'handlebarsTemplate',
  config: {
    ...sharedControls.entity,
    type: HandlebarsTemplateControl,
    label: t('Card template'),
    description: t(
      'Template used to render a grid of cards. Use CSS hover states to reveal extra information.',
    ),
    default: `<section class="kpi-mini-grid">
  {{#if rowCount}}
    {{#each displayRows}}
      <article class="kpi-mini">
        <header class="kpi-mini__header">
          <h3
            class="kpi-mini__title"
            title="{{coalesce titulo (lookup (lookup @root.columns 0) 'displayName') 'KPI card'}}"
          >
            {{coalesce titulo (lookup (lookup @root.columns 0) 'displayName') 'KPI card'}}
          </h3>
          <span
            class="kpi-mini__status {{#if estado_clase}}kpi-mini__status--{{estado_clase}}{{else}}{{#if (hasValue estado)}}kpi-mini__status--active{{else}}kpi-mini__status--muted{{/if}}{{/if}}"
            title="{{estado}}"
          ></span>
        </header>

        <div class="kpi-mini__main">
          <span class="kpi-mini__label">
            {{#if (hasValue valor_actual)}}
              ACTUAL
            {{else}}
              {{coalesce (lookup (lookup @root.columns 0) 'displayName') 'VALUE'}}
            {{/if}}
          </span>
          <strong class="kpi-mini__value">
            {{#if (hasValue valor_actual)}}
              {{formatNumber valor_actual}}
            {{else}}
              {{formatNumber (lookup this (lookup (lookup @root.columns 0) 'templateKey'))}}
            {{/if}}
          </strong>
        </div>

        <footer class="kpi-mini__footer">
          <div class="kpi-mini__meta">
            <span class="kpi-mini__target">
              {{#if (hasValue meta)}}
                Meta: <strong>{{formatNumber meta}}</strong>
              {{else}}
                {{#if (lookup @root.columns 1)}}
                  {{lookup (lookup @root.columns 1) 'displayName'}}:
                  <strong>{{formatNumber (lookup this (lookup (lookup @root.columns 1) 'templateKey'))}}</strong>
                {{/if}}
              {{/if}}
            </span>

            <span class="kpi-mini__variance {{#if variacion_negativa}}kpi-mini__variance--negative{{/if}}">
              {{#if (hasValue variacion_pct)}}
                {{variacion_pct}}%
              {{else}}
                {{lookup this (lookup (lookup @root.columns 2) 'templateKey')}}
              {{/if}}
            </span>
          </div>

          <div class="kpi-mini__progress">
            <div
              class="kpi-mini__progress-fill"
              style="width: {{coalesce avance_pct 0}}%;"
            ></div>
          </div>

          {{#if (hasValue subtitulo)}}
            <p class="kpi-mini__subtitle">{{subtitulo}}</p>
          {{/if}}
        </footer>
      </article>
    {{/each}}
  {{else}}
    <div class="kpi-mini__empty">
      <strong>No data available</strong>
      <p>Add dimensions or metrics to populate the cards.</p>
    </div>
  {{/if}}
</section>`,
    isInt: false,
    renderTrigger: true,
    valueKey: null,

    validators: [validateNonEmpty],
    mapStateToProps: ({ controls }) => ({
      value:
        controls?.handlebars_template?.value ??
        controls?.handlebarsTemplate?.value,
    }),
  },
};
