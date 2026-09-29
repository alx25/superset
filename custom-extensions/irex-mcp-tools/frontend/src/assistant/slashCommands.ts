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
 * Comandos "/" del composer del asistente de Explore (pedido del usuario
 * 2026-09-28: "/resume o /clear, con autocompletado cuando la primera
 * letra sea /"). Registro chico y extensible a propósito — agregar un
 * comando nuevo es sumar una entrada acá, sin tocar el parser.
 */
export interface SlashCommandDef {
  name: string;
  hint: string;
}

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { name: 'resume', hint: 'Retomar una conversación anterior de este gráfico' },
  { name: 'clear', hint: 'Empezar una conversación nueva (igual que "Nueva sesión")' },
];

export type ParsedSlashInput =
  | { isCommand: true; name: string; args: string }
  | { isCommand: false };

/** Reconoce un comando solo si el texto ENTERO (recortado) es `/nombre` o
 * `/nombre argumentos` y `nombre` coincide con uno registrado — así un
 * mensaje real que arranca con "/" (poco común, pero posible) nunca se
 * confunde con un comando: si no matchea un nombre conocido, se manda
 * como texto normal. */
export function parseSlashInput(text: string): ParsedSlashInput {
  const trimmed = text.trim();
  const match = /^\/([a-zA-Z]+)(?:\s+(.*))?$/.exec(trimmed);
  if (!match) return { isCommand: false };
  const name = match[1].toLowerCase();
  if (!SLASH_COMMANDS.some(cmd => cmd.name === name)) return { isCommand: false };
  return { isCommand: true, name, args: (match[2] ?? '').trim() };
}

/** Para el menú de autocompletado: `query` es lo que el usuario escribió
 * después de la "/" hasta ahora (puede estar vacío, recién tipeada la
 * barra). Coincidencia por prefijo, sin distinguir mayúsculas. */
export function matchingSlashCommands(query: string): SlashCommandDef[] {
  const needle = query.toLowerCase();
  return SLASH_COMMANDS.filter(cmd => cmd.name.startsWith(needle));
}

/** true mientras el usuario está en medio de tipear el NOMBRE del comando
 * (antes del primer espacio) — es la ventana en la que tiene sentido
 * mostrar el menú de autocompletado; una vez que hay un espacio (está
 * tipeando los argumentos, o ya no es un comando) el menú se cierra. */
export function isTypingSlashCommandName(text: string): { active: boolean; query: string } {
  const match = /^\/([a-zA-Z]*)$/.exec(text);
  if (!match) return { active: false, query: '' };
  return { active: true, query: match[1] };
}
