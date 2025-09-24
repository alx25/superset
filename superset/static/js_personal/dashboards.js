/**
 * Mejoras Visuales para Apache Superset
 * Versión 5.0
 * Autor: alx25
 * Fecha: 2025-06-23
 * 
 * SIMPLIFICADO: Solo animaciones básicas
 */

const SupersetDashboardEnhancer = {
    config: {
        selectorTarjetas: '.ant-card.ant-card-bordered',
        tiempoRipple: 600,
        tiempoEspera: 2000,
        animacionEntrada: true,
        efectoRipple: true
    },
    
    inicializado: false,
    paginaActual: '1',
    
    init: function() {
        // Evitar inicialización múltiple
        if (this.inicializado) return;
        
        if (window.location.pathname.includes('/dashboard/list')) {
            console.log('🎨 Mejoras visuales básicas iniciadas - por alx25');
            this.inicializado = true;
            
            // Detectar página actual
            this.actualizarPaginaActual();
            
            // Aplicar estilos básicos
            this.insertarEstilosBase();
            
            // Iniciar la búsqueda de tarjetas
            this.buscarTarjetasAgresivamente();
            
            // Observar cambios de paginación
            this.observarCambiosPaginacion();
        }
    },
    
    actualizarPaginaActual: function() {
        const elementoPagina = document.querySelector('.ant-pagination-item-active');
        if (elementoPagina) {
            this.paginaActual = elementoPagina.innerText || '1';
        } else {
            this.paginaActual = '1';
        }
    },
    
    observarCambiosPaginacion: function() {
        // Buscar elementos de paginación
        const paginadores = document.querySelectorAll('.ant-pagination, .pagination, [role="navigation"]');
        
        if (paginadores.length > 0) {
            // Observer para detectar cambios en la paginación activa
            const observerConfig = { attributes: true, childList: true, subtree: true };
            const observer = new MutationObserver((mutationsList) => {
                for (const mutation of mutationsList) {
                    // Si hay cambios en las clases o contenido de paginación
                    if (mutation.type === 'attributes' || mutation.type === 'childList') {
                        const nuevaPagina = document.querySelector('.ant-pagination-item-active')?.innerText;
                        if (nuevaPagina && nuevaPagina !== this.paginaActual) {
                            this.paginaActual = nuevaPagina;
                            
                            // Esperar a que se actualice el contenido
                            setTimeout(() => this.procesarCambioPagina(), 300);
                        }
                    }
                }
            });
            
            // Observar el contenedor de paginación
            paginadores.forEach(paginador => {
                observer.observe(paginador, observerConfig);
                
                // También escuchar clics directamente
                paginador.addEventListener('click', () => {
                    // Dejar tiempo para que se actualice la UI
                    setTimeout(() => {
                        const nuevaPagina = document.querySelector('.ant-pagination-item-active')?.innerText;
                        if (nuevaPagina && nuevaPagina !== this.paginaActual) {
                            this.paginaActual = nuevaPagina;
                            this.procesarCambioPagina();
                        }
                    }, 300);
                });
            });
        }
    },
    
    procesarCambioPagina: function() {
        // Buscar las nuevas tarjetas
        const tarjetas = document.querySelectorAll(this.config.selectorTarjetas);
        if (tarjetas.length > 0) {
            // Resetear estado para las nuevas tarjetas
            tarjetas.forEach(tarjeta => {
                tarjeta.removeAttribute('data-enhanced');
                tarjeta.removeAttribute('data-pagina-procesada');
            });
            
            // Aplicar animaciones a las nuevas tarjetas
            this.aplicarMejoras(tarjetas);
        }
    },
    
    buscarTarjetasAgresivamente: function() {
        // Intenta encontrar las tarjetas lo antes posible
        const buscarYAplicar = () => {
            const tarjetas = document.querySelectorAll(this.config.selectorTarjetas);
            if (tarjetas.length > 0) {
                this.aplicarMejoras(tarjetas);
                return true;
            }
            return false;
        };
        
        // Intentar inmediatamente
        if (buscarYAplicar()) return;
        
        // Buscar agresivamente
        let intentos = 0;
        const intervalRapido = setInterval(() => {
            if (buscarYAplicar() || ++intentos >= 10) {
                clearInterval(intervalRapido);
                
                // Si no se encontraron, usar MutationObserver
                if (intentos >= 10 && !document.querySelector(this.config.selectorTarjetas)) {
                    this.observarCambiosDOM();
                }
            }
        }, 50);
    },
    
    observarCambiosDOM: function() {
        const targetNode = document.querySelector('#app') || document.body;
        const observer = new MutationObserver((mutations) => {
            const tarjetas = document.querySelectorAll(this.config.selectorTarjetas);
            if (tarjetas.length > 0) {
                observer.disconnect();
                this.aplicarMejoras(tarjetas);
            }
        });
        
        observer.observe(targetNode, { childList: true, subtree: true });
        
        // Backup timeout
        setTimeout(() => {
            observer.disconnect();
            const tarjetas = document.querySelectorAll(this.config.selectorTarjetas);
            if (tarjetas.length > 0) {
                this.aplicarMejoras(tarjetas);
            }
        }, this.config.tiempoEspera);
    },
    
    aplicarMejoras: function(elementos) {
        if (!elementos || elementos.length === 0) return;
        
        // Verificar tarjetas ya procesadas
        const elementosSinProcesar = Array.from(elementos).filter(
            elemento => !elemento.hasAttribute('data-enhanced') || 
                       elemento.getAttribute('data-pagina-procesada') !== this.paginaActual
        );
        
        if (elementosSinProcesar.length === 0) return;
        
        console.log(`🔍 Aplicando animaciones a ${elementosSinProcesar.length} tarjetas en página ${this.paginaActual}`);
        
        // Aplicar animación de entrada
        if (this.config.animacionEntrada) {
            elementosSinProcesar.forEach((elemento, index) => {
                // Marcar para evitar duplicación
                elemento.setAttribute('data-enhanced', 'true');
                elemento.setAttribute('data-pagina-procesada', this.paginaActual);
                elemento.style.animationDelay = `${index * 0.05}s`;
                elemento.classList.add('dashboard-card-animated');
            });
        }
        
        // Aplicar eventos de ripple
        if (this.config.efectoRipple && !window.dashboardRippleApplied) {
            const container = elementos[0].parentElement;
            
            container.addEventListener('click', (e) => {
                const card = e.target.closest(this.config.selectorTarjetas);
                if (!card || e.target.closest('.ant-btn')) return;
                
                this.crearEfectoRipple(e, card);
            });
            
            window.dashboardRippleApplied = true;
        }
    },
    
    crearEfectoRipple: function(evento, elemento) {
        const rect = elemento.getBoundingClientRect();
        const size = 60;
        const x = evento.clientX - rect.left - size / 2;
        const y = evento.clientY - rect.top - size / 2;
        
        const ripple = document.createElement('div');
        ripple.className = 'ripple-effect';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        
        elemento.appendChild(ripple);
        
        setTimeout(() => {
            if (ripple.parentNode) ripple.remove();
        }, this.config.tiempoRipple);
    },
    
    insertarEstilosBase: function() {
        if (document.getElementById('superset-dashboard-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'superset-dashboard-styles';
        
        style.textContent = `
            /* Efecto de entrada para las tarjetas */
            @keyframes cardEntrance {
                from { 
                    opacity: 0; 
                    transform: translateY(15px); 
                }
                to { 
                    opacity: 1; 
                    transform: translateY(0); 
                }
            }
            
            .dashboard-card-animated {
                animation: cardEntrance 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
                animation-fill-mode: both !important;
            }
            
            /* Configuración para el efecto ripple */
            .ripple-effect {
                position: absolute !important;
                width: 60px !important;
                height: 60px !important;
                background: rgba(37, 99, 235, 0.2) !important;
                border-radius: 50% !important;
                pointer-events: none !important;
                z-index: 999 !important;
                animation: rippleEffect 0.6s cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            @keyframes rippleEffect {
                to { 
                    transform: scale(4); 
                    opacity: 0; 
                }
            }
            
            /* Aseguramos que las tarjetas puedan mostrar el efecto de ripple */
            .ant-card.ant-card-bordered {
                position: relative !important;
                overflow: hidden !important;
            }
        `;
        
        document.head.appendChild(style);
    }
};

// Auto-iniciar cuando se carga el DOM o inmediatamente si ya está cargado
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        SupersetDashboardEnhancer.init();
    });
} else {
    SupersetDashboardEnhancer.init();
}

// Observar cambios en la URL para navegación SPA
(function() {
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            SupersetDashboardEnhancer.inicializado = false;
            SupersetDashboardEnhancer.init();
        }
    }).observe(document, {subtree: true, childList: true});
})();

console.log('✅ Script de mejoras visuales básicas v5.0 cargado correctamente');