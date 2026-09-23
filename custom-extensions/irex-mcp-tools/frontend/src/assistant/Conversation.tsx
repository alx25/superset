import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { AssistantDiagnostic, AssistantMode } from '../contracts/assistant';
import { ChatMarkdown } from './ChatMarkdown';
import { Icon, type IconName } from './icons';
import { splitAssistantMessage, stripRedundantHeading } from './messageSections';
import { buttonIcon, card, DETAILS_RESET_CSS, FONT, MONO, readableOn, type PanelTheme } from './ui';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** Pedido por defecto de cada modo, usado cuando el usuario no escribe nada:
 * elegir "Revisar y optimizar" y tocar "Generar" alcanza. */
export const DEFAULT_PROMPTS: Partial<Record<AssistantMode, string>> = {
  review_document: 'Revisá esta consulta y proponé mejoras de claridad, corrección y rendimiento.',
  review_selection: 'Revisá y mejorá el SQL seleccionado.',
  explain_error: 'Explicá el último error y proponé una corrección.',
};

interface ModeOption {
  mode: AssistantMode;
  label: string;
  hint: string;
  icon: IconName;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: 'review_document', label: 'Optimizar', hint: 'Revisar y optimizar toda la consulta: rendimiento, claridad y errores', icon: 'zap' },
  { mode: 'review_selection', label: 'Selección', hint: 'Revisar solo el fragmento marcado en el editor', icon: 'selection' },
  { mode: 'create', label: 'Generar SQL', hint: 'Desde una descripción en lenguaje natural', icon: 'filePlus' },
];

const PLACEHOLDER: Record<AssistantMode, string> = {
  review_document: 'Instrucciones adicionales (opcional): p. ej. "priorizá legibilidad"…',
  review_selection: 'Qué querés mejorar en la selección (opcional)…',
  create: 'Describí el resultado: p. ej. "ventas por mes y región del último año"…',
  explain_error: 'Cómo querés corregirlo (opcional)…',
};

/** "24s" o "1m 32s": los segundos crudos son ilegibles pasado el minuto, y
 * las consultas reales ya llegaron a ~90-112s. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ---------------------------------------------------------------------------
// Control segmentado de modo
// ---------------------------------------------------------------------------

function SegmentedControl({
  value,
  onChange,
  disabled,
}: {
  value: AssistantMode;
  onChange: (mode: AssistantMode) => void;
  disabled: boolean;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Acción del asistente"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 2,
        padding: 2,
        borderRadius: theme.borderRadius,
        background: theme.colorFillTertiary,
        border: `1px solid ${theme.colorBorderSecondary}`,
      }}
    >
      {MODE_OPTIONS.map(option => {
        const selected = option.mode === value;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            disabled={disabled}
            onClick={() => onChange(option.mode)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              minWidth: 0,
              padding: '5px 4px',
              borderRadius: theme.borderRadiusSM,
              border: 'none',
              background: selected ? theme.colorBgContainer : 'transparent',
              boxShadow: selected ? `0 1px 2px ${theme.colorBorder}` : 'none',
              color: selected ? theme.colorPrimary : theme.colorTextSecondary,
              fontSize: FONT.small,
              fontWeight: selected ? 600 : 500,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            <Icon name={option.icon} size={12} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicador de trabajo en curso
// ---------------------------------------------------------------------------

/**
 * Reemplaza al "Pensando…" plano mientras el pedido está en vuelo. Cada
 * evento `status`/`activity` del SSE se acumula como un paso (✓ los
 * terminados, ○ el que sigue en curso), igual que el widget de dashboards.
 */
function WorkingIndicator({ steps, elapsedSeconds }: { steps: string[]; elapsedSeconds?: number }): React.ReactElement {
  const theme = themeNs.useTheme();
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 420);
    return () => window.clearInterval(id);
  }, []);
  const displaySteps = steps.length > 0 ? steps : [`Pensando${'.'.repeat((tick % 3) + 1)}`];
  const stepsRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (stepsRef.current) stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
  }, [displaySteps.length]);
  return (
    <div style={{ ...card(theme), padding: '7px 10px' }} aria-live="polite">
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: FONT.small }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: theme.colorPrimary,
            opacity: 0.35 + 0.65 * (((tick % 3) + 1) / 3),
          }}
        />
        <strong style={{ flex: 1, color: theme.colorText }}>Trabajando</strong>
        {elapsedSeconds !== undefined && (
          <span style={{ color: theme.colorTextSecondary, fontFamily: MONO }}>{formatElapsed(elapsedSeconds)}</span>
        )}
      </div>
      <div
        ref={stepsRef}
        style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6, maxHeight: 96, overflowY: 'auto' }}
      >
        {displaySteps.map((step, index) => {
          const isCurrent = steps.length > 0 && index === displaySteps.length - 1;
          return (
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} style={{ display: 'flex', gap: 6, fontSize: FONT.small, lineHeight: 1.4 }}>
              <span style={{ color: isCurrent ? theme.colorPrimary : theme.colorSuccess ?? '#389e0d' }}>
                {isCurrent ? '○' : '✓'}
              </span>
              <span style={{ color: isCurrent ? theme.colorText : theme.colorTextSecondary }}>{step}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resultado del último turno
// ---------------------------------------------------------------------------

type Tone = 'error' | 'warning' | 'info' | 'success' | 'neutral';

/** Fondo, borde e ícono por tono. El TEXTO no usa el color semántico (en
 * tema claro no llega a contraste AA, ver `ui.ts`): siempre `colorText`. */
function toneColors(theme: PanelTheme, tone: Tone): { bg: string; border: string; icon: string } {
  switch (tone) {
    case 'error':
      return { bg: theme.colorErrorBg, border: theme.colorErrorBorder, icon: theme.colorError };
    case 'warning':
      return { bg: theme.colorWarningBg, border: theme.colorWarningBorder, icon: theme.colorWarning };
    case 'success':
      return {
        bg: theme.colorSuccessBg ?? theme.colorBgContainer,
        border: theme.colorSuccessBorder ?? theme.colorBorderSecondary,
        icon: theme.colorSuccess ?? theme.colorPrimary,
      };
    case 'neutral':
      return { bg: theme.colorFillQuaternary ?? theme.colorBgContainer, border: theme.colorBorderSecondary, icon: theme.colorTextSecondary };
    default:
      return { bg: theme.colorInfoBg ?? theme.colorPrimaryBg, border: theme.colorInfoBorder ?? theme.colorPrimaryBorder, icon: theme.colorInfo ?? theme.colorPrimary };
  }
}

const TONE_ICON: Record<Tone, IconName> = { error: 'error', warning: 'warning', info: 'info', success: 'check', neutral: 'sparkles' };

/**
 * Tono y título según el TIPO de respuesta, no solo el resultado técnico.
 * Una explicación (sin propuesta ni avisos) va en estilo neutro: el verde
 * "Análisis completado" sugería una revisión que no ocurrió.
 */
function ResultSummary({
  text,
  diagnostics,
  failed,
  hasProposal,
}: {
  text: string;
  diagnostics: AssistantDiagnostic[];
  failed: boolean;
  hasProposal: boolean;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  const count = (severity: AssistantDiagnostic['severity']) => diagnostics.filter(d => d.severity === severity).length;
  const errors = count('error');
  const warnings = count('warning');
  const infos = count('info');
  const tone: Tone = failed || errors > 0
    ? 'error'
    : warnings > 0
      ? 'warning'
      : hasProposal
        ? 'success'
        : infos > 0
          ? 'info'
          : 'neutral';
  const colors = toneColors(theme, tone);
  const parts = [
    errors > 0 && `${errors} ${errors === 1 ? 'error' : 'errores'}`,
    warnings > 0 && `${warnings} ${warnings === 1 ? 'advertencia' : 'advertencias'}`,
    infos > 0 && `${infos} ${infos === 1 ? 'nota' : 'notas'}`,
  ].filter(Boolean);
  const title = failed
    ? 'No se pudo completar'
    : parts.length > 0
      ? `Análisis con ${parts.join(', ')}`
      : hasProposal
        ? 'Propuesta lista para revisar'
        : 'Respuesta';

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 10px',
        borderRadius: theme.borderRadius,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span style={{ color: colors.icon, marginTop: 1 }}>
        <Icon name={TONE_ICON[tone]} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5, color: theme.colorText }}>
        <div style={{ fontWeight: 600, color: theme.colorText, marginBottom: 2 }}>{title}</div>
        <ChatMarkdown text={failed ? text.replace(/^Error:\s*/, '') : text} />
      </div>
    </div>
  );
}

function ResultDetails({
  details,
  diagnostics,
  hasProposal,
}: {
  details: string;
  diagnostics: AssistantDiagnostic[];
  hasProposal: boolean;
}): React.ReactElement | null {
  const theme = themeNs.useTheme();
  if (!details && diagnostics.length === 0) return null;
  // El color de severidad va en un punto decorativo; la ubicación y el
  // mensaje, en colores de texto con contraste AA.
  const severityColor: Record<AssistantDiagnostic['severity'], string> = {
    error: theme.colorError,
    warning: theme.colorWarning,
    info: theme.colorInfo ?? theme.colorPrimary,
  };
  return (
    // Abierto por defecto (pedido del usuario). React no vuelve a imponer
    // `open` mientras la prop no cambie, así que el usuario puede plegarlo;
    // la `key` por respuesta (ver abajo) lo reabre con cada resultado nuevo.
    <details className="irex-details" open style={{ ...card(theme) }}>
      <summary
        style={{
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          cursor: 'pointer',
          fontSize: FONT.small,
          fontWeight: 600,
          color: theme.colorText,
        }}
      >
        <span style={{ color: theme.colorPrimary }}>
          <Icon name="info" size={13} />
        </span>
        <span style={{ flex: 1 }}>{hasProposal ? '¿Por qué se propone este cambio?' : 'Ver detalle'}</span>
        {diagnostics.length > 0 && (
          <span style={{ fontWeight: 500, color: theme.colorTextSecondary }}>
            {diagnostics.length} {diagnostics.length === 1 ? 'aviso' : 'avisos'}
          </span>
        )}
        <span className="irex-chevron" style={{ color: theme.colorTextSecondary, transition: 'transform 0.15s' }}>
          <Icon name="chevron" size={13} />
        </span>
      </summary>
      <div
        style={{
          borderTop: `1px solid ${theme.colorBorderSecondary}`,
          padding: '8px 10px 10px',
          fontSize: FONT.base,
          lineHeight: 1.55,
          color: theme.colorText,
          background: theme.colorFillQuaternary ?? theme.colorBgContainer,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {details && <ChatMarkdown text={details} />}
        {diagnostics.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {diagnostics.map((d, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={index} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: FONT.small }}>
                <span
                  aria-hidden="true"
                  style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: severityColor[d.severity] }}
                />
                <span style={{ color: theme.colorTextSecondary, fontFamily: MONO, whiteSpace: 'nowrap' }}>
                  L{d.line + 1}
                  {d.column !== undefined ? `:${d.column + 1}` : ''}
                </span>
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Conversación
// ---------------------------------------------------------------------------

function UserTurn({ text }: { text: string }): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <div
      style={{
        justifySelf: 'end',
        maxWidth: '88%',
        padding: '5px 9px',
        borderRadius: theme.borderRadius,
        borderTopRightRadius: 2,
        background: theme.colorFillSecondary,
        color: theme.colorText,
        fontSize: FONT.base,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}
    >
      {text}
    </div>
  );
}

function EarlierTurns({ messages }: { messages: ConversationMessage[] }): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <details className="irex-details" style={{ ...card(theme), background: 'transparent' }}>
      <summary
        style={{
          listStyle: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          cursor: 'pointer',
          fontSize: FONT.small,
          color: theme.colorTextSecondary,
        }}
      >
        <span style={{ flex: 1 }}>Conversación anterior · {messages.length} mensajes</span>
        <span className="irex-chevron" style={{ transition: 'transform 0.15s' }}>
          <Icon name="chevron" size={12} />
        </span>
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '6px 10px 10px' }}>
        {messages.map((m, index) =>
          m.role === 'user' ? (
            // eslint-disable-next-line react/no-array-index-key
            <UserTurn key={index} text={m.text} />
          ) : (
            // eslint-disable-next-line react/no-array-index-key
            <div key={index} style={{ fontSize: FONT.base, lineHeight: 1.5, color: theme.colorText }}>
              <ChatMarkdown text={m.text} />
            </div>
          ),
        )}
      </div>
    </details>
  );
}

export interface ConversationProps {
  history: ConversationMessage[];
  mode: AssistantMode;
  onModeChange: (mode: AssistantMode) => void;
  userMessage: string;
  onUserMessageChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Pasos reportados por el backend vía SSE mientras `sending` es true; cada
   * `status`/`activity` nuevo se agrega al final. Vacío → "Pensando…". */
  progressSteps: string[];
  /** Segundos desde que se mandó el pedido en curso (cronómetro del cliente). */
  elapsedSeconds?: number;
  sendDisabledReason?: string;
  lastErrorMessage?: string;
  /** Avisos de la última respuesta: tiñen el resumen y se listan en el detalle. */
  diagnostics?: AssistantDiagnostic[];
  /** Si la última respuesta trae propuestas (cambia el rótulo del detalle). */
  hasProposal?: boolean;
  /** Propuestas, aclaraciones y avisos de ejecución: van entre el resumen y
   * el detalle del último turno. */
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
  diagnostics = [],
  hasProposal = false,
  children,
}: ConversationProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const needsText = !DEFAULT_PROMPTS[mode];
  const canSend = !sending && !sendDisabledReason && (!needsText || userMessage.trim().length > 0);

  // Último turno: desde el último mensaje del usuario. Lo anterior se pliega.
  let lastUserIndex = -1;
  history.forEach((m, i) => {
    if (m.role === 'user') lastUserIndex = i;
  });
  const earlier = lastUserIndex > 0 ? history.slice(0, lastUserIndex) : [];
  const lastUser = lastUserIndex >= 0 ? history[lastUserIndex] : undefined;
  const lastAssistant = history.slice(lastUserIndex + 1).find(m => m.role === 'assistant');
  const failed = !!lastAssistant && lastAssistant.text.startsWith('Error:');
  const sections = lastAssistant ? splitAssistantMessage(lastAssistant.text) : { summary: '', details: '' };

  const scrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = sending ? el.scrollHeight : 0;
  }, [history.length, sending]);

  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 18 + 12)}px`;
  }, [userMessage]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <style>{DETAILS_RESET_CSS}</style>

      {/* Área de resultados: ocupa todo el alto disponible y es lo único que scrollea. */}
      <div
        ref={scrollRef}
        // Grid con filas `max-content`: en un contenedor con alto fijo y
        // scroll, tanto los ítems flex como las filas `auto` se achican hasta
        // el mínimo del contenido, que en una tarjeta con overflow:hidden es 0
        // (con el detalle abierto la propuesta quedaba recortada, sin botones).
        style={{
          display: 'grid',
          gridAutoRows: 'max-content',
          alignContent: 'start',
          gap: 8,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '10px 12px',
        }}
      >
        {history.length === 0 && !sending && (
          <div style={{ fontSize: FONT.base, lineHeight: 1.55, color: theme.colorTextSecondary, padding: '2px 0' }}>
            Elegí una acción abajo (por defecto, <strong style={{ color: theme.colorText }}>Optimizar</strong>) y tocá <strong style={{ color: theme.colorText }}>Generar</strong>. Trabajo sobre la
            pestaña activa y siempre te muestro el cambio antes de aplicarlo.
          </div>
        )}
        {earlier.length > 0 && <EarlierTurns messages={earlier} />}
        {lastUser && <UserTurn text={lastUser.text} />}
        {sending && <WorkingIndicator steps={progressSteps} elapsedSeconds={elapsedSeconds} />}
        {!sending && lastAssistant && sections.summary && (
          <ResultSummary text={sections.summary} diagnostics={diagnostics} failed={failed} hasProposal={hasProposal} />
        )}
        {children}
        {!sending && lastAssistant && !failed && (
          <ResultDetails
            key={`${history.length}:${lastAssistant.text.length}`}
            details={stripRedundantHeading(sections.details)}
            diagnostics={diagnostics}
            hasProposal={hasProposal}
          />
        )}
      </div>

      {/* Composer fijo abajo, estilo chat. */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          padding: '8px 12px 10px',
          borderTop: `1px solid ${theme.colorBorderSecondary}`,
          background: theme.colorBgContainer,
        }}
      >
        <SegmentedControl value={mode} onChange={onModeChange} disabled={sending} />

        {mode === 'explain_error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 4px 4px 8px',
              borderRadius: theme.borderRadiusSM,
              background: theme.colorErrorBg,
              border: `1px solid ${theme.colorErrorBorder}`,
              color: theme.colorText,
              fontSize: FONT.small,
            }}
          >
            <span style={{ color: theme.colorError }}>
              <Icon name="error" size={12} />
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>Corregir error:</strong> {lastErrorMessage ?? 'último error de la pestaña'}
            </span>
            <button
              type="button"
              aria-label="Salir del modo corregir error"
              onClick={() => onModeChange('review_document')}
              style={{ ...buttonIcon(theme), padding: 2, color: 'inherit' }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        <div
          style={{
            border: `1px solid ${theme.colorBorder}`,
            borderRadius: theme.borderRadius,
            background: theme.colorBgContainer,
            overflow: 'hidden',
          }}
        >
          <textarea
            ref={textareaRef}
            value={userMessage}
            onChange={event => onUserMessageChange(event.target.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canSend) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={PLACEHOLDER[mode]}
            aria-label="Instrucciones para el asistente"
            rows={2}
            style={{
              display: 'block',
              width: '100%',
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              resize: 'none',
              padding: '7px 9px',
              fontSize: FONT.base,
              lineHeight: 1.5,
              fontFamily: 'inherit',
              background: 'transparent',
              color: theme.colorText,
            }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 5px 4px 9px',
              borderTop: `1px solid ${theme.colorBorderSecondary}`,
              background: theme.colorFillQuaternary ?? theme.colorBgContainer,
            }}
          >
            <span style={{ flex: 1, fontSize: FONT.small, color: theme.colorTextSecondary }}>
              <kbd style={{ fontFamily: MONO, fontSize: 10.5 }}>Ctrl</kbd> + <kbd style={{ fontFamily: MONO, fontSize: 10.5 }}>Enter</kbd>
            </span>
            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 11px',
                borderRadius: theme.borderRadiusSM,
                border: 'none',
                fontSize: FONT.small,
                fontWeight: 600,
                cursor: canSend ? 'pointer' : 'default',
                background: canSend ? theme.colorPrimary : theme.colorFillSecondary,
                color: canSend ? readableOn(theme.colorPrimary) : theme.colorTextSecondary,
              }}
            >
              {sending ? `Analizando… ${elapsedSeconds !== undefined ? formatElapsed(elapsedSeconds) : ''}`.trim() : 'Generar'}
              {!sending && <Icon name="send" size={12} />}
            </button>
          </div>
        </div>
        <span style={{ fontSize: FONT.small, color: theme.colorTextSecondary, textAlign: 'center' }}>
          {sendDisabledReason ?? 'Nada se aplica ni se ejecuta sin tu confirmación.'}
        </span>
      </div>
    </div>
  );
}
