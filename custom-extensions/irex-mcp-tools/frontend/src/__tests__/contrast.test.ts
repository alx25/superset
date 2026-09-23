import { buttonDanger, contrastRatio, readableOn, type PanelTheme } from '../assistant/ui';

// Tokens reales que produce Ant Design con THEME_DEFAULT/THEME_DARK de esta
// instalación (2026-09-23). Si cambia el tema, actualizar estos valores.
const LIGHT = { primary: '#1d428a', error: '#ff4d4f' };
const DARK = { primary: '#83ad36', error: '#dc4446' };

describe('contrastRatio', () => {
  test('valores de referencia WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.48, 1);
  });

  test('acepta rgb/rgba y devuelve undefined si no puede leer el color', () => {
    expect(contrastRatio('rgb(0, 0, 0)', '#fff')).toBeCloseTo(21, 1);
    expect(contrastRatio('var(--x)', '#fff')).toBeUndefined();
  });
});

describe('readableOn: texto de botones rellenos con contraste AA en los dos temas', () => {
  test.each([
    ['primario claro', LIGHT.primary],
    ['primario oscuro', DARK.primary],
    ['error claro', LIGHT.error],
  ])('%s', (_label, background) => {
    expect(contrastRatio(readableOn(background), background)).toBeGreaterThanOrEqual(4.5);
  });

  test('en el primario oscuro NO elige blanco (blanco daba 2.6:1)', () => {
    expect(contrastRatio('#ffffff', DARK.primary)).toBeLessThan(3);
    expect(readableOn(DARK.primary)).not.toBe('#ffffff');
  });

  test('error oscuro: elige la mejor opción disponible (≥ 4.2:1)', () => {
    expect(contrastRatio(readableOn(DARK.error), DARK.error)).toBeGreaterThanOrEqual(4.2);
  });
});

describe('buttonDanger', () => {
  const themeWith = (colorError: string, colorBgContainer: string, colorText: string) =>
    ({ colorError, colorBgContainer, colorText, borderRadiusSM: 4 }) as unknown as PanelTheme;

  test('tema claro: relleno rojo con texto AA', () => {
    const style = buttonDanger(themeWith(LIGHT.error, '#ffffff', '#1f1f1f'));
    expect(style.background).toBe(LIGHT.error);
    expect(contrastRatio(String(style.color), LIGHT.error)).toBeGreaterThanOrEqual(4.5);
  });

  test('tema oscuro: cae a contorno porque ningún texto llega a AA sobre ese rojo', () => {
    const style = buttonDanger(themeWith(DARK.error, '#1f1f1f', '#e0e0e0'));
    expect(style.background).toBe('#1f1f1f');
    expect(style.borderColor).toBe(DARK.error);
    expect(contrastRatio(String(style.color), '#1f1f1f')).toBeGreaterThanOrEqual(4.5);
  });
});
