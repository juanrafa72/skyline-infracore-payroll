/**
 * La identidad visual de cada compañía.
 *
 * El sistema atiende a dos empresas distintas, con marcas distintas. Quien
 * entra a Infracore debe sentir que está en Infracore — no en una herramienta
 * genérica con su nombre encima.
 *
 * Por eso la marca es **dato, no código**: se resuelve por el código de la
 * compañía y se aplica como variables CSS. Agregar una tercera empresa mañana
 * es agregar una entrada aquí, no tocar pantallas.
 *
 * Los colores de Infracore están tomados de infracore360.com.
 */

export interface Brand {
  /** Código de compañía al que aplica. */
  code: string
  /** Logo en `/public`. `null` = se muestra el nombre en texto. */
  logo: string | null
  logoAlt: string
  /** Proporción del logo, para reservarle el espacio exacto y que no salte. */
  logoWidth: number
  logoHeight: number

  /** Azul principal: botones, enlaces, lo seleccionado. */
  accent: string
  /** Azul profundo, para degradados y encabezados. */
  accentDeep: string
  /** Navy casi negro: el color del texto fuerte y de las franjas oscuras. */
  ink: string
  background: string
  surface: string
  muted: string
  border: string
  hover: string
  /** Degradado de firma. */
  gradient: string
}

/**
 * Marca por defecto: la que traía el sistema.
 *
 * Skyline sigue con ella hasta que se estudie su identidad. Ninguna compañía
 * se queda sin colores por no tener marca propia todavía.
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
}

const BRANDS: readonly Brand[] = [
  {
    code: 'INFRACORE',
    logo: '/brands/infracore.jpeg',
    logoAlt: 'Infracore Systems LLC',
    logoWidth: 1213,
    logoHeight: 435,

    // Tomados de infracore360.com.
    accent: '#0083d6', // el azul de la marca
    accentDeep: '#0a4a8f', // el azul profundo del degradado
    ink: '#0f1b2d', // el navy que domina el sitio
    background: '#f7f9fc',
    surface: '#ffffff',
    muted: '#5b6b85',
    border: '#e5eaf2',
    hover: '#eef3fa',
    gradient: 'linear-gradient(135deg, #0a4a8f, #0083d6)',
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
  }
}
