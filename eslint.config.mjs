import next from 'eslint-config-next'
import nextTypescript from 'eslint-config-next/typescript'

const PURE_ENGINE_RULES = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: 'El motor es puro (BR-054): las fechas entran como parámetro.',
    },
    {
      selector: "MemberExpression[object.name='Date'][property.name='now']",
      message: 'El motor es puro (BR-054): no lee el reloj.',
    },
    {
      selector: "MemberExpression[object.name='Math'][property.name='random']",
      message: 'El motor es determinista (BR-054): sin aleatoriedad.',
    },
  ],
}

const config = [
  {
    ignores: [
      '.next/**',
      '.netlify/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      // Duplicados que crea iCloud: ".next 3", "page 2.tsx"…
      '**/* [0-9]/**',
      '**/* [0-9].*',
    ],
  },
  ...next,
  ...nextTypescript,
  {
    files: ['src/lib/payroll/engine/**/*.ts'],
    rules: PURE_ENGINE_RULES,
  },
  {
    // money.ts es la única frontera autorizada para tocar `Math`: valida que un
    // `number` de entrada represente centavos exactos antes de convertirlo.
    // Ningún otro archivo del motor puede redondear por su cuenta.
    files: ['src/lib/payroll/engine/**/*.ts'],
    ignores: ['src/lib/payroll/engine/money.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Math', message: 'Redondear solo con money.ts. Nada de Math.round en dinero.' },
      ],
    },
  },
]

export default config
