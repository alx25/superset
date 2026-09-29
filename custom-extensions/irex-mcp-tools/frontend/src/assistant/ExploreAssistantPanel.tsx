/**
 * Orquestación del copiloto de Explore — equivalente de `SqlLabAssistantPanel`
 * pero mucho más chico: sin pestañas ni editor que manipular. Lee el estado
 * con `exploreAdapter.ts`, manda el pedido con `exploreBackendAdapter.ts`,
 * renderiza con `ExploreConversation` (composer propio de Explore) y, desde
 * la Fase 6, aplica cambios reales con `exploreApplyAdapter.ts`.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { ExploreAction, ExploreAssistantResponse, ExploreDiagnostic, ExploreMode } from '../contracts/exploreAssistant';
import {
  buildExploreAssistantRequest,
  onExploreContextChanged,
  parseDatasourceRef,
  readExploreContext,
  readExploreFidelity,
  readIsAdminHint,
  type ExploreContext,
} from '../adapters/exploreAdapter';
import { ExploreBackendError, requestExploreAssistant } from '../adapters/exploreBackendAdapter';
import type { AssistantProgressEvent } from '../adapters/chatBackendAdapter';
import {
  ApplyExploreActionError,
  applyExploreActions,
  buildExploreReloadUrl,
  diffFormData,
  formatControlDiffValue,
  isApplicableExploreAction,
  postAppliedFormData,
  type ApplicableExploreAction,
  type ControlDiffEntry,
} from '../adapters/exploreApplyAdapter';
import { RESOLVE_DEBOUNCE_MS, UNSAVED_STATE_CONTRACT, fetchFormData, parseExploreLocation, type QueryFidelity } from '../hosts/exploreState';
import {
  listConversationEntries,
  recordConversationEntry,
  type PersistedConversationEntry,
} from '../hosts/exploreConversationHistory';
import { clearPendingUndo, readPendingUndo, rememberPendingUndo, type PersistedConversationSnapshot } from '../hosts/exploreUndo';
import { Clarification } from './Clarification';
import { formatCodeForDiff } from './codeFormat';
import { ExploreConversation, exploreDefaultPromptFor, type ConversationMessage } from './ExploreConversation';
import { Icon } from './icons';
import { PanelHeader } from './PanelHeader';
import { buttonGhost, buttonIcon, buttonPrimary, card, FONT, MONO } from './ui';

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

/** Descripción legible de una acción propuesta — también el texto que
 * queda guardado como título del aviso de "Deshacer" tras aplicar. */
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

/** Bloque de código con scroll propio (no `<span>` inline) — el CSS/HTML
 * real de un `styleTemplate`/`handlebarsTemplate` fácilmente pasa los miles
 * de caracteres; sin esto se ve todo apretado en una sola línea envuelta. */
function CodeBlock({ text, emphasis }: { text: string; emphasis?: boolean }): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <pre
      style={{
        margin: '2px 0 6px',
        padding: '6px 8px',
        maxHeight: 220,
        overflow: 'auto',
        whiteSpace: 'pre',
        fontFamily: MONO,
        fontSize: FONT.small,
        lineHeight: 1.45,
        color: theme.colorText,
        background: theme.colorFillQuaternary ?? theme.colorBgContainer,
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadiusSM,
        fontWeight: emphasis ? 600 : 400,
      }}
    >
      {text}
    </pre>
  );
}

function ControlDiffRow({ entry }: { entry: ControlDiffEntry }): React.ReactElement {
  const theme = themeNs.useTheme();
  // CSS/HTML (styleTemplate/handlebarsTemplate): formateado con indentación
  // real y en un bloque con scroll propio — el modelo los entrega
  // minificados en una sola línea (pedido del usuario 2026-09-28: "en los
  // CSS y HTML los entrega desordenados"). Cualquier otro control sigue el
  // resumen legible de siempre (`formatControlDiffValue`), sin cambios.
  const beforeCode = formatCodeForDiff(entry.control, entry.before);
  const afterCode = formatCodeForDiff(entry.control, entry.after);
  if (beforeCode !== undefined || afterCode !== undefined) {
    return (
      <div style={{ fontSize: FONT.small, lineHeight: 1.5 }}>
        <code style={{ fontFamily: MONO, fontWeight: 600 }}>{entry.control}</code>
        <div style={{ paddingLeft: 8, color: theme.colorTextSecondary, marginTop: 4 }}>antes:</div>
        <CodeBlock text={beforeCode ?? formatControlDiffValue(entry.control, entry.before)} />
        <div style={{ paddingLeft: 8, color: theme.colorTextSecondary }}>después:</div>
        <CodeBlock text={afterCode ?? formatControlDiffValue(entry.control, entry.after)} emphasis />
      </div>
    );
  }
  return (
    <div style={{ fontSize: FONT.small, lineHeight: 1.5 }}>
      <code style={{ fontFamily: MONO, fontWeight: 600 }}>{entry.control}</code>
      <div style={{ paddingLeft: 8, color: theme.colorTextSecondary }}>
        antes: <span style={{ color: theme.colorText }}>{formatControlDiffValue(entry.control, entry.before)}</span>
      </div>
      <div style={{ paddingLeft: 8, color: theme.colorTextSecondary }}>
        después: <span style={{ color: theme.colorText, fontWeight: 600 }}>{formatControlDiffValue(entry.control, entry.after)}</span>
      </div>
    </div>
  );
}

/** Lo que hace falta para poder escribir el `POST` real — se arma UNA vez,
 * al pedir "Ver cambio" (ahí se lee el form_data fresco y se valida la key
 * vigente); "Aplicar" reusa esto sin volver a leer nada, salvo la
 * revalidación de la key justo antes de escribir. */
interface PreparedExploreApply {
  sliceId: number | null;
  datasourceId: number;
  datasourceType: 'table';
  nextFormData: Record<string, unknown>;
  diff: ControlDiffEntry[];
}

/** Prepare→diff→confirm→aplicar, compartido entre una tarjeta individual
 * (`ExploreActionCard`, un elemento) y la lista con casilleros
 * (`ExploreProposalChecklist`, los elementos tildados) — mismo flujo, la
 * única diferencia es cuántas acciones se combinan en un solo form_data
 * antes del POST/reload. Todas las acciones deben compartir
 * `base_form_data_key`: son de un mismo turno, armadas sobre el mismo
 * estado verificado. */
function usePreparedApply(
  actions: ApplicableExploreAction[],
  title: string,
  snapshotConversation: () => PersistedConversationSnapshot,
): {
  busy: boolean;
  error: string | undefined;
  prepared: PreparedExploreApply | undefined;
  handlePrepare: () => Promise<void>;
  handleConfirm: () => Promise<void>;
  handleCancel: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [prepared, setPrepared] = useState<PreparedExploreApply | undefined>();
  const baseKey = actions[0]?.base_form_data_key;

  const handlePrepare = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (actions.length === 0) throw new Error('No hay ningún cambio para aplicar.');
      if (!actions.every(a => a.base_form_data_key === baseKey)) {
        throw new Error('Estas propuestas no corresponden al mismo estado — pedile al asistente que las revise de nuevo.');
      }
      const { sliceId, formDataKey } = parseExploreLocation(window.location.search);
      if (!formDataKey || formDataKey !== baseKey) {
        throw new Error('El estado del gráfico cambió desde que se generó esta propuesta — pedile al asistente que la revise de nuevo.');
      }
      const currentFormData = await fetchFormData(formDataKey);
      if (!currentFormData) {
        throw new Error('No se pudo leer el estado actual del gráfico (la key puede haber vencido).');
      }
      const datasourceRaw = currentFormData.datasource;
      const ref = typeof datasourceRaw === 'string' ? parseDatasourceRef(datasourceRaw) : undefined;
      if (!ref) throw new Error('El estado actual no identifica un dataset válido.');
      const nextFormData = applyExploreActions(currentFormData, actions);
      const diff = diffFormData(currentFormData, nextFormData);
      if (diff.length === 0) {
        throw new Error('Este cambio no modifica nada respecto al estado actual — puede que ya se haya aplicado.');
      }
      setPrepared({ sliceId: sliceId ?? null, datasourceId: ref.id, datasourceType: ref.type, nextFormData, diff });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [actions, baseKey]);

  const handleConfirm = useCallback(async () => {
    if (!prepared) return;
    if (
      !window.confirm(
        'Se va a recargar Explore con el cambio aplicado. Si tenías controles editados sin ejecutar en la pantalla, se pierden. ¿Continuar?',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { formDataKey: currentKey } = parseExploreLocation(window.location.search);
      if (!currentKey || currentKey !== baseKey) {
        throw new Error('El estado del gráfico cambió justo antes de aplicar — volvé a pedir la propuesta.');
      }
      const newKey = await postAppliedFormData(prepared.datasourceId, prepared.datasourceType, prepared.nextFormData, prepared.sliceId ?? undefined);
      rememberPendingUndo({
        sliceId: prepared.sliceId,
        previousFormDataKey: currentKey,
        appliedFormDataKey: newKey,
        title,
        appliedAt: Date.now(),
        // El reload que sigue borra la conversación de React — se guarda
        // acá para que `ExploreUndoBanner`/`ExploreAssistantPanel` la
        // restauren apenas la página vuelva a montar (mismo criterio de
        // vigencia que "Deshacer": mientras el aviso siga mostrándose).
        conversation: snapshotConversation(),
      });
      window.location.assign(buildExploreReloadUrl(newKey, prepared.sliceId));
    } catch (e) {
      setError(e instanceof ApplyExploreActionError ? e.message : e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [prepared, baseKey, title, snapshotConversation]);

  const handleCancel = useCallback(() => {
    setPrepared(undefined);
    setError(undefined);
  }, []);

  return { busy, error, prepared, handlePrepare, handleConfirm, handleCancel };
}

function ExploreActionCard({
  action,
  snapshotConversation,
}: {
  action: ExploreAction;
  /** Arma la instantánea de la conversación ACTUAL, tomada recién al
   * confirmar — nunca antes, para no capturar un estado ya viejo si el
   * usuario siguió chateando entre "Ver cambio" y "Aplicar". */
  snapshotConversation: () => PersistedConversationSnapshot;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  const applicable = isApplicableExploreAction(action);
  const singleAction = useMemo(() => (applicable ? [action] : []), [action, applicable]);
  const { busy, error, prepared, handlePrepare, handleConfirm, handleCancel } = usePreparedApply(
    singleAction,
    applicable ? describeExploreAction(action) : '',
    snapshotConversation,
  );

  if (!applicable) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px' }}>
        <span style={{ marginTop: 1 }}>
          <Icon name="sparkles" size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5 }}>
          <div>{describeExploreAction(action)}</div>
          <div style={{ fontSize: FONT.small, marginTop: 2, color: theme.colorTextSecondary }}>
            {action.type === 'preview' ? 'La vista previa vive en el propio gráfico.' : 'Esto requiere rol Admin y todavía no está disponible desde acá.'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ marginTop: 1 }}>
          <Icon name="sparkles" size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5 }}>{describeExploreAction(action)}</div>
      </div>

      {error && (
        <div style={{ fontSize: FONT.small, color: theme.colorError, paddingLeft: 21 }}>{error}</div>
      )}

      {prepared && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 21 }}>
          {prepared.diff.map(entry => (
            <ControlDiffRow key={entry.control} entry={entry} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', paddingLeft: 21 }}>
        {!prepared ? (
          <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={() => void handlePrepare()}>
            {busy ? 'Comprobando…' : 'Ver cambio'}
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={handleCancel}>
              Cancelar
            </button>
            <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => void handleConfirm()}>
              {busy ? 'Aplicando…' : 'Aplicar'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Segunda versión (2026-09-25): la primera ("Aplicar todo") era una
 * tarjeta aparte MÁS las individuales, cada una avisando que aplicarla
 * sola descartaba las demás — el usuario la sintió compleja y no le gustó
 * ese aviso. Ahora es UNA sola tarjeta con casilleros (todos tildados por
 * defecto): elegís qué entra, listo — no hay "aplicar mal" ni aviso de
 * pérdida, porque lo que no tildás nunca estuvo en el paquete a aplicar.
 * Con una sola acción aplicable no tiene sentido mostrar un casillero
 * único — `ExploreActionList` usa `ExploreActionCard` para ese caso. */
function ExploreProposalChecklist({
  actions,
  snapshotConversation,
}: {
  actions: ApplicableExploreAction[];
  snapshotConversation: () => PersistedConversationSnapshot;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  const [checked, setChecked] = useState<boolean[]>(() => actions.map(() => true));
  const selected = useMemo(() => actions.filter((_, index) => checked[index]), [actions, checked]);
  const title = useMemo(
    () => (selected.length === 1 ? describeExploreAction(selected[0]) : truncateText(`${selected.length} cambios: ${selected.map(describeExploreAction).join('; ')}`, 200)),
    [selected],
  );
  const { busy, error, prepared, handlePrepare, handleConfirm, handleCancel } = usePreparedApply(selected, title, snapshotConversation);

  // Cambiar la selección invalida cualquier diff ya calculado — hay que
  // pedirlo de nuevo. Más simple que sincronizar `prepared` con la
  // selección: mientras hay un diff en pantalla, los casilleros se
  // bloquean (ver `disabled` abajo) — "Cancelar" los vuelve a habilitar.
  const toggle = (index: number): void => {
    if (prepared || busy) return;
    setChecked(prev => prev.map((value, i) => (i === index ? !value : value)));
  };

  return (
    <div style={{ ...card(theme), display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ marginTop: 1 }}>
          <Icon name="sparkles" size={13} />
        </span>
        <div style={{ flex: 1, minWidth: 0, fontSize: FONT.base, lineHeight: 1.5 }}>
          Esta propuesta tiene {actions.length} cambios relacionados. Elegí cuáles aplicar juntos, en un solo paso.
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 21 }}>
        {actions.map((action, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <label
            key={index}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              fontSize: FONT.base,
              lineHeight: 1.5,
              cursor: prepared || busy ? 'default' : 'pointer',
              color: checked[index] ? theme.colorText : theme.colorTextSecondary,
            }}
          >
            <input type="checkbox" checked={checked[index]} disabled={prepared !== undefined || busy} onChange={() => toggle(index)} style={{ marginTop: 3, flexShrink: 0 }} />
            <span>{describeExploreAction(action)}</span>
          </label>
        ))}
      </div>

      {error && <div style={{ fontSize: FONT.small, color: theme.colorError, paddingLeft: 21 }}>{error}</div>}

      {prepared && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 21 }}>
          {prepared.diff.map(entry => (
            <ControlDiffRow key={entry.control} entry={entry} />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', paddingLeft: 21 }}>
        {!prepared ? (
          <button type="button" disabled={busy || selected.length === 0} style={buttonGhost(theme)} onClick={() => void handlePrepare()}>
            {busy ? 'Comprobando…' : 'Ver cambio'}
          </button>
        ) : (
          <>
            <button type="button" disabled={busy} style={buttonGhost(theme)} onClick={handleCancel}>
              Cancelar
            </button>
            <button type="button" disabled={busy} style={buttonPrimary(theme)} onClick={() => void handleConfirm()}>
              {busy ? 'Aplicando…' : `Aplicar (${selected.length})`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ExploreActionList({
  actions,
  snapshotConversation,
}: {
  actions: ExploreAction[];
  snapshotConversation: () => PersistedConversationSnapshot;
}): React.ReactElement | null {
  const theme = themeNs.useTheme();
  if (actions.length === 0) return null;
  const applicable = actions.filter(isApplicableExploreAction);
  // Con 2+ acciones aplicables, el casillero único las reemplaza — las
  // tarjetas individuales de abajo quedan solo para lo NO aplicable
  // (dataset/preview). Con 0 o 1, no hay nada que "elegir": la lista de
  // siempre alcanza.
  const useChecklist = applicable.length >= 2;
  const individualActions = useChecklist ? actions.filter(action => !isApplicableExploreAction(action)) : actions;
  return (
    <>
      {useChecklist && <ExploreProposalChecklist actions={applicable} snapshotConversation={snapshotConversation} />}
      {individualActions.length > 0 && (
        <div style={card(theme)}>
          {individualActions.map((action, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <ExploreActionCard key={index} action={action} snapshotConversation={snapshotConversation} />
          ))}
        </div>
      )}
    </>
  );
}

function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return new Date(timestampMs).toLocaleDateString();
}

/** Picker de `/resume` cuando hay 2+ conversaciones guardadas para este
 * gráfico — con 0 o 1, `handleCommand` resuelve directo sin mostrar esto. */
function ExploreResumePicker({
  entries,
  onPick,
  onDismiss,
}: {
  entries: PersistedConversationEntry[];
  onPick: (entry: PersistedConversationEntry) => void;
  onDismiss: () => void;
}): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <div style={card(theme)}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: `1px solid ${theme.colorBorderSecondary}` }}>
        <Icon name="reset" size={13} />
        <span style={{ flex: 1, fontSize: FONT.small, fontWeight: 600, color: theme.colorText }}>
          Elegí una conversación para retomar ({entries.length})
        </span>
        <button type="button" aria-label="Cancelar" style={{ ...buttonIcon(theme), padding: 3 }} onClick={onDismiss}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {entries.map((entry, index) => {
          const firstUserTurn = entry.history.find(turn => turn.role === 'user');
          return (
            <button
              key={entry.conversationKey}
              type="button"
              onClick={() => onPick(entry)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                textAlign: 'left',
                padding: '7px 10px',
                border: 'none',
                borderBottom: index < entries.length - 1 ? `1px solid ${theme.colorBorderSecondary}` : 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: FONT.small, fontWeight: 600, color: theme.colorTextSecondary }}>#{index + 1}</span>
                <span style={{ fontSize: FONT.small, color: theme.colorTextSecondary }}>{formatRelativeTime(entry.updatedAt)}</span>
                <span style={{ fontSize: FONT.small, color: theme.colorTextSecondary }}>
                  · {entry.history.length} {entry.history.length === 1 ? 'mensaje' : 'mensajes'}
                </span>
              </span>
              {firstUserTurn && (
                <span
                  style={{
                    fontSize: FONT.base,
                    color: theme.colorText,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {firstUserTurn.text}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Aviso persistente tras un "Aplicar" — sobrevive a la recarga completa
 * que dispara aplicar (`exploreUndo.ts`, `sessionStorage`), así que se lee
 * recién al montar, no como parte del estado normal del chat. */
function ExploreUndoBanner({ sliceId, formDataKey }: { sliceId: number | null; formDataKey: string | undefined }): React.ReactElement | null {
  const theme = themeNs.useTheme();
  const [undo, setUndo] = useState(() => readPendingUndo(sliceId, formDataKey));
  const [busy, setBusy] = useState(false);

  if (!undo) return null;

  const handleUndo = (): void => {
    setBusy(true);
    clearPendingUndo();
    window.location.assign(buildExploreReloadUrl(undo.previousFormDataKey, undo.sliceId));
  };

  return (
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
        Aplicado: <strong>{undo.title}</strong>
      </span>
      <button type="button" disabled={busy} style={{ ...buttonIcon(theme), width: 'auto', padding: '3px 8px' }} onClick={handleUndo}>
        {busy ? 'Deshaciendo…' : 'Deshacer'}
      </button>
      <button
        type="button"
        aria-label="Ocultar aviso de cambio aplicado"
        style={{ ...buttonIcon(theme), padding: 3 }}
        onClick={() => {
          clearPendingUndo();
          setUndo(undefined);
        }}
      >
        <Icon name="close" size={12} />
      </button>
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

/** Solo lo que necesita el banner de "Deshacer" para saber si la entrada
 * guardada corresponde al gráfico/estado que se está viendo AHORA — se
 * actualiza con el mismo `onExploreContextChanged` que ya escucha el resto
 * del panel, no uno nuevo. */
function useCurrentExploreLocation(): { sliceId: number | null; formDataKey: string | undefined } {
  const parse = (): { sliceId: number | null; formDataKey: string | undefined } => {
    const { sliceId, formDataKey } = parseExploreLocation(window.location.search);
    return { sliceId: sliceId ?? null, formDataKey };
  };
  const [location, setLocation] = useState(parse);

  React.useEffect(() => {
    const sub = onExploreContextChanged(kind => {
      if (kind === 'location') setLocation(parse());
    });
    return () => sub.dispose();
  }, []);

  return location;
}

const EXPLORE_MODES: readonly ExploreMode[] = ['explain', 'improve_chart', 'metrics'];

export function ExploreAssistantPanel(): React.ReactElement {
  const theme = themeNs.useTheme();
  const fidelity = useQueryFidelity();
  const currentLocation = useCurrentExploreLocation();
  // Calculado UNA sola vez al montar (el `useState` de abajo nunca vuelve
  // a leerlo) — si el aviso de "Deshacer" sigue vigente para este mismo
  // gráfico/key, la conversación que lo generó se restaura con él; si no
  // hay nada pendiente o no corresponde, arranca vacía como siempre.
  const [pendingUndoAtMount] = useState(() => readPendingUndo(currentLocation.sliceId, currentLocation.formDataKey));
  const restoredConversation = pendingUndoAtMount?.conversation;
  const [mode, setMode] = useState<ExploreMode>(() =>
    restoredConversation && EXPLORE_MODES.includes(restoredConversation.mode as ExploreMode) ? (restoredConversation.mode as ExploreMode) : 'explain',
  );
  const [userMessage, setUserMessage] = useState('');
  const [history, setHistory] = useState<ConversationMessage[]>(() => restoredConversation?.history ?? []);
  const [sending, setSending] = useState(false);
  const [progressSteps, setProgressSteps] = useState<string[]>([]);
  const [response, setResponse] = useState<ExploreAssistantResponse | undefined>();
  const [conversationKey, setConversationKey] = useState<string>(() => restoredConversation?.conversationKey ?? createConversationKey());
  const [sessionId, setSessionId] = useState<string | undefined>(() => restoredConversation?.sessionId);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const sendStartRef = useRef<number | null>(null);
  const pendingRequestRef = useRef<AbortController | null>(null);
  // Espejo de `history` sin re-crear `handleSend` en cada mensaje — se lee
  // al INICIO de un envío (antes de que ese mismo turno lo actualice), así
  // que siempre refleja el historial previo al turno que se está armando.
  const historyRef = useRef<ConversationMessage[]>(history);
  React.useEffect(() => {
    historyRef.current = history;
  }, [history]);

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
      const baseHistory = historyRef.current;
      const userTurn: ConversationMessage = { role: 'user', text };
      setSending(true);
      setProgressSteps([]);
      sendStartRef.current = Date.now();
      setElapsedSeconds(0);
      setHistory(prev => [...prev, userTurn]);
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
        const assistantTurn: ConversationMessage = { role: 'assistant', text: result.message };
        setHistory(prev => [...prev, assistantTurn]);
        const resolvedSessionId = result.session_id ?? sessionId;
        if (result.session_id) setSessionId(result.session_id);
        // Para /resume — solo turnos que sí terminaron en una respuesta real
        // (ni error ni abortado); ver hosts/exploreConversationHistory.ts.
        recordConversationEntry(currentLocation.sliceId, {
          conversationKey,
          sessionId: resolvedSessionId,
          mode,
          history: [...baseHistory, userTurn, assistantTurn],
        });
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
    [mode, userMessage, conversationKey, sessionId, currentLocation.sliceId],
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
    setResumeCandidates(null);
    setCommandNotice(undefined);
  }, []);

  // /resume: candidatas a elegir cuando hay más de una conversación
  // guardada para este gráfico (null = no se está mostrando el picker).
  const [resumeCandidates, setResumeCandidates] = useState<PersistedConversationEntry[] | null>(null);
  const [commandNotice, setCommandNotice] = useState<string | undefined>(undefined);

  // Reenvía el MISMO conversation_key de la entrada elegida — el backend
  // deriva el mismo session_id (usuario + key) y rehidrata el historial
  // desde su almacén persistente si ya salió de la caché en memoria
  // (confirmado por el backend del chat, 2026-09-28). El texto visible acá
  // es el que este mismo navegador guardó en su momento, no algo que se le
  // pida de vuelta al backend.
  const applyConversationEntry = useCallback((entry: PersistedConversationEntry) => {
    pendingRequestRef.current?.abort();
    setSending(false);
    setProgressSteps([]);
    sendStartRef.current = null;
    setElapsedSeconds(0);
    setUserMessage('');
    setResponse(undefined);
    setMode(EXPLORE_MODES.includes(entry.mode as ExploreMode) ? (entry.mode as ExploreMode) : 'explain');
    setHistory(entry.history);
    setConversationKey(entry.conversationKey);
    setSessionId(entry.sessionId);
    setResumeCandidates(null);
    setCommandNotice(undefined);
  }, []);

  const handleCommand = useCallback(
    (name: string, args: string) => {
      setCommandNotice(undefined);
      if (name === 'clear') {
        handleNewSession();
        return;
      }
      if (name === 'resume') {
        if (currentLocation.sliceId === null) {
          setCommandNotice('Este gráfico todavía no está guardado — no hay conversaciones anteriores para retomar.');
          return;
        }
        const entries = listConversationEntries(currentLocation.sliceId);
        if (entries.length === 0) {
          setCommandNotice('No hay conversaciones anteriores guardadas para este gráfico, en este navegador.');
          return;
        }
        const index = Number.parseInt(args, 10);
        if (args && Number.isInteger(index)) {
          const picked = entries[index - 1];
          if (!picked) {
            setCommandNotice(`No hay una conversación #${args} — hay ${entries.length} guardada(s). Probá "/resume" sin número para elegir de una lista.`);
            return;
          }
          applyConversationEntry(picked);
          return;
        }
        if (entries.length === 1) {
          applyConversationEntry(entries[0]);
          return;
        }
        setResumeCandidates(entries);
        return;
      }
      setCommandNotice(`Comando "/${name}" no reconocido.`);
    },
    [currentLocation.sliceId, handleNewSession, applyConversationEntry],
  );

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

  // Se llama recién al confirmar un "Aplicar" (nunca antes) — así la
  // instantánea guardada para el reload es la conversación tal como quedó
  // en ese momento, no una capturada al abrir la tarjeta.
  const snapshotConversation = useCallback(
    (): PersistedConversationSnapshot => ({ conversationKey, sessionId, mode, history }),
    [conversationKey, sessionId, mode, history],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <PanelHeader title="Asistente de gráficos" subtitle="Explore · último estado ejecutado" sessionId={sessionId} onNewSession={handleNewSession} />
      <ExploreUndoBanner sliceId={currentLocation.sliceId} formDataKey={currentLocation.formDataKey} />
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
        onCommand={handleCommand}
        sending={sending}
        progressSteps={progressSteps}
        elapsedSeconds={sending ? elapsedSeconds : undefined}
        diagnostics={diagnostics}
        hasProposal={actions.length > 0}
      >
        {commandNotice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 6,
              padding: '7px 10px',
              borderRadius: theme.borderRadius,
              background: theme.colorFillQuaternary ?? theme.colorBgContainer,
              border: `1px solid ${theme.colorBorderSecondary}`,
              fontSize: FONT.small,
              color: theme.colorTextSecondary,
            }}
          >
            <Icon name="info" size={13} />
            <span>{commandNotice}</span>
          </div>
        )}
        {resumeCandidates && (
          <ExploreResumePicker
            entries={resumeCandidates}
            onPick={applyConversationEntry}
            onDismiss={() => setResumeCandidates(null)}
          />
        )}
        {response?.suggestion_kind === 'clarification' && response.clarification_questions && (
          <Clarification
            clarification={{ reason: response.clarification_reason, questions: response.clarification_questions }}
            busy={sending}
            onSubmit={handleClarificationAnswer}
          />
        )}
        <ExploreActionList actions={actions} snapshotConversation={snapshotConversation} />
      </ExploreConversation>
    </div>
  );
}
