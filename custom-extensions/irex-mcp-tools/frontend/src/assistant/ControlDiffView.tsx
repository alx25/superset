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
import React, { useMemo, useState } from 'react';
import { theme as themeNs } from '@apache-superset/core';
import type { ControlDiffEntry } from '../adapters/exploreApplyAdapter';
import { formatControlDiffValue } from '../adapters/exploreApplyAdapter';
import { formatCodeForDiff } from './codeFormat';
import { collapseContext, computeLineDiff, hasLineChanges, type DiffRenderItem } from './lineDiff';
import { FONT, MONO, type PanelTheme } from './ui';

/** Bloque de código con scroll propio (no `<span>` inline) — el CSS/HTML
 * real de un `styleTemplate`/`handlebarsTemplate` fácilmente pasa los miles
 * de caracteres; sin esto se ve todo apretado en una sola línea envuelta. */
export function CodeBlock({ text, emphasis }: { text: string; emphasis?: boolean }): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <pre
      style={{
        margin: 0,
        padding: '6px 8px',
        maxHeight: 220,
        overflow: 'auto',
        whiteSpace: 'pre',
        fontFamily: MONO,
        fontSize: FONT.small,
        lineHeight: 1.45,
        color: theme.colorText,
        background: theme.colorFillQuaternary ?? theme.colorBgContainer,
        borderRadius: theme.borderRadiusSM,
        fontWeight: emphasis ? 600 : 400,
      }}
    >
      {text}
    </pre>
  );
}

/** Una línea del diff unificado. Nunca colorea TEXTO con colorSuccess/
 * colorError directamente (no llegan a contraste AA como texto, ver
 * ui.ts) — el color semántico va solo en el fondo (tenue) y el borde
 * izquierdo; el texto siempre es colorText/colorTextSecondary. */
function DiffLineRow({ item, theme }: { item: DiffRenderItem; theme: PanelTheme }): React.ReactElement {
  if (item.type === 'ellipsis') {
    return (
      <div style={{ padding: '2px 8px', color: theme.colorTextSecondary, textAlign: 'center', fontFamily: MONO }}>
        ···
      </div>
    );
  }
  const bg = item.type === 'added' ? theme.colorSuccessBg : item.type === 'removed' ? theme.colorErrorBg : undefined;
  const borderColor = item.type === 'added' ? theme.colorSuccess : item.type === 'removed' ? theme.colorError : 'transparent';
  const prefix = item.type === 'added' ? '+' : item.type === 'removed' ? '-' : ' ';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 24px 12px 1fr',
        background: bg ?? (theme.colorFillQuaternary ?? theme.colorBgContainer),
        borderLeft: `3px solid ${borderColor}`,
        whiteSpace: 'pre',
      }}
    >
      <span style={{ textAlign: 'right', paddingRight: 4, color: theme.colorTextSecondary, userSelect: 'none' }}>
        {item.beforeLineNumber ?? ''}
      </span>
      <span style={{ textAlign: 'right', paddingRight: 4, color: theme.colorTextSecondary, userSelect: 'none' }}>
        {item.afterLineNumber ?? ''}
      </span>
      <span style={{ color: theme.colorTextSecondary, userSelect: 'none' }}>{prefix}</span>
      <span style={{ color: theme.colorText }}>{item.text}</span>
    </div>
  );
}

function UnifiedDiffView({ lines }: { lines: DiffRenderItem[] }): React.ReactElement {
  const theme = themeNs.useTheme();
  return (
    <div
      style={{
        maxHeight: 260,
        overflow: 'auto',
        fontFamily: MONO,
        fontSize: FONT.small,
        lineHeight: 1.5,
        borderRadius: theme.borderRadiusSM,
      }}
    >
      {lines.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <DiffLineRow key={index} item={item} theme={theme} />
      ))}
    </div>
  );
}

type DiffTab = 'cambios' | 'antes' | 'despues';

function DiffTabButton({
  label,
  active,
  onClick,
  theme,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  theme: PanelTheme;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '4px 9px',
        fontSize: FONT.small,
        fontWeight: active ? 600 : 400,
        color: theme.colorText,
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? theme.colorPrimary : 'transparent'}`,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** styleTemplate/handlebarsTemplate con antes/después definidos: pestañas
 * "Cambios" (diff unificado, contexto colapsado — pedido del usuario
 * 2026-09-30, referencia visual tipo diff de git) / "Antes" / "Después"
 * (el bloque completo formateado, para cuando hace falta ver todo). */
function CodeDiffTabs({ control, beforeCode, afterCode }: { control: string; beforeCode: string; afterCode: string }): React.ReactElement {
  const theme = themeNs.useTheme();
  const diffLines = useMemo(() => collapseContext(computeLineDiff(beforeCode, afterCode), 1), [beforeCode, afterCode]);
  const rawLines = useMemo(() => computeLineDiff(beforeCode, afterCode), [beforeCode, afterCode]);
  const changed = hasLineChanges(rawLines);
  const [tab, setTab] = useState<DiffTab>('cambios');

  return (
    <div>
      <code style={{ fontFamily: MONO, fontWeight: 600, fontSize: FONT.small }}>{control}</code>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${theme.colorBorderSecondary}`, margin: '4px 0 0' }}>
        <DiffTabButton label="Cambios" active={tab === 'cambios'} onClick={() => setTab('cambios')} theme={theme} />
        <DiffTabButton label="Antes" active={tab === 'antes'} onClick={() => setTab('antes')} theme={theme} />
        <DiffTabButton label="Después" active={tab === 'despues'} onClick={() => setTab('despues')} theme={theme} />
      </div>
      <div style={{ marginTop: 4 }}>
        {tab === 'cambios' &&
          (changed ? <UnifiedDiffView lines={diffLines} /> : (
            <div style={{ padding: '6px 8px', fontSize: FONT.small, color: theme.colorTextSecondary }}>
              El formato no cambió — solo espacios/orden distintos al del modelo.
            </div>
          ))}
        {tab === 'antes' && <CodeBlock text={beforeCode} />}
        {tab === 'despues' && <CodeBlock text={afterCode} emphasis />}
      </div>
    </div>
  );
}

export function ControlDiffRow({ entry }: { entry: ControlDiffEntry }): React.ReactElement {
  const theme = themeNs.useTheme();
  // CSS/HTML (styleTemplate/handlebarsTemplate): formateado con indentación
  // real — el modelo los entrega minificados en una sola línea (pedido del
  // usuario 2026-09-28). Con ambos lados presentes, se arma el diff
  // unificado con pestañas; si falta alguno (control agregado/quitado del
  // todo), se muestra antes/después apilado como antes.
  const beforeCode = formatCodeForDiff(entry.control, entry.before);
  const afterCode = formatCodeForDiff(entry.control, entry.after);
  if (beforeCode !== undefined && afterCode !== undefined) {
    return (
      <div style={{ fontSize: FONT.small, lineHeight: 1.5 }}>
        <CodeDiffTabs control={entry.control} beforeCode={beforeCode} afterCode={afterCode} />
      </div>
    );
  }
  if (beforeCode !== undefined || afterCode !== undefined) {
    return (
      <div style={{ fontSize: FONT.small, lineHeight: 1.5 }}>
        <code style={{ fontFamily: MONO, fontWeight: 600 }}>{entry.control}</code>
        <div style={{ paddingLeft: 8, color: theme.colorTextSecondary, marginTop: 4 }}>antes:</div>
        <CodeBlock text={beforeCode ?? formatControlDiffValue(entry.control, entry.before)} />
        <div style={{ paddingLeft: 8, color: theme.colorTextSecondary, marginTop: 6 }}>después:</div>
        <CodeBlock text={afterCode ?? formatControlDiffValue(entry.control, entry.after)} emphasis />
      </div>
    );
  }
  return (
    <div style={{ fontSize: FONT.small, lineHeight: 1.5 }}>
      <code style={{ fontFamily: MONO, fontWeight: 600 }}>{entry.control}</code>
      <div style={{ paddingLeft: 8, color: theme.colorTextSecondary }}>
        antes: <span style={{ color: theme.colorText }}>{formatControlDiffValue(entry.control, entry.before)}</span>
      </div>
      <div style={{ paddingLeft: 8, color: theme.colorTextSecondary }}>
        después: <span style={{ color: theme.colorText, fontWeight: 600 }}>{formatControlDiffValue(entry.control, entry.after)}</span>
      </div>
    </div>
  );
}
