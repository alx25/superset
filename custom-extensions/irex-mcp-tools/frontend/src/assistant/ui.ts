import type React from 'react';
import type { theme as themeNs } from '@apache-superset/core';

export type PanelTheme = ReturnType<typeof themeNs.useTheme>;

/**
 * Escala tipográfica compacta del panel. Piso de 11px para cualquier texto
 * legible: el mockup de referencia bajaba a 9–10px, pero ahí el texto deja
 * de ser cómodo y los grises claros no llegan a contraste AA. Los textos
 * secundarios usan `colorTextSecondary` (≈5.7:1 sobre blanco) y NUNCA
 * `colorTextTertiary` (≈3.9:1, no llega al 4.5:1 de WCAG AA en texto chico).
 */
export const FONT = {
  base: 12,
  small: 11,
  code: 11.5,
  title: 13,
} as const;

export const MONO = "'SF Mono', 'JetBrains Mono', Consolas, Monaco, monospace";

// ---------------------------------------------------------------------------
// Contraste (WCAG 2.x). Verificado contra los tokens reales que produce el
// algoritmo de Ant Design con THEME_DEFAULT/THEME_DARK de esta instalación
// (2026-09-23): los `color*Text` semánticos (ámbar, rojo, verde) NO llegan a
// 4.5:1 en tema claro (1.8–3.0), y el blanco sobre `colorPrimary` NO llega en
// tema oscuro (2.6). Por eso: el texto siempre usa colorText/colorTextSecondary
// (el color semántico queda para íconos, bordes y fondos), y el texto de los
// botones rellenos se elige en runtime con `readableOn`.
// ---------------------------------------------------------------------------

function parseColor(color: string): [number, number, number, number] | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1];
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgb) {
    const [r, g, b, a = '1'] = rgb[1].split(',').map(p => p.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  return undefined;
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return undefined;
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#141414';

/** Texto legible sobre un fondo sólido: blanco o casi negro, el que dé más
 * contraste. Si el color no se puede leer, blanco (el caso habitual). */
export function readableOn(background: string): string {
  const light = contrastRatio(LIGHT_TEXT, background);
  const dark = contrastRatio(DARK_TEXT, background);
  if (light === undefined || dark === undefined) return LIGHT_TEXT;
  return light >= dark ? LIGHT_TEXT : DARK_TEXT;
}

export function buttonBase(theme: PanelTheme): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    border: '1px solid transparent',
    borderRadius: theme.borderRadiusSM,
    padding: '4px 9px',
    fontSize: FONT.small,
    fontWeight: 500,
    lineHeight: 1.4,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

export function buttonPrimary(theme: PanelTheme): React.CSSProperties {
  return { ...buttonBase(theme), background: theme.colorPrimary, color: readableOn(theme.colorPrimary) };
}

/** Botón de acción con riesgo (ejecutar): borde ámbar y texto normal. El
 * ámbar como color de TEXTO no llega a contraste AA en tema claro. */
export function buttonWarning(theme: PanelTheme): React.CSSProperties {
  return {
    ...buttonBase(theme),
    background: theme.colorBgContainer,
    color: theme.colorText,
    borderColor: theme.colorWarning,
  };
}

/** Acción destructiva. Relleno rojo si algún color de texto llega a AA
 * sobre ese rojo; si no (rojo del tema oscuro: 4.2:1 como máximo), variante
 * con contorno: fondo del panel, borde rojo y texto normal. */
export function buttonDanger(theme: PanelTheme): React.CSSProperties {
  const text = readableOn(theme.colorError);
  if ((contrastRatio(text, theme.colorError) ?? 0) >= 4.5) {
    return { ...buttonBase(theme), background: theme.colorError, color: text };
  }
  return { ...buttonBase(theme), background: theme.colorBgContainer, color: theme.colorText, borderColor: theme.colorError };
}

export function buttonGhost(theme: PanelTheme): React.CSSProperties {
  return {
    ...buttonBase(theme),
    background: theme.colorBgContainer,
    color: theme.colorTextSecondary,
    borderColor: theme.colorBorder,
  };
}

/** Botón solo-ícono (o ícono + texto corto) sin borde, para barras de herramientas. */
export function buttonIcon(theme: PanelTheme): React.CSSProperties {
  return {
    ...buttonBase(theme),
    padding: '3px 6px',
    background: 'transparent',
    color: theme.colorTextSecondary,
  };
}

/** Tarjeta base del área de resultados. */
export function card(theme: PanelTheme): React.CSSProperties {
  return {
    border: `1px solid ${theme.colorBorderSecondary}`,
    borderRadius: theme.borderRadius,
    background: theme.colorBgContainer,
    overflow: 'hidden',
  };
}

/**
 * Oculta el marcador nativo de `<summary>` en Safari/Chrome antiguos
 * (`list-style: none` inline cubre el resto). Va acotado a una clase propia,
 * sin CSS global.
 */
export const DETAILS_RESET_CSS = `
  .irex-details > summary { list-style: none; }
  .irex-details > summary::-webkit-details-marker { display: none; }
  .irex-details[open] > summary .irex-chevron { transform: rotate(180deg); }
`;
