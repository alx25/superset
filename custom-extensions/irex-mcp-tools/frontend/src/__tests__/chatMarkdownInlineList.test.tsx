import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../assistant/ChatMarkdown';

// El modelo a veces enumera sugerencias sin saltos de línea reales
// ("Sugerencias: 1) A 2) B 3) C"), volviendo la respuesta un bloque denso
// (reportado por el usuario con captura). ChatMarkdown lo detecta y lo
// separa en un párrafo introductorio + una lista real.
describe('ChatMarkdown — enumeración pegada en un solo párrafo', () => {
  test('separa intro + 3 ítems cuando la secuencia empieza en 1) y es correlativa', () => {
    render(<ChatMarkdown text="Sugerencias para evaluar: 1) Revisa el formato. 2) Considera desactivarla. 3) Compará el orden." />);
    expect(screen.getByText('Sugerencias para evaluar:')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Revisa el formato.');
    expect(items[1]).toHaveTextContent('Considera desactivarla.');
    expect(items[2]).toHaveTextContent('Compará el orden.');
    expect(screen.getByRole('list').tagName).toBe('OL');
  });

  test('acepta el marcador con punto ("1. ") igual que con paréntesis ("1) ")', () => {
    render(<ChatMarkdown text="Pasos: 1. Primero. 2. Segundo." />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test('sin introducción (arranca directo en "1)"), no deja un párrafo vacío', () => {
    const { container } = render(<ChatMarkdown text="1) Uno. 2) Dos. 3) Tres." />);
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  test('una sola mención numérica suelta NO dispara la lista (falso positivo)', () => {
    const { container } = render(<ChatMarkdown text="La reunión es a las 3) horas, avisale." />);
    expect(container.querySelectorAll('ol, ul')).toHaveLength(0);
    expect(screen.getByText(/La reunión es a las 3\) horas, avisale\./)).toBeInTheDocument();
  });

  test('números no correlativos (1, 3) NO disparan la lista', () => {
    const { container } = render(<ChatMarkdown text="Mirá el punto 1) y también el 3) del documento." />);
    expect(container.querySelectorAll('ol, ul')).toHaveLength(0);
  });

  test('la secuencia debe empezar en 1) — "2) X 3) Y" no dispara la lista', () => {
    const { container } = render(<ChatMarkdown text="Como dijimos en 2) el punto anterior, y en 3) el siguiente." />);
    expect(container.querySelectorAll('ol, ul')).toHaveLength(0);
  });

  test('una lista real con saltos de línea (el caso ya soportado) sigue funcionando igual', () => {
    render(<ChatMarkdown text={'Sugerencias:\n1. Uno\n2. Dos'} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  test('un párrafo de varias líneas físicas con marcadores no se toca (evita falsos positivos multilínea)', () => {
    // Dos líneas separadas por un salto de línea simple (mismo párrafo,
    // sin línea en blanco entre medio) — no es el caso que se quiere cubrir
    // (una sola línea física densa), así que se deja como antes.
    const { container } = render(<ChatMarkdown text={'Primero, 1) revisá esto.\nDespués, 2) revisá lo otro.'} />);
    expect(container.querySelectorAll('ol, ul')).toHaveLength(0);
  });
});
