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
import {
  isTypingSlashCommandName,
  matchingSlashCommands,
  parseSlashInput,
  SLASH_COMMANDS,
} from '../assistant/slashCommands';

describe('parseSlashInput', () => {
  test('reconoce un comando registrado sin argumentos', () => {
    expect(parseSlashInput('/clear')).toEqual({ isCommand: true, name: 'clear', args: '' });
  });

  test('reconoce un comando registrado con argumentos', () => {
    expect(parseSlashInput('/resume 2')).toEqual({ isCommand: true, name: 'resume', args: '2' });
  });

  test('recorta espacios alrededor', () => {
    expect(parseSlashInput('  /resume  ')).toEqual({ isCommand: true, name: 'resume', args: '' });
  });

  test('no distingue mayúsculas en el nombre', () => {
    expect(parseSlashInput('/RESUME')).toEqual({ isCommand: true, name: 'resume', args: '' });
  });

  test('un mensaje normal nunca se confunde con un comando', () => {
    expect(parseSlashInput('agregá una métrica')).toEqual({ isCommand: false });
  });

  test('un "/" seguido de algo que no es un comando conocido se manda como mensaje normal', () => {
    expect(parseSlashInput('/explicame esto por favor')).toEqual({ isCommand: false });
  });

  test('texto vacío no es un comando', () => {
    expect(parseSlashInput('')).toEqual({ isCommand: false });
    expect(parseSlashInput('   ')).toEqual({ isCommand: false });
  });

  test('solo la "/" sola todavía no es un comando (nombre vacío no matchea ninguno registrado)', () => {
    expect(parseSlashInput('/')).toEqual({ isCommand: false });
  });
});

describe('isTypingSlashCommandName', () => {
  test('activo mientras se tipea el nombre, sin espacio todavía', () => {
    expect(isTypingSlashCommandName('/re')).toEqual({ active: true, query: 're' });
    expect(isTypingSlashCommandName('/')).toEqual({ active: true, query: '' });
  });

  test('inactivo apenas aparece un espacio (ya está en los argumentos)', () => {
    expect(isTypingSlashCommandName('/resume ')).toEqual({ active: false, query: '' });
    expect(isTypingSlashCommandName('/resume 2')).toEqual({ active: false, query: '' });
  });

  test('inactivo para texto que no arranca con "/"', () => {
    expect(isTypingSlashCommandName('hola')).toEqual({ active: false, query: '' });
    expect(isTypingSlashCommandName('')).toEqual({ active: false, query: '' });
  });
});

describe('matchingSlashCommands', () => {
  test('sin query, devuelve todos los comandos registrados', () => {
    expect(matchingSlashCommands('')).toEqual(SLASH_COMMANDS);
  });

  test('filtra por prefijo, sin distinguir mayúsculas', () => {
    expect(matchingSlashCommands('resu').map(c => c.name)).toEqual(['resume']);
    expect(matchingSlashCommands('RESU').map(c => c.name)).toEqual(['resume']);
  });

  test('un prefijo compartido por varios comandos los devuelve a todos', () => {
    expect(matchingSlashCommands('re').map(c => c.name).sort()).toEqual(['resume', 'review']);
  });

  test('prefijo que no matchea nada da lista vacía', () => {
    expect(matchingSlashCommands('zzz')).toEqual([]);
  });
});

test('el registro tiene resume, clear, explain, metrics y review, sin ningún nombre repetido', () => {
  const names = SLASH_COMMANDS.map(c => c.name);
  expect(names).toContain('resume');
  expect(names).toContain('clear');
  expect(names).toContain('explain');
  expect(names).toContain('metrics');
  expect(names).toContain('review');
  expect(new Set(names).size).toBe(names.length);
});

test('/review se reconoce como comando, con y sin detalle', () => {
  expect(parseSlashInput('/review')).toEqual({ isCommand: true, name: 'review', args: '' });
  expect(parseSlashInput('/review los meses se ven desordenados')).toEqual({
    isCommand: true,
    name: 'review',
    args: 'los meses se ven desordenados',
  });
});

test('/explain y /metrics se reconocen como comandos, con y sin argumentos', () => {
  expect(parseSlashInput('/explain')).toEqual({ isCommand: true, name: 'explain', args: '' });
  expect(parseSlashInput('/metrics una métrica de promedio')).toEqual({
    isCommand: true,
    name: 'metrics',
    args: 'una métrica de promedio',
  });
});
