document.addEventListener("DOMContentLoaded", function() {
    console.log('DOM completamente cargado y procesado');

    // Referencias a los elementos
    const chatButton = document.getElementById("chatButton");
    const chatWindow = document.getElementById("chatWindow");
    const closeChat = document.getElementById("closeChat");

    // Función para abrir la ventana de chat
    chatButton.addEventListener("click", function() {
        chatWindow.classList.add("show");
        console.log('Ventana de chat abierta');
    });

    // Función para cerrar la ventana de chat
    closeChat.addEventListener("click", function() {
        chatWindow.classList.remove("show");
        console.log('Ventana de chat cerrada');
    });
    
    
    // Detectar clic fuera de la ventana del chat para cerrarla
    document.addEventListener('click', function(event) {
        // Verificar si el clic fue fuera de la ventana de chat
        if (!chatWindow.contains(event.target) && !chatButton.contains(event.target)) {
            chatWindow.classList.remove("show");
            console.log('Ventana de chat cerrada por clic fuera de la ventana');
        }
    });

    // Función para abrir una pestaña
    window.openTab = async function(evt, tabName) {
    console.log(`Pestaña seleccionada: ${tabName}`);

    const tabcontent = document.getElementsByClassName("tabcontent");
    const tablinks = document.getElementsByClassName("tablinks");

    // Ocultar todas las pestañas
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Remover la clase "active" de todos los botones
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Mostrar la pestaña seleccionada
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
    
    if (tabName === 'Marcadores') {
        console.log('Intentando cargar Marcadores');
        loadSavedStates();
    }

    // Cargar estados si la pestaña seleccionada es "Estados"
    if (tabName === 'Estados') {
        console.log('Cargando la lista de estados');
        const userResponse = await fetch('/api/v1/me/');
        const userData = await userResponse.json();
        const userId = userData.result.id;
        await loadStates(userId); // Llamada a la función que carga los estados
    }

    // Si la pestaña seleccionada es Chatbot, cargar el iframe
    if (tabName === 'Chatbot') {
        console.log('Intentando cargar el chatbot');
        loadChat();
    }
};


    // Función para cargar el chat en el iframe
    function loadChat() {
        console.log('Ejecutando loadChat()');

        fetch('/api/v1/me/')
            .then(response => response.json())
            .then(data => {
                const chatIframe = document.getElementById('chatIframe');
                const encodedData = encodeURIComponent(JSON.stringify(data.result));
                const chatUrl = `https://webchat.botframework.com/embed/prueba_botv2?s=F2ZSmcab_SI.WmBRgWeDQB_UgEcQJ5JpTdLqTlxCOFo1o5iQkb-dvJE&username=${encodedData}`;
                console.log('URL generada para el chat:', chatUrl);
                chatIframe.src = chatUrl;
            })
            .catch(error => {
                console.error('Error al obtener el nombre de usuario:', error);
            });
    }

    // Abrir la pestaña de Chatbot por defecto
    document.querySelector(".tablinks").click();

    // Detectar cambios en la URL y cargar marcadores
    window.addEventListener('popstate', loadSavedStates);
    window.addEventListener('hashchange', loadSavedStates);

    // Detectar cambios en el dashboard cuando se cambia la URL de forma programática
    let lastUrl = window.location.href;
    new MutationObserver(() => {
        const currentUrl = window.location.href;
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl;
            loadSavedStates();
        }
    }).observe(document, { subtree: true, childList: true });

    // Cargar marcadores al cargar la página
    loadSavedStates();
});

 
 /// ESTADO PNC
async function loadStates(userId) {
    console.log('Cargando los estados...');

    try {
        // Cuerpo de la solicitud
        const requestBody = {
            esquema: "oc",
            tabla: "pnc_cierres_mes",
            filtro: {
                usuario: userId
            }
        };

        // Realizar la solicitud POST
        const response = await fetch('http://192.168.76.11:5000/api/database/dataframe_get', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error('Error al cargar los estados.');
        }

        const data = await response.json();

        // Verificar si la respuesta es un array
        if (!Array.isArray(data)) {
            throw new Error('La respuesta no contiene un array de estados.');
        }

        // Referencia al contenedor donde mostrarás los estados
        const estadosContainer = document.getElementById('Estados');
        if (!estadosContainer) {
            throw new Error('No se encontró el contenedor de estados.');
        }
        estadosContainer.innerHTML = ''; // Limpiar contenido existente

        // Crear y agregar el botón de agregar estado
        const addButton = document.createElement('button');
        addButton.textContent = 'Agregar Estado';
        addButton.classList.add('guardar-marcador-button'); // Clase para mantener estilo consistente
        addButton.id = 'guardarEstadoButton'; // Asegurarse de que el botón tenga el mismo ID

        // Agregar evento al botón para guardar estados
        addButton.addEventListener('click', async function () {
            // Mostrar mensaje temporal de guardando en lugar del contenido
            estadosContainer.innerHTML = '<div style="font-size: 16px; color: #333; text-align: center;">Guardando estado, espere...</div>';

            // Solicitar al usuario las fechas y el nombre
            const nombre = prompt("Ingrese un nombre para el estado:");
            if (!nombre) {
                alert("Debe ingresar un nombre.");
                loadStates(userId); // Recargar la lista de estados si la operación se cancela
                return;
            }

            const fechainicio = prompt("Ingrese la fecha de inicio (YYYY-MM-DD):");
            if (!fechainicio || !/^\d{4}-\d{2}-\d{2}$/.test(fechainicio)) {
                alert("Debe ingresar una fecha de inicio válida en formato YYYY-MM-DD.");
                loadStates(userId); // Recargar la lista de estados si la operación se cancela
                return;
            }

            const fechafin = prompt("Ingrese la fecha de fin (YYYY-MM-DD):");
            if (!fechafin || !/^\d{4}-\d{2}-\d{2}$/.test(fechafin)) {
                alert("Debe ingresar una fecha de fin válida en formato YYYY-MM-DD.");
                loadStates(userId); // Recargar la lista de estados si la operación se cancela
                return;
            }

            try {
                const userResponse = await fetch('/api/v1/me/');
                const userData = await userResponse.json();

                // Verifica si userData.result existe y contiene los datos esperados
                if (!userData.result) {
                    throw new Error('La respuesta no contiene datos del usuario en userData.result');
                }

                // Accede al id del usuario
                const userId = userData.result.id;
                console.log(`ID USUARIO: ${userId}`);

                // Crear el cuerpo de la solicitud con el id del usuario incluido
                const bodyData = {
                    nombre: nombre,
                    fechainicio: fechainicio,
                    fechafin: fechafin,
                    user_id: userId // Incluir el id del usuario
                };

                // Enviar la solicitud POST para guardar el estado
                const saveResponse = await fetch('http://192.168.76.11:5000/api/pnc/guarda_estado_pnc', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(bodyData)
                });

                if (saveResponse.ok) {
                    alert("Estado guardado con éxito.");
                    await loadStates(userId); // Recargar la lista de estados después de guardar
                } else {
                    const errorText = await saveResponse.text();
                    throw new Error(`Error en la solicitud: ${errorText}`);
                }
            } catch (error) {
                console.error('Error al guardar el estado:', error);
                alert('Error al guardar el estado.');
                loadStates(userId); // Recargar la lista de estados si ocurre un error
            }
        });

        estadosContainer.appendChild(addButton);

        // Mostrar los estados
        const savedStatesContainer = document.createElement('div');
        savedStatesContainer.classList.add('saved-states-container-custom'); // Clase para el contenedor de estados
        estadosContainer.appendChild(savedStatesContainer);

        // Suponiendo que `data` contiene un array de estados
        data.forEach(state => {
            if (!state.nombre || !state.consecutivo) {
                console.warn('El estado no tiene un nombre o un consecutivo válido:', state);
                return;
            }

            const stateElement = document.createElement('div');
            stateElement.classList.add('saved-state-custom'); // Clase personalizada para estilos

            // Mostrar el nombre del estado como texto fijo
            const stateName = document.createElement('div');
            stateName.textContent = state.nombre; // Mostrar solo el nombre del estado
            stateName.classList.add('saved-state-text'); // Clase personalizada para aplicar estilos al texto

            // Contenedor para los botones (alineados en fila)
            const buttonContainer = document.createElement('div');
            buttonContainer.style.display = 'flex';
            buttonContainer.style.gap = '8px'; // Espaciado entre botones

            // Botón para eliminar el estado
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '<i class="fa fa-trash-o"></i> Eliminar';
            deleteButton.classList.add('delete-button-custom'); // Clase personalizada
            deleteButton.style.backgroundColor = 'red'; // Color rojo para el botón de eliminar
            deleteButton.style.color = 'white'; // Color de texto blanco para el botón de eliminar

            deleteButton.onclick = function() {
                const confirmDelete = confirm('¿Está seguro de que desea eliminar este estado?');
                if (confirmDelete) {
                    deleteState(state.consecutivo, stateElement); // Llama a la función para eliminar el estado
                }
            };

            // Botón para modificar el estado
            const editButton = document.createElement('button');
            editButton.innerHTML = '<i class="fa fa-pencil"></i> Modificar';
            editButton.classList.add('delete-button-custom'); // Usar la misma clase que el botón de eliminar para estilo consistente

            editButton.onclick = function() {
                editState(state); // Llama a la función para modificar el estado
            };

            // Agregar los botones al contenedor de botones
            buttonContainer.appendChild(editButton);
            buttonContainer.appendChild(deleteButton);

            // Agregar los elementos al estado
            stateElement.appendChild(stateName);
            stateElement.appendChild(buttonContainer);
            savedStatesContainer.appendChild(stateElement);
        });

        console.log('Estados cargados correctamente.');
    } catch (error) {
        console.error('Error al cargar los estados:', error);
        alert('Error al cargar los estados.');
    }
}





function deleteState(stateId, element) {
    console.log('Borrando estado ',stateId)
    fetch('http://192.168.76.11:5000/api/pnc/borra_estado_pnc', { // Cambia la URL según tu endpoint para eliminar
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ consecutivo: stateId }), // Ajusta el cuerpo según tus requisitos
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

    // Realizar solicitud para actualizar el estado
    fetch('http://192.168.76.11:5000/api/pnc/modif_estado_pnc', { // Cambia la URL según tu endpoint para modificar
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            consecutivo: state.consecutivo, // Ajusta según la estructura de tu estado
            nombre: nuevoNombre
        }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Estado modificado con éxito');
            // Opcional: recargar la lista de estados o actualizar el DOM
            loadStates(state.usuario);
        } else {
            alert('Error al modificar el estado');
        }
    })
    .catch(error => {
        console.error('Error al modificar el estado:', error);
        alert('Error al modificar el estado.');
    });
}





async function loadSavedStates() {
    console.log('Cargando los estados guardados...test');
    try {
        const userResponse = await fetch('/api/v1/me/');
        const userData = await userResponse.json();
        const user_info = JSON.stringify(userData.result);

        const path = window.location.pathname;
        let sqlQuery;

        if (path.startsWith('/superset/dashboard/')) {
            const permalink = window.location.href;
            let dashboardIdOrUuid = permalink.split('/dashboard/')[1]?.split('/')[0];

            // Si el dashboardIdOrUuid no es un número (es un UUID), obtener el ID numérico
            if (isNaN(dashboardIdOrUuid)) {
                const dashboardApiUrl = `http://192.168.76.11/api/v1/dashboard/${dashboardIdOrUuid}`;
                const dashboardResponse = await fetch(dashboardApiUrl, {
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
                dashboardIdOrUuid = dashboardData.result.id;
            }

            // Mostrar la pestaña Estados solo si el ID es 84
            console.log('Revisando si el id es 84...');
            console.log(`ID del dashboard: ${dashboardIdOrUuid}`);
            if (parseInt(dashboardIdOrUuid) === 84) {
                console.log('ID del dashboard es 84, mostrando la pestaña Estados.');
                document.getElementById('statesTab').style.display = 'block';
            } else {
                document.getElementById('statesTab').style.display = 'none';
                console.log(`ID del dashboard no es 84, es ${dashboardIdOrUuid}`);
            }

            sqlQuery = `
                SELECT A.permalink, A.user_info, A.dashboard_id, A.nombre, B.dashboard_title
                FROM superset_dev.dashboard_permalinks A
                LEFT JOIN public.dashboards B ON A.dashboard_id = B.id 
                WHERE A.user_info = '${user_info}' AND A.dashboard_id = '${dashboardIdOrUuid}'
                ORDER BY B.dashboard_title, A.nombre
            `;
        } else {
            sqlQuery = `
                SELECT A.permalink, A.user_info, A.dashboard_id, A.nombre, B.dashboard_title
                FROM superset_dev.dashboard_permalinks A
                LEFT JOIN public.dashboards B ON A.dashboard_id = B.id 
                WHERE A.user_info = '${user_info}' 
                ORDER BY B.dashboard_title, A.nombre
            `;
        }

        const response = await fetch('http://192.168.76.11:5000/api/permalinks/get_saved_permalinks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ sql_query: sqlQuery })
        });

        if (!response.ok) {
            throw new Error('Error al cargar los marcadores guardados.');
        }

        const data = await response.json();
        const savedStatesContainer = document.getElementById('savedStatesContainer');
        savedStatesContainer.innerHTML = '';

        const groupedByTitle = data.permalinks.reduce((acc, state) => {
            const title = state.dashboard_title || "Sin Título";
            if (!acc[title]) acc[title] = [];
            acc[title].push(state);
            return acc;
        }, {});

        Object.keys(groupedByTitle).forEach(title => {
            const titleElement = document.createElement('h4');
            titleElement.textContent = title;
            savedStatesContainer.appendChild(titleElement);

            groupedByTitle[title].forEach(state => {
                addStateToDOM(state.permalink, state.nombre, savedStatesContainer);
            });
        });

    } catch (error) {
        console.error('Error al cargar los permalinks guardados:', error);
    }
}





async function guardarmarcador() {
            try {
                const permalinkApiUrl = 'http://192.168.76.11/api/v1/dashboard';
                const csrfTokenUrl = 'http://192.168.76.11/api/v1/security/csrf_token/';
                const permalink = window.location.href;
                let dashboardIdOrUuid = permalink.split('/dashboard/')[1]?.split('/')[0];
        
                // Si el dashboardIdOrUuid no es un número (es un UUID), obtener el ID numérico
                if (isNaN(dashboardIdOrUuid)) {
                    const dashboardApiUrl = `http://192.168.76.11/api/v1/dashboard/${dashboardIdOrUuid}`;
                    const dashboardResponse = await fetch(dashboardApiUrl, {
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
                    dashboardIdOrUuid = dashboardData.result.id; // Aquí se obtiene el ID numérico del dashboard
                }
                
                // Mostrar la pestaña Estados solo si el ID es 84
if (dashboardIdOrUuid === 84) {
    document.getElementById('statesTab').style.display = 'block';
}
        
                // Obtener la información del usuario
                const userResponse = await fetch('/api/v1/me/');
                const userData = await userResponse.json();
                const user_info = JSON.stringify(userData.result);
        
                // Solicitar al usuario que ingrese un nombre
                const nombre = prompt("Por favor, ingrese un nombre para guardar este estado:");
        
                if (!nombre) {
                    alert('Debe ingresar un nombre para guardar el permalink.');
                    return;
                }
        
                // Obtener el token CSRF desde la API
                const csrfResponse = await fetch(csrfTokenUrl, {
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
                const csrfToken = csrfData.result;
        
                // Obtener el estado actual de los filtros
                const nativeFiltersKey = getNativeFiltersKey();
        
                if (!nativeFiltersKey) {
                    throw new Error('No se encontró el native_filters_key en la URL.');
                }
        
                const filterStateUrl = `http://192.168.76.11/api/v1/dashboard/${dashboardIdOrUuid}/filter_state/${nativeFiltersKey}`;
                const filterStateResponse = await fetch(filterStateUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRFToken': csrfToken,
                    },
                });
        
                if (!filterStateResponse.ok) {
                    throw new Error('Error al obtener el estado de los filtros.');
                }
        
                const filterStateData = await filterStateResponse.json();
                const dataMask = JSON.parse(filterStateData.value);  // Parsear el JSON que está en el valor de la respuesta
        
                // Generar el permalink usando la API de Superset
                const permalinkResponse = await fetch(`${permalinkApiUrl}/${dashboardIdOrUuid}/permalink`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRFToken': csrfToken,
                    },
                    body: JSON.stringify({
                        urlParams: [],
                        dataMask: dataMask,
                        activeTabs: ["TAB-MAFnIh40iJ", "TAB-tMsGgdCvT9"]  // Reemplaza con los tabs activos reales si es necesario
                    }),
                });
        
                if (!permalinkResponse.ok) {
                    const errorText = await permalinkResponse.text();  // Obtener más detalles del error
                    throw new Error(`Error al generar el permalink: ${errorText}`);
                }
        
                const permalinkData = await permalinkResponse.json();
                const generatedPermalink = permalinkData.result || permalinkData.url;
        
                // Guardar el permalink generado
                const saveResponse = await fetch('http://192.168.76.11:5000/api/permalinks/save_permalink', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        permalink: generatedPermalink, 
                        dashboard_id: dashboardIdOrUuid,
                        user_info: user_info,
                        nombre: nombre
                    }),
                });
        
                if (saveResponse.ok) {
                    alert('¡Permalink guardado con éxito!');
                    loadSavedStates();
                } else {
                    throw new Error('Error en la solicitud de guardado');
                }
            } catch (error) {
                console.error('Error al guardar el permalink:', error);
                alert('Error al guardar el permalink.');
            }
        }

function getNativeFiltersKey() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('native_filters_key');
}


function addStateToDOM(permalink, displayName, container) {
    const stateElement = document.createElement('div');
    stateElement.classList.add('saved-state-custom'); // Nueva clase personalizada

    const stateName = document.createElement('a');
    stateName.textContent = displayName;
    stateName.href = permalink;
    stateName.classList.add('saved-state-link-custom'); // Clase personalizada para los links

    const deleteButton = document.createElement('button');
    deleteButton.innerHTML = '<i class="fa fa-trash-o"></i>Borrar';
    deleteButton.classList.add('delete-button-custom'); // Nueva clase personalizada
    deleteButton.onclick = function() {
        deleteSavedState(permalink, stateElement);
    };

    stateElement.appendChild(stateName);
    stateElement.appendChild(deleteButton);

    container.appendChild(stateElement);
}

function deleteSavedState(permalink, element) {
    fetch('http://192.168.76.11:5000/api/permalinks/delete_permalink', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permalink: permalink }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            alert('Marcador eliminado con éxito');
            element.remove();
        } else {
            alert('Error al eliminar el Marcador');
        }
    })
    .catch(error => {
        console.error('Error al eliminar el Marcador:', error);
        alert('Error al eliminar el Marcador.');
    });
}
