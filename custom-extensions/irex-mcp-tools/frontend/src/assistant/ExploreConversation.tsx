/**
 * Composer + área de conversación para el copiloto de Explore — mismo
 * lenguaje visual que `Conversation.tsx` (SQL Lab), reusando sus piezas
 * genéricas (`WorkingIndicator`, `UserTurn`, `EarlierTurns`) pero con tipos
 * propios de Explore: `ExploreMode` (3 modos, no 4) y `ExploreDiagnostic`
 * (sin `line`/`column` — un diagnóstico de Explore apunta a un `control`
 * del formulario, no a una posición en texto SQL). No se generaliza
 * `Conversation.tsx` para cubrir ambos casos: `ResultSummary`/
 * `ResultDetails` de SQL Lab renderizan `L{line}:{column}` de forma
 * incondicional — forzar esas líneas a tener sentido para Explore es más
 * riesgo sobre un componente con muchos tests que duplicar ~150 líneas.
 */
import React from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { ExploreDiagnostic, ExploreMode } from '../contracts/exploreAssistant';
import { ChatMarkdown } from './ChatMarkdown';
import { EarlierTurns, UserTurn, WorkingIndicator, type ConversationMessage } from './Conversation';
import { Icon, type IconName } from './icons';
import { splitAssistantMessage, stripRedundantHeading } from './messageSections';
import {
  isTypingSlashCommandName,
  matchingSlashCommands,
  parseSlashInput,
  type SlashCommandDef,
} from './slashCommands';
import { card, DETAILS_RESET_CSS, FONT, MONO, readableOn, type PanelTheme } from './ui';

export type { ConversationMessage };

/** Pedido por defecto de cada modo — igual que `DEFAULT_PROMPTS` de SQL
 * Lab: elegir un modo y tocar "Generar" sin escribir nada alcanza. */
export const EXPLORE_DEFAULT_PROMPTS: Record<ExploreMode, string> = {
  explain: 'Explicame la configuración actual de este gráfico: qué muestra y por qué.',
  improve_chart: 'Sugerime mejoras a este gráfico (métricas, columnas, opciones).',
  metrics: 'Sugerime métricas o columnas calculadas útiles para este gráfico.',
};

const EXPLORE_PLACEHOLDER: Record<ExploreMode, string> = {
  explain: 'Algo puntual que quieras que explique (opcional)…',
  improve_chart: 'Qué querés cambiar: p. ej. "agregá una métrica de promedio"…',
  metrics: 'Qué métrica o columna calculada necesitás (opcional)…',
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

type Tone = 'error' | 'warning' | 'info' | 'success' | 'neutral';

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

function ExploreResultSummary({
  text,
  diagnostics,
  failed,
  hasProposal,
}: {
  text: string;
  diagnostics: ExploreDiagnostic[];
  failed: boolean;
  hasProposal: boolean;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  const count = (severity: ExploreDiagnostic['severity']) => diagnostics.filter(d => d.severity === severity).length;
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
    : hasProposal
      ? 'Propuesta lista para revisar'
      : parts.length > 0
        ? 'Análisis'
        : 'Respuesta';

  return (
    <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderRadius: theme.borderRadius, background: colors.bg, border: `1px solid ${colors.border}` }}>
      <span style={{ color: colors.icon, marginTop: 1 }}>
        <Icon name={TONE_ICON[tone]} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5, color: theme.colorText }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: theme.colorText }}>{title}</span>
          {parts.length > 0 && (
            <span
              style={{
                fontSize: FONT.small,
                fontWeight: 500,
                padding: '1px 7px',
                borderRadius: 999,
                background: theme.colorBgContainer,
                border: `1px solid ${colors.border}`,
                color: theme.colorTextSecondary,
              }}
            >
              {parts.join(', ')}
            </span>
          )}
        </div>
        <ChatMarkdown text={failed ? text.replace(/^Error:\s*/, '') : text} />
      </div>
    </div>
  );
}

function ExploreResultDetails({
  details,
  diagnostics,
  hasProposal,
}: {
  details: string;
  diagnostics: ExploreDiagnostic[];
  hasProposal: boolean;
}): React.ReactElement | null {
  const theme = themeNs.useTheme();
  if (!details && diagnostics.length === 0) return null;
  const severityColor: Record<ExploreDiagnostic['severity'], string> = {
    error: theme.colorError,
    warning: theme.colorWarning,
    info: theme.colorInfo ?? theme.colorPrimary,
  };
  return (
    <details className="irex-details" style={{ ...card(theme) }}>
      <summary
        style={{ listStyle: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: 'pointer', fontSize: FONT.small, fontWeight: 600, color: theme.colorText }}
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
                <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: severityColor[d.severity] }} />
                {d.control && (
                  <span style={{ color: theme.colorTextSecondary, fontFamily: MONO, whiteSpace: 'nowrap' }}>{d.control}</span>
                )}
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

/** Menú flotante de autocompletado, sobre el textarea — mismo trigger que
 * Slack/Discord: aparece mientras se tipea el NOMBRE del comando (antes
 * del primer espacio), se cierra al completar o cancelar. */
function SlashCommandMenu({
  theme,
  commands,
  highlightedIndex,
  onPick,
}: {
  theme: PanelTheme;
  commands: SlashCommandDef[];
  highlightedIndex: number;
  onPick: (name: string) => void;
}): React.ReactElement {
  return (
    <div
      role="listbox"
      aria-label="Comandos disponibles"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '100%',
        marginBottom: 4,
        ...card(theme),
        boxShadow: `0 4px 16px ${theme.colorBorder}`,
        overflow: 'hidden',
      }}
    >
      {commands.map((cmd, index) => {
        const selected = index === highlightedIndex;
        return (
          <div
            key={cmd.name}
            role="option"
            aria-selected={selected}
            onMouseDown={event => {
              // mousedown (no click) para que dispare ANTES del blur del textarea.
              event.preventDefault();
              onPick(cmd.name);
            }}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              padding: '6px 9px',
              cursor: 'pointer',
              background: selected ? theme.colorFillTertiary : 'transparent',
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: FONT.code, fontWeight: 600, color: theme.colorPrimary, flexShrink: 0 }}>
              /{cmd.name}
            </span>
            <span style={{ fontSize: FONT.small, color: theme.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cmd.hint}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ExploreConversationProps {
  history: ConversationMessage[];
  mode: ExploreMode;
  userMessage: string;
  onUserMessageChange: (text: string) => void;
  onSend: () => void;
  /** Habilita los comandos "/" (autocompletado + ruteo) y se llama en vez
   * de `onSend` cuando el mensaje entero es un comando reconocido (ej.
   * "/resume", "/clear") — nunca se manda al backend. Sin esto, el
   * composer se comporta como antes (ningún "/" es especial). */
  onCommand?: (name: string, args: string) => void;
  sending: boolean;
  progressSteps: string[];
  elapsedSeconds?: number;
  sendDisabledReason?: string;
  diagnostics?: ExploreDiagnostic[];
  hasProposal?: boolean;
  children?: React.ReactNode;
}

export function ExploreConversation({
  history,
  mode,
  userMessage,
  onUserMessageChange,
  onSend,
  onCommand,
  sending,
  progressSteps,
  elapsedSeconds,
  sendDisabledReason,
  diagnostics = [],
  hasProposal = false,
  children,
}: ExploreConversationProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const canSend = !sending && !sendDisabledReason;
  const commandsEnabled = !!onCommand;

  const [menuDismissed, setMenuDismissed] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const slashTyping = commandsEnabled ? isTypingSlashCommandName(userMessage) : { active: false, query: '' };
  const menuCommands = slashTyping.active ? matchingSlashCommands(slashTyping.query).slice() : [];
  const showCommandMenu = slashTyping.active && menuCommands.length > 0 && !menuDismissed;
  const clampedHighlight = Math.min(highlightedIndex, Math.max(menuCommands.length - 1, 0));

  const pickCommand = React.useCallback(
    (name: string) => {
      onUserMessageChange(`/${name} `);
      setMenuDismissed(true);
      setHighlightedIndex(0);
    },
    [onUserMessageChange],
  );

  const handleSubmit = React.useCallback(() => {
    if (showCommandMenu) {
      pickCommand(menuCommands[clampedHighlight].name);
      return;
    }
    const parsed = parseSlashInput(userMessage);
    if (parsed.isCommand && onCommand) {
      onCommand(parsed.name, parsed.args);
      onUserMessageChange('');
      return;
    }
    onSend();
  }, [showCommandMenu, menuCommands, clampedHighlight, userMessage, onCommand, onUserMessageChange, onSend, pickCommand]);

  const isPendingCommand = commandsEnabled && parseSlashInput(userMessage).isCommand;

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

      <div
        ref={scrollRef}
        style={{ display: 'grid', gridAutoRows: 'max-content', alignContent: 'start', gap: 8, flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}
      >
        {history.length === 0 && !sending && (
          <div style={{ fontSize: FONT.base, lineHeight: 1.55, color: theme.colorTextSecondary, padding: '2px 0' }}>
            Escribí qué querés cambiar y tocá <strong style={{ color: theme.colorText }}>Generar</strong> — por
            defecto propongo mejoras al gráfico. Para explicar la configuración actual o sugerir métricas en vez de
            eso, usá <strong style={{ color: theme.colorText }}>/explain</strong> o{' '}
            <strong style={{ color: theme.colorText }}>/metrics</strong>. Siempre te muestro el cambio antes de
            aplicarlo.
          </div>
        )}
        {earlier.length > 0 && <EarlierTurns messages={earlier} />}
        {lastUser && <UserTurn text={lastUser.text} />}
        {sending && <WorkingIndicator steps={progressSteps} elapsedSeconds={elapsedSeconds} />}
        {!sending && lastAssistant && sections.summary && (
          <ExploreResultSummary text={sections.summary} diagnostics={diagnostics} failed={failed} hasProposal={hasProposal} />
        )}
        {children}
        {!sending && lastAssistant && !failed && (
          <ExploreResultDetails
            key={`${history.length}:${lastAssistant.text.length}`}
            details={stripRedundantHeading(sections.details)}
            diagnostics={diagnostics}
            hasProposal={hasProposal}
          />
        )}
      </div>

      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7, padding: '8px 12px 10px', borderTop: `1px solid ${theme.colorBorderSecondary}`, background: theme.colorBgContainer }}>
        <div style={{ position: 'relative', border: `1px solid ${theme.colorBorder}`, borderRadius: theme.borderRadius, background: theme.colorBgContainer, overflow: 'visible' }}>
          {showCommandMenu && (
            <SlashCommandMenu theme={theme} commands={menuCommands} highlightedIndex={clampedHighlight} onPick={pickCommand} />
          )}
          <textarea
            ref={textareaRef}
            value={userMessage}
            onChange={event => {
              onUserMessageChange(event.target.value);
              setMenuDismissed(false);
              setHighlightedIndex(0);
            }}
            onKeyDown={event => {
              if (showCommandMenu) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlightedIndex(i => (i + 1) % menuCommands.length);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlightedIndex(i => (i - 1 + menuCommands.length) % menuCommands.length);
                  return;
                }
                if (event.key === 'Tab' || event.key === 'Enter') {
                  event.preventDefault();
                  pickCommand(menuCommands[clampedHighlight].name);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMenuDismissed(true);
                  return;
                }
              }
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && (isPendingCommand ? !sending : canSend)) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={EXPLORE_PLACEHOLDER[mode]}
            aria-label="Instrucciones para el asistente"
            aria-autocomplete={commandsEnabled ? 'list' : undefined}
            aria-expanded={showCommandMenu}
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
              fontFamily: isPendingCommand ? MONO : 'inherit',
              background: 'transparent',
              color: theme.colorText,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 5px 4px 9px', borderTop: `1px solid ${theme.colorBorderSecondary}`, background: theme.colorFillQuaternary ?? theme.colorBgContainer }}>
            <span style={{ flex: 1, fontSize: FONT.small, color: theme.colorTextSecondary }}>
              {commandsEnabled && !userMessage ? (
                <>Escribí <kbd style={{ fontFamily: MONO, fontSize: 10.5 }}>/</kbd> para ver comandos, o </>
              ) : null}
              <kbd style={{ fontFamily: MONO, fontSize: 10.5 }}>Ctrl</kbd> + <kbd style={{ fontFamily: MONO, fontSize: 10.5 }}>Enter</kbd>
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPendingCommand ? sending : !canSend}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 11px',
                borderRadius: theme.borderRadiusSM,
                border: 'none',
                fontSize: FONT.small,
                fontWeight: 600,
                cursor: (isPendingCommand ? !sending : canSend) ? 'pointer' : 'default',
                background: (isPendingCommand ? !sending : canSend) ? theme.colorPrimary : theme.colorFillSecondary,
                color: (isPendingCommand ? !sending : canSend) ? readableOn(theme.colorPrimary) : theme.colorTextSecondary,
              }}
            >
              {sending
                ? `Analizando… ${elapsedSeconds !== undefined ? formatElapsed(elapsedSeconds) : ''}`.trim()
                : isPendingCommand
                  ? 'Ejecutar'
                  : 'Generar'}
              {!sending && <Icon name={isPendingCommand ? 'play' : 'send'} size={12} />}
            </button>
          </div>
        </div>
        <span style={{ fontSize: FONT.small, color: theme.colorTextSecondary, textAlign: 'center' }}>
          {sendDisabledReason && !isPendingCommand ? sendDisabledReason : 'Nada se aplica ni se ejecuta sin tu confirmación.'}
        </span>
      </div>
    </div>
  );
}

/** Único símbolo que no viene de `Conversation.tsx`: cada modo de Explore
 * tiene default, así que a diferencia de SQL Lab (`needsText` en
 * `Conversation`) acá nunca hace falta escribir texto para enviar. Se
 * expone para que `ExploreAssistantPanel` arme el mensaje a mandar. */
export function exploreDefaultPromptFor(mode: ExploreMode): string {
  return EXPLORE_DEFAULT_PROMPTS[mode];
}
