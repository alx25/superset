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
 * "Deshacer" de la Fase 6 (PLAN_COPILOTO_EXPLORE.md): aplicar un cambio
 * recarga la página completa (`exploreApplyAdapter.ts`), así que cualquier
 * estado de React se pierde en el momento — esto es lo único que sobrevive
 * a esa recarga, en `sessionStorage` (por pestaña, no por dispositivo).
 * Un solo nivel: la key de INMEDIATAMENTE antes del último "Aplicar", no
 * una pila completa — alcanza para el caso real ("me equivoqué, volvé")
 * sin la complejidad de un historial completo de deshacer/rehacer.
 */

const STORAGE_KEY = 'irex-explore-pending-undo';

/** Un turno del historial del chat, tal cual lo pinta `ExploreConversation`
 * — forma mínima y propia (no importa `ConversationMessage` de
 * `assistant/`) para no crear una dependencia hosts→assistant; la forma
 * real es estructuralmente compatible, así que no hace falta convertir
 * nada al guardar. */
export interface PersistedConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Lo mínimo para reconstruir la conversación tal como estaba justo antes
 * de aplicar — "Aplicar" recarga la página entera (no hay forma de
 * evitarlo sin acceso al store de Explore, que la extensión no tiene) y
 * eso borra cualquier estado de React, incluida la conversación. Se
 * restaura con el MISMO ciclo de vida que "Deshacer": mientras el aviso
 * siga vigente (mismo gráfico, misma key recién aplicada), la conversación
 * reaparece; en cuanto deja de coincidir, también deja de ofrecerse. */
export interface PersistedConversationSnapshot {
  conversationKey: string;
  sessionId?: string;
  mode: string;
  history: PersistedConversationTurn[];
}

export interface PendingExploreUndo {
  /** `slice_id` del gráfico en el momento de aplicar — null si era un
   * gráfico sin guardar. Sirve para no ofrecer "Deshacer" en un gráfico
   * distinto al que originó el cambio. */
  sliceId: number | null;
  /** La form_data_key de ANTES de aplicar — a la que vuelve "Deshacer". */
  previousFormDataKey: string;
  /** La form_data_key que quedó activa después de aplicar — si la URL
   * actual no tiene esta key, el cambio ya no está "recién aplicado"
   * (el usuario navegó a otra cosa) y no corresponde ofrecer deshacer. */
  appliedFormDataKey: string;
  /** Descripción corta de qué se aplicó, para el aviso. */
  title: string;
  appliedAt: number;
  /** Opcional: la conversación de la que salió este cambio, para
   * restaurarla tras el reload. Ausente en entradas viejas (compatibilidad
   * hacia atrás — `sessionStorage` puede sobrevivir a un redeploy). */
  conversation?: PersistedConversationSnapshot;
}

export function rememberPendingUndo(undo: PendingExploreUndo): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(undo));
  } catch {
    // sessionStorage no disponible (ventana privada, etc.) — "Deshacer" no
    // sobrevive a la recarga, pero aplicar el cambio ya funcionó.
  }
}

/** Solo devuelve la entrada si de verdad corresponde al gráfico y a la key
 * ACTUALES — evita ofrecer "Deshacer" para un cambio de otro gráfico, o
 * para uno que ya se deshizo/perdió vigencia. */
export function readPendingUndo(currentSliceId: number | null, currentFormDataKey: string | undefined): PendingExploreUndo | undefined {
  let raw: string | null;
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  let undo: PendingExploreUndo;
  try {
    undo = JSON.parse(raw) as PendingExploreUndo;
  } catch {
    return undefined;
  }
  if (undo.sliceId !== currentSliceId || undo.appliedFormDataKey !== currentFormDataKey) return undefined;
  return undo;
}

export function clearPendingUndo(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
