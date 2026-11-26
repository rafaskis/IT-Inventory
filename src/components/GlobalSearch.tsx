import { useEffect, useMemo, useState } from 'react'
import { Search, X, Package, Users, MapPin, Tags, Loader2, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { normalizeSearchText } from '../lib/searchText'
import { useLanguage } from '../i18n/LanguageProvider'

type InventorySearchRow = { id: number; item_code: string; serial_number: string | null; mac_address: string | null; pc_name: string | null; ip_address: string | null; socket: string | null };
type EmployeeSearchRow = { id: number; full_name: string };
type NamedSearchRow = { id: number; name: string };

type SearchResult = {
  key: string
  category: 'Inventory' | 'Employees' | 'Locations' | 'Catalogues'
  title: string
  subtitle: string
  detail?: string
}

type Props = {
  onClose: () => void
  onNavigate: (page: string) => void
}

export default function GlobalSearch({ onClose, onNavigate }: Props) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      // Clear stale results when the query is too short to search.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([])
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const pattern = `%${term.replace(/[%_,().]/g, ' ')}%`
        const [inventory, employees, locations, types, brands, models] = await Promise.all([
          supabase.from('inventory_items').select('id,item_code,serial_number,mac_address,pc_name,ip_address,socket').or(`item_code.ilike.${pattern},serial_number.ilike.${pattern},mac_address.ilike.${pattern},pc_name.ilike.${pattern},ip_address.ilike.${pattern},socket.ilike.${pattern}`).eq('lifecycle_status', 'active').limit(8),
          supabase.from('employees').select('id,full_name').order('full_name').limit(1000),
          supabase.from('locations').select('id,name').order('name').limit(1000),
          supabase.from('item_types').select('id,name').order('name').limit(1000),
          supabase.from('brands').select('id,name').order('name').limit(1000),
          supabase.from('models').select('id,name').order('name').limit(1000),
        ])
        const failed = [inventory, employees, locations, types, brands, models].find((result) => result.error)
        if (failed?.error) throw failed.error
        if (cancelled) return

        const normalizedTerm = normalizeSearchText(term)
        const matchingEmployees = (employees.data ?? []).filter((employee: EmployeeSearchRow) => normalizeSearchText(employee.full_name).includes(normalizedTerm)).slice(0, 5)
        const matchingLocations = (locations.data ?? []).filter((location: NamedSearchRow) => normalizeSearchText(location.name).includes(normalizedTerm)).slice(0, 5)
        const matchingTypes = (types.data ?? []).filter((item: NamedSearchRow) => normalizeSearchText(item.name).includes(normalizedTerm)).slice(0, 5)
        const matchingBrands = (brands.data ?? []).filter((item: NamedSearchRow) => normalizeSearchText(item.name).includes(normalizedTerm)).slice(0, 5)
        const matchingModels = (models.data ?? []).filter((item: NamedSearchRow) => normalizeSearchText(item.name).includes(normalizedTerm)).slice(0, 5)

        const next: SearchResult[] = [
          ...(inventory.data ?? []).map((item: InventorySearchRow) => ({
            key: `inventory-${item.id}`, category: 'Inventory' as const,
            title: item.item_code, subtitle: [item.serial_number, item.mac_address].filter(Boolean).join(' · ') || t('Inventory item'),
            detail: [item.pc_name, item.ip_address, item.socket].filter(Boolean).join(' · '),
          })),
          ...matchingEmployees.map((employee: EmployeeSearchRow) => ({
            key: `employee-${employee.id}`, category: 'Employees' as const,
            title: employee.full_name, subtitle: t('Employee ID: {id}', { id: employee.id }),
          })),
          ...matchingLocations.map((location: NamedSearchRow) => ({
            key: `location-${location.id}`, category: 'Locations' as const,
            title: location.name, subtitle: t('Location'),
          })),
          ...matchingTypes.map((item: NamedSearchRow) => ({ key: `type-${item.id}`, category: 'Catalogues' as const, title: item.name, subtitle: t('Item type') })),
          ...matchingBrands.map((item: NamedSearchRow) => ({ key: `brand-${item.id}`, category: 'Catalogues' as const, title: item.name, subtitle: t('Brand') })),
          ...matchingModels.map((item: NamedSearchRow) => ({ key: `model-${item.id}`, category: 'Catalogues' as const, title: item.name, subtitle: t('Model') })),
        ]
        setResults(next)
      } catch (searchError) {
        console.error('Global search failed:', searchError)
        if (!cancelled) setError(t('Search could not be completed. Please try again.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, t])

  const grouped = useMemo(() => {
    const categories: SearchResult['category'][] = ['Inventory', 'Employees', 'Locations', 'Catalogues']
    return categories.map((category) => ({ category, items: results.filter((item) => item.category === category) })).filter((group) => group.items.length)
  }, [results])

  const icons = { Inventory: Package, Employees: Users, Locations: MapPin, Catalogues: Tags }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/50 p-3 pt-[10vh] sm:p-6 sm:pt-[12vh]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-label={t('Global search')} className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <Search className="shrink-0 text-slate-400" size={21} />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('Search inventory, employees, locations, catalogues...')} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
          <button onClick={onClose} aria-label={t('Close search')} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-3">
          {query.trim().length < 2 ? <p className="px-3 py-8 text-center text-sm text-slate-500">{t('Enter at least 2 characters to search.')}</p>
            : loading ? <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 size={17} className="animate-spin" /> {t('Searching…')}</div>
            : error ? <p className="px-3 py-8 text-center text-sm text-red-600">{error}</p>
            : grouped.length === 0 ? <p className="px-3 py-8 text-center text-sm text-slate-500">{t('No results found for “{query}”.', { query: query.trim() })}</p>
            : <div className="space-y-4">{grouped.map((group) => {
              const Icon = icons[group.category]
              return <div key={group.category}>
                <h3 className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400"><Icon size={14} /> {t(group.category)}</h3>
                <div className="space-y-1">{group.items.map((item) => <button key={item.key} onClick={() => { onNavigate(item.category); onClose() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-blue-50">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800">{item.title}</p><p className="truncate text-xs text-slate-500">{item.subtitle}{item.detail ? ` · ${item.detail}` : ''}</p></div>
                  <ArrowRight size={15} className="shrink-0 text-slate-300" />
                </button>)}</div>
              </div>
            })}</div>}
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-400">{t('Searches equipment identifiers, employee names, locations and catalogue entries.')}</div>
      </section>
    </div>
  )
}
