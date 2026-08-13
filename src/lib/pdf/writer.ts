/**
 * Generador de PDF mínimo, sin dependencias.
 *
 * Por qué no una librería: un PDF de una página con texto y líneas es un
 * formato de texto que cabe en este archivo. Traer un paquete para esto
 * agregaría megas al despliegue serverless — que es justo lo que estamos
 * cuidando — y una dependencia más que mantener sobre un documento contable.
 *
 * Cubre lo que necesitan los soportes: Helvetica normal y negrita, texto
 * alineado a izquierda o derecha, líneas, rectángulos y varias páginas.
 * Los acentos y la ñ funcionan porque el texto se escribe en Latin-1 con
 * WinAnsiEncoding, que es lo que entienden las fuentes base del formato.
 */

const PAGE_WIDTH = 612 // carta, en puntos
const PAGE_HEIGHT = 792

/** Anchos de Helvetica, en milésimas de em (tabla estándar del formato). */
const REGULAR: Record<number, number> = buildWidths(
  '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 ' +
    '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 ' +
    '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 ' +
    '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 ' +
    '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584',
)

const BOLD: Record<number, number> = buildWidths(
  '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 ' +
    '556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 ' +
    '975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 ' +
    '667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 ' +
    '333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 ' +
    '611 611 389 556 333 611 556 778 556 556 500 389 280 389 584',
)

function buildWidths(spec: string): Record<number, number> {
  const values = spec.trim().split(/\s+/).map(Number)
  const table: Record<number, number> = {}
  values.forEach((width, index) => {
    table[32 + index] = width
  })
  return table
}

/**
 * Las vocales acentuadas y la ñ miden lo mismo que su letra base en Helvetica,
 * así que se mide por la base. Sin esto, una columna de nombres con tildes
 * quedaría desalineada.
 */
const ACCENT_BASE = 'AAAAAAACEEEEIIIIDNOOOOOxOUUUUYPsaaaaaaaceeeeiiiidnooooo/ouuuuypy'

function charWidth(code: number, bold: boolean): number {
  const table = bold ? BOLD : REGULAR
  if (code >= 32 && code <= 126) return table[code] ?? 556
  if (code >= 0xc0 && code <= 0xff) {
    const base = ACCENT_BASE.charCodeAt(code - 0xc0)
    return table[base] ?? 556
  }
  return table[63] ?? 556 // desconocido: se mide como '?'
}

/** Ancho de un texto en puntos. */
export function textWidth(text: string, size: number, bold = false): number {
  let total = 0
  for (const character of text) {
    total += charWidth(character.charCodeAt(0), bold)
  }
  return (total * size) / 1000
}

/**
 * Recorta un texto para que quepa.
 *
 * Los tres puntos van sueltos, no como el carácter «…»: el archivo se escribe
 * en Latin-1 y ese carácter no existe ahí, saldría convertido en basura.
 */
export function ellipsize(text: string, maxWidth: number, size: number, bold = false): string {
  if (textWidth(text, size, bold) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return `${cut.trimEnd()}...`
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

export interface TextOptions {
  size?: number
  bold?: boolean
  align?: 'left' | 'right' | 'center'
  /** Gris de 0 (negro) a 1 (blanco). */
  gray?: number
}

/**
 * Un documento. Las coordenadas van con el origen arriba a la izquierda, que
 * es como piensa cualquiera; el formato las usa al revés y aquí se traducen.
 */
export class PdfDocument {
  readonly width = PAGE_WIDTH
  readonly height = PAGE_HEIGHT

  private pages: string[] = []
  private current: string[] = []

  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    const size = options.size ?? 10
    const bold = options.bold ?? false
    const font = bold ? '/F2' : '/F1'

    let left = x
    if (options.align === 'right') left = x - textWidth(value, size, bold)
    if (options.align === 'center') left = x - textWidth(value, size, bold) / 2

    const gray = options.gray ?? 0
    this.current.push(
      `BT ${gray} g ${font} ${size} Tf 1 0 0 1 ${left.toFixed(2)} ${(PAGE_HEIGHT - y).toFixed(2)} Tm (${escapeText(value)}) Tj ET`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, gray = 0.8, thickness = 0.5): void {
    this.current.push(
      `${gray} G ${thickness} w ${x1.toFixed(2)} ${(PAGE_HEIGHT - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_HEIGHT - y2).toFixed(2)} l S`,
    )
  }

  rect(x: number, y: number, width: number, height: number, gray = 0.94): void {
    this.current.push(
      `${gray} g ${x.toFixed(2)} ${(PAGE_HEIGHT - y - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    )
  }

  newPage(): void {
    this.pages.push(this.current.join('\n'))
    this.current = []
  }

  /** Cierra el documento y devuelve los bytes del archivo. */
  build(): Buffer {
    const last = this.current.join('\n')
    // Si se pidió página nueva y no se escribió nada, no se emite una en blanco.
    const contents = last === '' && this.pages.length > 0 ? [...this.pages] : [...this.pages, last]
    const pageCount = contents.length

    // 1 catálogo, 2 páginas, 3 y 4 fuentes; después, por página, el objeto de
    // página y el de contenido.
    const firstPageObject = 5
    const pageIds = contents.map((_, index) => firstPageObject + index * 2)

    const objects: string[] = [
      `<< /Type /Catalog /Pages 2 0 R >>`,
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`,
    ]

    const streams: Array<{ index: number; body: string }> = []

    contents.forEach((body, index) => {
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPageObject + index * 2 + 1} 0 R >>`,
      )
      objects.push('') // marcador: se reemplaza abajo por el flujo
      streams.push({ index: objects.length - 1, body })
    })

    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')]
    const offsets: number[] = []
    let position = parts[0]!.length

    objects.forEach((definition, index) => {
      const number = index + 1
      const stream = streams.find((item) => item.index === index)

      const chunk = stream
        ? Buffer.from(
            `${number} 0 obj\n<< /Length ${Buffer.byteLength(stream.body, 'latin1')} >>\nstream\n${stream.body}\nendstream\nendobj\n`,
            'latin1',
          )
        : Buffer.from(`${number} 0 obj\n${definition}\nendobj\n`, 'latin1')

      offsets.push(position)
      parts.push(chunk)
      position += chunk.length
    })

    const xrefStart = position
    const xref = [
      `xref`,
      `0 ${objects.length + 1}`,
      `0000000000 65535 f `,
      ...offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
      `trailer`,
      `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
      `startxref`,
      String(xrefStart),
      `%%EOF`,
    ].join('\n')

    parts.push(Buffer.from(`${xref}\n`, 'latin1'))
    return Buffer.concat(parts)
  }
}
