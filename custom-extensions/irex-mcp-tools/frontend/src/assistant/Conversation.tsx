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

/**
 * Burbuja que indica que el LLM está generando la respuesta. Si el backend
 * manda progreso real por SSE (`progressLabel`, ver `chatBackendAdapter`),
 * se muestra eso ("Analizando la consulta de SQL Lab.", "Obteniendo el plan
 * de ejecución.", etc.); si no (backend sin soporte SSE todavía, o antes de
 * que llegue el primer evento) cae al "Pensando…" genérico animado de
 * siempre.
 */
function TypingIndicator({ label }: { label?: string }): React.ReactElement {
  const theme = themeNs.useTheme();
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 420);
    return () => window.clearInterval(id);
  }, []);
  const dots = '.'.repeat((tick % 3) + 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <div style={avatarStyle(theme, 'assistant')}>{ROLE_AVATAR.assistant}</div>
      <div style={{ ...bubbleStyle(theme, 'assistant'), minWidth: 78, color: theme.colorTextSecondary }}>
        {label ?? `Pensando${dots}`}
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
  /** Paso actual reportado por el backend vía SSE mientras `sending` es
   * true (ver `AssistantProgressEvent`). undefined -> "Pensando…" genérico. */
  progressLabel?: string;
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
  progressLabel,
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
        {sending && <TypingIndicator label={progressLabel} />}
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
          {sending ? 'Analizando…' : 'Pedir propuesta'}
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
