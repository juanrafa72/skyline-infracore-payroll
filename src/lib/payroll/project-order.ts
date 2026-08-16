/**
 * En qué orden se ofrecen los proyectos.
 *
 * Son 21 y el selector aparece en CADA fila: en una semana de 40 personas son
 * 40 listas de 21 pueblos, y alfabéticamente el que se necesita puede estar de
 * último. En la práctica una semana se trabaja en dos o tres sitios, así que
 * los que ya se usaron van arriba y el resto queda debajo, separado.
 *
 * Puro: se prueba sin base ni pantalla.
 */

export interface ProjectOption {
  id: string
  name: string
}

export interface ProjectGroups {
  /** Los que ya aparecen en la semana. Vacío al empezar. */
  enUso: ProjectOption[]
  /** Todos los demás, alfabéticos. */
  resto: ProjectOption[]
}

/**
 * Separa los proyectos que ya se están usando de los demás.
 *
 * No los reordena dentro de cada grupo más allá del alfabético: si la lista
 * cambiara de orden cada vez que alguien marca un día, la posición dejaría de
 * ser memoria muscular y habría que leerla entera siempre.
 */
export function agruparProyectos(
  todos: readonly ProjectOption[],
  idsEnUso: Iterable<string | null | undefined>,
): ProjectGroups {
  const usados = new Set<string>()
  for (const id of idsEnUso) {
    if (id) usados.add(id)
  }

  const enUso: ProjectOption[] = []
  const resto: ProjectOption[] = []
  for (const proyecto of todos) {
    if (usados.has(proyecto.id)) enUso.push(proyecto)
    else resto.push(proyecto)
  }

  const alfabetico = (a: ProjectOption, b: ProjectOption) => a.name.localeCompare(b.name, 'es')
  return { enUso: enUso.sort(alfabetico), resto: resto.sort(alfabetico) }
}
