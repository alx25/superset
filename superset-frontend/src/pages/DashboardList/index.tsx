/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import {
  isFeatureEnabled,
  FeatureFlag,
  styled,
  SupersetClient,
  t,
} from '@superset-ui/core';
import { useSelector } from 'react-redux';
import { useState, useMemo, useCallback } from 'react';
import { Link, useLocation, useHistory } from 'react-router-dom';
import rison from 'rison';
import {
  createFetchRelated,
  createErrorHandler,
  handleDashboardDelete,
} from 'src/views/CRUD/utils';
import { useListViewResource, useFavoriteStatus } from 'src/views/CRUD/hooks';
import ConfirmStatusChange from 'src/components/ConfirmStatusChange';
import { PublishedLabel } from 'src/components/Label';
import { TagsList } from 'src/components/Tags';
import handleResourceExport from 'src/utils/export';
import Loading from 'src/components/Loading';
import SubMenu, { SubMenuProps } from 'src/features/home/SubMenu';
import ListView, {
  ListViewProps,
  Filter,
  Filters,
  FilterOperator,
} from 'src/components/ListView';
import { dangerouslyGetItemDoNotUse } from 'src/utils/localStorageHelpers';
import Owner from 'src/types/Owner';
import Tag from 'src/types/TagType';
import withToasts from 'src/components/MessageToasts/withToasts';
import FacePile from 'src/components/FacePile';
import Icons from 'src/components/Icons';
import DeleteModal from 'src/components/DeleteModal';
import FaveStar from 'src/components/FaveStar';
import PropertiesModal from 'src/dashboard/components/PropertiesModal';
import { Tooltip } from 'src/components/Tooltip';
import ImportModelsModal from 'src/components/ImportModal/index';
import DashboardTagSidebar from 'src/features/dashboards/DashboardTagSidebar';

import Dashboard from 'src/dashboard/containers/Dashboard';
import {
  Dashboard as CRUDDashboard,
  QueryObjectColumns,
} from 'src/views/CRUD/types';
import CertifiedBadge from 'src/components/CertifiedBadge';
import { loadTags } from 'src/components/Tags/utils';
import DashboardCard from 'src/features/dashboards/DashboardCard';
import { DashboardStatus } from 'src/features/dashboards/types';
import { UserWithPermissionsAndRoles } from 'src/types/bootstrapTypes';
import { findPermission } from 'src/utils/findPermission';
import { ModifiedInfo } from 'src/components/AuditInfo';

const PAGE_SIZE = 25;
const PASSWORDS_NEEDED_MESSAGE = t(
  'The passwords for the databases below are needed in order to ' +
    'import them together with the dashboards. Please note that the ' +
    '"Secure Extra" and "Certificate" sections of ' +
    'the database configuration are not present in export files, and ' +
    'should be added manually after the import if they are needed.',
);
const CONFIRM_OVERWRITE_MESSAGE = t(
  'You are importing one or more dashboards that already exist. ' +
    'Overwriting might cause you to lose some of your work. Are you ' +
    'sure you want to overwrite?',
);

interface DashboardListProps {
  addDangerToast: (msg: string) => void;
  addSuccessToast: (msg: string) => void;
  user: {
    userId: string | number;
    firstName: string;
    lastName: string;
  };
}

export interface Dashboard {
  changed_by_name: string;
  changed_on_delta_humanized: string;
  changed_by: string;
  dashboard_title: string;
  id: number;
  published: boolean;
  url: string;
  thumbnail_url: string;
  owners: Owner[];
  tags: Tag[];
  created_by: object;
}

const Actions = styled.div`
  color: ${({ theme }) => theme.colors.grayscale.base};
`;

const PageLayout = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
`;

const ListArea = styled.div`
  flex: 1;
  overflow-x: hidden;
`;

const ToggleSidebarButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.primary.base};
  color: white;
  border: none;
  border-radius: ${({ theme }) => theme.borderRadius}px;
  padding: ${({ theme }) => theme.gridUnit * 1.5}px
    ${({ theme }) => theme.gridUnit * 3}px;
  font-size: ${({ theme }) => theme.typography.sizes.l}px;
  font-weight: ${({ theme }) => theme.typography.weights.medium};
  cursor: pointer;
  transition: all 0.2s ease;
  margin-right: ${({ theme }) => theme.gridUnit * 3}px;
  min-width: ${({ theme }) => theme.gridUnit * 10}px;
  height: ${({ theme }) => theme.gridUnit * 10}px;

  &:hover {
    background: ${({ theme }) => theme.colors.primary.dark1};
    transform: scale(1.05);
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.primary.light3};
  }
`;

const DASHBOARD_COLUMNS_TO_FETCH = [
  'id',
  'dashboard_title',
  'published',
  'url',
  'slug',
  'changed_by',
  'changed_by.id',
  'changed_by.first_name',
  'changed_by.last_name',
  'changed_on_delta_humanized',
  'owners',
  'owners.id',
  'owners.first_name',
  'owners.last_name',
  'tags.id',
  'tags.name',
  'tags.type',
  'status',
  'certified_by',
  'certification_details',
  'changed_on',
];

function DashboardList(props: DashboardListProps) {
  const { addDangerToast, addSuccessToast, user } = props;
  const location = useLocation();
  const history = useHistory();

  const { roles } = useSelector<any, UserWithPermissionsAndRoles>(
    state => state.user,
  );
  const canReadTag = findPermission('can_read', 'Tag', roles);

  // Estado para controlar la visibilidad del panel de tags
  const [showTagSidebar, setShowTagSidebar] = useState(() => {
    // En desktop, mostrar por defecto. En móvil, oculto por defecto
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1536; // 192 * 8px grid unit
    }
    return true;
  });

  // Obtener el tagId actual desde la URL
  const getCurrentTagId = useCallback((): number | null => {
    try {
      const params = new URLSearchParams(location.search);
      const filtersParam = params.get('filters');
      
      if (filtersParam) {
        const decodedFilters = rison.decode(filtersParam);
        
        // Los filtros pueden venir como array o como objeto
        let filters: any[] = [];
        if (Array.isArray(decodedFilters)) {
          filters = decodedFilters;
        } else if (typeof decodedFilters === 'object' && decodedFilters !== null) {
          // Si es un objeto, buscar directamente la propiedad 'tags'
          const filtersObj = decodedFilters as any;
          if (filtersObj.tags !== undefined) {
            // El formato oficial es: {tags: {label: '...', value: 9}}
            if (typeof filtersObj.tags === 'object' && filtersObj.tags.value !== undefined) {
              return Number(filtersObj.tags.value);
            }
            // Formato alternativo: solo el valor
            return Number(filtersObj.tags);
          }
          // Convertir objeto a array de filtros
          filters = Object.entries(decodedFilters).map(([key, value]) => ({
            id: key,
            key,
            value,
          }));
        }
        
        const tagsFilter = filters?.find((f: any) => f.id === 'tags' || f.key === 'tags');
        
        if (tagsFilter && tagsFilter.value !== undefined) {
          return Number(tagsFilter.value);
        }
      }
    } catch (error) {
      console.error('Error parsing tag filter from URL:', error);
    }
    return null;
  }, [location.search]);

  const {
    state: {
      loading,
      resourceCount: dashboardCount,
      resourceCollection: dashboards,
      bulkSelectEnabled,
    },
    setResourceCollection: setDashboards,
    hasPerm,
    fetchData,
    toggleBulkSelect,
    refreshData,
  } = useListViewResource<Dashboard>(
    'dashboard',
    t('dashboard'),
    addDangerToast,
    undefined,
    undefined,
    undefined,
    undefined,
    DASHBOARD_COLUMNS_TO_FETCH,
  );

  // Actualizar el filtro de tags en la URL (después de useListViewResource para tener acceso a fetchData)
  const handleTagSelect = useCallback(
    (tagId: number | null, tagName?: string) => {
      const params = new URLSearchParams(location.search);
      const filtersParam = params.get('filters');

      try {
        let filters: any = filtersParam ? rison.decode(filtersParam) : {};
        
        // Asegurarse de que filters sea un objeto
        if (Array.isArray(filters)) {
          const newFilters: any = {};
          filters.forEach((f: any) => {
            if (f.id && f.id !== 'tags') {
              newFilters[f.id] = f.value;
            }
          });
          filters = newFilters;
        }
        
        // Actualizar el filtro de tags
        if (tagId !== null) {
          // Usar el nombre del tag si está disponible
          filters.tags = {
            label: tagName || `Tag ${tagId}`,
            value: tagId,
          };
        } else {
          delete filters.tags;
        }
        
        // Actualizar parámetros de URL
        if (Object.keys(filters).length > 0) {
          params.set('filters', rison.encode(filters));
        } else {
          params.delete('filters');
        }
        
        // Resetear a página 1 cuando cambia el filtro
        params.set('pageIndex', '0');
        
        const newSearch = params.toString();
        
        // Actualizar la URL sin recargar la página
        history.push({
          pathname: location.pathname,
          search: newSearch,
        });
      } catch (error) {
        console.error('Error updating tag filter:', error);
      }
    },
    [location.pathname, location.search, history],
  );
  
  const dashboardIds = useMemo(() => dashboards.map(d => d.id), [dashboards]);
  const [saveFavoriteStatus, favoriteStatus] = useFavoriteStatus(
    'dashboard',
    dashboardIds,
    addDangerToast,
  );

  const [dashboardToEdit, setDashboardToEdit] = useState<Dashboard | null>(
    null,
  );
  const [dashboardToDelete, setDashboardToDelete] =
    useState<CRUDDashboard | null>(null);

  const [importingDashboard, showImportModal] = useState<boolean>(false);
  const [passwordFields, setPasswordFields] = useState<string[]>([]);
  const [preparingExport, setPreparingExport] = useState<boolean>(false);
  const [sshTunnelPasswordFields, setSSHTunnelPasswordFields] = useState<
    string[]
  >([]);
  const [sshTunnelPrivateKeyFields, setSSHTunnelPrivateKeyFields] = useState<
    string[]
  >([]);
  const [
    sshTunnelPrivateKeyPasswordFields,
    setSSHTunnelPrivateKeyPasswordFields,
  ] = useState<string[]>([]);

  const openDashboardImportModal = () => {
    showImportModal(true);
  };

  const closeDashboardImportModal = () => {
    showImportModal(false);
  };

  const handleDashboardImport = () => {
    showImportModal(false);
    refreshData();
    addSuccessToast(t('Dashboard imported'));
  };

  // TODO: Fix usage of localStorage keying on the user id
  const userKey = dangerouslyGetItemDoNotUse(user?.userId?.toString(), null);

  const canCreate = hasPerm('can_write');
  const canEdit = hasPerm('can_write');
  const canDelete = hasPerm('can_write');
  const canExport = hasPerm('can_export');

  const initialSort = [{ id: 'changed_on_delta_humanized', desc: true }];

  function openDashboardEditModal(dashboard: Dashboard) {
    setDashboardToEdit(dashboard);
  }

  function handleDashboardEdit(edits: Dashboard) {
    return SupersetClient.get({
      endpoint: `/api/v1/dashboard/${edits.id}`,
    }).then(
      ({ json = {} }) => {
        setDashboards(
          dashboards.map(dashboard => {
            if (dashboard.id === json?.result?.id) {
              const {
                changed_by_name,
                changed_by,
                dashboard_title = '',
                slug = '',
                json_metadata = '',
                changed_on_delta_humanized,
                url = '',
                certified_by = '',
                certification_details = '',
                owners,
                tags,
              } = json.result;
              return {
                ...dashboard,
                changed_by_name,
                changed_by,
                dashboard_title,
                slug,
                json_metadata,
                changed_on_delta_humanized,
                url,
                certified_by,
                certification_details,
                owners,
                tags,
              };
            }
            return dashboard;
          }),
        );
      },
      createErrorHandler(errMsg =>
        addDangerToast(
          t('An error occurred while fetching dashboards: %s', errMsg),
        ),
      ),
    );
  }

  const handleBulkDashboardExport = (dashboardsToExport: Dashboard[]) => {
    const ids = dashboardsToExport.map(({ id }) => id);
    handleResourceExport('dashboard', ids, () => {
      setPreparingExport(false);
    });
    setPreparingExport(true);
  };

  function handleBulkDashboardDelete(dashboardsToDelete: Dashboard[]) {
    return SupersetClient.delete({
      endpoint: `/api/v1/dashboard/?q=${rison.encode(
        dashboardsToDelete.map(({ id }) => id),
      )}`,
    }).then(
      ({ json = {} }) => {
        refreshData();
        addSuccessToast(json.message);
      },
      createErrorHandler(errMsg =>
        addDangerToast(
          t('There was an issue deleting the selected dashboards: ', errMsg),
        ),
      ),
    );
  }

  const columns = useMemo(
    () => [
      {
        Cell: ({
          row: {
            original: { id },
          },
        }: any) =>
          user?.userId && (
            <FaveStar
              itemId={id}
              saveFaveStar={saveFavoriteStatus}
              isStarred={favoriteStatus[id]}
            />
          ),
        Header: '',
        id: 'id',
        disableSortBy: true,
        size: 'xs',
        hidden: !user?.userId,
      },
      {
        Cell: ({
          row: {
            original: {
              url,
              dashboard_title: dashboardTitle,
              certified_by: certifiedBy,
              certification_details: certificationDetails,
            },
          },
        }: any) => (
          <Link to={url}>
            {certifiedBy && (
              <>
                <CertifiedBadge
                  certifiedBy={certifiedBy}
                  details={certificationDetails}
                />{' '}
              </>
            )}
            {dashboardTitle}
          </Link>
        ),
        Header: t('Name'),
        accessor: 'dashboard_title',
      },
      {
        Cell: ({
          row: {
            original: { status },
          },
        }: any) => (
          <PublishedLabel isPublished={status === DashboardStatus.PUBLISHED} />
        ),
        Header: t('Status'),
        accessor: 'published',
        size: 'xl',
      },
      {
        Cell: ({
          row: {
            original: { tags = [] },
          },
        }: {
          row: {
            original: {
              tags: Tag[];
            };
          };
        }) => (
          // Only show custom type tags
          <TagsList
            tags={tags.filter(
              (tag: Tag) => tag.type === 'TagTypes.custom' || tag.type === 1,
            )}
            maxTags={3}
          />
        ),
        Header: t('Tags'),
        accessor: 'tags',
        disableSortBy: true,
        hidden: !isFeatureEnabled(FeatureFlag.TaggingSystem),
      },
      {
        Cell: ({
          row: {
            original: { owners = [] },
          },
        }: any) => <FacePile users={owners} />,
        Header: t('Owners'),
        accessor: 'owners',
        disableSortBy: true,
        size: 'xl',
      },
      {
        Cell: ({
          row: {
            original: {
              changed_on_delta_humanized: changedOn,
              changed_by: changedBy,
            },
          },
        }: any) => <ModifiedInfo date={changedOn} user={changedBy} />,
        Header: t('Last modified'),
        accessor: 'changed_on_delta_humanized',
        size: 'xl',
      },
      {
        Cell: ({ row: { original } }: any) => {
          const handleDelete = () =>
            handleDashboardDelete(
              original,
              refreshData,
              addSuccessToast,
              addDangerToast,
            );
          const handleEdit = () => openDashboardEditModal(original);
          const handleExport = () => handleBulkDashboardExport([original]);

          return (
            <Actions className="actions">
              {canDelete && (
                <ConfirmStatusChange
                  title={t('Please confirm')}
                  description={
                    <>
                      {t('Are you sure you want to delete')}{' '}
                      <b>{original.dashboard_title}</b>?
                    </>
                  }
                  onConfirm={handleDelete}
                >
                  {confirmDelete => (
                    <Tooltip
                      id="delete-action-tooltip"
                      title={t('Delete')}
                      placement="bottom"
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        className="action-button"
                        onClick={confirmDelete}
                      >
                        <Icons.Trash data-test="dashboard-list-trash-icon" />
                      </span>
                    </Tooltip>
                  )}
                </ConfirmStatusChange>
              )}
              {canExport && (
                <Tooltip
                  id="export-action-tooltip"
                  title={t('Export')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleExport}
                  >
                    <Icons.Share />
                  </span>
                </Tooltip>
              )}
              {canEdit && (
                <Tooltip
                  id="edit-action-tooltip"
                  title={t('Edit')}
                  placement="bottom"
                >
                  <span
                    role="button"
                    tabIndex={0}
                    className="action-button"
                    onClick={handleEdit}
                  >
                    <Icons.EditAlt data-test="edit-alt" />
                  </span>
                </Tooltip>
              )}
            </Actions>
          );
        },
        Header: t('Actions'),
        id: 'actions',
        hidden: !canEdit && !canDelete && !canExport,
        disableSortBy: true,
      },
      {
        accessor: QueryObjectColumns.ChangedBy,
        hidden: true,
      },
    ],
    [
      user?.userId,
      canEdit,
      canDelete,
      canExport,
      saveFavoriteStatus,
      favoriteStatus,
      refreshData,
      addSuccessToast,
      addDangerToast,
    ],
  );

  const favoritesFilter: Filter = useMemo(
    () => ({
      Header: t('Favorite'),
      key: 'favorite',
      id: 'id',
      urlDisplay: 'favorite',
      input: 'select',
      operator: FilterOperator.DashboardIsFav,
      unfilteredLabel: t('Any'),
      selects: [
        { label: t('Yes'), value: true },
        { label: t('No'), value: false },
      ],
    }),
    [],
  );

  const filters: Filters = useMemo(() => {
    const filters_list = [
      {
        Header: t('Name'),
        key: 'search',
        id: 'dashboard_title',
        input: 'search',
        operator: FilterOperator.TitleOrSlug,
      },
      {
        Header: t('Status'),
        key: 'published',
        id: 'published',
        input: 'select',
        operator: FilterOperator.Equals,
        unfilteredLabel: t('Any'),
        selects: [
          { label: t('Published'), value: true },
          { label: t('Draft'), value: false },
        ],
      },
      ...(isFeatureEnabled(FeatureFlag.TaggingSystem) && canReadTag
        ? [
            {
              Header: 'Categoría',
              key: 'tags',
              id: 'tags',
              input: 'select',
              operator: FilterOperator.DashboardTagById,
              unfilteredLabel: 'Todas',
              fetchSelects: loadTags,
            },
          ]
        : []),
      {
        Header: t('Owner'),
        key: 'owner',
        id: 'owners',
        input: 'select',
        operator: FilterOperator.RelationManyMany,
        unfilteredLabel: t('All'),
        fetchSelects: createFetchRelated(
          'dashboard',
          'owners',
          createErrorHandler(errMsg =>
            addDangerToast(
              t(
                'An error occurred while fetching dashboard owner values: %s',
                errMsg,
              ),
            ),
          ),
          props.user,
        ),
        paginate: true,
      },
      ...(user?.userId ? [favoritesFilter] : []),
      {
        Header: t('Certified'),
        key: 'certified',
        id: 'id',
        urlDisplay: 'certified',
        input: 'select',
        operator: FilterOperator.DashboardIsCertified,
        unfilteredLabel: t('Any'),
        selects: [
          { label: t('Yes'), value: true },
          { label: t('No'), value: false },
        ],
      },
      {
        Header: t('Modified by'),
        key: 'changed_by',
        id: 'changed_by',
        input: 'select',
        operator: FilterOperator.RelationOneMany,
        unfilteredLabel: t('All'),
        fetchSelects: createFetchRelated(
          'dashboard',
          'changed_by',
          createErrorHandler(errMsg =>
            t(
              'An error occurred while fetching dataset datasource values: %s',
              errMsg,
            ),
          ),
          user,
        ),
        paginate: true,
      },
    ] as Filters;
    return filters_list;
  }, [addDangerToast, favoritesFilter, props.user]);

  const sortTypes = [
    {
      desc: false,
      id: 'dashboard_title',
      label: t('Alphabetical'),
      value: 'alphabetical',
    },
    {
      desc: true,
      id: 'changed_on_delta_humanized',
      label: t('Recently modified'),
      value: 'recently_modified',
    },
    {
      desc: false,
      id: 'changed_on_delta_humanized',
      label: t('Least recently modified'),
      value: 'least_recently_modified',
    },
  ];

  const renderCard = useCallback(
    (dashboard: Dashboard) => (
      <DashboardCard
        dashboard={dashboard}
        hasPerm={hasPerm}
        bulkSelectEnabled={bulkSelectEnabled}
        showThumbnails={
          userKey
            ? userKey.thumbnails
            : isFeatureEnabled(FeatureFlag.Thumbnails)
        }
        userId={user?.userId}
        loading={loading}
        openDashboardEditModal={openDashboardEditModal}
        saveFavoriteStatus={saveFavoriteStatus}
        favoriteStatus={favoriteStatus[dashboard.id]}
        handleBulkDashboardExport={handleBulkDashboardExport}
        onDelete={dashboard => setDashboardToDelete(dashboard)}
      />
    ),
    [
      bulkSelectEnabled,
      favoriteStatus,
      hasPerm,
      loading,
      user?.userId,
      saveFavoriteStatus,
      userKey,
    ],
  );

  const subMenuButtons: SubMenuProps['buttons'] = [];
  
  if (canDelete || canExport) {
    subMenuButtons.push({
      name: t('Bulk select'),
      buttonStyle: 'secondary',
      'data-test': 'bulk-select',
      onClick: toggleBulkSelect,
    });
  }
  if (canCreate) {
    subMenuButtons.push({
      name: (
        <>
          <i className="fa fa-plus" /> {t('Dashboard')}
        </>
      ),
      buttonStyle: 'primary',
      onClick: () => {
        window.location.assign('/dashboard/new');
      },
    });

    subMenuButtons.push({
      name: (
        <Tooltip
          id="import-tooltip"
          title={t('Import dashboards')}
          placement="bottomRight"
        >
          <Icons.Import data-test="import-button" />
        </Tooltip>
      ),
      buttonStyle: 'link',
      onClick: openDashboardImportModal,
    });
  }
  
  // Crear el nombre del SubMenu con el botón de toggle a la izquierda
  const subMenuName = isFeatureEnabled(FeatureFlag.TaggingSystem) && canReadTag ? (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <ToggleSidebarButton 
        onClick={() => setShowTagSidebar(!showTagSidebar)}
        title={showTagSidebar ? 'Ocultar categorías' : 'Mostrar categorías'}
      >
        📂
      </ToggleSidebarButton>
      {t('Dashboards')}
    </div>
  ) : t('Dashboards');
  
  return (
    <>
      <SubMenu name={subMenuName} buttons={subMenuButtons} />
      <ConfirmStatusChange
        title={t('Please confirm')}
        description={t(
          'Are you sure you want to delete the selected dashboards?',
        )}
        onConfirm={handleBulkDashboardDelete}
      >
        {confirmDelete => {
          const enableBulkTag = isFeatureEnabled(FeatureFlag.TaggingSystem);
          const bulkActions: ListViewProps['bulkActions'] = [];
          if (canDelete) {
            bulkActions.push({
              key: 'delete',
              name: t('Delete'),
              type: 'danger',
              onSelect: confirmDelete,
            });
          }
          if (canExport) {
            bulkActions.push({
              key: 'export',
              name: t('Export'),
              type: 'primary',
              onSelect: handleBulkDashboardExport,
            });
          }
          return (
            <>
              {dashboardToEdit && (
                <PropertiesModal
                  dashboardId={dashboardToEdit.id}
                  show
                  onHide={() => setDashboardToEdit(null)}
                  onSubmit={handleDashboardEdit}
                />
              )}
              {dashboardToDelete && (
                <DeleteModal
                  description={
                    <>
                      {t('Are you sure you want to delete')}{' '}
                      <b>{dashboardToDelete.dashboard_title}</b>?
                    </>
                  }
                  onConfirm={() => {
                    handleDashboardDelete(
                      dashboardToDelete,
                      refreshData,
                      addSuccessToast,
                      addDangerToast,
                      undefined,
                      user?.userId,
                    );
                    setDashboardToDelete(null);
                  }}
                  onHide={() => setDashboardToDelete(null)}
                  open={!!dashboardToDelete}
                  title={t('Please confirm')}
                />
              )}
              <PageLayout>
                {isFeatureEnabled(FeatureFlag.TaggingSystem) && canReadTag && (
                  <DashboardTagSidebar
                    visible={showTagSidebar}
                    onClose={() => setShowTagSidebar(false)}
                    selectedTagId={getCurrentTagId()}
                    onTagSelect={handleTagSelect}
                  />
                )}
                <ListArea>
                  <ListView<Dashboard>
                    key={`dashboard-list-${getCurrentTagId() || 'all'}`}
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
      </ConfirmStatusChange>

      <ImportModelsModal
        resourceName="dashboard"
        resourceLabel={t('dashboard')}
        passwordsNeededMessage={PASSWORDS_NEEDED_MESSAGE}
        confirmOverwriteMessage={CONFIRM_OVERWRITE_MESSAGE}
        addDangerToast={addDangerToast}
        addSuccessToast={addSuccessToast}
        onModelImport={handleDashboardImport}
        show={importingDashboard}
        onHide={closeDashboardImportModal}
        passwordFields={passwordFields}
        setPasswordFields={setPasswordFields}
        sshTunnelPasswordFields={sshTunnelPasswordFields}
        setSSHTunnelPasswordFields={setSSHTunnelPasswordFields}
        sshTunnelPrivateKeyFields={sshTunnelPrivateKeyFields}
        setSSHTunnelPrivateKeyFields={setSSHTunnelPrivateKeyFields}
        sshTunnelPrivateKeyPasswordFields={sshTunnelPrivateKeyPasswordFields}
        setSSHTunnelPrivateKeyPasswordFields={
          setSSHTunnelPrivateKeyPasswordFields
        }
      />

      {preparingExport && <Loading />}
    </>
  );
}

export default withToasts(DashboardList);
