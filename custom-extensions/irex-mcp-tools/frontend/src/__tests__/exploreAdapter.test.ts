jest.mock('../hosts/exploreState', () => {
  const actual = jest.requireActual<typeof import('../hosts/exploreState')>('../hosts/exploreState');
  return { ...actual, fetchFormData: jest.fn(), fetchSavedChart: jest.fn(), resolveQueryFidelity: jest.fn() };
});
jest.mock('../adapters/exploreApplyAdapter', () => {
  const actual = jest.requireActual<typeof import('../adapters/exploreApplyAdapter')>('../adapters/exploreApplyAdapter');
  return { ...actual, postAppliedFormData: jest.fn() };
});

import { parseDatasourceRef, readExploreContext, readIsAdminHint } from '../adapters/exploreAdapter';
import { fetchFormData, fetchSavedChart, resolveQueryFidelity, type QueryFidelity } from '../hosts/exploreState';
import { postAppliedFormData } from '../adapters/exploreApplyAdapter';

function docWithBootstrap(bootstrap: unknown): Document {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById('app') as HTMLElement;
  if (bootstrap !== undefined) app.setAttribute('data-bootstrap', JSON.stringify(bootstrap));
  return document;
}

describe('readIsAdminHint — pista de rol Admin, nunca autoritativa', () => {
  test('true cuando bootstrap.user.roles tiene la clave "Admin"', () => {
    const doc = docWithBootstrap({ user: { roles: { Admin: [['can_write', 'Chart']] } } });
    expect(readIsAdminHint(doc)).toBe(true);
  });

  test('false cuando el usuario tiene otro rol pero no Admin', () => {
    const doc = docWithBootstrap({ user: { roles: { Gamma: [['can_read', 'Chart']] } } });
    expect(readIsAdminHint(doc)).toBe(false);
  });

  test('false cuando no hay data-bootstrap en #app', () => {
    const doc = docWithBootstrap(undefined);
    expect(readIsAdminHint(doc)).toBe(false);
  });

  test('false cuando #app no existe', () => {
    document.body.innerHTML = '';
    expect(readIsAdminHint(document)).toBe(false);
  });

  test('false (no revienta) cuando data-bootstrap no es JSON válido', () => {
    document.body.innerHTML = '<div id="app" data-bootstrap="{not valid json"></div>';
    expect(readIsAdminHint(document)).toBe(false);
  });

  test('false cuando user.roles no viene (bootstrap sin include_perms)', () => {
    const doc = docWithBootstrap({ user: { username: 'ana' } });
    expect(readIsAdminHint(doc)).toBe(false);
  });
});

describe('parseDatasourceRef', () => {
  test('extrae id y tipo de un datasource de tabla válido', () => {
    expect(parseDatasourceRef('11__table')).toEqual({ id: 11, type: 'table' });
  });

  test.each(['0__table', '-1__table', '11__query', '11query', 'abc__table', ''])('rechaza %s', raw => {
    expect(parseDatasourceRef(raw)).toBeUndefined();
  });
});

const fetchFormDataMock = fetchFormData as jest.MockedFunction<typeof fetchFormData>;
const fetchSavedChartMock = fetchSavedChart as jest.MockedFunction<typeof fetchSavedChart>;
const resolveQueryFidelityMock = resolveQueryFidelity as jest.MockedFunction<typeof resolveQueryFidelity>;
const postAppliedFormDataMock = postAppliedFormData as jest.MockedFunction<typeof postAppliedFormData>;

const NO_FIDELITY: QueryFidelity = { status: 'no-disponible', reason: 'sin capturar (no relevante para estos tests)' };

describe('readExploreContext — sembrar form_data_key para un gráfico guardado sin key en la URL', () => {
  beforeEach(() => {
    fetchFormDataMock.mockReset().mockResolvedValue(undefined);
    fetchSavedChartMock.mockReset();
    resolveQueryFidelityMock.mockReset().mockResolvedValue(NO_FIDELITY);
    postAppliedFormDataMock.mockReset();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  test('con slice_id y sin form_data_key, si el gráfico guardado tiene datasource válido, siembra una key nueva y la deja en la URL', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157');
    fetchSavedChartMock.mockResolvedValue({ vizType: 'table_v3', params: { datasource: '5__table', viz_type: 'table_v3' } });
    postAppliedFormDataMock.mockResolvedValue('seeded-key-1');

    const context = await readExploreContext('?slice_id=157');

    expect(context.formDataKey).toBe('seeded-key-1');
    expect(context.formData).toEqual({ datasource: '5__table', viz_type: 'table_v3' });
    expect(postAppliedFormDataMock).toHaveBeenCalledWith(5, 'table', { datasource: '5__table', viz_type: 'table_v3' }, 157, undefined);
    expect(window.location.search).toContain('form_data_key=seeded-key-1');
  });

  test('manda el tab_id de sessionStorage cuando existe (mismo id que usa el propio Explore)', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157');
    window.sessionStorage.setItem('tab_id', 'tab-xyz');
    fetchSavedChartMock.mockResolvedValue({ params: { datasource: '5__table', viz_type: 'table_v3' } });
    postAppliedFormDataMock.mockResolvedValue('seeded-key-1');

    await readExploreContext('?slice_id=157');

    expect(postAppliedFormDataMock).toHaveBeenCalledWith(5, 'table', expect.anything(), 157, 'tab-xyz');
  });

  test('sin gráfico guardado (fetchSavedChart devuelve undefined), no siembra nada', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157');
    fetchSavedChartMock.mockResolvedValue(undefined);

    const context = await readExploreContext('?slice_id=157');

    expect(context.formData).toBeUndefined();
    expect(postAppliedFormDataMock).not.toHaveBeenCalled();
  });

  test('el gráfico guardado sin datasource válido, no siembra nada', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157');
    fetchSavedChartMock.mockResolvedValue({ params: { viz_type: 'table_v3' } });

    const context = await readExploreContext('?slice_id=157');

    expect(context.formData).toBeUndefined();
    expect(postAppliedFormDataMock).not.toHaveBeenCalled();
  });

  test('si el POST de siembra falla, no rompe — formData queda undefined', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157');
    fetchSavedChartMock.mockResolvedValue({ params: { datasource: '5__table', viz_type: 'table_v3' } });
    postAppliedFormDataMock.mockRejectedValue(new Error('403'));

    const context = await readExploreContext('?slice_id=157');

    expect(context.formData).toBeUndefined();
  });

  test('sin slice_id (gráfico nunca guardado), no intenta sembrar nada', async () => {
    window.history.replaceState({}, '', '/explore/');

    const context = await readExploreContext('');

    expect(context.formData).toBeUndefined();
    expect(fetchSavedChartMock).not.toHaveBeenCalled();
  });

  test('con form_data_key que sí resuelve, no intenta sembrar (el flujo normal ya alcanza)', async () => {
    window.history.replaceState({}, '', '/explore/?slice_id=157&form_data_key=existing-key');
    fetchFormDataMock.mockResolvedValue({ datasource: '5__table', viz_type: 'table_v3' });

    const context = await readExploreContext('?slice_id=157&form_data_key=existing-key');

    expect(context.formDataKey).toBe('existing-key');
    expect(fetchSavedChartMock).not.toHaveBeenCalled();
    expect(postAppliedFormDataMock).not.toHaveBeenCalled();
  });
});
