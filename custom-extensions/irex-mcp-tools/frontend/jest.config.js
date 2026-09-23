/**
 * Tests de frontend (Fase 9 de PLAN_ASISTENTE_SQL_LAB.md).
 *
 * La config de Babel va acá adentro y no en un babel.config.js a propósito:
 * webpack compila con ts-loader, así que un babel.config.js global no
 * cambiaría el build, pero dejarlo acá evita cualquier duda.
 *
 * `@apache-superset/core` en node_modules solo trae tipos: la implementación
 * real la inyecta el host por Module Federation. En tests se reemplaza por
 * un doble controlable (src/__tests__/supersetCoreMock.tsx).
 */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^@apache-superset/core$': '<rootDir>/src/__tests__/supersetCoreMock.tsx',
  },
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-react',
          '@babel/preset-typescript',
        ],
      },
    ],
  },
};
