(function () {
  var THEME_KEY = 'superset-theme-mode';

  /* ── Tema claro/oscuro ─────────────────────────────────────── */
  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'dark'
      : 'default';
  }

  function updateThemeLabel(mode) {
    var label = document.querySelector('.theme-label');
    if (label) label.textContent = mode === 'dark' ? 'Modo claro' : 'Modo oscuro';
  }

  function applyTheme(mode) {
    if (mode === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    updateThemeLabel(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch (_e) {
      // ignore
    }
  }

  function toggleTheme() {
    applyTheme(getCurrentTheme() === 'dark' ? 'default' : 'dark');
  }

  /* ── Modal demo video ──────────────────────────────────────── */
  function safeQuery(selector) {
    return document.querySelector(selector);
  }

  var modal = document.getElementById('myModal');
  var closeButton = safeQuery('.close');
  var video = document.getElementById('myVideo');
  var modalTrigger = safeQuery('.open-modal');

  function showModal() {
    if (!modal) return;
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }

  if (modalTrigger) {
    modalTrigger.addEventListener('click', function (e) {
      e.preventDefault();
      showModal();
    });
  }

  if (closeButton) {
    closeButton.addEventListener('click', function () {
      closeModal();
      try {
        localStorage.setItem('videoVisto', 'true');
      } catch (_e) {
        // ignore
      }
    });
  }

  window.addEventListener('click', function (event) {
    if (modal && event.target === modal) {
      closeModal();
      try {
        localStorage.setItem('videoVisto', 'true');
      } catch (_e) {
        // ignore
      }
    }
  });

  if (video) {
    video.addEventListener('ended', function () {
      closeModal();
      try {
        localStorage.setItem('videoVisto', 'true');
      } catch (_e) {
        // ignore
      }
    });
  }

  /* ── Toggle contraseña ─────────────────────────────────────── */
  var passwordInput = document.getElementById('password');
  var togglePasswordBtn = safeQuery('.toggle-password');
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', function () {
      var isPassword = passwordInput.getAttribute('type') === 'password';
      passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
      togglePasswordBtn.classList.toggle('is-visible', isPassword);
      togglePasswordBtn.setAttribute(
        'aria-label',
        isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña',
      );
    });
  }

  /* ── Animación Lottie ──────────────────────────────────────── */
  function initializeAnimation() {
    if (window.lottie) {
      var animationContainer = document.getElementById('login-animation');
      if (animationContainer && animationContainer.dataset.animation) {
        try {
          window.lottie.loadAnimation({
            container: animationContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: animationContainer.dataset.animation,
          });
        } catch (error) {
          console.warn('No se pudo cargar la animación:', error);
        }
      }
    }
  }

  /* ── Inicialización al cargar el DOM ───────────────────────── */
  function onDOMReady() {
    var themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Sincronizar el label con el tema que ya está activo (aplicado por el script inline)
    updateThemeLabel(getCurrentTheme());

    initializeAnimation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMReady);
  } else {
    onDOMReady();
  }
})();
