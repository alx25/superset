import React, { useCallback, useState } from 'react';
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
} from '../adapters/chatBackendAdapter';
import {
  applyAction,
  cancelQuery,
  executeConfirmed,
  NoActiveTabError,
  onActiveTabChanged,
  onQueryFail,
  onQuerySuccess,
  readActiveContext,
} from '../adapters/sqlLabAdapter';
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

interface ActionCardProps {
  action: AssistantAction;
  context: AssistantContext;
  onDismiss: () => void;
  onExecuted: (queryId: string) => void;
}

function ActionCard({ action, context, onDismiss, onExecuted }: ActionCardProps): React.ReactElement {
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
        if (applied.type === 'propose_sql_apply') {
          if (applied.target === 'selection') {
            await applyAction({ type: 'replace_selection', sql: applied.sql });
          } else if (applied.target === 'document') {
            await applyAction({ type: 'replace_document', sql: applied.sql });
          } else {
            await applyAction({ type: 'create_tab', sql: applied.sql, title: applied.title });
          }
        } else {
          await applyAction(applied);
        }
        onDismiss();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onDismiss],
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
        onDismiss();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [onDismiss, onExecuted],
  );

  const before = diffBeforeFor(action, context);
  const sql = 'sql' in action ? action.sql : '';

  return (
    <div
      style={{
        border: `1px solid ${theme.colorPrimaryBorder ?? theme.colorBorder}`,
        borderLeft: `3px solid ${theme.colorPrimary}`,
        borderRadius: theme.borderRadius,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: theme.colorPrimaryBg ?? theme.colorBgContainer,
      }}
    >
      <strong style={{ fontSize: 12.5, color: theme.colorText }}>💡 {titleFor(action)}</strong>
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
              {action.target === 'newTab' ? 'Nueva pestaña' : 'Aplicar'}
            </button>
            <button type="button" disabled={busy} style={buttonWarning(theme)} onClick={() => runExecute(action.sql)}>
              Ejecutar
            </button>
          </>
        )}
        {(action.type === 'replace_selection' ||
          action.type === 'replace_document' ||
          action.type === 'insert_sql') && (
          <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => runApply(action)}>
            Aplicar
          </button>
        )}
        {action.type === 'create_tab' && (
          <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => runApply(action)}>
            Nueva pestaña
          </button>
        )}
        {action.type === 'suggest_execution' && (
          <button type="button" disabled={busy} style={buttonWarning(theme)} onClick={() => runExecute(action.sql)}>
            Ejecutar
          </button>
        )}
        <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={onDismiss}>
          Descartar
        </button>
      </div>
    </div>
  );
}

type QueryEventStatus = { kind: 'success' } | { kind: 'error'; message: string };

export function SqlLabAssistantPanel(): React.ReactElement {
  const theme = themeNs.useTheme();
  const [mode, setMode] = useState<AssistantMode>('create');
  const [userMessage, setUserMessage] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const [proposal, setProposal] = useState<AssistantResponse | undefined>();
  const [proposalContext, setProposalContext] = useState<AssistantContext | undefined>();
  const [lastError, setLastError] = useState<AssistantLastError | undefined>();
  const [pendingQueryId, setPendingQueryId] = useState<string | undefined>();
  const [lastQueryEvent, setLastQueryEvent] = useState<QueryEventStatus | undefined>();
  const [contextUnavailable, setContextUnavailable] = useState<string | undefined>();
  const [activeTabVersion, setActiveTabVersion] = useState(0);

  // onDidChangeActiveTab es un evento global (no atado a una pestaña), así
  // que este efecto se suscribe una sola vez.
  React.useEffect(() => {
    const activeTabDisposable = onActiveTabChanged(() => {
      setContextUnavailable(undefined);
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

  const handleSend = useCallback(async () => {
    if (!userMessage.trim() && mode !== 'explain_error') {
      return;
    }
    setSending(true);
    setSendError(undefined);
    setHistory(prev => [...prev, { role: 'user', text: userMessage || `[${mode}]` }]);

    try {
      const context = await readActiveContext(
        mode,
        userMessage,
        mode === 'explain_error' ? lastError : undefined,
      );
      const response = await requestAssistantResponse(context);
      setProposal(response);
      setProposalContext(context);
      setHistory(prev => [...prev, { role: 'assistant', text: response.message }]);
      setUserMessage('');
    } catch (e) {
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
    }
  }, [mode, userMessage, lastError]);

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
      style={{
        padding: 14,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        background: theme.colorBgContainer,
        color: theme.colorText,
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ borderBottom: `1px solid ${theme.colorBorderSecondary}`, paddingBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Asistente SQL Lab</div>
        <div style={{ fontSize: 11, color: theme.colorTextSecondary }}>
          Propone cambios sobre la pestaña activa — nada se aplica ni se ejecuta sin confirmación.
        </div>
      </div>

      <Conversation
        history={history}
        mode={mode}
        onModeChange={setMode}
        userMessage={userMessage}
        onUserMessageChange={setUserMessage}
        onSend={handleSend}
        sending={sending}
        sendDisabledReason={contextUnavailable}
        explainErrorDisabled={!lastError}
      />

      {sendError && <components.Alert type="error" message={sendError} showIcon />}

      {proposal && proposalContext && proposal.actions.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            borderTop: `1px solid ${theme.colorBorderSecondary}`,
            paddingTop: 10,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: theme.colorTextSecondary,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
          >
            Propuesta
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
            />
          ))}
        </div>
      )}
      {proposal && proposal.actions.length === 0 && (
        <Diagnostics diagnostics={proposal.diagnostics} />
      )}

      {pendingQueryId && (
        <div
          style={{
            background: theme.colorWarningBg ?? theme.colorBgContainer,
            border: `1px solid ${theme.colorWarningBorder ?? theme.colorWarning}`,
            borderRadius: theme.borderRadius,
            padding: '6px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>Ejecutando queryId={pendingQueryId}…</span>
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
          message={`${lastQueryEvent.message} — podés usar "Explicar/corregir el último error" para pedir ayuda.`}
          showIcon
        />
      )}
    </div>
  );
}
