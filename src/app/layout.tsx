import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Inter, JetBrains_Mono, Saira } from 'next/font/google'
import './globals.css'

/*
 * Las tres fuentes de Infracore, tomadas de su sitio.
 *
 * `next/font` las descarga al compilar y las sirve desde nuestro propio
 * dominio: la aplicación no le pide nada a Google en tiempo de ejecución, que
 * además es lo que exige nuestra frontera de proveedores.
 *
 * Saira  — titulares, pesada y en cursiva, como sus encabezados.
 * Inter  — texto corrido.
 * JetBrains Mono — etiquetas en mayúscula con espaciado, su sello.
 */
const saira = Saira({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Payroll · Skyline Advance Tech / Infracore',
  description: 'Sistema de nómina, contratistas y control financiero',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${saira.variable} ${inter.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
