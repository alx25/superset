/**
 * Orquestación del copiloto de Explore — equivalente de `SqlLabAssistantPanel`
 * pero mucho más chico: sin pestañas ni editor que manipular (todavía no hay
 * "aplicar"; PLAN_COPILOTO_EXPLORE.md, Fase 6). Lee el estado con
 * `exploreAdapter.ts`, manda el pedido con `exploreBackendAdapter.ts` y
 * renderiza con `ExploreConversation` (composer propio de Explore, no el de
 * SQL Lab — ver el comentario de ese archivo).
 */
import React, { useCallback, useRef, useState } from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { ExploreAction, ExploreAssistantResponse, ExploreDiagnostic, ExploreMode } from '../contracts/exploreAssistant';
import {
  buildExploreAssistantRequest,
  onExploreContextChanged,
  readExploreContext,
  readExploreFidelity,
  readIsAdminHint,
  type ExploreContext,
} from '../adapters/exploreAdapter';
import { ExploreBackendError, requestExploreAssistant } from '../adapters/exploreBackendAdapter';
import type { AssistantProgressEvent } from '../adapters/chatBackendAdapter';
import { RESOLVE_DEBOUNCE_MS, UNSAVED_STATE_CONTRACT, type QueryFidelity } from '../hosts/exploreState';
import { Clarification } from './Clarification';
import { ExploreConversation, exploreDefaultPromptFor, type ConversationMessage } from './ExploreConversation';
import { Icon } from './icons';
import { PanelHeader } from './PanelHeader';
import { card, FONT } from './ui';

/** Igual criterio que `createConversationKey` de `SqlLabAssistantPanel.tsx`
 * (duplicado a propósito, no importado: es la única pieza de ese archivo
 * que hacía falta, y así este panel no depende en nada de SQL Lab). */
function createConversationKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return [hex.slice(0, 4).join(''), hex.slice(4, 6).join(''), hex.slice(6, 8).join(''), hex.slice(8, 10).join(''), hex.slice(10, 16).join('')].join('-');
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const STATUS_LABELS: Record<'thinking' | 'calling_tool' | 'responding', string> = {
  thinking: 'Analizando…',
  calling_tool: 'Consultando…',
  responding: 'Preparando respuesta…',
};

/** Descripción legible de una acción propuesta — de solo lectura por ahora:
 * aplicar automáticamente (validar catálogo/key vigente e integrar con el
 * formulario de Explore) es trabajo real de Fase 6, todavía no construido.
 * Mostrar un botón "Aplicar" que no hiciera nada sería peor que no
 * mostrarlo. */
function describeExploreAction(action: ExploreAction): string {
  switch (action.type) {
    case 'patch_form_data':
      return action.title ?? `Cambiar ${action.operations.length === 1 ? 'un control' : `${action.operations.length} controles`} del gráfico`;
    case 'add_adhoc_metric':
      return action.title ?? `Agregar la métrica "${action.label}" (${action.expression})`;
    case 'add_adhoc_column':
      return action.title ?? `Agregar la columna "${action.label}" (${action.expression})`;
    case 'change_viz_type':
      return action.title ?? `Cambiar el tipo de gráfico a "${action.viz_type}"`;
    case 'add_dataset_metric':
      return action.title ?? `Agregar al dataset la métrica guardada "${action.label}" (${action.expression})`;
    case 'add_calculated_column':
      return action.title ?? `Agregar al dataset la columna calculada "${action.label}" (${action.expression})`;
    case 'preview':
      return action.title ?? 'Vista previa del resultado';
    default:
      return 'Propuesta';
  }
}

function ExploreActionCard({ action }: { action: ExploreAction }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px' }}>
      <span style={{ marginTop: 1 }}>
        <Icon name="sparkles" size={13} />
      </span>
      <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5 }}>
        <div>{describeExploreAction(action)}</div>
        <div style={{ fontSize: FONT.small, marginTop: 2 }}>Aplicar propuestas automáticamente todavía no está disponible.</div>
      </div>
    </div>
  );
}

function ExploreActionList({ actions }: { actions: ExploreAction[] }): React.ReactElement | null {
  const theme = themeNs.useTheme();
  if (actions.length === 0) return null;
  return (
    <div style={card(theme)}>
      {actions.map((action, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <ExploreActionCard key={index} action={action} />
      ))}
    </div>
  );
}

type FidelityState = { status: 'cargando' } | QueryFidelity;

/** Mismo hook que vivía en `exploreHost.tsx` antes de esta entrada, movido
 * acá: es lógica del asistente ("¿puedo mostrar SQL fiel?"), no del
 * mecanismo de montaje/resize que le sigue correspondiendo a ese archivo. */
function useQueryFidelity(): FidelityState {
  const [state, setState] = useState<FidelityState>({ status: 'cargando' });

  React.useEffect(() => {
    let cancelled = false;
    let debounceTimer: number | undefined;
    let requestId = 0;

    const resolve = (): void => {
      const currentRequestId = ++requestId;
      const search = window.location.search;
      setState({ status: 'cargando' });
      void readExploreFidelity(search).then(result => {
        if (!cancelled && currentRequestId === requestId && search === window.location.search) {
          setState(result);
        }
      });
    };

    resolve();
    const sub = onExploreContextChanged(kind => {
      requestId += 1;
      setState({ status: 'cargando' });
      window.clearTimeout(debounceTimer);
      if (kind === 'capture') resolve();
      else debounceTimer = window.setTimeout(resolve, RESOLVE_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      requestId += 1;
      window.clearTimeout(debounceTimer);
      sub.dispose();
    };
  }, []);

  return state;
}

function fidelityMessage(state: FidelityState): string {
  if (state.status === 'cargando') return 'Comprobando el estado del gráfico…';
  if (state.status === 'fiel') {
    const label = state.source === 'ejecutado' ? 'SQL del estado ejecutado disponible' : 'SQL fiel disponible';
    return `${label}${state.vizType ? ` (${state.vizType})` : ''}.`;
  }
  return `SQL/vista previa no disponible: ${state.reason}`;
}

export function ExploreAssistantPanel(): React.ReactElement {
  const theme = themeNs.useTheme();
  const fidelity = useQueryFidelity();
  const [mode, setMode] = useState<ExploreMode>('explain');
  const [userMessage, setUserMessage] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [response, setResponse] = useState<ExploreAssistantResponse | undefined>();
  const [conversationKey, setConversationKey] = useState<string>(createConversationKey);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const sendStartRef = useRef<number | null>(null);
  const pendingRequestRef = useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!sending) return undefined;
    const id = window.setInterval(() => {
      if (sendStartRef.current !== null) setElapsedSeconds(Math.floor((Date.now() - sendStartRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [sending]);

  const handleSend = useCallback(
    async (overrideText?: string) => {
      const text = overrideText ?? (userMessage.trim() || exploreDefaultPromptFor(mode));
      setSending(true);
      setProgressSteps([]);
      sendStartRef.current = Date.now();
      setElapsedSeconds(0);
      setHistory(prev => [...prev, { role: 'user', text }]);
      setUserMessage('');

      const controller = new AbortController();
      pendingRequestRef.current = controller;

      try {
        const context: ExploreContext = await readExploreContext(window.location.search);
        const request = buildExploreAssistantRequest(context, mode, text, conversationKey, readIsAdminHint());
        const onProgress = (event: AssistantProgressEvent): void => {
          if (event.type === 'session') {
            setSessionId(event.sessionId);
            return;
          }
          const label = event.type === 'activity' ? event.message : STATUS_LABELS[event.state];
          setProgressSteps(prev => (prev[prev.length - 1] === label ? prev : [...prev, label]));
        };
        const result = await requestExploreAssistant(request, controller.signal, onProgress);
        setResponse(result);
        setHistory(prev => [...prev, { role: 'assistant', text: result.message }]);
        if (result.session_id) setSessionId(result.session_id);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        const message = e instanceof ExploreBackendError ? e.message : e instanceof Error ? e.message : String(e);
        setHistory(prev => [...prev, { role: 'assistant', text: `Error: ${message}` }]);
      } finally {
        setSending(false);
        setProgressSteps([]);
        sendStartRef.current = null;
      }
    },
    [mode, userMessage, conversationKey],
  );

  const handleClarificationAnswer = useCallback(
    (answerText: string) => {
      setResponse(undefined);
      void handleSend(answerText);
    },
    [handleSend],
  );

  const handleNewSession = useCallback(() => {
    pendingRequestRef.current?.abort();
    setMode('explain');
    setUserMessage('');
    setSending(false);
    setProgressSteps([]);
    sendStartRef.current = null;
    setElapsedSeconds(0);
    setHistory([]);
    setResponse(undefined);
    setConversationKey(createConversationKey());
    setSessionId(undefined);
  }, []);

  // Cambió de gráfico, de key o se ejecutó una consulta nueva: la propuesta
  // en pantalla (si había una) ya no corresponde a lo que se está viendo —
  // no hay acciones aplicables todavía (ver `ExploreActionCard`), así que
  // alcanza con dejar de mostrarla; el historial de texto queda intacto.
  React.useEffect(() => {
    const sub = onExploreContextChanged(() => setResponse(undefined));
    return () => sub.dispose();
  }, []);

  const diagnostics: ExploreDiagnostic[] = response?.diagnostics ?? [];
  const actions: ExploreAction[] = response?.actions ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <PanelHeader title="Asistente de gráficos" subtitle="Explore · último estado ejecutado" sessionId={sessionId} onNewSession={handleNewSession} />
      {/* Contrato del criterio de salida 1: SIEMPRE visible, no solo antes
          del primer mensaje — "lo dice en la interfaz" (PLAN_COPILOTO_EXPLORE.md). */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '8px 12px',
          borderBottom: `1px solid ${theme.colorBorderSecondary}`,
          fontSize: FONT.small,
        }}
      >
        <div style={{ color: theme.colorTextSecondary }}>{UNSAVED_STATE_CONTRACT}</div>
        <div
          style={{
            color: fidelity.status === 'no-disponible' ? theme.colorWarning : theme.colorTextSecondary,
            fontWeight: fidelity.status === 'no-disponible' ? 600 : 400,
          }}
          data-testid="irex-explore-fidelity"
        >
          {fidelityMessage(fidelity)}
        </div>
      </div>
      <ExploreConversation
        history={history}
        mode={mode}
        onModeChange={setMode}
        userMessage={userMessage}
        onUserMessageChange={setUserMessage}
        onSend={() => void handleSend()}
        sending={sending}
        progressSteps={progressSteps}
        elapsedSeconds={sending ? elapsedSeconds : undefined}
        diagnostics={diagnostics}
        hasProposal={actions.length > 0}
      >
        {response?.suggestion_kind === 'clarification' && response.clarification_questions && (
          <Clarification
            clarification={{ reason: response.clarification_reason, questions: response.clarification_questions }}
            busy={sending}
            onSubmit={handleClarificationAnswer}
          />
        )}
        <ExploreActionList actions={actions} />
      </ExploreConversation>
    </div>
  );
}
