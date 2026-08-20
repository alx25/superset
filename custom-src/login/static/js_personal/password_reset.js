(function () {
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  onReady(function () {
    const toggleButtons = document.querySelectorAll('.toggle-password');

    toggleButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        const targetId = button.getAttribute('data-target');
        if (!targetId) return;
        const passwordInput = document.getElementById(targetId);
        if (!passwordInput) return;

        const isPassword = passwordInput.getAttribute('type') === 'password';
        passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
        button.classList.toggle('is-visible', isPassword);
        button.setAttribute(
          'aria-label',
          isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña',
        );
      });
    });
  });
})();
