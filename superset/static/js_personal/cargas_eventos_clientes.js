/**
 * Script para inyectar botón "Cargar Eventos" en dashboard ID 83
 * Solo visible para usuarios en la lista de IDs permitidos
 * Ubicación: dashboard-header-container
 * Versión: 1.1
 * Fecha: 2025-07-09
 */

(function() {
    'use strict';
    
    console.log('🚀 Iniciando script cargas_dashboard_83.js v1.1');
    
    const CONFIG = {
        DASHBOARD_ID: 83,
        AUTHORIZED_USER_IDS: [1, 77, 78], // 🔥 LISTA DE USUARIOS PERMITIDOS
        TARGET_URL: 'http://192.168.76.11:5000/api/servicio_cliente/pagina-cargas',
        BUTTON_ID: 'cargas-eventos-btn-83',
        HEADER_SELECTOR: '[data-test-id="83"].dashboard-header-container',
        BUTTON_CONTAINER_SELECTOR: '.right-button-panel .button-container',
        VERSION: '1.1'
    };
    
    // Evitar múltiples ejecuciones
    if (window.cargasDashboard83Loaded) {
        console.log('⚠️ Script dashboard 83 ya cargado, evitando duplicación');
        return;
    }
    window.cargasDashboard83Loaded = true;

    /**
     * Verifica si estamos en el dashboard correcto
     * @returns {boolean} true si estamos en dashboard ID 83
     */
    function estamosEnDashboard83() {
        // Verificar por data-test-id
        const headerPorId = document.querySelector(`[data-test-id="${CONFIG.DASHBOARD_ID}"]`);
        if (headerPorId) {
            console.log('✅ Dashboard 83 detectado por data-test-id');
            return true;
        }
        
        // Verificar por URL
        const url = window.location.href;
        const esDashboard83 = url.includes(`/dashboard/${CONFIG.DASHBOARD_ID}`) || 
                             url.includes(`dashboard_id=${CONFIG.DASHBOARD_ID}`);
        
        if (esDashboard83) {
            console.log('✅ Dashboard 83 detectado por URL');
            return true;
        }
        
        console.log('❌ No estamos en dashboard 83');
        return false;
    }

    /**
     * Verifica si el usuario está en la lista de usuarios permitidos
     * @returns {Promise<boolean>} true si el usuario tiene permisos
     */
    async function verificarPermisosUsuario() {
        try {
            console.log('🔍 Verificando permisos del usuario...');
            console.log(`📋 Usuarios permitidos: [${CONFIG.AUTHORIZED_USER_IDS.join(', ')}]`);
            
            const respuesta = await fetch('/api/v1/me/');
            if (!respuesta.ok) {
                console.error('❌ Error obteniendo datos del usuario:', respuesta.status);
                return false;
            }
            
            const datos = await respuesta.json();
            console.log('👤 Datos del usuario:', datos);
            
            if (!datos.result || typeof datos.result.id === 'undefined') {
                console.error('❌ Estructura de datos incorrecta');
                return false;
            }
            
            const userId = parseInt(datos.result.id);
            const username = datos.result.username;
            
            console.log(`🆔 ID del usuario: ${userId}`);
            console.log(`👤 Nombre del usuario: ${username}`);
            
            // Verificar si el ID está en la lista de usuarios permitidos
            const estaEnLista = CONFIG.AUTHORIZED_USER_IDS.includes(userId);
            
            if (estaEnLista) {
                console.log(`✅ Usuario AUTORIZADO - ID ${userId} está en la lista de permitidos`);
                console.log(`🎉 ¡Bienvenido ${username}! Tienes acceso al sistema de cargas`);
            } else {
                console.log(`🚫 Usuario NO AUTORIZADO - ID ${userId} no está en la lista`);
                console.log(`📝 Lista actual de IDs permitidos: [${CONFIG.AUTHORIZED_USER_IDS.join(', ')}]`);
            }
            
            return estaEnLista;
            
        } catch (error) {
            console.error('❌ Error verificando permisos:', error);
            return false;
        }
    }

    /**
     * Elimina botones existentes para evitar duplicados
     */
    function eliminarBotonesExistentes() {
        const botonExistente = document.getElementById(CONFIG.BUTTON_ID);
        if (botonExistente) {
            console.log('🗑️ Eliminando botón existente');
            botonExistente.remove();
        }
    }

    /**
     * Encuentra el contenedor donde insertar el botón
     * @returns {Element|null} El contenedor encontrado
     */
    function encontrarContenedor() {
        // Intentar múltiples selectores
        const selectores = [
            `${CONFIG.HEADER_SELECTOR} ${CONFIG.BUTTON_CONTAINER_SELECTOR}`,
            `${CONFIG.HEADER_SELECTOR} .right-button-panel`,
            `${CONFIG.HEADER_SELECTOR} .button-container`,
            CONFIG.HEADER_SELECTOR
        ];
        
        for (const selector of selectores) {
            const contenedor = document.querySelector(selector);
            if (contenedor) {
                console.log(`✅ Contenedor encontrado con selector: ${selector}`);
                return contenedor;
            }
        }
        
        console.log('❌ No se encontró contenedor apropiado');
        return null;
    }

    /**
     * Crea el botón de cargas
     * @returns {Element} El botón creado
     */
    function crearBotonCargas() {
        console.log('🔧 Creando botón de cargas...');
        
        const boton = document.createElement('div');
        boton.id = CONFIG.BUTTON_ID;
        boton.className = 'css-1w8luh0'; // Misma clase que el botón "Edit dashboard"
        
        boton.innerHTML = `
            <button 
                aria-label="Cargar eventos" 
                type="button" 
                class="ant-btn action-button superset-button superset-button-secondary css-d0k8zk"
                style="margin-right: 8px;"
            >
                <span style="display: flex; align-items: center; gap: 6px;">
                    <i class="fa fa-upload" style="font-size: 14px;"></i>
                    <span>Cargar Eventos</span>
                </span>
            </button>
        `;
        
        // Agregar evento click
        const botonElemento = boton.querySelector('button');
        botonElemento.addEventListener('click', (e) => {
            e.preventDefault();
            console.log('🎯 Abriendo sistema de cargas...');
            window.open(CONFIG.TARGET_URL, '_blank');
        });
        
        // Efecto hover
        botonElemento.addEventListener('mouseenter', () => {
            botonElemento.style.transform = 'translateY(-1px)';
            botonElemento.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        });
        
        botonElemento.addEventListener('mouseleave', () => {
            botonElemento.style.transform = 'translateY(0)';
            botonElemento.style.boxShadow = '';
        });
        
        return boton;
    }

    /**
     * Inyecta el botón en el header del dashboard
     * @returns {Promise<boolean>} true si fue exitoso
     */
    async function inyectarBoton() {
        console.log('💉 Intentando inyectar botón en dashboard 83...');
        
        // Verificar que estamos en el dashboard correcto
        if (!estamosEnDashboard83()) {
            console.log('⏭️ No estamos en dashboard 83, saltando...');
            return false;
        }
        
        // Verificar permisos
        const tienePermisos = await verificarPermisosUsuario();
        if (!tienePermisos) {
            console.log('🚫 Usuario sin permisos - botón no será mostrado');
            return false;
        }
        
        // Verificar si ya existe
        if (document.getElementById(CONFIG.BUTTON_ID)) {
            console.log('✅ Botón ya existe');
            return true;
        }
        
        // Limpiar botones existentes
        eliminarBotonesExistentes();
        
        // Encontrar contenedor
        const contenedor = encontrarContenedor();
        if (!contenedor) {
            console.log('❌ No se encontró contenedor');
            return false;
        }
        
        // Crear e insertar botón
        const boton = crearBotonCargas();
        
        // Insertar antes del botón "Edit dashboard" si existe
        const editButton = contenedor.querySelector('.css-1w8luh0');
        if (editButton) {
            contenedor.insertBefore(boton, editButton);
            console.log('✅ Botón insertado antes del botón Edit');
        } else {
            contenedor.appendChild(boton);
            console.log('✅ Botón agregado al final del contenedor');
        }
        
        console.log('🎉 Botón "Cargar Eventos" inyectado exitosamente en dashboard 83');
        return true;
    }

    /**
     * Sistema de reintentos
     */
    async function intentarConReintentos() {
        console.log('🔄 Iniciando sistema de reintentos...');
        
        const maxIntentos = 8;
        const delay = 1500; // 1.5 segundos
        
        for (let intento = 1; intento <= maxIntentos; intento++) {
            console.log(`🎯 Intento ${intento}/${maxIntentos}`);
            
            const exito = await inyectarBoton();
            if (exito) {
                console.log(`✅ ¡Éxito en intento ${intento}!`);
                return true;
            }
            
            if (intento < maxIntentos) {
                console.log(`⏰ Esperando ${delay/1000}s antes del siguiente intento...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        console.log('❌ Se agotaron todos los reintentos');
        return false;
    }

    /**
     * Observador de cambios en el DOM
     */
    function configurarObservador() {
        console.log('🔍 Configurando observador DOM...');
        
        const observer = new MutationObserver(async (mutaciones, obs) => {
            // Verificar si aparece el header del dashboard 83
            const hayHeader83 = mutaciones.some(mutacion => {
                return Array.from(mutacion.addedNodes).some(nodo => {
                    if (nodo.nodeType !== Node.ELEMENT_NODE) return false;
                    
                    return nodo.matches && (
                        nodo.matches(`[data-test-id="${CONFIG.DASHBOARD_ID}"]`) ||
                        nodo.querySelector && nodo.querySelector(`[data-test-id="${CONFIG.DASHBOARD_ID}"]`)
                    );
                });
            });
            
            if (hayHeader83) {
                console.log('🔄 Header dashboard 83 detectado, reintentando...');
                const exito = await inyectarBoton();
                if (exito) {
                    console.log('✅ Inyección exitosa desde observador');
                    obs.disconnect();
                }
            }
        });
        
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        // Timeout de seguridad
        setTimeout(() => {
            console.log('⏰ Timeout del observador alcanzado');
            observer.disconnect();
        }, 45000); // 45 segundos
    }

    /**
     * Función principal de inicialización
     */
    async function inicializar() {
        console.log(`🎯 Inicializando script para dashboard ${CONFIG.DASHBOARD_ID}...`);
        
        // Delay inicial
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Intentar inyección con reintentos
        const exito = await intentarConReintentos();
        
        if (!exito) {
            console.log('🔍 Activando observador como último recurso...');
            configurarObservador();
        }
    }

    /**
     * Punto de entrada principal
     */
    function main() {
        console.log(`📋 Script cargas_dashboard_83.js v${CONFIG.VERSION} cargado`);
        console.log(`🎯 Dashboard objetivo: ID = ${CONFIG.DASHBOARD_ID}`);
        console.log(`👥 Usuarios autorizados: IDs = [${CONFIG.AUTHORIZED_USER_IDS.join(', ')}]`);
        console.log(`📅 Fecha: 2025-07-09 22:06:14 UTC`);
        console.log(`👨‍💻 Usuario actual: alx25`);
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', inicializar);
        } else {
            inicializar();
        }
    }

    // Ejecutar
    main();

})();