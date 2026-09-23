import React from 'react';

/**
 * Íconos de trazo simples, dibujados a mano (sin dependencia nueva: el
 * bundle de la extensión es chico y `lucide-react` sumaría ~30 KB por unos
 * pocos íconos). Heredan `currentColor`, así siguen el tema claro/oscuro.
 * Son decorativos (`aria-hidden`): el texto o el `aria-label` del botón que
 * los contiene es lo que lee un lector de pantalla.
 */
export type IconName =
  | 'sparkles'
  | 'reset'
  | 'copy'
  | 'check'
  | 'send'
  | 'info'
  | 'warning'
  | 'error'
  | 'chevron'
  | 'expand'
  | 'collapse'
  | 'zap'
  | 'selection'
  | 'filePlus'
  | 'apply'
  | 'play'
  | 'close';

const PATHS: Record<IconName, string[]> = {
  sparkles: ['M12 3l1.8 4.9L19 9.7l-5.2 1.9L12 16.5l-1.8-4.9L5 9.7l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
  reset: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  send: ['M4 12l16-8-6 16-2.5-6.5z', 'M11.5 13.5L20 4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v6', 'M12 7.5v.5'],
  warning: ['M12 3.5L22 20.5H2z', 'M12 10v4.5', 'M12 17.5v.5'],
  error: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9 9l6 6', 'M15 9l-6 6'],
  chevron: ['M6 9l6 6 6-6'],
  expand: ['M14 4h6v6', 'M10 20H4v-6', 'M20 4l-7 7', 'M4 20l7-7'],
  collapse: ['M4 14h6v6', 'M20 10h-6V4', 'M10 14l-7 7', 'M14 10l7-7'],
  zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
  selection: ['M4 7V4h3', 'M17 4h3v3', 'M20 17v3h-3', 'M7 20H4v-3', 'M8 10h8', 'M8 14h5'],
  filePlus: ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M12 11v6', 'M9 14h6'],
  apply: ['M20 5v7a3 3 0 0 1-3 3H6', 'M10 11l-4 4 4 4'],
  play: ['M7 4.5v15l13-7.5z'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
};

export interface IconProps {
  name: IconName;
  size?: number;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 14, style }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {PATHS[name].map(d => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
