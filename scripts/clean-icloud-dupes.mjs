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
import { fileURLToPath } from 'node:url'

/*
 * `fileURLToPath` y NO `.pathname`.
 *
 * Esta carpeta vive en «Documentos - MacBook Pro de Juan», con espacios, y
 * `.pathname` los devuelve como %20. `readdir` no encuentra esa ruta, el
 * `catch` de abajo se traga el error y el script termina diciendo que todo
 * está bien sin haber mirado un solo archivo. Estuvo así hasta el 16/08:
 * el guardián de los duplicados de iCloud no guardaba nada.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP = new Set(['node_modules', '.git'])
const DUPLICATE = /^(.*?) \d+(\.[^.]+)?$/

let removed = 0

async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    // Una carpeta que desaparece a mitad del recorrido es normal; que no se
    // pueda leer la RAÍZ no lo es, y callarlo fue justo lo que escondió el
    // error durante semanas.
    if (directory === ROOT) throw error
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
