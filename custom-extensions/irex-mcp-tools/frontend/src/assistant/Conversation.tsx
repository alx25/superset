import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { AssistantMode } from '../contracts/assistant';
import { ChatMarkdown } from './ChatMarkdown';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

const ROLE_AVATAR: Record<ConversationMessage['role'], string> = {
  user: 'Tú',
  assistant: 'IA',
};

type PanelTheme = ReturnType<typeof themeNs.useTheme>;

function avatarStyle(theme: PanelTheme, role: ConversationMessage['role']): React.CSSProperties {
  return {
    flexShrink: 0,
    minWidth: 26,
    height: 26,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 700,
    background: role === 'user' ? theme.colorFillSecondary : theme.colorPrimaryBg,
    color: role === 'user' ? theme.colorTextSecondary : theme.colorPrimary,
  };
}

function bubbleStyle(theme: PanelTheme, role: ConversationMessage['role']): React.CSSProperties {
  return {
    background: role === 'user' ? theme.colorFillTertiary : theme.colorBgContainer,
    border: role === 'assistant' ? `1px solid ${theme.colorBorderSecondary}` : 'none',
    color: theme.colorText,
    borderRadius: theme.borderRadius,
    borderTopRightRadius: role === 'user' ? 2 : theme.borderRadius,
    borderTopLeftRadius: role === 'assistant' ? 2 : theme.borderRadius,
    padding: '10px 13px',
    maxWidth: '85%',
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
  };
}

/** "24s" o "1m 32s" — segundos crudos son ilegibles pasado el minuto, y las
 * consultas reales que motivan este temporizador ya llegaron a ~90-112s. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

/**
 * Tarjeta que reemplaza el "Pensando…" plano mientras el pedido está en
 * vuelo. Cada evento `status`/`activity` que llega por SSE (ver
 * `chatBackendAdapter`) se acumula como un paso más en vez de pisar al
 * anterior — así el usuario ve el historial de lo que ya pasó ("Analizando
 * la solicitud." ✓, "Consultando a Irex Superset." ✓, …) y no solo la
 * última línea, igual que el widget de chat del dashboard. El último paso
 * de la lista es el único que todavía no tiene tilde: es el que sigue en
 * curso. Si todavía no llegó ningún evento (backend sin soporte SSE, o
 * antes del primero) cae al "Pensando…" genérico animado de siempre.
 */
function WorkingIndicator({ steps, elapsedSeconds }: { steps: string[]; elapsedSeconds?: number }): React.ReactElement {
  const theme = themeNs.useTheme();
  const [expanded, setExpanded] = React.useState(true);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 420);
    return () => window.clearInterval(id);
  }, []);
  const dots = '.'.repeat((tick % 3) + 1);
  const displaySteps = steps.length > 0 ? steps : [`Pensando${dots}`];
  const stepsRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = stepsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displaySteps.length]);
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <div style={avatarStyle(theme, 'assistant')}>{ROLE_AVATAR.assistant}</div>
      <div
        style={{
          ...bubbleStyle(theme, 'assistant'),
          whiteSpace: 'normal',
          minWidth: 220,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(e => !e)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') setExpanded(e => !e);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 12px',
            cursor: 'pointer',
            borderBottom: expanded ? `1px solid ${theme.colorBorderSecondary}` : 'none',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              background: theme.colorPrimary,
              opacity: 0.35 + 0.65 * (((tick % 3) + 1) / 3),
            }}
          />
          <strong style={{ fontSize: 12.5, flex: 1 }}>Trabajando</strong>
          {elapsedSeconds !== undefined && (
            <span style={{ fontSize: 10.5, color: theme.colorTextTertiary, whiteSpace: 'nowrap' }}>
              {formatElapsed(elapsedSeconds)}
            </span>
          )}
          <span
            style={{
              fontSize: 9,
              color: theme.colorTextTertiary,
              display: 'inline-block',
              transform: expanded ? 'rotate(180deg)' : 'none',
            }}
          >
            ▾
          </span>
        </div>
        {expanded && (
          <div
            ref={stepsRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: '8px 12px 10px',
              maxHeight: 140,
              overflowY: 'auto',
            }}
          >
            {displaySteps.map((step, index) => {
              const isCurrent = steps.length > 0 && index === displaySteps.length - 1;
              return (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={index}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, lineHeight: 1.4 }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      marginTop: 1,
                      color: isCurrent ? theme.colorPrimary : theme.colorSuccess ?? '#52c41a',
                    }}
                  >
                    {isCurrent ? '○' : '✓'}
                  </span>
                  <span style={{ color: isCurrent ? theme.colorText : theme.colorTextSecondary }}>{step}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface QuickAction {
  mode: AssistantMode;
  title: string;
  description: string;
  prompt: string;
  icon: string;
}

export interface ConversationProps {
  history: ConversationMessage[];
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  userMessage: string;
  onUserMessageChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Historial acumulado de pasos reportados por el backend vía SSE mientras
   * `sending` es true (ver `AssistantProgressEvent`) — cada `status`/`activity`
   * nuevo se agrega al final, nunca reemplaza al anterior. Array vacío ->
   * "Pensando…" genérico. */
  progressSteps: string[];
  /** Segundos transcurridos desde que se mandó el pedido en curso — cronómetro
   * del cliente, independiente de si el backend manda progreso SSE o no. */
  elapsedSeconds?: number;
  sendDisabledReason?: string;
  lastErrorMessage?: string;
  children?: React.ReactNode;
}

export function Conversation({
  history,
  mode,
  onModeChange,
  userMessage,
  onUserMessageChange,
  onSend,
  sending,
  progressSteps,
  elapsedSeconds,
  sendDisabledReason,
  lastErrorMessage,
  children,
}: ConversationProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const canSend = !sending && !sendDisabledReason;
  const quickActions: QuickAction[] = [
    {
      mode: 'review_document',
      title: 'Revisar y optimizar',
      description: 'Busca errores, claridad y oportunidades de rendimiento.',
      prompt: 'Revisá esta consulta y proponé mejoras de claridad, corrección y rendimiento.',
      icon: '⌁',
    },
    {
      mode: 'review_selection',
      title: 'Revisar selección',
      description: 'Trabaja únicamente sobre el fragmento seleccionado.',
      prompt: 'Revisá y mejorá el SQL seleccionado.',
      icon: '✦',
    },
    {
      mode: 'create',
      title: 'Crear SQL',
      description: 'Describe el resultado que necesitás obtener.',
      prompt: '',
      icon: '+',
    },
  ];

  const placeholder =
    mode === 'explain_error'
      ? 'Opcional: indicá cómo querés corregirlo…'
      : mode === 'review_document'
        ? 'Opcional: priorizá rendimiento, legibilidad o ambos…'
        : mode === 'review_selection'
          ? 'Opcional: indicá qué querés mejorar en la selección…'
          : 'Ej.: ventas por mes, filtradas por región y año…';

  const chooseQuickAction = (action: QuickAction) => {
    onModeChange(action.mode);
    onUserMessageChange(action.prompt);
  };

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [history.length, sending]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
      <div
        ref={scrollRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '2px 2px 8px',
        }}
      >
        {history.length === 0 && (
          <div
            style={{
              padding: '4px 2px 0',
              color: theme.colorTextSecondary,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            Elegí una acción o escribí tu pedido. Voy a revisar la pestaña activa y siempre mostraré los cambios antes de aplicarlos.
          </div>
        )}
        {history.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {history.map((entry, index) => (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              style={{
                display: 'flex',
                flexDirection: entry.role === 'user' ? 'row-reverse' : 'row',
                gap: 6,
                alignItems: 'flex-start',
              }}
            >
              <div style={avatarStyle(theme, entry.role)}>{ROLE_AVATAR[entry.role]}</div>
              <div
                style={
                  entry.role === 'assistant'
                    ? { ...bubbleStyle(theme, entry.role), whiteSpace: 'normal' }
                    : bubbleStyle(theme, entry.role)
                }
              >
                {entry.role === 'assistant' ? <ChatMarkdown text={entry.text} /> : entry.text}
              </div>
            </div>
          ))}
        </div>
        )}
        {sending && <WorkingIndicator steps={progressSteps} elapsedSeconds={elapsedSeconds} />}
        {children}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flexShrink: 0,
          borderTop: `1px solid ${theme.colorBorderSecondary}`,
          paddingTop: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: theme.colorTextSecondary,
              textTransform: 'uppercase',
              letterSpacing: 0.45,
              marginBottom: 7,
            }}
          >
            Acciones sugeridas
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 7 }}>
            {quickActions.map(action => {
              const selected = action.mode === mode;
              return (
                <button
                  key={action.mode}
                  type="button"
                  onClick={() => chooseQuickAction(action)}
                  aria-pressed={selected}
                  style={{
                    textAlign: 'left',
                    minHeight: 66,
                    padding: '8px 9px',
                    borderRadius: theme.borderRadius,
                    border: `1px solid ${selected ? theme.colorPrimary : theme.colorBorderSecondary}`,
                    background: selected ? theme.colorPrimaryBg : theme.colorBgContainer,
                    color: theme.colorText,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700 }}>
                    <span style={{ color: selected ? theme.colorPrimary : theme.colorTextSecondary }}>{action.icon}</span>
                    {action.title}
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.35, color: theme.colorTextSecondary }}>
                    {action.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {lastErrorMessage && mode === 'explain_error' && (
          <div
            style={{
              borderLeft: `3px solid ${theme.colorError}`,
              background: theme.colorErrorBg,
              color: theme.colorErrorText ?? theme.colorText,
              padding: '7px 9px',
              borderRadius: `0 ${theme.borderRadiusSM}px ${theme.borderRadiusSM}px 0`,
              fontSize: 11.5,
              lineHeight: 1.4,
            }}
          >
            <strong>Último error: </strong>{lastErrorMessage}
          </div>
        )}

        <textarea
          value={userMessage}
          onChange={event => onUserMessageChange(event.target.value)}
          onKeyDown={event => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSend) {
              event.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          rows={4}
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            padding: '9px 10px',
            resize: 'vertical',
            borderRadius: theme.borderRadius,
            border: `1px solid ${theme.colorBorder}`,
            background: theme.colorBgContainer,
            color: theme.colorText,
          }}
        />

        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          style={{
            padding: '9px 0',
            fontWeight: 600,
            fontSize: 13,
            borderRadius: theme.borderRadius,
            border: 'none',
            cursor: canSend ? 'pointer' : 'default',
            background: canSend ? theme.colorPrimary : theme.colorFillSecondary,
            color: canSend ? theme.colorWhite ?? '#fff' : theme.colorTextTertiary,
          }}
        >
          {sending ? `Analizando… ${elapsedSeconds !== undefined ? formatElapsed(elapsedSeconds) : ''}`.trim() : 'Pedir propuesta'}
        </button>
        <span style={{ marginTop: -4, fontSize: 10.5, color: theme.colorTextTertiary, textAlign: 'center' }}>
          Ctrl/Cmd + Enter para enviar · los cambios siempre requieren confirmación
        </span>
        {sendDisabledReason && (
          <span style={{ fontSize: 11, color: theme.colorTextTertiary }}>{sendDisabledReason}</span>
        )}
      </div>
    </div>
  );
}
