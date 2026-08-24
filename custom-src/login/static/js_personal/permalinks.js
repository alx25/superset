const CUSTOM_API_BASE = 'http://192.168.76.11:5000';
const permalinkStateCache = new Map();
const dashboardFilterNamesCache = new Map();

function getNativeFiltersKey() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('native_filters_key');
}

function getPermalinkKey(permalinkUrl) {
    if (!permalinkUrl) {
        return null;
    }

    const match = permalinkUrl.match(/\/dashboard\/p\/([^/?#]+)/);
    return match?.[1] || null;
}

async function copyTextToClipboard(text) {
    if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } finally {
        document.body.removeChild(textArea);
    }

    if (!copied) {
        throw new Error('Clipboard API no disponible y execCommand falló');
    }
}

function showBookmarkToast(message, type = 'info') {
    let container = document.getElementById('bookmarkToastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bookmarkToastContainer';
        container.className = 'bookmark-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `bookmark-toast bookmark-toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    window.setTimeout(() => {
        toast.classList.remove('show');
        window.setTimeout(() => {
            toast.remove();
            if (!container.childElementCount) {
                container.remove();
            }
        }, 220);
    }, 2600);
}

function requestBookmarkName(initialValue = '') {
    return new Promise(resolve => {
        const host = document.getElementById('chatWindow') || document.body;
        const overlay = document.createElement('div');
        overlay.className = 'bookmark-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'bookmark-modal-dialog';

        const title = document.createElement('h4');
        title.className = 'bookmark-modal-title';
        title.textContent = 'Agregar marcador';

        const description = document.createElement('p');
        description.className = 'bookmark-modal-description';
        description.textContent = 'Escribe un nombre para este marcador.';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'bookmark-modal-input';
        input.maxLength = 120;
        input.placeholder = 'Ej: Ventas enero - región norte';
        input.value = initialValue;

        const errorMessage = document.createElement('div');
        errorMessage.className = 'bookmark-modal-error';

        const actions = document.createElement('div');
        actions.className = 'bookmark-modal-actions';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'delete-button-custom bookmark-modal-cancel';
        cancelButton.textContent = 'Cancelar';

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'guardar-marcador-button bookmark-modal-save';
        saveButton.textContent = 'Agregar';

        actions.appendChild(cancelButton);
        actions.appendChild(saveButton);

        dialog.appendChild(title);
        dialog.appendChild(description);
        dialog.appendChild(input);
        dialog.appendChild(errorMessage);
        dialog.appendChild(actions);
        overlay.appendChild(dialog);
        host.appendChild(overlay);

        const cleanup = result => {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            resolve(result);
        };

        const submit = () => {
            const value = input.value.trim();
            if (!value) {
                errorMessage.textContent = 'Debes ingresar un nombre para continuar.';
                input.focus();
                return;
            }
            cleanup(value);
        };

        const onKeydown = event => {
            if (event.key === 'Escape') {
                cleanup(null);
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                submit();
            }
        };

        cancelButton.addEventListener('click', () => cleanup(null));
        saveButton.addEventListener('click', submit);
        overlay.addEventListener('click', event => {
            if (event.target === overlay) {
                cleanup(null);
            }
        });
        document.addEventListener('keydown', onKeydown);

        requestAnimationFrame(() => input.focus());
    });
}

function formatFilterValue(value) {
    if (value === null || value === undefined || value === '') {
        return 'Sin valor';
    }

    if (Array.isArray(value)) {
        if (!value.length) {
            return 'Sin valor';
        }
        return value.map(item => String(item)).join(', ');
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

function hasAppliedValue(value) {
    if (value === null || value === undefined) {
        return false;
    }

    if (typeof value === 'string') {
        return value.trim() !== '';
    }

    if (Array.isArray(value)) {
        return value.some(item => hasAppliedValue(item));
    }

    if (typeof value === 'object') {
        return Object.keys(value).length > 0;
    }

    return true;
}

async function getDashboardFilterNames(dashboardIdOrUuid) {
    if (!dashboardIdOrUuid) {
        return new Map();
    }

    if (dashboardFilterNamesCache.has(dashboardIdOrUuid)) {
        return dashboardFilterNamesCache.get(dashboardIdOrUuid);
    }

    const response = await fetch(`/api/v1/dashboard/${encodeURIComponent(dashboardIdOrUuid)}`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        const emptyMap = new Map();
        dashboardFilterNamesCache.set(dashboardIdOrUuid, emptyMap);
        return emptyMap;
    }

    const payload = await response.json();
    const jsonMetadataRaw = payload?.result?.json_metadata;
    const filterMap = new Map();

    try {
        const jsonMetadata = typeof jsonMetadataRaw === 'string'
            ? JSON.parse(jsonMetadataRaw)
            : (jsonMetadataRaw || {});
        const nativeFilters = Array.isArray(jsonMetadata?.native_filter_configuration)
            ? jsonMetadata.native_filter_configuration
            : [];

        nativeFilters.forEach(filterConfig => {
            if (!filterConfig?.id) {
                return;
            }
            const filterName = filterConfig?.name || filterConfig?.filter_name || filterConfig?.id;
            filterMap.set(filterConfig.id, filterName);
        });
    } catch (error) {
        console.error('No fue posible parsear native_filter_configuration:', error);
    }

    dashboardFilterNamesCache.set(dashboardIdOrUuid, filterMap);
    return filterMap;
}

function extractTabIdFromElement(element) {
    if (!element) {
        return null;
    }

    const directCandidates = [
        element.getAttribute('data-node-key'),
        element.getAttribute('data-key'),
        element.getAttribute('id'),
    ];

    for (const candidate of directCandidates) {
        if (candidate && candidate.trim() !== '') {
            return candidate.trim();
        }
    }

    const link = element.matches('a[href^="#"]')
        ? element
        : element.querySelector('a[href^="#"]');
    const href = link?.getAttribute('href');
    if (href && href.startsWith('#') && href.length > 1) {
        return href.slice(1);
    }

    return null;
}

function getActiveTabsFromDOM() {
    const selectors = [
        '[role="tab"][aria-selected="true"]',
        '.ant-tabs-tab.ant-tabs-tab-active',
    ];

    const found = new Set();
    selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(element => {
            const tabId = extractTabIdFromElement(element);
            if (tabId) {
                found.add(tabId);
            }
        });
    });

    return Array.from(found);
}

function createFilterDetailsContent(state, filterNames = new Map()) {
    const wrapper = document.createElement('div');
    wrapper.classList.add('bookmark-details-content');

    const stateData = state?.state || {};
    const dataMask = stateData.dataMask || {};
    const activeTabs = Array.isArray(stateData.activeTabs) ? stateData.activeTabs : [];
    const filters = Object.entries(dataMask)
        .map(([filterId, filterEntry], index) => {
            const filterState = filterEntry?.filterState || {};
            const label = filterNames.get(filterId) || filterEntry?.id || `Filtro ${index + 1}`;
            return {
                filterId,
                filterEntry,
                index,
                label,
                value: filterState.value,
            };
        })
        .filter(item => hasAppliedValue(item.value))
        .sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));

    const summaryLine = document.createElement('p');
    summaryLine.classList.add('bookmark-summary-line');
    summaryLine.textContent = `Filtros aplicados: ${filters.length} | Tabs activas: ${activeTabs.length}`;
    wrapper.appendChild(summaryLine);

    if (!filters.length) {
        const emptyText = document.createElement('p');
        emptyText.classList.add('bookmark-empty-details');
        emptyText.textContent = 'Este marcador no tiene filtros con valor aplicado.';
        wrapper.appendChild(emptyText);
        return wrapper;
    }

    const list = document.createElement('ul');
    list.classList.add('bookmark-filter-list');

    filters.forEach(({ label, value }) => {

        const item = document.createElement('li');
        item.classList.add('bookmark-filter-item');

        const title = document.createElement('strong');
        title.textContent = `${label}: `;
        item.appendChild(title);

        const text = document.createElement('span');
        text.textContent = formatFilterValue(value);
        item.appendChild(text);

        list.appendChild(item);
    });

    wrapper.appendChild(list);
    return wrapper;
}

async function loadPermalinkState(permalinkUrl) {
    const key = getPermalinkKey(permalinkUrl);
    if (!key) {
        return null;
    }

    if (permalinkStateCache.has(key)) {
        return permalinkStateCache.get(key);
    }

    const response = await fetch(`/api/v1/dashboard/permalink/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error('No se pudo consultar el detalle del permalink.');
    }

    const payload = await response.json();
    permalinkStateCache.set(key, payload);
    return payload;
}

async function getDashboardIdFromUrl() {
    const path = window.location.pathname;
    if (!path.startsWith('/superset/dashboard/')) {
        return null;
    }

    const permalink = window.location.href;
    const dashboardIdOrUuid = permalink.split('/dashboard/')[1]?.split('/')[0];

    if (!dashboardIdOrUuid) {
        return null;
    }

    if (!isNaN(dashboardIdOrUuid)) {
        return Number(dashboardIdOrUuid);
    }

    const dashboardResponse = await fetch(`/api/v1/dashboard/${dashboardIdOrUuid}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    });

    if (!dashboardResponse.ok) {
        throw new Error('Error al obtener el ID del dashboard.');
    }

    const dashboardData = await dashboardResponse.json();
    return dashboardData.result.id;
}

async function getCsrfToken() {
    const csrfResponse = await fetch('/api/v1/security/csrf_token/', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
    });

    if (!csrfResponse.ok) {
        throw new Error('Error al obtener el token CSRF.');
    }

    const csrfData = await csrfResponse.json();
    return csrfData.result;
}

async function getCurrentDataMask(dashboardId, csrfToken) {
    const nativeFiltersKey = getNativeFiltersKey();
    if (!nativeFiltersKey) {
        return {};
    }

    const filterStateResponse = await fetch(`/api/v1/dashboard/${dashboardId}/filter_state/${nativeFiltersKey}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-CSRFToken': csrfToken,
        },
    });

    if (!filterStateResponse.ok) {
        return {};
    }

    const filterStateData = await filterStateResponse.json();
    if (!filterStateData?.value) {
        return {};
    }

    return JSON.parse(filterStateData.value);
}

/// ESTADO PNC
window.loadStates = async function loadStates(userId) {
    console.log('Cargando los estados...');

    try {
        const requestBody = {
            esquema: 'oc',
            tabla: 'pnc_cierres_mes',
            filtro: {
                usuario: userId,
            },
        };

        const response = await fetch(`${CUSTOM_API_BASE}/api/database/dataframe_get`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            throw new Error('Error al cargar los estados.');
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('La respuesta no contiene un array de estados.');
        }

        const estadosContainer = document.getElementById('Estados');
        if (!estadosContainer) {
            throw new Error('No se encontró el contenedor de estados.');
        }
        estadosContainer.innerHTML = '';

        const addButton = document.createElement('button');
        addButton.textContent = 'Agregar Estado';
        addButton.classList.add('guardar-marcador-button');
        addButton.id = 'guardarEstadoButton';

        addButton.addEventListener('click', async function () {
            estadosContainer.innerHTML = '<div style="font-size: 16px; color: #333; text-align: center;">Guardando estado, espere...</div>';

            const nombre = prompt('Ingrese un nombre para el estado:');
            if (!nombre) {
                alert('Debe ingresar un nombre.');
                window.loadStates(userId);
                return;
            }

            const fechainicio = prompt('Ingrese la fecha de inicio (YYYY-MM-DD):');
            if (!fechainicio || !/^\d{4}-\d{2}-\d{2}$/.test(fechainicio)) {
                alert('Debe ingresar una fecha de inicio válida en formato YYYY-MM-DD.');
                window.loadStates(userId);
                return;
            }

            const fechafin = prompt('Ingrese la fecha de fin (YYYY-MM-DD):');
            if (!fechafin || !/^\d{4}-\d{2}-\d{2}$/.test(fechafin)) {
                alert('Debe ingresar una fecha de fin válida en formato YYYY-MM-DD.');
                window.loadStates(userId);
                return;
            }

            try {
                const userResponse = await fetch('/api/v1/me/');
                const userData = await userResponse.json();

                if (!userData.result) {
                    throw new Error('La respuesta no contiene datos del usuario en userData.result');
                }

                const currentUserId = userData.result.id;

                const bodyData = {
                    nombre,
                    fechainicio,
                    fechafin,
                    user_id: currentUserId,
                };

                const saveResponse = await fetch(`${CUSTOM_API_BASE}/api/pnc/guarda_estado_pnc`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(bodyData),
                });

                if (saveResponse.ok) {
                    alert('Estado guardado con éxito.');
                    await window.loadStates(currentUserId);
                } else {
                    const errorText = await saveResponse.text();
                    throw new Error(`Error en la solicitud: ${errorText}`);
                }
            } catch (error) {
                console.error('Error al guardar el estado:', error);
                alert('Error al guardar el estado.');
                window.loadStates(userId);
            }
        });

        estadosContainer.appendChild(addButton);

        const savedStatesContainer = document.createElement('div');
        savedStatesContainer.classList.add('saved-states-container-custom');
        estadosContainer.appendChild(savedStatesContainer);

        data.forEach(state => {
            if (!state.nombre || !state.consecutivo) {
                return;
            }

            const stateElement = document.createElement('div');
            stateElement.classList.add('saved-state-custom');

            const stateName = document.createElement('div');
            stateName.textContent = state.nombre;
            stateName.classList.add('saved-state-text');

            const buttonContainer = document.createElement('div');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px';

            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fa fa-trash-o"></i> Eliminar';
            deleteButton.classList.add('delete-button-custom');
            deleteButton.style.backgroundColor = 'red';
            deleteButton.style.color = 'white';

            deleteButton.onclick = function() {
                const confirmDelete = confirm('¿Está seguro de que desea eliminar este estado?');
                if (confirmDelete) {
                    deleteState(state.consecutivo, stateElement);
                }
            };

            const editButton = document.createElement('button');
            editButton.innerHTML = '<i class="fa fa-pencil"></i> Modificar';
            editButton.classList.add('delete-button-custom');

            editButton.onclick = function() {
                editState(state);
            };

            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(deleteButton);

            stateElement.appendChild(stateName);
            stateElement.appendChild(buttonContainer);
            savedStatesContainer.appendChild(stateElement);
        });

        console.log('Estados cargados correctamente.');
    } catch (error) {
        console.error('Error al cargar los estados:', error);
        alert('Error al cargar los estados.');
    }
};

function deleteState(stateId, element) {
    fetch(`${CUSTOM_API_BASE}/api/pnc/borra_estado_pnc`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consecutivo: stateId }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Estado eliminado con éxito');
            element.remove();
        } else {
            alert('Error al eliminar el estado');
        }
    })
    .catch(error => {
        console.error('Error al eliminar el estado:', error);
        alert('Error al eliminar el estado.');
    });
}

function editState(state) {
    const nuevoNombre = prompt('Ingrese un nuevo nombre para el estado:', state.nombre);
    if (!nuevoNombre) {
        alert('Debe ingresar un nombre.');
        return;
    }

    fetch(`${CUSTOM_API_BASE}/api/pnc/modif_estado_pnc`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            consecutivo: state.consecutivo,
            nombre: nuevoNombre,
        }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Estado modificado con éxito');
            window.loadStates(state.usuario);
        } else {
            alert('Error al modificar el estado');
        }
    })
    .catch(error => {
        console.error('Error al modificar el estado:', error);
        alert('Error al modificar el estado.');
    });
}

window.loadSavedStates = async function loadSavedStates() {
    console.log('Cargando los marcadores guardados...');

    try {
        const path = window.location.pathname;
        let endpoint = '/api/v1/dashboard/bookmark/';

        if (path.startsWith('/superset/dashboard/')) {
            const dashboardId = await getDashboardIdFromUrl();

            if (dashboardId === 84) {
                document.getElementById('statesTab').style.display = 'block';
            } else {
                document.getElementById('statesTab').style.display = 'none';
            }

            endpoint = `${endpoint}?dashboard_id=${encodeURIComponent(dashboardId)}`;
        } else {
            const statesTab = document.getElementById('statesTab');
            if (statesTab) {
                statesTab.style.display = 'none';
            }
        }

        const response = await fetch(endpoint, { method: 'GET' });

        if (!response.ok) {
            throw new Error('Error al cargar los marcadores guardados.');
        }

        const data = await response.json();
        const savedStatesContainer = document.getElementById('savedStatesContainer');
        if (!savedStatesContainer) {
            return;
        }

        savedStatesContainer.innerHTML = '';

        const bookmarks = data.result || [];

        if (!bookmarks.length) {
            const emptyState = document.createElement('div');
            emptyState.classList.add('bookmark-empty-state');
            emptyState.textContent = 'No tienes marcadores guardados para este reporte.';
            savedStatesContainer.appendChild(emptyState);
            return;
        }

        const groupedByTitle = bookmarks.reduce((acc, state) => {
            const title = state.dashboard_title || 'Sin Título';
            if (!acc[title]) {
                acc[title] = [];
            }
            acc[title].push(state);
            return acc;
        }, {});

        Object.keys(groupedByTitle).forEach(title => {
            const titleElement = document.createElement('h4');
            titleElement.classList.add('dashboard-title-custom');
            titleElement.textContent = title;
            savedStatesContainer.appendChild(titleElement);

            groupedByTitle[title].forEach(state => {
                addStateToDOM(state.id, state.permalink, state.name, savedStatesContainer);
            });
        });
    } catch (error) {
        console.error('Error al cargar los permalinks guardados:', error);
        showBookmarkToast('No se pudieron cargar los marcadores.', 'error');
    }
};

window.guardarmarcador = async function guardarmarcador() {
    try {
        const dashboardId = await getDashboardIdFromUrl();
        if (!dashboardId) {
            showBookmarkToast('Solo se pueden agregar marcadores dentro de un dashboard.', 'info');
            return;
        }

        const nombre = await requestBookmarkName();
        if (!nombre) {
            return;
        }

        const csrfToken = await getCsrfToken();
        const dataMask = await getCurrentDataMask(dashboardId, csrfToken);
        const activeTabs = getActiveTabsFromDOM();

        const permalinkResponse = await fetch(`/api/v1/dashboard/${dashboardId}/permalink`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify({
                urlParams: [],
                dataMask,
                activeTabs,
            }),
        });

        if (!permalinkResponse.ok) {
            const errorText = await permalinkResponse.text();
            throw new Error(`Error al generar el permalink: ${errorText}`);
        }

        const permalinkData = await permalinkResponse.json();
        const generatedPermalink = permalinkData.url || permalinkData.result;

        const saveResponse = await fetch('/api/v1/dashboard/bookmark/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': csrfToken,
            },
            body: JSON.stringify({
                permalink: generatedPermalink,
                dashboard_id: dashboardId,
                name: nombre,
            }),
        });

        if (saveResponse.ok) {
            showBookmarkToast('Marcador agregado con éxito.', 'success');
            window.loadSavedStates();
        } else {
            const errorText = await saveResponse.text();
            throw new Error(`Error en la solicitud de agregado: ${errorText}`);
        }
    } catch (error) {
        console.error('Error al guardar el permalink:', error);
        showBookmarkToast('Error al agregar el marcador.', 'error');
    }
};

function addStateToDOM(bookmarkId, permalink, displayName, container) {
    const stateElement = document.createElement('div');
    stateElement.classList.add('saved-state-custom');

    const header = document.createElement('div');
    header.classList.add('bookmark-header');

    const titleGroup = document.createElement('div');
    titleGroup.classList.add('bookmark-title-group');
    titleGroup.setAttribute('role', 'link');
    titleGroup.setAttribute('tabindex', '0');
    titleGroup.setAttribute('aria-label', `Abrir marcador ${displayName}`);

    const stateName = document.createElement('a');
    stateName.textContent = displayName;
    stateName.href = permalink;
    stateName.classList.add('saved-state-link-custom');

    const openHint = document.createElement('span');
    openHint.classList.add('bookmark-open-hint');
    openHint.textContent = 'Haz clic en el título para abrir el marcador';

    titleGroup.addEventListener('click', () => {
        window.location.href = permalink;
    });
    titleGroup.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.location.href = permalink;
        }
    });

    titleGroup.appendChild(stateName);
    titleGroup.appendChild(openHint);

    const actionGroup = document.createElement('div');
    actionGroup.classList.add('bookmark-actions');

    const copyButton = document.createElement('button');
    copyButton.classList.add('delete-button-custom');
    copyButton.classList.add('bookmark-copy-button');
    copyButton.textContent = 'Copiar';
    copyButton.onclick = async function() {
        try {
            await copyTextToClipboard(permalink);
            showBookmarkToast('Permalink copiado al portapapeles', 'success');
        } catch (error) {
            console.error('Error al copiar permalink:', error);
            showBookmarkToast('No se pudo copiar automáticamente. Intenta copiar manualmente.', 'error');
        }
    };

    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '<i class="fa fa-trash-o"></i>Borrar';
    deleteButton.classList.add('delete-button-custom');
    deleteButton.classList.add('bookmark-delete-button');
    deleteButton.onclick = function() {
        deleteSavedState(bookmarkId, stateElement);
    };

    actionGroup.appendChild(copyButton);
    actionGroup.appendChild(deleteButton);

    header.appendChild(titleGroup);
    header.appendChild(actionGroup);

    const details = document.createElement('details');
    details.classList.add('bookmark-details');

    const summary = document.createElement('summary');
    summary.textContent = 'Ver detalle de filtros';
    details.appendChild(summary);

    const detailsContainer = document.createElement('div');
    detailsContainer.classList.add('bookmark-details-content');
    detailsContainer.textContent = 'Expande para cargar detalle...';
    details.appendChild(detailsContainer);

    details.addEventListener('toggle', async function() {
        if (!details.open || details.dataset.loaded === 'true') {
            return;
        }

        detailsContainer.textContent = 'Cargando detalle...';
        try {
            const state = await loadPermalinkState(permalink);
            const filterNames = await getDashboardFilterNames(state?.dashboardId);
            detailsContainer.innerHTML = '';
            detailsContainer.appendChild(createFilterDetailsContent(state, filterNames));
            details.dataset.loaded = 'true';
        } catch (error) {
            console.error('Error cargando detalle del permalink:', error);
            detailsContainer.textContent = 'No fue posible cargar el detalle de filtros.';
        }
    });

    stateElement.appendChild(header);
    stateElement.appendChild(details);
    container.appendChild(stateElement);
}

async function deleteSavedState(bookmarkId, element) {
    try {
        const csrfToken = await getCsrfToken();
        const response = await fetch(`/api/v1/dashboard/bookmark/${encodeURIComponent(bookmarkId)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRFToken': csrfToken,
            },
        });

        if (response.ok) {
            showBookmarkToast('Marcador eliminado con éxito.', 'success');
            element.remove();
            return;
        }

        showBookmarkToast('Error al eliminar el marcador.', 'error');
    } catch (error) {
        console.error('Error al eliminar el Marcador:', error);
        showBookmarkToast('Error al eliminar el marcador.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    if (typeof window.loadSavedStates === 'function') {
        window.loadSavedStates();
        window.addEventListener('popstate', window.loadSavedStates);
        window.addEventListener('hashchange', window.loadSavedStates);

        let lastUrl = window.location.href;
        new MutationObserver(() => {
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
                lastUrl = currentUrl;
                window.loadSavedStates();
            }
        }).observe(document, { subtree: true, childList: true });
    }
});