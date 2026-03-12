- 2026-01-30: TableV3: se agregó filtrado de columnas excluidas (Jinja Fields y Top N Metric) en exportación CSV/Excel. Los campos en buildQuery.ts son enviados en extras.excluded_columns y filtrados en query_context_processor.py antes de exportar.

## Migración de Login Personalizado a superset_v6 (2026-01-30)

### Archivos copiados de superset6_test:
1. **Templates:**
   - `superset/templates/appbuilder/custom_login.html` - Página de login personalizada
   - `superset/templates/appbuilder/password/` - Templates de recuperación de contraseña
     - `request.html` - Formulario para solicitar reset
     - `reset.html` - Formulario para cambiar contraseña  
     - `email_reset.html` - Email con enlace de recuperación

2. **Assets:**
   - `superset/static/customcss/custom_login.css` - Estilos personalizados
   - `superset/static/js_personal/custom_login.js` - Funcionalidad toggle password y modal video

3. **Backend:**
   - `superset/security/password_reset.py` - Vista y lógica de recuperación de contraseña
   - `superset/config.py` - Agregado CustomSecurityManager y CustomAuthDBView

### Funcionalidades implementadas:
- ✅ Página de login personalizada con diseño Irex corporativo
- ✅ Panel de branding con logo y animación
- ✅ Formulario de login moderno y responsivo
- ✅ Toggle para mostrar/ocultar contraseña
- ✅ Botón para ver video demo (modal)
- ✅ Recuperación de contraseña por email
- ✅ Diseño totalmente responsivo (desktop, tablet, móvil)
- ✅ Colores corporativos Irex (azul #0066CC, verde #8DC63F)

### Configuración requerida en superset_config.py:
```python
# Habilitar recuperación de contraseña
PASSWORD_RESET_EMAIL_ENABLED = True
PASSWORD_RESET_SUPPORT_EMAIL = 'soporte@irex.co.cr'

# Configuración SMTP para envío de emails
SMTP_HOST = 'smtp.gmail.com'
SMTP_PORT = 587
SMTP_STARTTLS = True
SMTP_SSL = False
SMTP_USER = 'tu-email@gmail.com'
SMTP_PASSWORD = 'tu-password'
SMTP_MAIL_FROM = 'tu-email@gmail.com'
```

### Notas:
- El CustomSecurityManager usa PasswordResetSecurityManager como base
- El login usa template Jinja2 server-side en lugar del SPA React
- Los templates de password incluyen logo embebido en el email

- 2026-01-30: Login personalizado: agregado password_flow.css y password_reset.js para las páginas de recuperación de contraseña (request.html y reset.html)
