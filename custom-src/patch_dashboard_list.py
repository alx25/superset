#!/usr/bin/env python3
"""
Parche para src/pages/DashboardList/index.tsx
Integra FavoritesBanner (barra de favoritos) y DashboardTagSidebar (filtro por tags).
"""
import sys

if len(sys.argv) < 2:
    print('Uso: patch_dashboard_list.py <ruta/DashboardList/index.tsx>')
    sys.exit(1)

f = sys.argv[1]
with open(f) as fh:
    content = fh.read()

if 'FavoritesBanner' in content:
    print('  [skip] DashboardList/index.tsx ya parcheado')
    sys.exit(0)

changed = []

# ── Patch A: agregar imports ─────────────────────────────────────────────────
OLD_ROUTER_IMPORT = "import { Link } from 'react-router-dom';"
NEW_ROUTER_IMPORT = (
    "import { Link, useHistory, useLocation } from 'react-router-dom';\n"
    "import FavoritesBanner from 'src/features/dashboards/FavoritesBanner';\n"
    "import DashboardTagSidebar from 'src/features/dashboards/DashboardTagSidebar';"
)
if OLD_ROUTER_IMPORT in content:
    content = content.replace(OLD_ROUTER_IMPORT, NEW_ROUTER_IMPORT, 1)
    changed.append('A: imports')
else:
    print('  [warn] A: import de react-router-dom no encontrado, verificar manualmente')

# ── Patch B: styled components y helpers antes de `const Actions = styled.div` ──
ACTIONS_ANCHOR = 'const Actions = styled.div`'
STYLED_BLOCK = '''\
const PageLayout = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const getGridUnit = (theme: any) => theme.gridUnit ?? theme.sizeUnit ?? 4;
const getTypography = (theme: any) => theme.typography ?? {};
const getFontSize = (theme: any, sizeKey: string, fallback: number) =>
  getTypography(theme)?.sizes?.[sizeKey] ?? theme.fontSize ?? fallback;
const getFontWeight = (theme: any, weightKey: string, fallback: number) =>
  getTypography(theme)?.weights?.[weightKey] ?? fallback;

const ListArea = styled.div`
  flex: 1;
  overflow-x: hidden;
`;

const ToggleSidebarButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colorBgContainer};
  color: ${({ theme }) => theme.colorText};
  border: 1px solid ${({ theme }) => theme.colorBorderSecondary};
  border-radius: ${({ theme }) => theme.borderRadius}px;
  padding: ${({ theme }) => getGridUnit(theme)}px ${({ theme }) => getGridUnit(theme) * 2}px;
  font-size: ${({ theme }) => getFontSize(theme, 'm', 14)}px;
  font-weight: ${({ theme }) => getFontWeight(theme, 'bold', 600)};
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: ${({ theme }) => getGridUnit(theme) * 2}px;

  &:hover {
    background: ${({ theme }) => theme.colorBgTextHover};
    border-color: ${({ theme }) => theme.colorBorder};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colorPrimaryBorder};
  }
`;

''' + ACTIONS_ANCHOR

if ACTIONS_ANCHOR in content:
    content = content.replace(ACTIONS_ANCHOR, STYLED_BLOCK, 1)
    changed.append('B: styled components')
else:
    print('  [warn] B: Actions styled component no encontrado, verificar manualmente')

# ── Patch C: estado y callbacks tras initialSort ────────────────────────────
INITIAL_SORT = "  const initialSort = [{ id: 'changed_on_delta_humanized', desc: true }];"
STATE_AND_CALLBACKS = INITIAL_SORT + r"""

  const location = useLocation();
  const history = useHistory();

  // En desktop mostrar por defecto; en móvil oculto
  const [showTagSidebar, setShowTagSidebar] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1536;
    }
    return true;
  });

  const getCurrentTagId = useCallback((): number | null => {
    try {
      const params = new URLSearchParams(location.search);
      const filtersParam = params.get('filters');
      if (!filtersParam) {
        return null;
      }

      const decoded: any = rison.decode(filtersParam);

      // Formato objeto: { tags: { label, value } }
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
        const tagsFilter = (decoded as any).tags;
        if (tagsFilter && typeof tagsFilter === 'object') {
          const value = (tagsFilter as any).value;
          return value != null ? Number(value) : null;
        }
        if (tagsFilter != null) {
          return Number(tagsFilter);
        }
        return null;
      }

      // Formato array: [{ id/key: 'tags', value }]
      if (Array.isArray(decoded)) {
        const tagsFilter = decoded.find(
          (fil: any) => fil?.id === 'tags' || fil?.key === 'tags',
        );
        if (tagsFilter && tagsFilter.value != null) {
          return Number(tagsFilter.value);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }, [location.search]);

  const handleTagSelect = useCallback(
    (tagId: number | null, tagName?: string) => {
      const params = new URLSearchParams(location.search);
      const filtersParam = params.get('filters');
      let decoded: any = {};
      try {
        decoded = filtersParam ? rison.decode(filtersParam) : {};
      } catch {
        decoded = {};
      }

      const nextFilters: any =
        decoded && typeof decoded === 'object' && !Array.isArray(decoded)
          ? { ...decoded }
          : {};

      if (tagId == null) {
        delete nextFilters.tags;
      } else {
        nextFilters.tags = {
          label: tagName || String(tagId),
          value: tagId,
        };
      }

      if (!nextFilters.tags) {
        if (Object.keys(nextFilters).length === 0) {
          params.delete('filters');
        } else {
          params.set('filters', rison.encode(nextFilters));
        }
      } else {
        params.set('filters', rison.encode(nextFilters));
      }

      history.push({
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      });
    },
    [history, location.pathname, location.search],
  );"""

if INITIAL_SORT in content:
    content = content.replace(INITIAL_SORT, STATE_AND_CALLBACKS, 1)
    changed.append('C: estado showTagSidebar y callbacks')
else:
    print('  [warn] C: initialSort no encontrado, verificar manualmente')

# ── Patch D: subMenuName antes del return + actualizar SubMenu ───────────────
OLD_RETURN = """\
  return (
    <>
      <SubMenu name={t('Dashboards')} buttons={subMenuButtons} />"""

NEW_RETURN = """\
  const subMenuName =
    isFeatureEnabled(FeatureFlag.TaggingSystem) && canReadTag ? (
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <ToggleSidebarButton
          onClick={() => setShowTagSidebar(!showTagSidebar)}
          title={showTagSidebar ? t('Ocultar categorías') : t('Mostrar categorías')}
        >
          {t('Categorías')}
        </ToggleSidebarButton>
        {t('Dashboards')}
      </div>
    ) : (
      t('Dashboards')
    );

  const currentTagId = getCurrentTagId();

  return (
    <>
      <SubMenu name={subMenuName} buttons={subMenuButtons} />"""

if OLD_RETURN in content:
    content = content.replace(OLD_RETURN, NEW_RETURN, 1)
    changed.append('D: subMenuName y SubMenu')
else:
    print('  [warn] D: return header no encontrado, verificar manualmente')

# ── Patch E: envolver ListView con PageLayout/ListArea + FavoritesBanner/Sidebar ─
LISTVIEW_MARKER = '              <ListView<Dashboard>'
CONFIRM_END = '      </ConfirmStatusChange>'

start_idx = content.find(LISTVIEW_MARKER)
end_idx = content.find(CONFIRM_END, start_idx) if start_idx != -1 else -1

if start_idx != -1 and end_idx != -1:
    end_full = end_idx + len(CONFIRM_END)
    NEW_LISTVIEW_BLOCK = """\
              <PageLayout>
                {isFeatureEnabled(FeatureFlag.TaggingSystem) && canReadTag && (
                  <DashboardTagSidebar
                    visible={showTagSidebar}
                    onClose={() => setShowTagSidebar(false)}
                    selectedTagId={currentTagId}
                    onTagSelect={handleTagSelect}
                  />
                )}
                <ListArea>
                  <FavoritesBanner
                    favoriteStatus={favoriteStatus}
                    saveFavoriteStatus={saveFavoriteStatus}
                    userId={user.userId}
                    showThumbnails={
                      userKey
                        ? userKey.thumbnails
                        : isFeatureEnabled(FeatureFlag.Thumbnails)
                    }
                    bulkSelectEnabled={bulkSelectEnabled}
                    addDangerToast={addDangerToast}
                    addSuccessToast={addSuccessToast}
                    refreshData={refreshData}
                    hasPerm={hasPerm}
                    handleBulkDashboardExport={handleBulkDashboardExport}
                    onDelete={dashboard => setDashboardToDelete(dashboard)}
                  />
                  <ListView<Dashboard>
                    key={`dashboard-list-${currentTagId ?? 'all'}`}
                    bulkActions={bulkActions}
                    bulkSelectEnabled={bulkSelectEnabled}
                    cardSortSelectOptions={sortTypes}
                    className="dashboard-list-view"
                    columns={columns}
                    count={dashboardCount}
                    data={dashboards}
                    disableBulkSelect={toggleBulkSelect}
                    fetchData={fetchData}
                    refreshData={refreshData}
                    filters={filters}
                    initialSort={initialSort}
                    loading={loading}
                    pageSize={PAGE_SIZE}
                    addSuccessToast={addSuccessToast}
                    addDangerToast={addDangerToast}
                    showThumbnails={
                      userKey
                        ? userKey.thumbnails
                        : isFeatureEnabled(FeatureFlag.Thumbnails)
                    }
                    renderCard={renderCard}
                    defaultViewMode={
                      isFeatureEnabled(FeatureFlag.ListviewsDefaultCardView)
                        ? 'card'
                        : 'table'
                    }
                    enableBulkTag={enableBulkTag}
                    bulkTagResourceName="dashboard"
                  />
                </ListArea>
              </PageLayout>
            </>
          );
        }}
      </ConfirmStatusChange>"""
    content = content[:start_idx] + NEW_LISTVIEW_BLOCK + content[end_full:]
    changed.append('E: PageLayout/ListArea/FavoritesBanner/DashboardTagSidebar')
else:
    print('  [warn] E: bloque ListView o </ConfirmStatusChange> no encontrado, verificar manualmente')

with open(f, 'w') as fh:
    fh.write(content)

if changed:
    print(f'  [ok] patches aplicados: {", ".join(changed)}')
else:
    print('  [warn] ningún patch aplicado')
