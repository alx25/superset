"""Vista y gestor para recuperación de contraseñas usando AUTH_DB."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from flask import current_app, flash, render_template, request, url_for
from werkzeug.routing import BuildError
from flask_appbuilder import BaseView, expose
from flask_appbuilder.security.forms import ResetPasswordForm
from flask_babel import lazy_gettext as _
from flask_wtf import FlaskForm
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from wtforms import StringField
from wtforms.validators import DataRequired

from superset.utils.core import send_email_smtp
from superset.security import SupersetSecurityManager

logger = logging.getLogger(__name__)


@dataclass
class PasswordResetSettings:
    """Preferencias del flujo de recuperación."""

    token_max_age: int = 3600
    salt: str = "superset-password-reset"


class PasswordResetRequestForm(FlaskForm):
    """Formulario para solicitar el enlace de restablecimiento."""

    identifier = StringField(
        label=_("Usuario o correo"),
        validators=[DataRequired(message=_("Este campo es obligatorio"))],
    )


class PasswordResetView(BaseView):
    """Rutas para solicitar y completar el restablecimiento de contraseñas."""

    route_base = "/password"
    default_view = "request_reset"
    settings = PasswordResetSettings()

    def _support_email(self) -> str:
        return (
            current_app.config.get("PASSWORD_RESET_SUPPORT_EMAIL")
            or current_app.config.get("SMTP_MAIL_FROM")
            or "soporte@localhost"
        )

    def _build_serializer(self) -> URLSafeTimedSerializer:
        secret_key = current_app.config.get("SECRET_KEY")
        if not secret_key:
            raise RuntimeError("SECRET_KEY no está configurado")
        return URLSafeTimedSerializer(secret_key, salt=self.settings.salt)

    def _find_user(self, identifier: str):
        sm = self.appbuilder.sm
        identifier = identifier.strip()
        if not identifier:
            return None
        user = sm.find_user(email=identifier)
        if user:
            return user
        return sm.find_user(username=identifier)

    def _send_reset_link(self, user) -> None:
        if not current_app.config.get("EMAIL_NOTIFICATIONS", False):
            logger.warning("EMAIL_NOTIFICATIONS está desactivado; no se envió correo de recuperación.")
            return
        if not user.email:
            logger.warning("El usuario %s no tiene correo registrado; no se envió enlace de recuperación.", user.username)
            return
        serializer = self._build_serializer()
        token = serializer.dumps(user.email)
        reset_url = url_for("PasswordResetView.reset_password", token=token, _external=True)
        subject = str(_("Recupera tu contraseña"))
        static_folder = Path(current_app.static_folder or "")
        logo_cid = None
        inline_images: dict[str, bytes] = {}
        if static_folder:
            logo_path = static_folder / "assets" / "images" / "logo.png"
            if logo_path.exists():
                logo_cid = "password-reset-logo"
                try:
                    inline_images[logo_cid] = logo_path.read_bytes()
                except OSError as err:
                    logger.warning("No se pudo leer el logo para el correo: %s", err)
                else:
                    logger.debug("Logo embebido para correo: %s", logo_path)
            else:
                logger.warning("No se encontró el logo en %s", logo_path)

        html_content = render_template(
            "appbuilder/password/email_reset.html",
            user=user,
            reset_url=reset_url,
            app_name=current_app.config.get("APP_NAME", "Superset"),
            logo_url=url_for("static", filename="assets/images/logo.png", _external=True),
            logo_cid=logo_cid,
            support_email=self._support_email(),
        )
        mime_subtype = "related" if inline_images else "alternative"
        logger.info("Enviando correo de recuperacion para el usuario %s", user.username)
        try:
            send_email_smtp(
                user.email,
                subject,
                html_content,
                current_app.config,
                mime_subtype=mime_subtype,
                images=inline_images or None,
            )
            logger.info("Correo de recuperacion enviado a %s", user.email)
        except Exception as exc:  # pylint: disable=broad-except
            if isinstance(exc, TypeError) and "linesep" in str(exc):
                logger.warning(
                    "Fallo el envío usando EMAIL_HEADER_MUTATOR, reintentando sin mutador.",
                    exc_info=exc,
                )
                safe_config = dict(current_app.config)
                safe_config["EMAIL_HEADER_MUTATOR"] = lambda msg, **_: msg  # type: ignore[assignment]
                try:
                    send_email_smtp(
                        user.email,
                        subject,
                        html_content,
                        safe_config,
                        mime_subtype=mime_subtype,
                    )
                    logger.info(
                        "Correo de recuperacion enviado tras remover EMAIL_HEADER_MUTATOR para %s",
                        user.email,
                    )
                    return
                except Exception as retry_exc:  # pylint: disable=broad-except
                    logger.exception(
                        "Incluso sin mutador no se pudo enviar el correo de recuperación: %s",
                        retry_exc,
                    )
                    return
            logger.exception("No se pudo enviar el correo de recuperación: %s", exc)

    def _render_message(self, message: str, redirect_url: str):
        return self.render_template(
            "appbuilder/general/model/message.html",
            message=message,
            redirect=redirect_url,
            support_email=self._support_email(),
        )

    def _login_url(self) -> str:
        for endpoint in ("CustomAuthDBView.login", "AuthDBView.login"):
            try:
                return url_for(endpoint)
            except BuildError:
                continue
        return "/login/"

    @expose("/solicitar/", methods=["GET", "POST"])
    def request_reset(self):
        form = PasswordResetRequestForm()
        if request.method == "POST" and form.validate_on_submit():
            identifier = form.identifier.data
            user = self._find_user(identifier)
            if user:
                self._send_reset_link(user)
            # Siempre devolvemos el mismo mensaje para evitar enumeración.
            flash(_("Si el usuario existe, enviamos un correo con instrucciones."), "info")
            return self._render_message(
                message=_("Revisa tu correo para continuar con el restablecimiento."),
                redirect_url=self._login_url(),
            )
        return self.render_template(
            "appbuilder/password/request.html",
            form=form,
            support_email=self._support_email(),
        )

    @expose("/restablecer/<token>/", methods=["GET", "POST"])
    def reset_password(self, token: str):
        serializer = self._build_serializer()
        try:
            email = serializer.loads(token, max_age=self.settings.token_max_age)
        except SignatureExpired:
            flash(_("El enlace ha expirado, solicita uno nuevo."), "warning")
            return self._render_message(
                message=_("El enlace caducó."),
                redirect_url=url_for("PasswordResetView.request_reset"),
            )
        except BadSignature:
            flash(_("El enlace no es válido."), "danger")
            return self._render_message(
                message=_("El token proporcionado no es válido."),
                redirect_url=self._login_url(),
            )

        user = self.appbuilder.sm.find_user(email=email)
        if not user:
            logger.warning("Token de recuperación con correo %s sin usuario asociado", email)
            return self._render_message(
                message=_("El usuario no existe."),
                redirect_url=self._login_url(),
            )

        form = ResetPasswordForm()
        if request.method == "POST" and form.validate_on_submit():
            new_password = form.password.data
            self.appbuilder.sm.reset_password(user.id, new_password)
            flash(_("Contraseña actualizada correctamente."), "success")
            return self._render_message(
                message=_("Ya puedes iniciar sesión con tu nueva contraseña."),
                redirect_url=self._login_url(),
            )
        return self.render_template(
            "appbuilder/password/reset.html",
            form=form,
            support_email=self._support_email(),
        )


class PasswordResetSecurityManager(SupersetSecurityManager):
    """SecurityManager que agrega las vistas necesarias para recuperación."""

    password_reset_view_class = PasswordResetView

    def register_views(self):  # type: ignore[override]
        rv = super().register_views()
        view = self.password_reset_view_class()
        self.password_reset_view = self.appbuilder.add_view_no_menu(view)
        return rv
