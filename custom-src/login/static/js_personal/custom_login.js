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

  /* ── Recordar usuario ──────────────────────────────────────── */
  var REMEMBER_USER_KEY = 'superset-remember-username';
  var REMEMBER_ACTIVE_KEY = 'superset-remember-active';
  var REMEMBER_PROMPT_SEEN_KEY = 'superset-remember-prompt-seen';

  function safeGetItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (_e) {
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_e) {
      // ignore
    }
  }

  function safeRemoveItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (_e) {
      // ignore
    }
  }

  function initRememberUsername() {
    var usernameInput = document.getElementById('username');
    var rememberCheckbox = document.getElementById('rememberUsername');
    var loginForm = safeQuery('.login-form');
    var promptModal = document.getElementById('rememberPromptModal');

    if (!usernameInput || !rememberCheckbox || !loginForm) return;

    var isActive = safeGetItem(REMEMBER_ACTIVE_KEY) === '1';
    var savedUsername = safeGetItem(REMEMBER_USER_KEY);

    if (isActive && savedUsername && !usernameInput.value) {
      usernameInput.value = savedUsername;
      rememberCheckbox.checked = true;
    }

    function persistPreference() {
      if (rememberCheckbox.checked) {
        safeSetItem(REMEMBER_ACTIVE_KEY, '1');
        safeSetItem(REMEMBER_USER_KEY, usernameInput.value.trim());
      } else {
        safeSetItem(REMEMBER_ACTIVE_KEY, '0');
        safeRemoveItem(REMEMBER_USER_KEY);
      }
    }

    function closePromptModal() {
      if (!promptModal) return;
      promptModal.style.display = 'none';
      document.body.style.overflow = 'auto';
    }

    // El usuario ya tomó una decisión explícita (vía checkbox o vía el
    // mensaje): no volver a preguntar en futuras sesiones.
    rememberCheckbox.addEventListener('change', function () {
      safeSetItem(REMEMBER_PROMPT_SEEN_KEY, '1');
    });

    loginForm.addEventListener('submit', function (event) {
      var promptSeen = safeGetItem(REMEMBER_PROMPT_SEEN_KEY) === '1';

      if (!rememberCheckbox.checked && !promptSeen && promptModal) {
        event.preventDefault();
        promptModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        return;
      }

      persistPreference();
    });

    if (promptModal) {
      var acceptBtn = promptModal.querySelector('.remember-accept');
      var declineBtn = promptModal.querySelector('.remember-decline');

      if (acceptBtn) {
        acceptBtn.addEventListener('click', function () {
          rememberCheckbox.checked = true;
          safeSetItem(REMEMBER_PROMPT_SEEN_KEY, '1');
          persistPreference();
          closePromptModal();
          loginForm.submit();
        });
      }

      if (declineBtn) {
        declineBtn.addEventListener('click', function () {
          rememberCheckbox.checked = false;
          safeSetItem(REMEMBER_PROMPT_SEEN_KEY, '1');
          persistPreference();
          closePromptModal();
          loginForm.submit();
        });
      }
    }
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
    initRememberUsername();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDOMReady);
  } else {
    onDOMReady();
  }
})();
