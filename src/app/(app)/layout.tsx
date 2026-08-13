import { Shell } from '@/components/shell/Shell'
import { getActiveCompany, listCompanies } from '@/lib/company/context'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [companies, active] = await Promise.all([listCompanies(), getActiveCompany()])
  return (
    <Shell companies={companies} active={active}>
      {children}
    </Shell>
  )
}
