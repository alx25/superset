import React, { useState } from 'react';
import { components, theme as themeNs } from '@apache-superset/core';
import type { AssistantDiagnostic } from '../contracts/assistant';

const SEVERITY_TO_ALERT_TYPE: Record<AssistantDiagnostic['severity'], 'error' | 'warning' | 'info'> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const SEVERITY_ICON: Record<AssistantDiagnostic['severity'], string> = {
  error: '🔴',
  warning: '🟡',
  info: '🔵',
};

export interface DiagnosticsProps {
  diagnostics: AssistantDiagnostic[];
}

export function Diagnostics({ diagnostics }: DiagnosticsProps): React.ReactElement | null {
  const theme = themeNs.useTheme();
  const [expanded, setExpanded] = useState(false);

  if (diagnostics.length === 0) {
    return null;
  }

  const hasError = diagnostics.some(d => d.severity === 'error');
  const counts = diagnostics.reduce(
    (acc, d) => ({ ...acc, [d.severity]: (acc[d.severity] ?? 0) + 1 }),
    {} as Partial<Record<AssistantDiagnostic['severity'], number>>,
  );
  const summary = (['error', 'warning', 'info'] as const)
    .filter(severity => counts[severity])
    .map(severity => `${SEVERITY_ICON[severity]} ${counts[severity]}`)
    .join('  ');

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        style={{
          fontSize: 11,
          background: theme.colorBgContainer,
          border: `1px solid ${hasError ? theme.colorErrorBorder : theme.colorBorder}`,
          borderRadius: theme.borderRadiusSM,
          padding: '3px 8px',
          cursor: 'pointer',
          color: hasError ? theme.colorError : theme.colorTextSecondary,
        }}
      >
        {expanded ? '▾' : '▸'} {summary} {diagnostics.length === 1 ? 'aviso' : 'avisos'}
      </button>
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          {diagnostics.map((diagnostic, index) => (
            <components.Alert
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              type={SEVERITY_TO_ALERT_TYPE[diagnostic.severity]}
              showIcon
              message={
                diagnostic.column !== undefined
                  ? `L${diagnostic.line + 1}:C${diagnostic.column + 1} — ${diagnostic.message}`
                  : `L${diagnostic.line + 1} — ${diagnostic.message}`
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
