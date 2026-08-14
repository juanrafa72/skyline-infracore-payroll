/**
 * La identidad visual de cada compañía.
 *
 * El sistema atiende a dos empresas distintas, con marcas distintas. Quien
 * entra a Infracore debe sentir que está en Infracore, y quien entra a Skyline
 * en Skyline — no en una herramienta genérica con el nombre encima.
 *
 * Por eso la marca es **dato, no código**: se resuelve por el código de la
 * compañía y se aplica como variables CSS. Agregar una tercera empresa mañana
 * es agregar una entrada aquí, no tocar pantallas.
 *
 * **La tipografía también es marca.** Infracore titula en mayúscula pesada y
 * rotula en monoespaciada espaciada; Skyline titula en minúscula suave y no usa
 * monoespaciada en ningún lado. Forzar un solo estilo haría que una de las dos
 * se viera como la otra, que es justo lo contrario de lo que se busca.
 *
 * Colores tomados de infracore360.com y skylinenext.com.
 */

export interface Brand {
  /** Código de compañía al que aplica. */
  code: string
  /** Logo en `/public`. `null` = se muestra el nombre en texto. */
  logo: string | null
  logoAlt: string
  /** Proporción real del archivo, para reservarle el espacio y que no salte. */
  logoWidth: number
  logoHeight: number

  /** Color principal: botones, enlaces, lo seleccionado. */
  accent: string
  /** Tono profundo del mismo color, para degradados. */
  accentDeep: string
  /** Navy casi negro: el texto fuerte. */
  ink: string
  background: string
  surface: string
  muted: string
  border: string
  hover: string
  /** Degradado de firma. */
  gradient: string

  /** Tipografía de los titulares. */
  titleFont: 'display' | 'body'
  titleTransform: 'uppercase' | 'none'
  titleWeight: string
  titleSpacing: string

  /** Tipografía de los rótulos pequeños. */
  labelFont: 'mono' | 'body'
  labelTransform: 'uppercase' | 'none'
  labelWeight: string
  labelSpacing: string
  labelSize: string
}

/**
 * Marca por defecto: la que traía el sistema.
 *
 * Existe para que una compañía nueva nunca se quede sin colores por no tener
 * marca propia todavía.
 */
export const DEFAULT_BRAND: Brand = {
  code: 'DEFAULT',
  logo: null,
  logoAlt: '',
  logoWidth: 0,
  logoHeight: 0,
  accent: '#12467b',
  accentDeep: '#0d3358',
  ink: '#0b1220',
  background: '#f6f7f9',
  surface: '#ffffff',
  muted: '#64708a',
  border: '#e1e6ee',
  hover: '#f2f5f9',
  gradient: 'linear-gradient(135deg, #0d3358, #12467b)',
  titleFont: 'body',
  titleTransform: 'none',
  titleWeight: '600',
  titleSpacing: '-0.01em',
  labelFont: 'body',
  labelTransform: 'uppercase',
  labelWeight: '600',
  labelSpacing: '0.05em',
  labelSize: '0.72rem',
}

const BRANDS: readonly Brand[] = [
  {
    // Técnica, industrial: azul, mayúsculas pesadas y monoespaciada.
    code: 'INFRACORE',
    logo: '/brands/infracore.jpeg',
    logoAlt: 'Infracore Systems LLC',
    logoWidth: 1213,
    logoHeight: 435,

    accent: '#0083d6',
    accentDeep: '#0a4a8f',
    ink: '#0f1b2d',
    background: '#f7f9fc',
    surface: '#ffffff',
    muted: '#5b6b85',
    border: '#e5eaf2',
    hover: '#eef3fa',
    gradient: 'linear-gradient(135deg, #0a4a8f, #0083d6)',

    titleFont: 'display',
    titleTransform: 'uppercase',
    titleWeight: '800',
    titleSpacing: '-0.01em',

    labelFont: 'mono',
    labelTransform: 'uppercase',
    labelWeight: '500',
    labelSpacing: '0.12em',
    labelSize: '0.68rem',
  },
  {
    // Limpia y cercana: verde turquesa, minúsculas, sin monoespaciada.
    code: 'SKYLINE',
    logo: '/brands/skyline.png',
    logoAlt: 'Skyline Advance Tech',
    logoWidth: 3795,
    logoHeight: 1155,

    accent: '#00c49a', // el verde de la marca
    accentDeep: '#20a9be', // el cian del isotipo
    ink: '#1d2e45', // el navy del «line»
    background: '#f6f9f9',
    surface: '#ffffff',
    muted: '#6e7a84',
    border: '#e3eaea',
    hover: '#eff7f5',
    gradient: 'linear-gradient(135deg, #20a9be, #00c49a)',

    // Su sitio titula en minúscula, con Inter. Nada de mayúsculas forzadas.
    titleFont: 'body',
    titleTransform: 'none',
    titleWeight: '700',
    titleSpacing: '-0.02em',

    labelFont: 'body',
    labelTransform: 'uppercase',
    labelWeight: '600',
    labelSpacing: '0.06em',
    labelSize: '0.72rem',
  },
]

export function brandFor(companyCode: string): Brand {
  return BRANDS.find((brand) => brand.code === companyCode) ?? DEFAULT_BRAND
}

/**
 * Las variables CSS de una marca.
 *
 * Se ponen en el elemento que envuelve la aplicación, no en `:root`, para que
 * cambiar de compañía cambie la piel entera sin recargar hojas de estilo.
 */
export function brandVariables(brand: Brand): Record<string, string> {
  return {
    '--accent': brand.accent,
    '--accent-deep': brand.accentDeep,
    '--ink': brand.ink,
    '--background': brand.background,
    '--surface': brand.surface,
    '--muted': brand.muted,
    '--border': brand.border,
    '--hover': brand.hover,
    '--brand-gradient': brand.gradient,

    '--title-font': `var(--font-${brand.titleFont})`,
    '--title-transform': brand.titleTransform,
    '--title-weight': brand.titleWeight,
    '--title-spacing': brand.titleSpacing,

    '--label-font': `var(--font-${brand.labelFont})`,
    '--label-transform': brand.labelTransform,
    '--label-weight': brand.labelWeight,
    '--label-spacing': brand.labelSpacing,
    '--label-size': brand.labelSize,
  }
}
