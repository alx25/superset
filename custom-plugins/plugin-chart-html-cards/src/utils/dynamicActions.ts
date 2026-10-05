/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/**
 * Vocabulario declarativo de comportamientos interactivos para
 * handlebarsTemplate: `data-hc-on="click"` + `data-hc-action="toggleClass:
 * is-open"` (+ `data-hc-target="selector"` opcional). Generaliza el patrón
 * ya usado por data-hc-sort/data-hc-resize (tableInteractions.ts) más allá
 * de tablas, a pedido del usuario 2026-09-28 ("busco algo más dinámico
 * pero sin que llegue a ser inseguro" para comportamientos JS en tarjetas).
 *
 * INVARIANTE DE SEGURIDAD (misma lección que el hallazgo de
 * calculated_columns, 2026-09-29): el modelo NUNCA escribe código — solo
 * NOMBRES DE ACCIÓN y ARGUMENTOS de texto plano, parseados con split()
 * puro. Nunca `new Function()`/`eval()` sobre lo que el modelo escriba acá.
 * Cualquier acción nueva se agrega como una función más en ACTIONS (código
 * auditado del plugin), nunca interpretando texto del modelo como
 * expresión ejecutable.
 */

export type RegisterCleanup = (dispose: () => void) => void;

interface ActionContext {
  container: HTMLElement;
  registerCleanup: RegisterCleanup;
}

type ActionHandler = (
  target: HTMLElement,
  args: string[],
  ctx: ActionContext,
) => void;

const ALLOWED_EVENTS = new Set([
  'click',
  'dblclick',
  'mouseenter',
  'mouseleave',
  'change',
  'submit',
  // 'load' es sintético (no hay evento DOM por elemento) -- la acción se
  // corre inmediatamente al escanear el elemento, en vez de engancharse
  // con addEventListener. Se re-dispara en cada re-render (cada vez que
  // cambian los datos de la tarjeta), no solo en el montaje inicial.
  'load',
]);

function splitClassNames(raw: string | undefined): string[] {
  return (raw ?? '').split(/\s+/).filter(Boolean);
}

const ACTIONS: Record<string, ActionHandler> = {
  toggleClass: (target, [classNames]) =>
    splitClassNames(classNames).forEach(cls => target.classList.toggle(cls)),
  addClass: (target, [classNames]) =>
    splitClassNames(classNames).forEach(cls => target.classList.add(cls)),
  removeClass: (target, [classNames]) =>
    splitClassNames(classNames).forEach(cls => target.classList.remove(cls)),
  toggleAttr: (target, [attrName]) => {
    if (attrName) target.toggleAttribute(attrName);
  },
  scrollTo: (target, [behavior]) => {
    target.scrollIntoView({
      behavior: behavior === 'auto' ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  },
  setStyleVar: (target, [varNameRaw, value]) => {
    if (!varNameRaw) return;
    const varName = varNameRaw.startsWith('--') ? varNameRaw : `--${varNameRaw}`;
    target.style.setProperty(varName, value ?? '');
  },
  copyText: target => {
    const text = target.dataset.hcCopyValue ?? target.textContent ?? '';
    if (!text || !navigator.clipboard?.writeText) return;
    navigator.clipboard.writeText(text).catch(() => {
      // portapapeles no disponible (permiso denegado, contexto no seguro) -- silencioso
    });
  },
  countUp: (target, [toRaw, durationRaw, suffixRaw], ctx) => {
    const to = Number(toRaw);
    if (!Number.isFinite(to)) return;
    const duration = Math.max(0, Number(durationRaw) || 800);
    const suffix = suffixRaw ?? '';
    const fromRaw = target.dataset.hcCountFrom ?? target.textContent ?? '0';
    const from = Number(String(fromRaw).replace(/[^0-9.-]/g, '')) || 0;
    const decimals = (toRaw.split('.')[1] || '').length;
    // `start` se fija en el timestamp del PRIMER frame real (el `now` que
    // recibe el primer callback de rAF), no en el momento en que se llama
    // `countUp`. Si se fijara acá con `performance.now()`, un hilo
    // principal ocupado (otros gráficos cargando, inicialización pesada)
    // puede demorar ese primer callback más que `duration` entero — la
    // animación entera colapsa en un solo salto instantáneo al valor
    // final, sin ningún frame intermedio visible (bug real encontrado en
    // vivo, 2026-10-05: la tarjeta mostraba el número final de una, sin
    // contar — los atributos data-hc-on/data-hc-action llegaban intactos
    // al DOM, así que no era un problema de sanitización ni de render).
    let start: number | null = null;
    let frameId = 0;
    const tick = (now: number) => {
      const elapsedSince = start ?? now;
      start = elapsedSince;
      const progress = duration === 0 ? 1 : Math.min(1, (now - elapsedSince) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const current = from + (to - from) * eased;
      target.textContent = current.toFixed(decimals) + suffix;
      if (progress < 1) {
        frameId = requestAnimationFrame(tick);
      }
    };
    frameId = requestAnimationFrame(tick);
    ctx.registerCleanup(() => cancelAnimationFrame(frameId));
  },
};

/**
 * Parsea `data-hc-action="toggleClass:is-open; scrollTo:smooth"` en una
 * lista de `{name, args}` -- SOLO split()/trim(), nunca evaluado como
 * código. Varias acciones se separan con `;`, los argumentos de una misma
 * acción con `,`.
 */
export function parseActions(raw: string): { name: string; args: string[] }[] {
  return raw
    .split(';')
    .map(chunk => chunk.trim())
    .filter(Boolean)
    .map(chunk => {
      const sep = chunk.indexOf(':');
      const name = (sep === -1 ? chunk : chunk.slice(0, sep)).trim();
      const argsRaw = sep === -1 ? '' : chunk.slice(sep + 1);
      const args = argsRaw
        .split(',')
        .map(arg => arg.trim())
        .filter(arg => arg.length > 0);
      return { name, args };
    })
    .filter(({ name }) => name.length > 0);
}

function resolveTarget(el: HTMLElement, container: HTMLElement): HTMLElement {
  const selector = el.dataset.hcTarget;
  if (!selector) return el;
  try {
    return container.querySelector<HTMLElement>(selector) ?? el;
  } catch {
    // selector inválido escrito por el modelo -- no romper el resto del render
    return el;
  }
}

/**
 * Escanea `container` por `[data-hc-on][data-hc-action]` y engancha los
 * eventos declarados a las acciones del registro ACTIONS. Devuelve una
 * función de limpieza que remueve todo lo que esta llamada enganchó
 * (seguro de llamar de nuevo en el próximo render) -- mismo contrato que
 * `initTableInteractions`.
 */
export function initDynamicActions(container: HTMLElement | null): () => void {
  const disposers: Array<() => void> = [];
  const registerCleanup: RegisterCleanup = dispose => disposers.push(dispose);

  if (container) {
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>('[data-hc-on][data-hc-action]'),
    );

    elements.forEach(el => {
      const eventName = el.dataset.hcOn?.trim();
      const actionsRaw = el.dataset.hcAction;
      if (!eventName || !actionsRaw || !ALLOWED_EVENTS.has(eventName)) {
        return;
      }
      const actions = parseActions(actionsRaw);
      if (!actions.length) return;

      const handler = (event: Event) => {
        if (eventName === 'submit') {
          event.preventDefault();
        }
        const target = resolveTarget(el, container);
        actions.forEach(({ name, args }) => {
          const action = ACTIONS[name];
          if (!action) {
            // eslint-disable-next-line no-console
            console.warn(`[html-cards] data-hc-action desconocida: "${name}"`);
            return;
          }
          action(target, args, { container, registerCleanup });
        });
      };

      if (eventName === 'load') {
        // Sin listener: corre ahora mismo, en cada escaneo (cada render).
        handler({ type: 'load' } as Event);
        return;
      }

      el.addEventListener(eventName, handler);
      registerCleanup(() => el.removeEventListener(eventName, handler));
    });
  }

  return () => disposers.forEach(dispose => dispose());
}
