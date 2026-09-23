import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import { copyText } from './clipboard';
import { Icon } from './icons';
import { buttonGhost, buttonIcon, FONT, MONO, readableOn } from './ui';

export interface PanelHeaderProps {
  sessionId?: string;
  onNewSession: () => void;
}

/** Header compacto del panel: una sola línea (título + sesión + "Limpiar"). */
export function PanelHeader({ sessionId, onNewSession }: PanelHeaderProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const [copyState, setCopyState] = React.useState<'idle' | 'copied' | 'failed'>('idle');
  const copySessionId = (id: string) => {
    void copyText(id).then(ok => {
      setCopyState(ok ? 'copied' : 'failed');
      window.setTimeout(() => setCopyState('idle'), ok ? 1500 : 2500);
    });
  };
  const copyLabel = copyState === 'copied' ? 'Id de sesión copiado' : copyState === 'failed' ? 'No se pudo copiar' : 'Copiar id de sesión';
  return (
    <div
      style={{
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        borderBottom: `1px solid ${theme.colorBorderSecondary}`,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: theme.borderRadiusSM,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: theme.colorPrimary,
          color: readableOn(theme.colorPrimary),
        }}
      >
        <Icon name="sparkles" size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: FONT.title, fontWeight: 600, lineHeight: 1.3 }}>Asistente SQL</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: FONT.small,
            color: theme.colorTextSecondary,
            lineHeight: 1.3,
            minWidth: 0,
          }}
        >
          {sessionId ? (
            <>
              <span
                title={`Sesión: ${sessionId} — usar con /api/logs/sessions/<id>`}
                style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}
              >
                {sessionId}
              </span>
              <button
                type="button"
                aria-label={copyLabel}
                title={copyLabel}
                onClick={() => copySessionId(sessionId)}
                style={{
                  ...buttonIcon(theme),
                  padding: 1,
                  color: copyState === 'copied' ? theme.colorSuccess ?? theme.colorPrimary : copyState === 'failed' ? theme.colorError : theme.colorTextSecondary,
                }}
              >
                <Icon name={copyState === 'copied' ? 'check' : copyState === 'failed' ? 'close' : 'copy'} size={11} />
              </button>
              {copyState !== 'idle' && (
                <span role="status" style={{ whiteSpace: 'nowrap' }}>
                  {copyState === 'copied' ? 'Copiado' : 'No se pudo copiar'}
                </span>
              )}
            </>
          ) : (
            <span>Pestaña activa · con confirmación</span>
          )}
        </span>
      </div>
      <button
        type="button"
        style={buttonGhost(theme)}
        onClick={onNewSession}
        aria-label="Nueva sesión"
        title="Vacía esta conversación y sus propuestas. No modifica el SQL ya aplicado en el editor."
      >
        <Icon name="reset" size={12} />
        Limpiar
      </button>
    </div>
  );
}
