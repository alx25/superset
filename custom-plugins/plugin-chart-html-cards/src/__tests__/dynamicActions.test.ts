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
import { initDynamicActions, parseActions } from '../utils/dynamicActions';

describe('parseActions', () => {
  test('una acción simple sin argumentos', () => {
    expect(parseActions('toggleClass')).toEqual([{ name: 'toggleClass', args: [] }]);
  });

  test('una acción con un argumento', () => {
    expect(parseActions('toggleClass:is-open')).toEqual([
      { name: 'toggleClass', args: ['is-open'] },
    ]);
  });

  test('una acción con varios argumentos separados por coma', () => {
    expect(parseActions('countUp:1234,1200')).toEqual([
      { name: 'countUp', args: ['1234', '1200'] },
    ]);
  });

  test('varias acciones separadas por punto y coma', () => {
    expect(parseActions('toggleClass:is-open; scrollTo:smooth')).toEqual([
      { name: 'toggleClass', args: ['is-open'] },
      { name: 'scrollTo', args: ['smooth'] },
    ]);
  });

  test('espacios alrededor de los tokens se recortan', () => {
    expect(parseActions('  toggleClass : is-open , other-class  ')).toEqual([
      { name: 'toggleClass', args: ['is-open', 'other-class'] },
    ]);
  });

  test('string vacío da lista vacía', () => {
    expect(parseActions('')).toEqual([]);
    expect(parseActions('   ')).toEqual([]);
  });

  test('nunca evalúa nada -- un intento de inyectar código queda como texto plano', () => {
    // Esto NO debe ejecutar nada -- "alert(1)" es simplemente el nombre de
    // una acción desconocida, como cualquier otro string.
    const parsed = parseActions('alert(1)');
    expect(parsed).toEqual([{ name: 'alert(1)', args: [] }]);
  });
});

describe('initDynamicActions', () => {
  function renderInto(html: string): HTMLDivElement {
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    return container;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('toggleClass en click alterna la clase en el propio elemento', () => {
    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="toggleClass:is-open">x</button>',
    );
    const dispose = initDynamicActions(container);
    const button = container.querySelector('button')!;

    button.click();
    expect(button.classList.contains('is-open')).toBe(true);
    button.click();
    expect(button.classList.contains('is-open')).toBe(false);

    dispose();
  });

  test('data-hc-target aplica la acción a OTRO elemento, no al que disparó el evento', () => {
    const container = renderInto(`
      <button id="btn" data-hc-on="click" data-hc-action="toggleClass:open" data-hc-target="#panel">x</button>
      <div id="panel"></div>
    `);
    const dispose = initDynamicActions(container);
    container.querySelector<HTMLButtonElement>('#btn')!.click();

    expect(container.querySelector('#panel')!.classList.contains('open')).toBe(true);
    expect(container.querySelector('#btn')!.classList.contains('open')).toBe(false);

    dispose();
  });

  test('varias acciones encadenadas con ; se aplican todas', () => {
    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="addClass:a; addClass:b">x</button>',
    );
    const dispose = initDynamicActions(container);
    container.querySelector('button')!.click();

    const button = container.querySelector('button')!;
    expect(button.classList.contains('a')).toBe(true);
    expect(button.classList.contains('b')).toBe(true);
    dispose();
  });

  test('un data-hc-on con un evento fuera de la allowlist no engancha nada', () => {
    const container = renderInto(
      '<div data-hc-on="mouseover" data-hc-action="toggleClass:x">y</div>',
    );
    const dispose = initDynamicActions(container);
    const el = container.querySelector('div')!;
    el.dispatchEvent(new Event('mouseover'));
    expect(el.classList.contains('x')).toBe(false);
    dispose();
  });

  test('una acción desconocida no rompe el resto de las acciones encadenadas', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="fetchSomething:evil; addClass:safe">x</button>',
    );
    const dispose = initDynamicActions(container);
    const button = container.querySelector('button')!;
    button.click();

    expect(button.classList.contains('safe')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('fetchSomething'),
    );

    warnSpy.mockRestore();
    dispose();
  });

  test('dispose() remueve el listener -- clicks posteriores no hacen nada', () => {
    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="toggleClass:is-open">x</button>',
    );
    const dispose = initDynamicActions(container);
    const button = container.querySelector('button')!;
    dispose();

    button.click();
    expect(button.classList.contains('is-open')).toBe(false);
  });

  test('setStyleVar antepone -- si el nombre no lo trae', () => {
    const container = renderInto(
      '<div data-hc-on="click" data-hc-action="setStyleVar:accent,red">x</div>',
    );
    const dispose = initDynamicActions(container);
    const el = container.querySelector('div')!;
    el.click();
    expect(el.style.getPropertyValue('--accent')).toBe('red');
    dispose();
  });

  test('copyText lee data-hc-copy-value en vez del texto visible cuando está presente', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="copyText" data-hc-copy-value="ABC-123">Copiar</button>',
    );
    const dispose = initDynamicActions(container);
    container.querySelector('button')!.click();

    expect(writeText).toHaveBeenCalledWith('ABC-123');
    dispose();
  });

  test('data-hc-on="load" corre la acción inmediatamente, sin esperar ningún evento', () => {
    const container = renderInto(
      '<div data-hc-on="load" data-hc-action="addClass:visible">x</div>',
    );
    const dispose = initDynamicActions(container);
    expect(container.querySelector('div')!.classList.contains('visible')).toBe(true);
    dispose();
  });

  test('data-hc-on="load" se re-dispara en cada llamada (cada re-render)', () => {
    const container = renderInto(
      '<div data-hc-on="load" data-hc-action="toggleClass:seen">x</div>',
    );
    const dispose1 = initDynamicActions(container);
    const el = container.querySelector('div')!;
    expect(el.classList.contains('seen')).toBe(true);
    dispose1();
    const dispose2 = initDynamicActions(container);
    expect(el.classList.contains('seen')).toBe(false); // toggle otra vez
    dispose2();
  });

  test('countUp con sufijo lo agrega al final del texto animado', async () => {
    const container = renderInto(
      '<span data-hc-on="load" data-hc-action="countUp:50,10,%" data-hc-count-from="0">0%</span>',
    );
    const dispose = initDynamicActions(container);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(container.querySelector('span')!.textContent).toBe('50%');
    dispose();
  });

  test('selector inválido en data-hc-target no rompe el render -- cae al propio elemento', () => {
    const container = renderInto(
      '<button data-hc-on="click" data-hc-action="toggleClass:x" data-hc-target=":::invalid:::">y</button>',
    );
    const dispose = initDynamicActions(container);
    const button = container.querySelector('button')!;
    expect(() => button.click()).not.toThrow();
    expect(button.classList.contains('x')).toBe(true);
    dispose();
  });
});
