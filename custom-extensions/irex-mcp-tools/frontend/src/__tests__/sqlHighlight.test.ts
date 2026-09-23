import { DARK_CODE_PALETTE, looksLikeSql, tokenizeSql, type SqlTokenType } from '../assistant/sqlHighlight';
import { contrastRatio } from '../assistant/ui';

const typesOf = (sql: string) => tokenizeSql(sql).filter(t => t.type !== 'plain').map(t => `${t.type}:${t.text}`);

describe('tokenizeSql', () => {
  test('nunca altera el texto: concatenar los tokens devuelve el original', () => {
    const sql = "SELECT j.key, (j.value)::numeric AS espacio -- nota\nFROM t CROSS JOIN LATERAL jsonb_each_text(t.data) j\nWHERE x = 'it''s' AND n >= 1.5e3 /* c */ {{ from_dttm }}";
    expect(tokenizeSql(sql).map(t => t.text).join('')).toBe(sql);
  });

  test('palabras clave, casts, funciones y literales', () => {
    expect(typesOf("select sum(v.monto)::int from t where a = 'x' and b > 10")).toEqual([
      'keyword:select', 'function:sum', 'operator:::', 'type:int', 'keyword:from', 'keyword:where',
      'operator:=', 'string:\'x\'', 'keyword:and', 'operator:>', 'number:10',
    ]);
  });

  test('comentarios, Jinja y dollar-quoting', () => {
    expect(typesOf('-- hola\n{% if x %}{{ y }}{% endif %} $$ a $$ {# c #}')).toEqual([
      'comment:-- hola', 'template:{% if x %}', 'template:{{ y }}', 'template:{% endif %}', 'string:$$ a $$', 'comment:{# c #}',
    ]);
  });

  test('identificadores entre comillas, dígitos dentro de nombres y tipos fuera de un cast', () => {
    expect(typesOf('SELECT "select", col2, date FROM t')).toEqual(['keyword:SELECT', 'keyword:FROM']);
  });

  test('un nombre calificado seguido de ( no es función (schema.tabla)', () => {
    expect(typesOf('FROM public.ventas (x)')).toEqual(['keyword:FROM']);
  });
});

test('looksLikeSql', () => {
  expect(looksLikeSql('SELECT a FROM t')).toBe(true);
  expect(looksLikeSql('with x as (select 1) select * from x')).toBe(true);
  expect(looksLikeSql('{"a": 1}')).toBe(false);
  expect(looksLikeSql('pip install requests')).toBe(false);
});

test('la paleta del código cumple AA sobre el fondo oscuro fijo (#1e1e2e)', () => {
  (Object.keys(DARK_CODE_PALETTE) as SqlTokenType[]).forEach(type => {
    const color = DARK_CODE_PALETTE[type]?.color;
    if (typeof color === 'string') expect(contrastRatio(color, '#1e1e2e')).toBeGreaterThanOrEqual(4.5);
  });
});
