import { createFakeTab, fakeHost } from './supersetCoreMock';
import {
  applyAction,
  ASSISTANT_EXECUTION_LIMIT,
  executeConfirmed,
  NoActiveTabError,
  readActiveContext,
} from '../adapters/sqlLabAdapter';

describe('readActiveContext', () => {
  test('lee SQL, selección y cursor de la pestaña activa', async () => {
    const tab = createFakeTab('t1', {
      value: 'SELECT a FROM t WHERE anio = 2024',
      selectedText: 'anio = 2024',
      cursor: { line: 0, column: 22 },
    });
    fakeHost.reset(tab);

    const context = await readActiveContext('review_selection', 'mejorá esto', { message: 'err', sql: 'x' });

    expect(context).toEqual({
      contractVersion: 1,
      source: 'superset_sqllab',
      mode: 'review_selection',
      userMessage: 'mejorá esto',
      lastError: { message: 'err', sql: 'x' },
      tab: { id: 't1', title: 'Pestaña t1', databaseId: 3, catalog: null, schema: 'public' },
      editor: {
        sql: 'SELECT a FROM t WHERE anio = 2024',
        selectedSql: 'anio = 2024',
        cursor: { line: 0, column: 22 },
      },
    });
  });

  test('sin pestaña activa lanza NoActiveTabError', async () => {
    fakeHost.reset(undefined);
    await expect(readActiveContext('create', '')).rejects.toBeInstanceOf(NoActiveTabError);
  });
});

describe('applyAction — nunca ejecuta, solo edita', () => {
  let tab: ReturnType<typeof createFakeTab>;
  beforeEach(() => {
    tab = createFakeTab('t1', { value: 'SELECT a FROM t WHERE anio = 2024', selectedText: 'anio = 2024' });
    fakeHost.reset(tab);
  });

  test('replace_selection reemplaza solo la selección', async () => {
    await applyAction({ type: 'replace_selection', sql: 'anio_id = 2024' });
    expect(tab.editor.insertText).toHaveBeenCalledWith('anio_id = 2024');
    expect(tab.editor.state.value).toBe('SELECT a FROM t WHERE anio_id = 2024');
  });

  test('replace_document reemplaza el documento completo', async () => {
    await applyAction({ type: 'replace_document', sql: 'SELECT 1' });
    expect(tab.editor.setValue).toHaveBeenCalledWith('SELECT 1');
  });

  test('create_tab crea una pestaña nueva sin tocar la activa', async () => {
    await applyAction({ type: 'create_tab', sql: 'SELECT 2', title: 'Nueva' });
    expect(fakeHost.createTab).toHaveBeenCalledWith({ sql: 'SELECT 2', title: 'Nueva' });
    expect(tab.editor.setValue).not.toHaveBeenCalled();
    expect(tab.editor.insertText).not.toHaveBeenCalled();
  });

  test.each(['propose_sql', 'suggest_execution'] as const)('%s no toca el editor ni ejecuta', async type => {
    const action =
      type === 'propose_sql'
        ? { type, target: 'document' as const, sql: 'SELECT 1', title: 't' }
        : { type, sql: 'SELECT 1' };
    await applyAction(action);
    expect(tab.editor.setValue).not.toHaveBeenCalled();
    expect(fakeHost.executeQuery).not.toHaveBeenCalled();
  });
});

describe('executeConfirmed', () => {
  test('pasa el SQL exacto y el límite conservador del asistente', async () => {
    fakeHost.reset(createFakeTab('t1'));
    const queryId = await executeConfirmed('SELECT * FROM grande');
    expect(fakeHost.executeQuery).toHaveBeenCalledWith({ sql: 'SELECT * FROM grande', limit: 1000 });
    expect(ASSISTANT_EXECUTION_LIMIT).toBe(1000);
    expect(queryId).toBe('q-1');
  });
});
