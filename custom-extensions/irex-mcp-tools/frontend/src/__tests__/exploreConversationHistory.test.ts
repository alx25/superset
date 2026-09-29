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
import { listConversationEntries, recordConversationEntry } from '../hosts/exploreConversationHistory';
import type { PersistedConversationSnapshot } from '../hosts/exploreUndo';

function snapshot(overrides: Partial<PersistedConversationSnapshot> = {}): PersistedConversationSnapshot {
  return {
    conversationKey: 'key-1',
    sessionId: 'explore-session-1',
    mode: 'explain',
    history: [{ role: 'user', text: 'hola' }, { role: 'assistant', text: 'respuesta' }],
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('recordConversationEntry / listConversationEntries', () => {
  test('gráfico sin guardar (sliceId null) no persiste nada', () => {
    recordConversationEntry(null, snapshot());
    expect(listConversationEntries(null)).toEqual([]);
  });

  test('conversación vacía (sin mensajes) no se guarda', () => {
    recordConversationEntry(7, snapshot({ history: [] }));
    expect(listConversationEntries(7)).toEqual([]);
  });

  test('una conversación real se guarda y se puede listar', () => {
    recordConversationEntry(7, snapshot());
    const entries = listConversationEntries(7);
    expect(entries).toHaveLength(1);
    expect(entries[0].conversationKey).toBe('key-1');
    expect(entries[0].history).toHaveLength(2);
    expect(typeof entries[0].updatedAt).toBe('number');
  });

  test('no mezcla conversaciones de gráficos distintos', () => {
    recordConversationEntry(7, snapshot({ conversationKey: 'key-a' }));
    recordConversationEntry(8, snapshot({ conversationKey: 'key-b' }));
    expect(listConversationEntries(7).map(e => e.conversationKey)).toEqual(['key-a']);
    expect(listConversationEntries(8).map(e => e.conversationKey)).toEqual(['key-b']);
  });

  test('grabar de nuevo con la MISMA conversationKey actualiza en vez de duplicar', () => {
    recordConversationEntry(7, snapshot({ history: [{ role: 'user', text: 'primero' }] }));
    recordConversationEntry(
      7,
      snapshot({ history: [{ role: 'user', text: 'primero' }, { role: 'assistant', text: 'segundo' }] }),
    );
    const entries = listConversationEntries(7);
    expect(entries).toHaveLength(1);
    expect(entries[0].history).toHaveLength(2);
  });

  test('conversaciones distintas del mismo gráfico quedan todas, más reciente primero', () => {
    recordConversationEntry(7, snapshot({ conversationKey: 'key-old' }));
    recordConversationEntry(7, snapshot({ conversationKey: 'key-new' }));
    const entries = listConversationEntries(7);
    expect(entries.map(e => e.conversationKey)).toEqual(['key-new', 'key-old']);
  });

  test('tope de 10 conversaciones por gráfico — la más vieja se descarta', () => {
    for (let i = 0; i < 12; i += 1) {
      recordConversationEntry(7, snapshot({ conversationKey: `key-${i}` }));
    }
    const entries = listConversationEntries(7);
    expect(entries).toHaveLength(10);
    // las dos primeras (key-0, key-1) quedaron afuera; la más nueva es key-11.
    expect(entries[0].conversationKey).toBe('key-11');
    expect(entries.map(e => e.conversationKey)).not.toContain('key-0');
    expect(entries.map(e => e.conversationKey)).not.toContain('key-1');
  });

  test('JSON corrupto en localStorage no rompe, se trata como vacío', () => {
    window.localStorage.setItem('irex-explore-chat-history:7', '{not valid json');
    expect(listConversationEntries(7)).toEqual([]);
  });

  test('un array con entradas mal formadas se filtra en vez de romper', () => {
    window.localStorage.setItem(
      'irex-explore-chat-history:7',
      JSON.stringify([{ conversationKey: 'ok', mode: 'explain', history: [], updatedAt: 1 }, { garbage: true }, null]),
    );
    // La entrada "ok" tiene history vacío -> igual pasa el filtro de forma
    // (solo valida FORMA al leer, no si tiene mensajes -- ese chequeo es
    // de escritura, en recordConversationEntry).
    expect(listConversationEntries(7)).toHaveLength(1);
  });

  test('listConversationEntries(null) siempre vacío, sin tocar storage', () => {
    recordConversationEntry(7, snapshot());
    expect(listConversationEntries(null)).toEqual([]);
  });
});
