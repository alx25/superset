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
import { t, useTheme } from '@superset-ui/core';
import { InfoTooltip } from '@superset-ui/core/components';
import { CodeEditor } from '../../components/CodeEditor/CodeEditor';
import { ControlHeader } from '../../components/ControlHeader/controlHeader';
import { debounceFunc } from '../../consts';

interface StyleCustomControlProps {
  value: string;
}

export const DEFAULT_STYLE_TEMPLATE = `.kpi-mini-grid {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  grid-auto-rows: 1fr;
  align-items: stretch;
  align-content: start;
  overflow: visible;
}

.kpi-mini,
.kpi-mini * {
  box-sizing: border-box;
}

.kpi-mini {
  --mini-primary: #0f8db3;
  --mini-surface: #ffffff;
  --mini-text-main: #1e293b;
  --mini-text-muted: #64748b;
  --mini-border: rgba(226, 232, 240, 0.8);
  --mini-danger-bg: #fff1f2;
  --mini-danger-text: #e11d48;
  display: flex;
  position: relative;
  z-index: 0;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 18px;
  border-radius: 18px;
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid var(--mini-border);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
  overflow: visible;
  isolation: isolate;
}

.kpi-mini:hover {
  z-index: 2;
  transform: translateY(-3px);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  border-color: rgba(15, 141, 179, 0.3);
}

.kpi-mini__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.kpi-mini__title {
  margin: 0;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--mini-text-main);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-mini__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 4px;
  background-color: #cbd5e1;
}

.kpi-mini__status--active {
  background-color: var(--mini-primary);
  box-shadow: 0 0 6px rgba(15, 141, 179, 0.4);
}

.kpi-mini__status--warning {
  background-color: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.4);
}

.kpi-mini__status--danger {
  background-color: #e11d48;
  box-shadow: 0 0 6px rgba(225, 29, 72, 0.4);
}

.kpi-mini__status--muted {
  background-color: #cbd5e1;
}

.kpi-mini__main {
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin: auto 0;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
}

.kpi-mini__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--mini-text-muted);
  margin-bottom: 4px;
}

.kpi-mini__value {
  font-size: clamp(12px, 11cqi, 32px);
  font-weight: 800;
  color: var(--mini-primary);
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-mini__footer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.kpi-mini__meta {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}

.kpi-mini__target {
  min-width: 0;
  font-size: 11px;
  color: var(--mini-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-mini__target strong {
  color: var(--mini-text-main);
  font-weight: 600;
}

.kpi-mini__variance {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 6px;
  border-radius: 6px;
  background-color: #f1f5f9;
  color: var(--mini-text-muted);
  white-space: nowrap;
}

.kpi-mini__variance--negative {
  background-color: var(--mini-danger-bg);
  color: var(--mini-danger-text);
}

.kpi-mini__progress {
  height: 4px;
  border-radius: 4px;
  background: #e2e8f0;
  overflow: hidden;
  width: 100%;
}

.kpi-mini__progress-fill {
  height: 100%;
  max-width: 100%;
  border-radius: 4px;
  background: var(--mini-primary);
  animation: miniProgress 1s ease-out forwards;
  transform-origin: left;
}

.kpi-mini__subtitle {
  margin: 0;
  font-size: 11px;
  line-height: 1.35;
  color: var(--mini-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kpi-mini__empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 18px;
  border-radius: 18px;
  border: 1px dashed rgba(148, 163, 184, 0.48);
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  color: var(--mini-text-main, #1e293b);
}

.kpi-mini__empty strong,
.kpi-mini__empty p {
  margin: 0;
}

.kpi-mini__empty p {
  color: #64748b;
}

@keyframes miniProgress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@container html-cards-chart (max-width: 720px) {
  .kpi-mini-grid {
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr));
  }

  .kpi-mini {
    padding: 14px;
  }
}

@container html-cards-chart (max-height: 420px) {
  .kpi-mini-grid {
    gap: 10px;
  }

  .kpi-mini {
    padding: 12px;
  }

  .kpi-mini__title {
    font-size: 13px;
  }

  .kpi-mini__value {
    font-size: clamp(12px, 10cqi, 24px);
  }

  .kpi-mini__footer {
    gap: 8px;
  }

  .kpi-mini__subtitle {
    display: none;
  }
}

@container html-cards-chart (max-height: 300px) {
  .kpi-mini-grid {
    gap: 8px;
  }

  .kpi-mini {
    padding: 10px;
  }

  .kpi-mini__status {
    margin-top: 3px;
  }

  .kpi-mini__label {
    margin-bottom: 2px;
  }

  .kpi-mini__meta {
    gap: 6px;
  }

  .kpi-mini__target,
  .kpi-mini__variance {
    font-size: 10px;
  }
}

@container html-cards-chart (max-width: 420px) {
  .kpi-mini-grid {
    grid-template-columns: 1fr;
  }
}`;

const StyleControl = (props: CustomControlConfig<StyleCustomControlProps>) => {
  const theme = useTheme();

  const defaultValue = props?.value ? undefined : DEFAULT_STYLE_TEMPLATE;

  return (
    <div>
      <ControlHeader>
        <div>
          {props.label}
          <InfoTooltip
            iconStyle={{ marginLeft: theme.sizeUnit }}
            tooltip={t('You need to configure HTML sanitization to use CSS')}
          />
        </div>
      </ControlHeader>
      <CodeEditor
        theme="dark"
        mode="css"
        value={props.value}
        modalTitle={String(props.label || t('Card CSS'))}
        defaultValue={defaultValue}
        onChange={source => {
          debounceFunc(props.onChange, source || '');
        }}
      />
    </div>
  );
};

export const styleControlSetItem: ControlSetItem = {
  name: 'styleTemplate',
  config: {
    ...sharedControls.entity,
    type: StyleControl,
    label: t('Card CSS'),
    description: t(
      'CSS applied to the cards. Use :hover states for tooltip-like overlays or data swaps.',
    ),
    default: DEFAULT_STYLE_TEMPLATE,
    isInt: false,
    renderTrigger: true,
    valueKey: null,

    validators: [],
    mapStateToProps: ({ controls }) => ({
      value: controls?.style_template?.value ?? controls?.styleTemplate?.value,
    }),
  },
};
