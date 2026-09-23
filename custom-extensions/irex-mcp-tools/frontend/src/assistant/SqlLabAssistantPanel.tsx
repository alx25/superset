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
  ASSISTANT_EXECUTION_LIMIT,
  cancelQuery,
  clearRevealedChange,
  executeConfirmed,
  getCurrentDocumentValue,
  NoActiveTabError,
  onActiveTabChanged,
  onQueryFail,
  onQueryStop,
  onQuerySuccess,
  readActiveContext,
  revealChange,
} from '../adapters/sqlLabAdapter';
import { Clarification } from './Clarification';
import { Conversation, DEFAULT_PROMPTS, type ConversationMessage } from './Conversation';
import { assessExecutionRisk, REINFORCED_CONFIRMATION_WORD, type ExecutionRisk } from './executionRisk';
import { copyText } from './clipboard';
import { Icon } from './icons';
import { PanelHeader } from './PanelHeader';
import { SqlDiff } from './SqlDiff';
import { buttonDanger, buttonGhost, buttonIcon, buttonPrimary, buttonWarning, card, FONT, MONO } from './ui';

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

export function ActionCard({ action, context, onDismiss, onExecuted, onApplied }: ActionCardProps): React.ReactElement {
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

  // Confirmación reforzada en curso (DDL/DML o varias sentencias, ver
  // `executionRisk.ts`): se resuelve dentro de la tarjeta, no con
  // `window.confirm`, para mostrar los motivos y exigir escribir la palabra.
  const [reinforcedPending, setReinforcedPending] = useState<{ sql: string; risk: ExecutionRisk } | undefined>();
  const [typedConfirmation, setTypedConfirmation] = useState('');

  const executeNow = useCallback(
    async (sql: string) => {
      setReinforcedPending(undefined);
      setTypedConfirmation('');
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

  const runExecute = useCallback(
    (sql: string) => {
      const risk = assessExecutionRisk(sql);
      if (risk.reinforced) {
        setTypedConfirmation('');
        setReinforcedPending({ sql, risk });
        return;
      }
      const confirmed = window.confirm(
        `Vas a ejecutar este SQL contra la base de la pestaña activa ` +
          `(máximo ${ASSISTANT_EXECUTION_LIMIT} filas):\n\n${sql}\n\n¿Confirmar ejecución?`,
      );
      if (confirmed) void executeNow(sql);
    },
    [executeNow],
  );

  const before = diffBeforeFor(action, context);
  const sql = 'sql' in action ? action.sql : '';
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copySql = () => {
    void copyText(sql).then(ok => {
      setCopyState(ok ? 'copied' : 'failed');
      window.setTimeout(() => setCopyState('idle'), ok ? 1500 : 2500);
    });
  };
  const canExecute =
    action.type === 'suggest_execution' ||
    action.type === 'replace_document' ||
    (action.type === 'propose_sql');
  const opensTab = action.type === 'create_tab' || (action.type === 'propose_sql' && action.target === 'newTab');
  const applyThis = () => {
    if (action.type === 'propose_sql') {
      void runApply({ type: 'propose_sql_apply', target: action.target, sql: action.sql, title: action.title });
    } else {
      void runApply(action);
    }
  };
  const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 8px',
    background: theme.colorFillQuaternary ?? theme.colorBgContainer,
  };

  return (
    <div style={card(theme)}>
      <div style={{ ...barStyle, borderBottom: `1px solid ${theme.colorBorderSecondary}` }}>
        <span style={{ color: theme.colorSuccess ?? theme.colorPrimary }}>
          <Icon name="check" size={13} />
        </span>
        <strong
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: FONT.small,
            fontWeight: 600,
            color: theme.colorText,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleFor(action)}
        >
          Propuesta · {titleFor(action)}
        </strong>
        {sql && (
          <button type="button" onClick={copySql} style={buttonIcon(theme)} aria-label="Copiar SQL propuesto">
            <Icon name={copyState === 'copied' ? 'check' : copyState === 'failed' ? 'close' : 'copy'} size={12} />
            <span aria-live="polite">
              {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'No se pudo copiar' : 'Copiar'}
            </span>
          </button>
        )}
      </div>
      {sql && <SqlDiff before={before} after={sql} />}
      {error && (
        <div style={{ padding: '6px 8px 0' }}>
          <components.Alert type="error" message={error} showIcon />
        </div>
      )}
      {reinforcedPending && (
        <div
          style={{
            margin: '8px 8px 0',
            border: `1px solid ${theme.colorErrorBorder ?? theme.colorError}`,
            background: theme.colorErrorBg ?? theme.colorBgContainer,
            borderRadius: theme.borderRadius,
            padding: 9,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: FONT.small,
            lineHeight: 1.45,
          }}
        >
          <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.colorText, fontSize: FONT.base }}>
            <span style={{ color: theme.colorError }}>
              <Icon name="warning" size={13} />
            </span>
            Este SQL puede modificar datos o estructura
          </strong>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {reinforcedPending.risk.reasons.map(reason => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <span style={{ color: theme.colorTextSecondary }}>
            Se ejecuta contra la base de la pestaña activa y no se puede deshacer desde el asistente. Superset lo
            rechaza si la base no permite DML. Para continuar, escribí{' '}
            <strong style={{ fontFamily: MONO }}>{REINFORCED_CONFIRMATION_WORD}</strong>:
          </span>
          <input
            type="text"
            value={typedConfirmation}
            onChange={e => setTypedConfirmation(e.target.value)}
            aria-label={`Escribí ${REINFORCED_CONFIRMATION_WORD} para confirmar`}
            style={{
              fontSize: FONT.base,
              fontFamily: MONO,
              padding: '4px 6px',
              borderRadius: theme.borderRadiusSM,
              border: `1px solid ${theme.colorBorder}`,
              background: theme.colorBgContainer,
              color: theme.colorText,
            }}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy}
              style={buttonGhost(theme)}
              onClick={() => {
                setReinforcedPending(undefined);
                setTypedConfirmation('');
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || typedConfirmation.trim().toUpperCase() !== REINFORCED_CONFIRMATION_WORD}
              style={{
                ...buttonDanger(theme),
                opacity: typedConfirmation.trim().toUpperCase() === REINFORCED_CONFIRMATION_WORD ? 1 : 0.5,
              }}
              onClick={() => void executeNow(reinforcedPending.sql)}
            >
              Ejecutar de todos modos
            </button>
          </div>
        </div>
      )}
      <div
        style={{
          ...barStyle,
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          borderTop: `1px solid ${theme.colorBorderSecondary}`,
          marginTop: reinforcedPending || error ? 8 : 0,
        }}
      >
        <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={onDismiss}>
          Descartar
        </button>
        {/* Ejecutar solo para SQL completo: 'propose_sql', 'replace_document' y
            'suggest_execution'. 'replace_selection'/'insert_sql' pueden ser
            un fragmento (una cláusula suelta) que no corre por sí solo. */}
        {canExecute && (
          <button
            type="button"
            disabled={busy}
            style={buttonWarning(theme)}
            onClick={() => runExecute(sql)}
            aria-label="Ejecutar con confirmación"
            title="Probar la consulta en SQL Lab (pide confirmación)"
          >
            <span style={{ color: theme.colorWarning }}>
              <Icon name="play" size={11} />
            </span>
            Ejecutar
          </button>
        )}
        {action.type !== 'suggest_execution' && (
          <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={applyThis}>
            {opensTab ? 'Abrir en nueva pestaña' : 'Aplicar al editor'}
            <Icon name={opensTab ? 'filePlus' : 'apply'} size={12} />
          </button>
        )}
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
  const [mode, setMode] = useState<AssistantMode>('review_document');
  const [userMessage, setUserMessage] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  // Historial acumulado de pasos del pedido en curso — cada evento `status`/
  // `activity` que llega por SSE se agrega al final (ver WorkingIndicator en
  // Conversation.tsx), no pisa al anterior como hacía `progressLabel`.
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [sendError, setSendError] = useState<string | undefined>();
  const [proposal, setProposal] = useState<AssistantResponse | undefined>();
  const [proposalContext, setProposalContext] = useState<AssistantContext | undefined>();
  const [lastError, setLastError] = useState<AssistantLastError | undefined>();
  const [pendingQueryId, setPendingQueryId] = useState<string | undefined>();
  // Copia sincrónica para los listeners de SQL Lab, que no deben
  // re-suscribirse cada vez que cambia la consulta en curso.
  const pendingQueryIdRef = useRef<string | undefined>(undefined);
  const setPendingQuery = useCallback((queryId: string | undefined) => {
    pendingQueryIdRef.current = queryId;
    setPendingQueryId(queryId);
  }, []);
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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const sendStartRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelHeight = usePanelHeight(rootRef);
  const pendingRequestRef = useRef<AbortController | null>(null);

  // Temporizador del pedido en curso — independiente de los eventos SSE de
  // progreso (que ya traen "Ns transcurridos" en su propio texto, pero solo
  // si el backend los manda): esto siempre corre desde el click, útil para
  // ver cuánto lleva una consulta real incluso sin soporte SSE desplegado.
  // Basado en `Date.now()` (no un contador que suma de a 1 por tick) para no
  // arrastrar drift en pedidos largos.
  React.useEffect(() => {
    if (!sending) return undefined;
    const id = window.setInterval(() => {
      if (sendStartRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - sendStartRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [sending]);

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
      // Los eventos de la consulta en curso llegan solo a los listeners de
      // SU pestaña; tras cambiar de pestaña el aviso "Ejecutando…" quedaría
      // colgado para siempre. La consulta sigue corriendo en su pestaña, que
      // tiene su propio botón nativo para detenerla.
      setPendingQuery(undefined);
      // onQuerySuccess/onQueryFail SÍ son tab-scoped: el filtro de a qué
      // pestaña pertenecen queda fijado en el momento en que se registra el
      // listener (ver superset-frontend/src/core/sqlLab/index.ts, `predicate`).
      // Sin este bump, el panel seguiría escuchando solo la pestaña que
      // estaba activa cuando se montó, y nunca se enteraría de un error
      // ocurrido en otra pestaña a la que el usuario cambió después.
      setActiveTabVersion(v => v + 1);
    });
    return () => activeTabDisposable.dispose();
  }, [setPendingQuery]);

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
  // Correlación por `clientId` (Fase 8): el aviso "Ejecutando…/Cancelar" y
  // el de éxito solo reaccionan a la consulta que lanzó el asistente — antes
  // cualquier ejecución manual de la misma pestaña los limpiaba o disparaba.
  // Los errores de CUALQUIER consulta de la pestaña siguen alimentando
  // `lastError`/"Corregir error" a propósito (entrada 21 del registro).
  React.useEffect(() => {
    const isOwnQuery = (clientId: string) => clientId === pendingQueryIdRef.current;
    const successDisposable = onQuerySuccess(result => {
      if (!isOwnQuery(result.clientId)) return;
      setLastQueryEvent({ kind: 'success' });
      setPendingQuery(undefined);
    });
    const failDisposable = onQueryFail(result => {
      const message = result.errorMessage || 'La consulta falló.';
      setLastQueryEvent({ kind: 'error', message });
      setLastError({ message, sql: result.executedSql ?? '' });
      if (isOwnQuery(result.clientId)) setPendingQuery(undefined);
    });
    const stopDisposable = onQueryStop(query => {
      if (isOwnQuery(query.clientId)) setPendingQuery(undefined);
    });
    return () => {
      successDisposable.dispose();
      failDisposable.dispose();
      stopDisposable.dispose();
    };
  }, [activeTabVersion, setPendingQuery]);

  const handleSend = useCallback(
    async (overrideMode?: AssistantMode, overrideText?: string) => {
      // `overrideMode`/`overrideText` permiten disparar el envío en el mismo
      // click que decide qué mandar (botón "Corregir error", respuesta a una
      // aclaración) — `setMode`/`setUserMessage` son asíncronos, así que leer
      // el estado en ese mismo instante daría el valor todavía viejo.
      const effectiveMode = overrideMode ?? mode;
      // Sin texto, los modos de revisión usan su pedido por defecto: elegir
      // "Revisar y optimizar" y tocar "Generar" alcanza. "Generar SQL" sí
      // necesita una descripción.
      const text = overrideText ?? (userMessage.trim() || DEFAULT_PROMPTS[effectiveMode] || '');
      if (!text.trim()) {
        return;
      }
      setSending(true);
      setProgressSteps([]);
      sendStartRef.current = Date.now();
      setElapsedSeconds(0);
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
            return;
          }
          const label = event.type === 'activity' ? event.message : STATUS_LABELS[event.state];
          // Evita repetir la misma línea dos veces seguidas (p. ej. un
          // `status: thinking` inmediatamente seguido de una `activity` que
          // dice exactamente lo mismo) sin perder pasos genuinamente nuevos.
          setProgressSteps(prev => (prev[prev.length - 1] === label ? prev : [...prev, label]));
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
        setProgressSteps([]);
        sendStartRef.current = null;
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
    setMode('review_document');
    setUserMessage('');
    setSending(false);
    setProgressSteps([]);
    sendStartRef.current = null;
    setElapsedSeconds(0);
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
        fontSize: FONT.base,
        display: 'flex',
        flexDirection: 'column',
        background: theme.colorBgContainer,
        color: theme.colorText,
        height: panelHeight ? `${panelHeight}px` : undefined,
        maxHeight: panelHeight ? `${panelHeight}px` : undefined,
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <PanelHeader sessionId={sessionId} onNewSession={handleNewSession} />

      {lastChange && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            margin: '8px 12px 0',
            padding: '4px 4px 4px 9px',
            background: theme.colorWarningBg ?? theme.colorBgContainer,
            border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
            borderRadius: theme.borderRadiusSM,
            fontSize: FONT.small,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {changeUndone ? 'Cambio deshecho en' : 'Cambio aplicado en'} <strong>{lastChange.tabTitle}</strong>
          </span>
          {changeUndone ? (
            <button type="button" style={buttonWarning(theme)} onClick={handleRedo}>
              Rehacer
            </button>
          ) : (
            <button type="button" style={buttonWarning(theme)} onClick={handleUndo}>
              <Icon name="reset" size={11} />
              Deshacer
            </button>
          )}
          <button
            type="button"
            aria-label="Ocultar aviso de cambio aplicado"
            style={{ ...buttonIcon(theme), padding: 3 }}
            onClick={() => {
              setLastChange(undefined);
              setChangeUndone(false);
            }}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      {changeError && (
        <div style={{ margin: '8px 12px 0' }}>
          <components.Alert type="error" message={changeError} showIcon closable onClose={() => setChangeError(undefined)} />
        </div>
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
        progressSteps={progressSteps}
        elapsedSeconds={sending ? elapsedSeconds : undefined}
        sendDisabledReason={contextUnavailable}
        lastErrorMessage={lastError?.message}
        diagnostics={proposal?.diagnostics ?? []}
        hasProposal={(proposal?.actions.length ?? 0) > 0}
      >
        {/* El error del pedido ya se muestra en el resumen del turno (tono
            rojo): no se repite acá como alerta aparte. */}
        {proposal?.clarification && (
          <Clarification clarification={proposal.clarification} busy={sending} onSubmit={handleClarificationAnswer} />
        )}

        {proposal &&
          proposalContext &&
          proposal.actions.map((action, index) => (
            <ActionCard
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              action={action}
              context={proposalContext}
              onDismiss={() => dismissAction(index)}
              onExecuted={setPendingQuery}
              onApplied={handleApplied}
            />
          ))}

        {pendingQueryId && (
          <div
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 5px 5px 10px',
              background: theme.colorWarningBg ?? theme.colorBgContainer,
              border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
              borderRadius: theme.borderRadiusSM,
              fontSize: FONT.small,
            }}
          >
            <span style={{ flex: 1 }}>Ejecutando consulta…</span>
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
