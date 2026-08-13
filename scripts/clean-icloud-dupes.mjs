/**
 * Borra los archivos duplicados que crea iCloud.
 *
 * El proyecto vive dentro de una carpeta sincronizada con iCloud. Cuando iCloud
 * detecta un conflicto crea una copia llamada "archivo 2.ts". Esas copias
 * rompen la compilación: TypeScript ve dos veces la misma definición y Next ve
 * dos veces la misma pantalla.
 *
 * Se ejecuta solo, antes de compilar.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SKIP = new Set(['node_modules', '.git'])
const DUPLICATE = /^(.*?) \d+(\.[^.]+)?$/

let removed = 0

async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const path = join(directory, entry.name)

    if (DUPLICATE.test(entry.name)) {
      await rm(path, { recursive: true, force: true })
      console.log(`  duplicado de iCloud eliminado: ${path.replace(ROOT, '')}`)
      removed += 1
      continue
    }
    if (entry.isDirectory()) await walk(path)
  }
}

await walk(ROOT)
if (removed > 0) console.log(`${removed} duplicado(s) de iCloud eliminados.`)
