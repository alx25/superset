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
 * Historial de conversaciones por gráfico GUARDADO, para el comando
 * `/resume` del composer (pedido del usuario 2026-09-28: "debería tener un
 * historial ligado a ese gráfico, aunque también poder iniciar una sesión
 * nueva sin contexto viejo").
 *
 * Distinto de `exploreUndo.ts` en dos cosas: usa `localStorage` (sobrevive
 * a cerrar la pestaña/el navegador, no solo un reload) y guarda VARIAS
 * conversaciones por gráfico, no una sola de un solo uso.
 *
 * Solo se persiste por `slice_id` (gráfico GUARDADO) — uno sin guardar no
 * tiene identidad estable entre visitas (el `form_data_key` cambia todo el
 * tiempo), así que no hay bajo qué key ofrecer "retomar" ahí.
 *
 * Confirmado con el backend del chat (2026-09-28): reenviar el mismo
 * `conversation_key` (no el `session_id`, que ellos derivan de
 * usuario+key) hace que el backend rehidrate el historial guardado en
 * Postgres si salió de la caché en memoria (TTL de 30 min ahí, sin TTL en
 * el almacén persistente) — por eso alcanza con guardar el `conversationKey`
 * acá para que `/resume` reconstruya tanto la conversación visible (con
 * el texto del usuario, que el log de diagnóstico NO guarda) como el
 * contexto real del modelo del lado del backend.
 */

import type { PersistedConversationSnapshot } from './exploreUndo';

const STORAGE_KEY_PREFIX = 'irex-explore-chat-history:';
/** No es un límite de tiempo (el usuario pidió explícitamente que no
 * venza) — es un tope de CANTIDAD para no crecer sin límite en
 * localStorage; la más vieja se descarta recién al superar este número. */
const MAX_CONVERSATIONS_PER_CHART = 10;

export interface PersistedConversationEntry extends PersistedConversationSnapshot {
  updatedAt: number;
}

function storageKey(sliceId: number): string {
  return `${STORAGE_KEY_PREFIX}${sliceId}`;
}

function readEntries(sliceId: number): PersistedConversationEntry[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(sliceId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersistedConversationEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.conversationKey === 'string' &&
        typeof entry.mode === 'string' &&
        Array.isArray(entry.history) &&
        typeof entry.updatedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeEntries(sliceId: number, entries: PersistedConversationEntry[]): void {
  try {
    window.localStorage.setItem(storageKey(sliceId), JSON.stringify(entries));
  } catch {
    // localStorage no disponible (ventana privada, cuota superada, etc.) —
    // el comando /resume simplemente no tendrá nada que ofrecer, sin
    // romper el resto del panel.
  }
}

/** Guarda o actualiza una conversación para este gráfico. No hace nada si
 * la conversación está vacía (nunca se mandó un mensaje) — no tiene
 * sentido ofrecer "retomar" algo que nunca empezó. */
export function recordConversationEntry(
  sliceId: number | null,
  snapshot: PersistedConversationSnapshot,
): void {
  if (sliceId === null || snapshot.history.length === 0) return;
  const existing = readEntries(sliceId).filter(entry => entry.conversationKey !== snapshot.conversationKey);
  const updated: PersistedConversationEntry[] = [{ ...snapshot, updatedAt: Date.now() }, ...existing]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS_PER_CHART);
  writeEntries(sliceId, updated);
}

/** Todas las conversaciones guardadas para este gráfico, más reciente
 * primero. Lista vacía si no hay ninguna o si el gráfico no está guardado. */
export function listConversationEntries(sliceId: number | null): PersistedConversationEntry[] {
  if (sliceId === null) return [];
  return readEntries(sliceId).sort((a, b) => b.updatedAt - a.updatedAt);
}
