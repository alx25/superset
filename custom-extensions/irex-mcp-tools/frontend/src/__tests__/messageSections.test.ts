import { splitAssistantMessage, stripRedundantHeading } from '../assistant/messageSections';

describe('splitAssistantMessage', () => {
  test('con encabezados: la primera sección es el resumen y el resto el detalle', () => {
    const message = '## Resultado clave\n\n- Falta un índice.\n\n## Detalle\n\nEl filtro usa make_date().\n\n## Riesgos\n\nNinguno.';
    expect(splitAssistantMessage(message)).toEqual({
      summary: '- Falta un índice.',
      details: '## Detalle\n\nEl filtro usa make_date().\n\n## Riesgos\n\nNinguno.',
    });
  });

  test('conserva el texto previo al primer encabezado dentro del resumen', () => {
    expect(splitAssistantMessage('Listo.\n## A\nuno\n## B\ndos')).toEqual({ summary: 'Listo.\n\nuno', details: '## B\ndos' });
  });

  test('un solo encabezado: no hay detalle que plegar', () => {
    expect(splitAssistantMessage('## Resultado\n\nTodo bien.')).toEqual({ summary: 'Todo bien.', details: '' });
  });

  test('sin encabezados: primer párrafo como resumen', () => {
    expect(splitAssistantMessage('Primer párrafo.\n\nSegundo.\n\nTercero.')).toEqual({
      summary: 'Primer párrafo.',
      details: 'Segundo.\n\nTercero.',
    });
  });

  test('normaliza CRLF y maneja mensajes vacíos', () => {
    expect(splitAssistantMessage('Uno.\r\n\r\nDos.')).toEqual({ summary: 'Uno.', details: 'Dos.' });
    expect(splitAssistantMessage('   ')).toEqual({ summary: '', details: '' });
  });

  test('encabezado sin contenido propio: todo va al resumen', () => {
    expect(splitAssistantMessage('## Solo título')).toEqual({ summary: '## Solo título', details: '' });
  });
});

describe('stripRedundantHeading', () => {
  test.each(['## Detalle', '### Detalles', '## Más detalle:', '## Explicación', '## ¿Por qué?'])('quita "%s"', heading => {
    expect(stripRedundantHeading(`${heading}\n\nTexto.`)).toBe('Texto.');
  });

  test('conserva encabezados con contenido propio y el resto de las secciones', () => {
    expect(stripRedundantHeading('## Riesgos\n\nNinguno.')).toBe('## Riesgos\n\nNinguno.');
    expect(stripRedundantHeading('## Detalle\n\nUno.\n\n## Riesgos\n\nDos.')).toBe('Uno.\n\n## Riesgos\n\nDos.');
  });
});
