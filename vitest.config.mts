import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * Los archivos corren en secuencia porque varios usan la base REAL y dos de
     * ellos desactivan candados (triggers) un instante para limpiar: si corren
     * a la vez, uno prueba un candado justo cuando el otro lo tiene apagado y
     * falla "a veces". La suite completa tarda ~2 s; no se pierde nada.
     */
    fileParallelism: false,
    coverage: {
      include: ['src/lib/payroll/engine/**'],
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
})
