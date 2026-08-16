import { describe, expect, it } from 'vitest'
import { decidirAuto } from '@/lib/mail/auto-destinatarios'

/**
 * La empresa receptora recibe su soporte sin que nadie lo configure.
 *
 * Lo que estas pruebas cuidan no es el alta —eso es fácil— sino que el
 * automatismo **se calle cuando una persona ya opinó**. Volver a poner un
 * correo que alguien quitó a propósito manda el desprendible de una empresa a
 * la bandeja equivocada, y nadie entendería por qué reapareció.
 */

const FORZO = {
  id: 'r1',
  name: 'FORZO',
  contactName: 'Hugo Restrepo',
  email: 'pagos@forzo.com',
}

describe('cuando sí se pone solo', () => {
  it('la empresa tiene correo y no hay nadie puesto: lo agrega', () => {
    const d = decidirAuto(FORZO, null)
    expect(d.tipo).toBe('CREAR')
    if (d.tipo === 'CREAR') {
      expect(d.email).toBe('pagos@forzo.com')
      // El contacto se lee mejor que repetir el nombre de la empresa, que ya
      // sale en la columna de al lado.
      expect(d.name).toBe('Hugo Restrepo')
    }
  })

  it('sin nombre de contacto, usa el de la empresa', () => {
    const d = decidirAuto({ ...FORZO, contactName: null }, null)
    expect(d.tipo).toBe('CREAR')
    if (d.tipo === 'CREAR') expect(d.name).toBe('FORZO')
  })

  it('el correo se guarda en minúscula y sin espacios', () => {
    const d = decidirAuto({ ...FORZO, email: '  Pagos@FORZO.com ' }, null)
    expect(d.tipo).toBe('CREAR')
    if (d.tipo === 'CREAR') expect(d.email).toBe('pagos@forzo.com')
  })
})

describe('cuando se queda callado', () => {
  it('la empresa no tiene correo: no hay a dónde mandar', () => {
    expect(decidirAuto({ ...FORZO, email: null }, null).tipo).toBe('NADA')
    expect(decidirAuto({ ...FORZO, email: '   ' }, null).tipo).toBe('NADA')
  })

  it('lo quitaron a propósito: NO se vuelve a poner', () => {
    // El caso que hace útil todo lo demás. Sin esto, cada vez que alguien
    // toque la ficha de la empresa reaparece el correo que quitaron.
    const d = decidirAuto(FORZO, { id: 'd1', email: 'pagos@forzo.com', active: false })
    expect(d.tipo).toBe('NADA')
    if (d.tipo === 'NADA') expect(d.porque).toContain('a propósito')
  })

  it('alguien lo corrigió a mano: su decisión manda', () => {
    // La empresa dice pagos@; una persona lo cambió a contabilidad@. Cambiar
    // el de la ficha no puede pisar esa corrección.
    const d = decidirAuto(
      { ...FORZO, email: 'nuevo@forzo.com', emailAnterior: 'pagos@forzo.com' },
      { id: 'd1', email: 'contabilidad@forzo.com', active: true },
    )
    expect(d.tipo).toBe('NADA')
    if (d.tipo === 'NADA') expect(d.porque).toContain('a mano')
  })

  it('ya está puesto con el mismo correo: no hace nada', () => {
    const d = decidirAuto(FORZO, { id: 'd1', email: 'pagos@forzo.com', active: true })
    expect(d.tipo).toBe('NADA')
  })
})

describe('cuando el correo de la empresa cambia', () => {
  it('si nadie lo había tocado, el destinatario lo sigue', () => {
    const d = decidirAuto(
      { ...FORZO, email: 'nuevo@forzo.com', emailAnterior: 'pagos@forzo.com' },
      { id: 'd1', email: 'pagos@forzo.com', active: true },
    )
    expect(d.tipo).toBe('ACTUALIZAR')
    if (d.tipo === 'ACTUALIZAR') {
      expect(d.id).toBe('d1')
      expect(d.email).toBe('nuevo@forzo.com')
    }
  })

  it('sin saber cuál era el anterior, no se arriesga a pisar nada', () => {
    const d = decidirAuto(
      { ...FORZO, email: 'nuevo@forzo.com' },
      { id: 'd1', email: 'pagos@forzo.com', active: true },
    )
    expect(d.tipo).toBe('NADA')
  })
})
