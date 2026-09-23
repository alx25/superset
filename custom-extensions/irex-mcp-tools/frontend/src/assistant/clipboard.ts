/**
 * Copia texto al portapapeles también fuera de un "contexto seguro".
 *
 * `navigator.clipboard` solo existe con HTTPS o en localhost. Test se sirve
 * por `http://<ip>:9090` y producción también responde por HTTP, así que
 * ahí `navigator.clipboard` es `undefined` y `navigator.clipboard.writeText`
 * lanzaba un TypeError síncrono que ningún `.catch()` atrapaba: los botones
 * "Copiar" no hacían nada (2026-09-23). Mismo problema de origen que
 * `crypto.randomUUID()` (Registro de cambios, entrada 34).
 *
 * Estrategia: API moderna si hay contexto seguro; si no existe o falla, el
 * método clásico (textarea temporal + `document.execCommand('copy')`), que
 * funciona por HTTP porque corre dentro del gesto del usuario (el clic).
 * Devuelve si pudo copiar, para mostrarle al usuario el resultado real.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permiso denegado u otro fallo: se intenta el método clásico.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Fuera de pantalla pero seleccionable (display:none no se puede seleccionar).
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  const previousFocus = document.activeElement as HTMLElement | null;
  document.body.appendChild(textarea);
  // focus() explícito: select() solo no garantiza que la selección activa del
  // documento sea la del textarea en todos los navegadores.
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  previousFocus?.focus?.();
  return ok;
}
