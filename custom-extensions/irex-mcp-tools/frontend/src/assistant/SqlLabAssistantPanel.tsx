import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { components } from '@apache-superset/core';
import type { AssistantContext, AssistantResponse } from '../contracts/assistant';
import { ASSISTANT_CONTRACT_VERSION } from '../contracts/assistant';
import {
  applyAction,
  cancelQuery,
  executeConfirmed,
  NoActiveTabError,
  onActiveTabChanged,
  onQueryFail,
  onQuerySuccess,
  probeInactiveTabEditors,
  readActiveContext,
  type TabEditorProbeResult,
} from '../adapters/sqlLabAdapter';

/**
 * Panel del spike (Fase 0). No llama a ningún backend real todavía —
 * la "propuesta" se genera localmente para validar el ciclo completo
 * (leer contexto -> mostrar diff -> aplicar -> ejecutar confirmado)
 * antes de conectar el contrato con el chat externo en la Fase 6.
 */
function buildSimulatedProposal(context: AssistantContext): AssistantResponse {
  const { editor } = context;

  if (editor.selectedSql.trim().length > 0) {
    return {
      contractVersion: ASSISTANT_CONTRACT_VERSION,
      message: 'Propuesta simulada: envolver la selección en un conteo de filas.',
      actions: [
        {
          type: 'propose_sql',
          target: 'selection',
          title: 'Contar filas de la selección',
          sql: `SELECT COUNT(*) AS row_count\nFROM (\n${editor.selectedSql}\n) AS subquery`,
        },
      ],
      diagnostics: [],
    };
  }

  return {
    contractVersion: ASSISTANT_CONTRACT_VERSION,
    message: 'Propuesta simulada: agregar un LIMIT de seguridad al documento.',
    actions: [
      {
        type: 'propose_sql',
        target: 'document',
        title: 'Agregar LIMIT 100',
        sql: `${editor.sql.trimEnd()}\nLIMIT 100`,
      },
      {
        type: 'create_tab',
        title: 'Consulta de ejemplo (spike)',
        sql: 'SELECT 1 AS spike_probe',
      },
    ],
    diagnostics: [],
  };
}

type QueryEventStatus = { kind: 'success' } | { kind: 'error'; message: string };

export function SqlLabAssistantPanel(): React.ReactElement {
  const [context, setContext] = useState<AssistantContext | undefined>();
  const [contextError, setContextError] = useState<string | undefined>();
  const [proposal, setProposal] = useState<AssistantResponse | undefined>();
  const [lastQueryEvent, setLastQueryEvent] = useState<QueryEventStatus | undefined>();
  const [pendingQueryId, setPendingQueryId] = useState<string | undefined>();
  const [probeResults, setProbeResults] = useState<TabEditorProbeResult[] | undefined>();
  const [probeRunning, setProbeRunning] = useState(false);

  const refreshContext = useCallback(() => {
    readActiveContext()
      .then(next => {
        setContext(next);
        setContextError(undefined);
      })
      .catch((error: unknown) => {
        setContext(undefined);
        setContextError(
          error instanceof NoActiveTabError
            ? error.message
            : `No se pudo leer el contexto: ${String(error)}`,
        );
      });
  }, []);

  useEffect(() => {
    refreshContext();
    const activeTabDisposable = onActiveTabChanged(() => refreshContext());
    const successDisposable = onQuerySuccess(() => {
      setLastQueryEvent({ kind: 'success' });
      setPendingQueryId(undefined);
      refreshContext();
    });
    const failDisposable = onQueryFail((result: unknown) => {
      const message =
        typeof result === 'object' && result !== null && 'errorMessage' in result
          ? String((result as { errorMessage: unknown }).errorMessage)
          : 'La consulta falló.';
      setLastQueryEvent({ kind: 'error', message });
      setPendingQueryId(undefined);
    });
    return () => {
      activeTabDisposable.dispose();
      successDisposable.dispose();
      failDisposable.dispose();
    };
  }, [refreshContext]);

  const handleSimulateProposal = useCallback(() => {
    if (!context) {
      return;
    }
    setProposal(buildSimulatedProposal(context));
  }, [context]);

  const handleApply = useCallback(async () => {
    if (!proposal) {
      return;
    }
    for (const action of proposal.actions) {
      if (action.type === 'propose_sql') {
        if (action.target === 'selection') {
          await applyAction({ type: 'replace_selection', sql: action.sql });
        } else if (action.target === 'document') {
          await applyAction({ type: 'replace_document', sql: action.sql });
        } else if (action.target === 'newTab') {
          await applyAction({ type: 'create_tab', sql: action.sql, title: action.title });
        }
      } else if (action.type === 'create_tab') {
        // La acción create_tab de ejemplo solo se aplica explícitamente,
        // vía el botón "Nueva pestaña de ejemplo" (no con "Aplicar").
      }
    }
    setProposal(undefined);
    refreshContext();
  }, [proposal, refreshContext]);

  const handleCreateExampleTab = useCallback(async () => {
    const createTabAction = proposal?.actions.find(action => action.type === 'create_tab');
    if (createTabAction?.type === 'create_tab') {
      await applyAction(createTabAction);
    }
  }, [proposal]);

  const handleExecuteConfirmed = useCallback(async () => {
    const proposeSqlAction = proposal?.actions.find(action => action.type === 'propose_sql');
    if (proposeSqlAction?.type !== 'propose_sql') {
      return;
    }
    const confirmed = window.confirm(
      `Vas a ejecutar este SQL contra la base de la pestaña activa:\n\n${proposeSqlAction.sql}\n\n¿Confirmar ejecución?`,
    );
    if (!confirmed) {
      return;
    }
    const queryId = await executeConfirmed(proposeSqlAction.sql);
    setPendingQueryId(queryId);
    setLastQueryEvent(undefined);
  }, [proposal]);

  const handleCancelQuery = useCallback(() => {
    if (pendingQueryId) {
      cancelQuery(pendingQueryId);
    }
  }, [pendingQueryId]);

  const handleRunProbe = useCallback(async () => {
    setProbeRunning(true);
    try {
      const results = await probeInactiveTabEditors(1500);
      setProbeResults(results);
    } finally {
      setProbeRunning(false);
    }
  }, []);

  const sqlPreview = useMemo(() => {
    if (!context) return '';
    const { sql } = context.editor;
    return sql.length > 300 ? `${sql.slice(0, 300)}…` : sql;
  }, [context]);

  return (
    <div style={{ padding: 12, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <strong>Asistente SQL Lab — spike (Fase 0)</strong>
        <p style={{ color: '#666', margin: '4px 0' }}>
          Panel descartable para validar la API de SQL Lab. No conecta con el chat todavía.
        </p>
      </div>

      <section>
        <button type="button" onClick={refreshContext}>
          Actualizar contexto
        </button>
        {contextError && <components.Alert type="warning" message={contextError} showIcon />}
        {context && (
          <dl style={{ fontFamily: 'monospace', fontSize: 11 }}>
            <div>tab.id: {context.tab.id}</div>
            <div>tab.title: {context.tab.title}</div>
            <div>databaseId: {context.tab.databaseId}</div>
            <div>schema: {context.tab.schema ?? '(ninguno)'}</div>
            <div>cursor: L{context.editor.cursor.line + 1}:C{context.editor.cursor.column + 1}</div>
            <div>selección: {context.editor.selectedSql ? `${context.editor.selectedSql.length} caracteres` : '(vacía)'}</div>
            <pre style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 6 }}>{sqlPreview || '(editor vacío)'}</pre>
          </dl>
        )}
      </section>

      <section>
        <button type="button" onClick={handleSimulateProposal} disabled={!context}>
          Simular propuesta
        </button>
        {proposal && (
          <div style={{ border: '1px solid #ddd', padding: 8, marginTop: 6 }}>
            <div>{proposal.message}</div>
            {proposal.actions
              .filter(action => action.type === 'propose_sql')
              .map(action =>
                action.type === 'propose_sql' ? (
                  <pre key={action.title} style={{ whiteSpace: 'pre-wrap', background: '#eef7ee', padding: 6 }}>
                    {action.sql}
                  </pre>
                ) : null,
              )}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={handleApply}>Aplicar</button>
              {proposal.actions.some(action => action.type === 'create_tab') && (
                <button type="button" onClick={handleCreateExampleTab}>Nueva pestaña de ejemplo</button>
              )}
              <button type="button" onClick={handleExecuteConfirmed}>Ejecutar (con confirmación)</button>
              <button type="button" onClick={() => setProposal(undefined)}>Descartar</button>
            </div>
          </div>
        )}
        {pendingQueryId && (
          <div style={{ marginTop: 6 }}>
            Ejecutando queryId={pendingQueryId}...{' '}
            <button type="button" onClick={handleCancelQuery}>Cancelar</button>
          </div>
        )}
        {lastQueryEvent?.kind === 'success' && <components.Alert type="success" message="Consulta ejecutada correctamente." showIcon />}
        {lastQueryEvent?.kind === 'error' && <components.Alert type="error" message={lastQueryEvent.message} showIcon />}
      </section>

      <section>
        <button type="button" onClick={handleRunProbe} disabled={probeRunning}>
          {probeRunning ? 'Midiendo…' : 'Diagnóstico: getEditor() en pestañas inactivas'}
        </button>
        {probeResults && (
          <table style={{ fontSize: 11, marginTop: 6, borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Pestaña</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Activa</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Estado</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>ms</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {probeResults.map(result => (
                <tr key={result.tabId}>
                  <td>{result.tabTitle}</td>
                  <td>{result.isActive ? 'sí' : 'no'}</td>
                  <td>{result.status}</td>
                  <td>{result.elapsedMs.toFixed(0)}</td>
                  <td>{result.valuePreview ?? result.errorMessage ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
