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
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ControlDiffRow } from '../assistant/ControlDiffView';

describe('ControlDiffRow', () => {
  test('control CSS con antes/después: arranca en la pestaña "Cambios" con el diff unificado', () => {
    render(
      <ControlDiffRow
        entry={{
          control: 'styleTemplate',
          before: '.a{color:red;border-radius:10px}',
          after: '.a{color:red;border-radius:14px}',
        }}
      />,
    );
    expect(screen.getByText('styleTemplate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Antes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Después' })).toBeInTheDocument();
    // la línea removida y la agregada aparecen, la que no cambió no se duplica fuera de contexto
    expect(screen.getByText('border-radius:10px')).toBeInTheDocument();
    expect(screen.getByText('border-radius:14px')).toBeInTheDocument();
  });

  test('click en "Antes"/"Después" muestra el bloque completo formateado de ese lado', () => {
    render(
      <ControlDiffRow
        entry={{
          control: 'styleTemplate',
          before: '.a{color:red;border-radius:10px}',
          after: '.a{color:red;border-radius:14px}',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Antes' }));
    expect(screen.getByText(/border-radius:10px/)).toBeInTheDocument();
    expect(screen.queryByText(/border-radius:14px/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Después' }));
    expect(screen.getByText(/border-radius:14px/)).toBeInTheDocument();
    expect(screen.queryByText(/border-radius:10px/)).toBeNull();
  });

  test('antes y después idénticos (sin cambios reales) -- la pestaña Cambios lo dice, no se cuelga vacía', () => {
    render(
      <ControlDiffRow
        entry={{
          control: 'styleTemplate',
          before: '.a{color:red}',
          after: '.a{color:red}',
        }}
      />,
    );
    expect(screen.getByText(/El formato no cambió/)).toBeInTheDocument();
  });

  test('un control que no es CSS/HTML sigue el resumen legible de siempre (sin pestañas)', () => {
    render(<ControlDiffRow entry={{ control: 'row_limit', before: 100, after: 1000 }} />);
    expect(screen.queryByRole('button', { name: 'Cambios' })).toBeNull();
    expect(screen.getByText('row_limit')).toBeInTheDocument();
    expect(screen.getByText('antes:')).toBeInTheDocument();
    expect(screen.getByText('después:')).toBeInTheDocument();
  });

  test('control agregado (sin "antes" real): antes/después apilado, sin pestañas de diff', () => {
    render(
      <ControlDiffRow
        entry={{
          control: 'styleTemplate',
          before: undefined,
          after: '.a{color:red}',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cambios' })).toBeNull();
    expect(screen.getByText('antes:')).toBeInTheDocument();
    expect(screen.getByText('después:')).toBeInTheDocument();
  });
});
