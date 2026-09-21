import React, { useCallback, useRef, useState } from 'react';
import { components, theme as themeNs } from '@apache-superset/core';
import type {
  AssistantAction,
  AssistantContext,
  AssistantLastError,
  AssistantMode,
  AssistantResponse,
} from '../contracts/assistant';
import {
  AssistantBackendError,
  requestAssistantResponse,
  type AssistantProgressEvent,
} from '../adapters/chatBackendAdapter';
import {
  applyAction,
  cancelQuery,
  clearRevealedChange,
  executeConfirmed,
  getCurrentDocumentValue,
  NoActiveTabError,
  onActiveTabChanged,
  onQueryFail,
  onQuerySuccess,
  readActiveContext,
  revealChange,
} from '../adapters/sqlLabAdapter';
import { Clarification } from './Clarification';
import { Conversation, type ConversationMessage } from './Conversation';
import { Diagnostics } from './Diagnostics';
import { SqlDiff } from './SqlDiff';

type PanelTheme = ReturnType<typeof themeNs.useTheme>;

function buttonBase(theme: PanelTheme): React.CSSProperties {
  return {
    border: '1px solid transparent',
    borderRadius: theme.borderRadiusSM,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  };
}
function buttonPrimary(theme: PanelTheme): React.CSSProperties {
  return { ...buttonBase(theme), background: theme.colorPrimary, color: theme.colorWhite ?? '#fff' };
}
function buttonWarning(theme: PanelTheme): React.CSSProperties {
  return {
    ...buttonBase(theme),
    background: theme.colorBgContainer,
    color: theme.colorWarningText ?? theme.colorWarning,
    borderColor: theme.colorWarningBorder ?? theme.colorWarning,
  };
}
function buttonGhost(theme: PanelTheme): React.CSSProperties {
  return {
    ...buttonBase(theme),
    background: theme.colorBgContainer,
    color: theme.colorTextSecondary,
    borderColor: theme.colorBorder,
  };
}

/** Texto contra el que se calcula el diff visual de cada acción, según su tipo y target. */
function diffBeforeFor(action: AssistantAction, context: AssistantContext): string {
  if (action.type === 'propose_sql') {
    if (action.target === 'selection') return context.editor.selectedSql;
    if (action.target === 'document') return context.editor.sql;
    return ''; // newTab: no hay contenido previo
  }
  if (action.type === 'replace_selection') return context.editor.selectedSql;
  if (action.type === 'replace_document') return context.editor.sql;
  return ''; // insert_sql / create_tab / suggest_execution: contenido nuevo, sin "antes"
}

function titleFor(action: AssistantAction): string {
  switch (action.type) {
    case 'propose_sql':
      return action.title;
    case 'replace_selection':
      return action.title ?? 'Reemplazar selección';
    case 'replace_document':
      return action.title ?? 'Reemplazar documento';
    case 'insert_sql':
      return action.title ?? 'Insertar en el cursor';
    case 'create_tab':
      return action.title ?? 'Nueva pestaña';
    case 'suggest_execution':
      return action.reason ?? 'Ejecutar SQL sugerido';
    default:
      return 'Acción';
  }
}

export interface AppliedSnapshot {
  before: string;
  after: string;
  tabTitle: string;
}

const REVEAL_MESSAGE = 'Cambio aplicado por el asistente.';

/**
 * `crypto.randomUUID()` requiere "secure context" (https o localhost) — no
 * existe sirviendo por `http://` plano contra una IP (el caso real del
 * ambiente de test). El backend ahora VALIDA que `conversation_key` sea un
 * UUID, así que el fallback tiene que producir un UUID v4 de verdad, no
 * cualquier string distinto — `crypto.getRandomValues()` sí funciona en
 * cualquier contexto (solo `randomUUID`/`subtle` tienen la restricción),
 * así que arma uno a mano (RFC 4122) en vez de degradar el formato.
 */
function createConversationKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante RFC 4122
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return [
      hex.slice(0, 4).join(''),
      hex.slice(4, 6).join(''),
      hex.slice(6, 8).join(''),
      hex.slice(8, 10).join(''),
      hex.slice(10, 16).join(''),
    ].join('-');
  }
  // Red de seguridad final — no debería llegar acá en ningún navegador real
  // (getRandomValues existe desde IE11). No es criptográficamente fuerte,
  // pero conversation_key no es un secreto: solo necesita tener forma de
  // UUID y no repetirse.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Etiqueta genérica cuando el backend manda un `status` pero todavía no un
 * `activity` más específico — ver eventos SSE de sql-lab-assistant. */
const STATUS_LABELS: Record<'thinking' | 'calling_tool' | 'responding', string> = {
  thinking: 'Analizando…',
  calling_tool: 'Consultando…',
  responding: 'Preparando propuesta…',
};

interface ActionCardProps {
  action: AssistantAction;
  context: AssistantContext;
  onDismiss: () => void;
  onExecuted: (queryId: string) => void;
  onApplied: (snapshot: AppliedSnapshot) => void;
}

function ActionCard({ action, context, onDismiss, onExecuted, onApplied }: ActionCardProps): React.ReactElement {
  const theme = themeNs.useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const runApply = useCallback(
    async (
      applied: AssistantAction | { type: 'propose_sql_apply'; target: 'selection' | 'document' | 'newTab'; sql: string; title: string },
    ) => {
      setBusy(true);
      setError(undefined);
      try {
        // `newTab`/`create_tab` no pisan nada de la pestaña activa, así que
        // no hay "antes" que restaurar. El resto sí sobrescribe contenido
        // existente: guardamos el documento completo antes y después (no
        // solo la selección/fragmento insertado) para que "Deshacer"/"Rehacer"
        // siempre puedan restaurar el estado exacto con un `replace_document`,
        // sin depender del undo nativo del editor (que `setValue` resetea).
        let overwroteInPlace = false;
        let newFullSql: string | undefined;
        if (applied.type === 'propose_sql_apply') {
          if (applied.target === 'selection') {
            await applyAction({ type: 'replace_selection', sql: applied.sql });
            overwroteInPlace = true;
          } else if (applied.target === 'document') {
            await applyAction({ type: 'replace_document', sql: applied.sql });
            overwroteInPlace = true;
            newFullSql = applied.sql;
          } else {
            await applyAction({ type: 'create_tab', sql: applied.sql, title: applied.title });
          }
        } else if (applied.type === 'replace_document') {
          await applyAction(applied);
          overwroteInPlace = true;
          newFullSql = applied.sql;
        } else {
          await applyAction(applied);
          overwroteInPlace = applied.type !== 'create_tab';
        }
        if (overwroteInPlace) {
          const beforeSql = context.editor.sql;
          try {
            const afterSql = newFullSql ?? (await getCurrentDocumentValue());
            await revealChange(beforeSql, afterSql, REVEAL_MESSAGE);
            onApplied({ before: beforeSql, after: afterSql, tabTitle: context.tab.title });
          } catch {
            // Resaltar en el editor y habilitar deshacer/rehacer es una
            // mejora de UX, no crítica: si falla no se reporta como error
            // de la propuesta (que sí se aplicó correctamente).
          }
        }
        onDismiss();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onDismiss, onApplied, context],
  );

  const runExecute = useCallback(
    async (sql: string) => {
      const confirmed = window.confirm(
        `Vas a ejecutar este SQL contra la base de la pestaña activa:\n\n${sql}\n\n¿Confirmar ejecución?`,
      );
      if (!confirmed) return;
      setBusy(true);
      setError(undefined);
      try {
        const queryId = await executeConfirmed(sql);
        onExecuted(queryId);
        // A diferencia de "Aplicar cambio" (que sí descarta la propuesta:
        // ya escribió el SQL en el editor, no queda nada más por hacer con
        // la tarjeta), ejecutar no toca el editor — es una forma de probar
        // el resultado antes de decidir aplicarlo. Descartar acá dejaba sin
        // poder aplicar el cambio después de haberlo probado.
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onExecuted],
  );

  const before = diffBeforeFor(action, context);
  const sql = 'sql' in action ? action.sql : '';

  return (
    <div
      style={{
        border: `1px solid ${theme.colorPrimaryBorder ?? theme.colorBorder}`,
        borderLeft: `3px solid ${theme.colorPrimary}`,
        borderRadius: theme.borderRadius,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: theme.colorPrimaryBg ?? theme.colorBgContainer,
      }}
    >
      <strong style={{ fontSize: 13.5, color: theme.colorText }}>Propuesta · {titleFor(action)}</strong>
      <SqlDiff before={before} after={sql} />
      {error && <components.Alert type="error" message={error} showIcon />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {action.type === 'propose_sql' && (
          <>
            <button
              type="button"
              disabled={busy}
              style={buttonPrimary(theme)}
              onClick={() =>
                runApply({ type: 'propose_sql_apply', target: action.target, sql: action.sql, title: action.title })
              }
            >
              {action.target === 'newTab' ? 'Abrir en nueva pestaña' : 'Aplicar cambio'}
            </button>
            <button type="button" disabled={busy} style={buttonWarning(theme)} onClick={() => runExecute(action.sql)}>
              Ejecutar con confirmación
            </button>
          </>
        )}
        {(action.type === 'replace_selection' ||
          action.type === 'replace_document' ||
          action.type === 'insert_sql') && (
          <>
            <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => runApply(action)}>
              Aplicar cambio
            </button>
            {/* Solo para 'replace_document': reemplaza el documento COMPLETO,
                así que su SQL es una consulta coherente y segura de probar
                antes de aplicar — mismo criterio que 'propose_sql'. 'replace_selection'
                e 'insert_sql' pueden ser un fragmento (ej. una cláusula suelta),
                no necesariamente ejecutable por sí solo. */}
            {action.type === 'replace_document' && (
              <button type="button" disabled={busy} style={buttonWarning(theme)} onClick={() => runExecute(action.sql)}>
                Ejecutar con confirmación
              </button>
            )}
          </>
        )}
        {action.type === 'create_tab' && (
          <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => runApply(action)}>
            Abrir en nueva pestaña
          </button>
        )}
        {action.type === 'suggest_execution' && (
          <button type="button" disabled={busy} style={buttonWarning(theme)} onClick={() => runExecute(action.sql)}>
            Ejecutar con confirmación
          </button>
        )}
        <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={onDismiss}>
          Descartar propuesta
        </button>
      </div>
    </div>
  );
}

type QueryEventStatus = { kind: 'success' } | { kind: 'error'; message: string };

const PANEL_BOTTOM_GAP = 8;
const PANEL_MIN_HEIGHT = 320;

/**
 * `ViewListExtension` (sidebar derecho de SQL Lab, ver AppLayout de Superset)
 * monta la extensión dentro de un `ContentWrapper` cuya altura no queda
 * definida por el layout: no es un flex container, así que un `height`
 * porcentual o `100vh` no refleja el espacio real (100vh ignora el
 * header/toolbar de SQL Lab que queda por encima del panel). Medimos
 * directamente cuánto queda hasta el fondo del viewport para que el
 * compositor quede realmente anclado sin recortarse ni empujarse fuera de
 * pantalla.
 */
function usePanelHeight(ref: React.RefObject<HTMLElement | null>): number | undefined {
  const [height, setHeight] = useState<number>();
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(PANEL_MIN_HEIGHT, window.innerHeight - top - PANEL_BOTTOM_GAP));
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [ref]);
  return height;
}

export function SqlLabAssistantPanel(): React.ReactElement {
  const theme = themeNs.useTheme();
  const [mode, setMode] = useState<AssistantMode>('create');
  const [userMessage, setUserMessage] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | undefined>();
  const [sendError, setSendError] = useState<string | undefined>();
  const [proposal, setProposal] = useState<AssistantResponse | undefined>();
  const [proposalContext, setProposalContext] = useState<AssistantContext | undefined>();
  const [lastError, setLastError] = useState<AssistantLastError | undefined>();
  const [pendingQueryId, setPendingQueryId] = useState<string | undefined>();
  const [lastQueryEvent, setLastQueryEvent] = useState<QueryEventStatus | undefined>();
  const [contextUnavailable, setContextUnavailable] = useState<string | undefined>();
  const [activeTabVersion, setActiveTabVersion] = useState(0);
  const [lastChange, setLastChange] = useState<AppliedSnapshot | undefined>();
  const [changeUndone, setChangeUndone] = useState(false);
  const [changeError, setChangeError] = useState<string | undefined>();
  // `conversationKey` es lo que el panel manda para que el backend arme su
  // clave de conversación (junto con usuario + tab.id) — rotarlo es lo que
  // hace que "Nueva sesión" realmente empiece de cero del lado del backend,
  // en vez de solo vaciar el historial visible acá. `sessionId` es el id
  // canónico que el backend devuelve para ese mismo turno (útil para
  // cruzar con /api/logs/sessions/<id>) — no es lo mismo que `conversationKey`:
  // uno lo generamos nosotros para "pedir" una conversación nueva o vieja,
  // el otro lo define el backend como identidad real de esa conversación.
  const [conversationKey, setConversationKey] = useState<string>(createConversationKey);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelHeight = usePanelHeight(rootRef);
  const pendingRequestRef = useRef<AbortController | null>(null);

  const handleApplied = useCallback((snapshot: AppliedSnapshot) => {
    setLastChange(snapshot);
    setChangeUndone(false);
  }, []);

  // onDidChangeActiveTab es un evento global (no atado a una pestaña), así
  // que este efecto se suscribe una sola vez.
  React.useEffect(() => {
    const activeTabDisposable = onActiveTabChanged(() => {
      setContextUnavailable(undefined);
      // El snapshot de "Deshacer"/"Rehacer" apunta a la pestaña donde se
      // aplicó el cambio; si el usuario ya se movió a otra, restaurarlo
      // pisaría el contenido de una pestaña distinta a la que originó el
      // cambio.
      setLastChange(undefined);
      setChangeUndone(false);
      // onQuerySuccess/onQueryFail SÍ son tab-scoped: el filtro de a qué
      // pestaña pertenecen queda fijado en el momento en que se registra el
      // listener (ver superset-frontend/src/core/sqlLab/index.ts, `predicate`).
      // Sin este bump, el panel seguiría escuchando solo la pestaña que
      // estaba activa cuando se montó, y nunca se enteraría de un error
      // ocurrido en otra pestaña a la que el usuario cambió después.
      setActiveTabVersion(v => v + 1);
    });
    return () => activeTabDisposable.dispose();
  }, []);

  const handleUndo = useCallback(async () => {
    if (!lastChange) return;
    setChangeError(undefined);
    try {
      await applyAction({ type: 'replace_document', sql: lastChange.before });
      await clearRevealedChange().catch(() => {});
      setChangeUndone(true);
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : String(e));
    }
  }, [lastChange]);

  const handleRedo = useCallback(async () => {
    if (!lastChange) return;
    setChangeError(undefined);
    try {
      await applyAction({ type: 'replace_document', sql: lastChange.after });
      await revealChange(lastChange.before, lastChange.after, REVEAL_MESSAGE).catch(() => {});
      setChangeUndone(false);
    } catch (e) {
      setChangeError(e instanceof Error ? e.message : String(e));
    }
  }, [lastChange]);

  // Tab-scoped: se re-suscribe cada vez que cambia la pestaña activa.
  React.useEffect(() => {
    const successDisposable = onQuerySuccess(() => {
      setLastQueryEvent({ kind: 'success' });
      setPendingQueryId(undefined);
    });
    const failDisposable = onQueryFail((result: unknown) => {
      const message =
        typeof result === 'object' && result !== null && 'errorMessage' in result
          ? String((result as { errorMessage: unknown }).errorMessage)
          : 'La consulta falló.';
      const executedSql =
        typeof result === 'object' && result !== null && 'executedSql' in result
          ? String((result as { executedSql: unknown }).executedSql ?? '')
          : '';
      setLastQueryEvent({ kind: 'error', message });
      setLastError({ message, sql: executedSql });
      setPendingQueryId(undefined);
    });
    return () => {
      successDisposable.dispose();
      failDisposable.dispose();
    };
  }, [activeTabVersion]);

  const handleSend = useCallback(
    async (overrideMode?: AssistantMode, overrideText?: string) => {
      // `overrideMode`/`overrideText` permiten disparar el envío en el mismo
      // click que decide qué mandar (botón "Corregir error", respuesta a una
      // aclaración) — `setMode`/`setUserMessage` son asíncronos, así que leer
      // el estado en ese mismo instante daría el valor todavía viejo.
      const effectiveMode = overrideMode ?? mode;
      const text = overrideText ?? userMessage;
      if (!text.trim() && effectiveMode !== 'explain_error') {
        return;
      }
      setSending(true);
      setProgressLabel(undefined);
      setSendError(undefined);
      setHistory(prev => [...prev, { role: 'user', text: text || `[${effectiveMode}]` }]);
      // Se limpia apenas se envía (no al recibir respuesta): así el compositor
      // nunca "retiene" lo que el usuario ya pidió, sin importar si la
      // respuesta tarda o falla.
      setUserMessage('');

      // "Nueva sesión" puede cancelar este pedido si todavía está en vuelo
      // (ver `handleNewSession`); sin esto, la respuesta llegaría igual y
      // reaparecería en una conversación que el usuario ya dio por cerrada.
      const controller = new AbortController();
      pendingRequestRef.current = controller;

      try {
        const context = await readActiveContext(
          effectiveMode,
          text,
          effectiveMode === 'explain_error' ? lastError : undefined,
        );
        const response = await requestAssistantResponse(context, conversationKey, undefined, controller.signal, event => {
          if (event.type === 'session') {
            setSessionId(event.sessionId);
          } else if (event.type === 'activity') {
            setProgressLabel(event.message);
          } else {
            setProgressLabel(STATUS_LABELS[event.state]);
          }
        });
        setProposal(response);
        setProposalContext(context);
        setHistory(prev => [...prev, { role: 'assistant', text: response.message }]);
        if (response.sessionId) {
          // Cubre el fallback JSON plano (sin el evento SSE "session" previo)
          // y refuerza el id final por si el que llegó antes por SSE difiere.
          setSessionId(response.sessionId);
        }
        if (effectiveMode === 'explain_error') {
          // La propuesta de corrección ya está lista: el aviso de error (con
          // su botón "Corregir error") dejó de tener sentido y, si seguía
          // ahí, quedaba clickeable de nuevo apenas terminaba el pedido.
          setLastQueryEvent(undefined);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          return;
        }
        let message: string;
        if (e instanceof NoActiveTabError) {
          message = e.message;
        } else if (e instanceof AssistantBackendError) {
          message = e.message;
        } else {
          message = e instanceof Error ? e.message : String(e);
        }
        setSendError(message);
        setHistory(prev => [...prev, { role: 'assistant', text: `Error: ${message}` }]);
      } finally {
        setSending(false);
        setProgressLabel(undefined);
      }
    },
    [mode, userMessage, lastError, conversationKey],
  );

  const handleFixError = useCallback(() => {
    setMode('explain_error');
    void handleSend('explain_error');
  }, [handleSend]);

  const handleClarificationAnswer = useCallback(
    (answerText: string) => {
      // La tarjeta de aclaración ya cumplió su función — se limpia acá
      // mismo (no al llegar la respuesta nueva) para no dejarla ocupando
      // espacio, ya deshabilitada, mientras el pedido siguiente está en
      // vuelo mostrando "Analizando…".
      setProposal(undefined);
      setProposalContext(undefined);
      // Mismo modo de la conversación en curso, texto elegido como el
      // próximo user_message — mismo conversation_key (nunca se toca acá).
      void handleSend(undefined, answerText);
    },
    [handleSend],
  );

  const handleNewSession = useCallback(() => {
    // Corta cualquier pedido en vuelo: si no se cancela, su respuesta
    // llegaría igual y reaparecería en la conversación recién vaciada.
    pendingRequestRef.current?.abort();
    setMode('create');
    setUserMessage('');
    setSending(false);
    setProgressLabel(undefined);
    setSendError(undefined);
    setHistory([]);
    setProposal(undefined);
    setProposalContext(undefined);
    setLastError(undefined);
    setLastQueryEvent(undefined);
    setLastChange(undefined);
    setChangeUndone(false);
    setChangeError(undefined);
    // Esto es lo que hace que "Nueva sesión" sea real del lado del backend,
    // no solo acá: al rotar la key, el próximo turno arma una clave de
    // conversación distinta y no puede rehidratar el historial anterior
    // (que igual queda preservado del lado del backend para auditoría/logs).
    setConversationKey(createConversationKey());
    setSessionId(undefined);
  }, []);

  const dismissAction = useCallback((index: number) => {
    setProposal(prev => {
      if (!prev) return prev;
      const actions = prev.actions.filter((_, i) => i !== index);
      return { ...prev, actions };
    });
  }, []);

  const handleCancelQuery = useCallback(() => {
    if (pendingQueryId) {
      cancelQuery(pendingQueryId);
    }
  }, [pendingQueryId]);

  return (
    <div
      ref={rootRef}
      style={{
        padding: 16,
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: theme.colorBgContainer,
        color: theme.colorText,
        height: panelHeight ? `${panelHeight}px` : undefined,
        maxHeight: panelHeight ? `${panelHeight}px` : undefined,
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          borderBottom: `1px solid ${theme.colorBorderSecondary}`,
          paddingBottom: 12,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: theme.borderRadius,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: theme.colorPrimaryBg,
            color: theme.colorPrimary,
            fontWeight: 700,
          }}
        >
          SQL
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Asistente SQL Lab</div>
          <div style={{ fontSize: 11.5, color: theme.colorTextSecondary, lineHeight: 1.45 }}>
            Analiza la pestaña activa y propone cambios seguros.
          </div>
          <div style={{ marginTop: 5, fontSize: 10.5, color: theme.colorPrimary, fontWeight: 600 }}>
            ● Pestaña activa · confirmación obligatoria
          </div>
          {sessionId && (
            <div
              style={{
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 10,
                color: theme.colorTextTertiary,
              }}
              title={`Sesión: ${sessionId} — usar con /api/logs/sessions/<id>`}
            >
              <span
                style={{
                  fontFamily: "'SF Mono', Consolas, Monaco, monospace",
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 150,
                }}
              >
                {sessionId}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(sessionId).catch(() => {})}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: theme.colorTextTertiary,
                  textDecoration: 'underline',
                  fontSize: 10,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                copiar
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          style={buttonGhost(theme)}
          onClick={handleNewSession}
          title="Vacía el historial de esta conversación y sus propuestas. No modifica el SQL ya aplicado en el editor."
        >
          ↻ Nueva sesión
        </button>
      </div>

      {lastChange && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: theme.colorWarningBg ?? theme.colorBgContainer,
            border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
            borderRadius: theme.borderRadius,
            padding: '7px 10px',
            fontSize: 11.5,
          }}
        >
          <span>
            {changeUndone ? 'Cambio deshecho en' : 'Último cambio aplicado en'}{' '}
            <strong>{lastChange.tabTitle}</strong>.
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {changeUndone ? (
              <button type="button" style={buttonWarning(theme)} onClick={handleRedo}>
                Rehacer
              </button>
            ) : (
              <button type="button" style={buttonWarning(theme)} onClick={handleUndo}>
                Deshacer
              </button>
            )}
            <button
              type="button"
              style={buttonGhost(theme)}
              onClick={() => {
                setLastChange(undefined);
                setChangeUndone(false);
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {changeError && (
        <components.Alert type="error" message={changeError} showIcon closable onClose={() => setChangeError(undefined)} />
      )}

      <Conversation
        history={history}
        mode={mode}
        onModeChange={setMode}
        userMessage={userMessage}
        onUserMessageChange={setUserMessage}
        // `Conversation` invoca esto como manejador nativo de click/keydown
        // (le pasa el evento como primer argumento) — `handleSend` acepta un
        // `overrideMode?` opcional, así que pasarla directa hacía que el
        // SyntheticEvent del click terminara viajando como "modo" hasta el
        // fetch, y `JSON.stringify` reventaba con "circular structure"
        // porque un evento de React referencia el nodo DOM completo.
        onSend={() => {
          void handleSend();
        }}
        sending={sending}
        progressLabel={progressLabel}
        sendDisabledReason={contextUnavailable}
        lastErrorMessage={lastError?.message}
      >
        {sendError && <components.Alert type="error" message={sendError} showIcon />}

        {proposal?.clarification && (
          <Clarification clarification={proposal.clarification} busy={sending} onSubmit={handleClarificationAnswer} />
        )}

        {proposal && proposalContext && proposal.actions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: theme.colorTextSecondary,
                textTransform: 'uppercase',
                letterSpacing: 0.45,
              }}
            >
              Propuesta lista para revisar
            </span>
            <Diagnostics diagnostics={proposal.diagnostics} />
            {proposal.actions.map((action, index) => (
              <ActionCard
                // eslint-disable-next-line react/no-array-index-key
                key={index}
                action={action}
                context={proposalContext}
                onDismiss={() => dismissAction(index)}
                onExecuted={setPendingQueryId}
                onApplied={handleApplied}
              />
            ))}
          </div>
        )}
        {proposal && proposal.actions.length === 0 && <Diagnostics diagnostics={proposal.diagnostics} />}

        {pendingQueryId && (
          <div
            style={{
              background: theme.colorWarningBg ?? theme.colorBgContainer,
              border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
              borderRadius: theme.borderRadius,
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span>Ejecutando consulta…</span>
            <button type="button" style={buttonGhost(theme)} onClick={handleCancelQuery}>
              Cancelar
            </button>
          </div>
        )}
        {lastQueryEvent?.kind === 'success' && (
          <components.Alert type="success" message="Consulta ejecutada correctamente." showIcon />
        )}
        {lastQueryEvent?.kind === 'error' && (
          <components.Alert
            type="error"
            message={lastQueryEvent.message}
            showIcon
            action={
              <button type="button" style={buttonWarning(theme)} onClick={handleFixError} disabled={sending}>
                Corregir error
              </button>
            }
          />
        )}
      </Conversation>
    </div>
  );
}
