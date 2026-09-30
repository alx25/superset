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
 * Diff línea por línea propio (sin dependencia nueva) para la pestaña
 * "Cambios" del diff de `styleTemplate`/`handlebarsTemplate` — pedido del
 * usuario 2026-09-30 ("mejora la UI", con una referencia visual tipo git
 * diff unificado: +/- por línea, numeradas, con contexto colapsado en vez
 * de mostrar el bloque completo dos veces). LCS clásico por
 * programación dinámica — para CSS/HTML de unos pocos miles de caracteres
 * (el caso real de esta app) el costo O(n·m) es insignificante.
 */

export interface DiffLine {
  type: 'context' | 'added' | 'removed';
  text: string;
  beforeLineNumber?: number;
  afterLineNumber?: number;
}

export type DiffRenderItem = DiffLine | { type: 'ellipsis' };

/** LCS línea por línea -- cada línea de `before`/`after` es un símbolo. */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const n = beforeLines.length;
  const m = afterLines.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let beforeLineNo = 1;
  let afterLineNo = 1;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      result.push({ type: 'context', text: beforeLines[i], beforeLineNumber: beforeLineNo, afterLineNumber: afterLineNo });
      i += 1;
      j += 1;
      beforeLineNo += 1;
      afterLineNo += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'removed', text: beforeLines[i], beforeLineNumber: beforeLineNo });
      i += 1;
      beforeLineNo += 1;
    } else {
      result.push({ type: 'added', text: afterLines[j], afterLineNumber: afterLineNo });
      j += 1;
      afterLineNo += 1;
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: beforeLines[i], beforeLineNumber: beforeLineNo });
    i += 1;
    beforeLineNo += 1;
  }
  while (j < m) {
    result.push({ type: 'added', text: afterLines[j], afterLineNumber: afterLineNo });
    j += 1;
    afterLineNo += 1;
  }
  return result;
}

/** Colapsa corridas largas de líneas SIN cambios a un solo marcador
 * `{type: 'ellipsis'}`, conservando `contextSize` líneas de contexto antes
 * y después de cada cambio -- igual criterio que un diff unificado de git. */
export function collapseContext(lines: DiffLine[], contextSize = 1): DiffRenderItem[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, idx) => {
    if (line.type !== 'context') {
      for (let k = Math.max(0, idx - contextSize); k <= Math.min(lines.length - 1, idx + contextSize); k += 1) {
        keep[k] = true;
      }
    }
  });

  const result: DiffRenderItem[] = [];
  let i = 0;
  while (i < lines.length) {
    if (keep[i]) {
      result.push(lines[i]);
      i += 1;
    } else {
      while (i < lines.length && !keep[i]) i += 1;
      result.push({ type: 'ellipsis' });
    }
  }
  return result;
}

/** true si el diff no tiene ningún cambio real (ej. dos formularios
 * distintos que formatean igual) -- para no mostrar una pestaña "Cambios"
 * vacía o engañosa. */
export function hasLineChanges(lines: DiffLine[]): boolean {
  return lines.some(line => line.type !== 'context');
}
