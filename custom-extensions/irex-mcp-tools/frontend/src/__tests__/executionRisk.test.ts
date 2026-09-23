import { assessExecutionRisk } from '../assistant/executionRisk';

describe('assessExecutionRisk — lecturas legítimas no piden confirmación reforzada', () => {
  test.each([
    'SELECT anio_id, sum(venta) FROM ventas GROUP BY 1',
    'WITH a AS (SELECT 1) SELECT * FROM a;',
    'SELECT update_date, deleted_flag FROM t',
    "SELECT 'DELETE FROM t; DROP' AS txt -- insert into x\nFROM t",
    'SELECT "update", `drop` FROM t /* truncate */',
    'SELECT $$ delete $$ AS s',
    'SELECT * FROM t WHERE d >= {{ from_dttm }} {# DELETE #}',
    'SELECT arr[1] FROM t SETTINGS max_threads = 2',
  ])('%s', sql => {
    expect(assessExecutionRisk(sql)).toEqual({ reinforced: false, reasons: [] });
  });
});

describe('assessExecutionRisk — escrituras, DDL y varias sentencias piden confirmación reforzada', () => {
  test.each([
    ['DELETE FROM t', 'DELETE'],
    ['WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'DELETE'],
    ['SELECT * INTO nueva FROM t', 'INTO'],
    ['select * from t for update', 'UPDATE'],
    ['EXPLAIN ANALYZE SELECT 1', 'ANALYZE'],
    ["SELECT 'it''s'; DROP TABLE t", 'DROP'],
    ['{% if true %} DELETE FROM t {% endif %}', 'DELETE'],
    ['TRUNCATE t', 'TRUNCATE'],
  ])('%s', (sql, keyword) => {
    const risk = assessExecutionRisk(sql);
    expect(risk.reinforced).toBe(true);
    expect(risk.reasons.join(' ')).toContain(keyword);
  });

  test('varias sentencias de solo lectura también piden reforzada', () => {
    const risk = assessExecutionRisk('SELECT 1; SELECT 2');
    expect(risk.reinforced).toBe(true);
    expect(risk.reasons[0]).toContain('2 sentencias');
  });

  test('un ; final sin nada después no cuenta como segunda sentencia', () => {
    expect(assessExecutionRisk('SELECT 1;  \n').reinforced).toBe(false);
  });
});
