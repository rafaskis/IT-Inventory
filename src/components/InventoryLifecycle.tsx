import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Gift,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDate, formatNumber, useLanguage } from '../i18n/LanguageProvider'

export type InventoryLifecycleSection = 'pending_scrap' | 'scrapped' | 'gifted'
export type InventoryLifecycleTarget = InventoryLifecycleSection

type FilterOption = { id: number; name: string }

type LifecycleItem = {
  id: number
  item_code: string
  item_type_id: number
  brand_id: number
  model_id: number
  serial_number: string | null
  mac_address: string | null
  notes: string | null
  document_number: number | null
  invoice: string | null
  purchase_date: string | null
  warranty_until: string | null
  store: string | null
  lifecycle_status: InventoryLifecycleSection
  gen_118: string | null
  gen_118_date: string | null
  gen_36: string | null
  gen_36_date: string | null
  gen_32a: string | null
  service_name: string | null
  gen_32a_date: string | null
  created_at: string
  updated_at: string
  brand: {
    id: number
    name: string
    item_type: { id: number; name: string } | null
  } | null
  model: { id: number; name: string } | null
  created_by_username?: string | null
  updated_by_username?: string | null
}

const PAGE_SIZES = [10, 25, 50, 100]

const COMMON_LIFECYCLE_COLUMN_KEYS = [
  'item_code', 'item_type', 'brand', 'model', 'serial_number', 'mac_address',
  'document_number', 'invoice', 'purchase_date', 'warranty_until', 'store', 'notes',
]

const HIDDEN_BY_DEFAULT_COMMON_COLUMNS = [
  'mac_address', 'document_number', 'invoice', 'purchase_date', 'warranty_until', 'store', 'notes',
]

const DEFAULT_LIFECYCLE_VISIBLE_COLUMNS: Record<InventoryLifecycleSection, string[]> = {
  pending_scrap: [
    ...COMMON_LIFECYCLE_COLUMN_KEYS.filter((key) => !HIDDEN_BY_DEFAULT_COMMON_COLUMNS.includes(key)),
    'gen_118', 'gen_118_date',
  ],
  scrapped: [
    ...COMMON_LIFECYCLE_COLUMN_KEYS.filter((key) => !HIDDEN_BY_DEFAULT_COMMON_COLUMNS.includes(key)),
    'gen_36', 'gen_36_date',
  ],
  gifted: [
    ...COMMON_LIFECYCLE_COLUMN_KEYS.filter((key) => !HIDDEN_BY_DEFAULT_COMMON_COLUMNS.includes(key)),
    'gen_32a', 'service_name', 'gen_32a_date',
  ],
}

function loadLifecycleColumnVisibility(): Record<InventoryLifecycleSection, string[]> {
  try {
    const saved = sessionStorage.getItem('it-inventory-lifecycle-visible-columns-v2')
    if (saved) {
      const parsed = JSON.parse(saved) as Record<string, unknown>
      return {
        pending_scrap: normalizeVisibleColumns(parsed.pending_scrap, DEFAULT_LIFECYCLE_VISIBLE_COLUMNS.pending_scrap),
        scrapped: normalizeVisibleColumns(parsed.scrapped, DEFAULT_LIFECYCLE_VISIBLE_COLUMNS.scrapped),
        gifted: normalizeVisibleColumns(parsed.gifted, DEFAULT_LIFECYCLE_VISIBLE_COLUMNS.gifted),
      }
    }
  } catch {
    // Use defaults if session storage is unavailable or invalid.
  }
  return { ...DEFAULT_LIFECYCLE_VISIBLE_COLUMNS }
}

function normalizeVisibleColumns(value: unknown, allowed: string[]): string[] {
  if (!Array.isArray(value)) return [...allowed]
  const valid = value.filter((key): key is string => typeof key === 'string' && allowed.includes(key))
  return valid.length > 0 ? valid : [...allowed]
}

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function lifecycleTitle(section: InventoryLifecycleSection, t: (key: string) => string) {
  if (section === 'pending_scrap') return t('To be scrapped')
  if (section === 'scrapped') return t('Scrapped')
  return t('Goods issued to other services')
}

function lifecycleDescription(section: InventoryLifecycleSection, t: (key: string) => string) {
  if (section === 'pending_scrap') return t('Items awaiting final scrapping. Employee, Location, PC Name, IP and SOCKET have been cleared.')
  if (section === 'scrapped') return t('Items that have completed the final scrapping procedure. These records are read-only.')
  return t('Items issued to other services. These records are read-only.')
}

function dateCell(value: string | null, language: 'en' | 'el') {
  return value ? formatDate(value, language) : '—'
}

function getLocalDateInputValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function LifecycleTransitionDialog({
  targetStatus,
  itemIds,
  onClose,
  onSuccess,
  fromEdit = false,
}: {
  targetStatus: InventoryLifecycleTarget
  itemIds: number[]
  onClose: () => void
  onSuccess: () => void | Promise<void>
  fromEdit?: boolean
}) {
  const { t } = useLanguage()
  const [reference, setReference] = useState('')
  const [serviceName, setServiceName] = useState('')
  const [transitionDate, setTransitionDate] = useState(getLocalDateInputValue)
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isGift = targetStatus === 'gifted'
  const isFinalScrap = targetStatus === 'scrapped'
  const title = targetStatus === 'pending_scrap'
    ? t('Move to ΠΡΟΣ ΑΠΟΣΥΡΣΗ')
    : isFinalScrap ? t('Complete ΑΠΟΣΥΡΣΗ') : t('Move to ΕΚΔΟΣΗ ΑΓΑΘΩΝ')
  const referenceLabel = targetStatus === 'pending_scrap'
    ? 'ΓΕΝ.118'
    : isFinalScrap ? 'ΓΕΝ.36' : 'ΓΕΝ.32Α'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!reference.trim() || /[\r\n]/.test(reference)) {
      setError(t('Enter a valid single-line document reference.'))
      return
    }
    if (isGift && (!serviceName.trim() || /[\r\n]/.test(serviceName))) {
      setError(t('Enter a valid single-line service name.'))
      return
    }
    if (!acknowledged) {
      setError(t('Confirm that you understand this operation is irreversible.'))
      return
    }

    setSaving(true)
    const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', {
      body: {
        action: 'transition_lifecycle',
        item_ids: itemIds,
        target_status: targetStatus,
        reference: reference.trim(),
        transition_date: transitionDate,
        ...(isGift ? { service_name: serviceName.trim() } : {}),
      },
    })

    if (invokeError || data?.error || !data?.success) {
      let message = data?.error || invokeError?.message || t('The inventory lifecycle operation could not be completed.')
      const context = invokeError?.context
      if (!data?.error && context && typeof context.clone === 'function') {
        try {
          const responseBody = await context.clone().json()
          message = responseBody?.error || responseBody?.message || message
        } catch {
          // Keep the original request error.
        }
      }
      setError(t(message))
      setSaving(false)
      return
    }

    setSaving(false)
    await onSuccess()
  }

  const warning = targetStatus === 'pending_scrap'
    ? t('This operation cannot be undone. The selected item(s) will leave the main inventory. Employee assignments, Location, PC Name, IP and SOCKET will be cleared. The original item IDs and all other information will be preserved.')
    : isFinalScrap
      ? t('This is the final scrapping stage and cannot be undone. The selected item(s) will become read-only records. Their original item IDs and all existing historical information will be preserved.')
      : t('This operation cannot be undone. The selected item(s) will leave the main inventory. Employee assignments, Location, PC Name, IP and SOCKET will be cleared. The original item IDs and all other information will be preserved.')

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <form onSubmit={submit} className="my-auto w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {t('{count} selected item(s)', { count: itemIds.length })}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50" aria-label={t('Close')}>
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              <AlertCircle size={17} />
              {t('Irreversible operation')}
            </div>
            {warning}
            {fromEdit && (
              <p className="mt-2 border-t border-amber-300/70 pt-2 font-medium">
                {t('The item will be moved using its currently saved information. Unsaved changes in the edit form will be discarded.')}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                {referenceLabel} *
              </label>
            <input
              autoFocus
              type="text"
              maxLength={200}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t('Enter {field}', { field: referenceLabel })}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t(isGift ? 'ΓΕΝ.32Α date' : isFinalScrap ? 'ΓΕΝ.36 date' : 'ΓΕΝ.118 date')} *</label>
              <input
                type="date"
                value={transitionDate}
                onChange={(event) => setTransitionDate(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                required
              />
            </div>
          </div>

          {isGift && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">{t('ΥΠΗΡΕΣΙΑ')} *</label>
              <input
                type="text"
                maxLength={200}
                value={serviceName}
                onChange={(event) => setServiceName(event.target.value)}
                placeholder={t('Enter the receiving service')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                required
              />
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{t('I understand that this operation is irreversible and confirm the selected item(s) should be moved.')}</span>
          </label>

          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {t('Cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || !reference.trim() || !transitionDate || (isGift && !serviceName.trim()) || !acknowledged}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${isFinalScrap ? 'bg-red-600 hover:bg-red-700' : isGift ? 'bg-blue-600 hover:bg-blue-700' : 'bg-amber-600 hover:bg-amber-700'}`}
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            {saving ? t('Processing…') : isFinalScrap ? t('Confirm ΑΠΟΣΥΡΣΗ') : isGift ? t('Confirm ΕΚΔΟΣΗ ΑΓΑΘΩΝ') : t('Confirm ΠΡΟΣ ΑΠΟΣΥΡΣΗ')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function InventoryLifecycle({
  section,
  canManageInventory,
}: {
  section: InventoryLifecycleSection
  canManageInventory: boolean
}) {
  const { t, language } = useLanguage()
  const [items, setItems] = useState<LifecycleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState(() =>
    section === 'pending_scrap' ? 'gen_118_date' : section === 'scrapped' ? 'gen_36_date' : 'gen_32a_date',
  )
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true)
  const [itemTypes, setItemTypes] = useState<FilterOption[]>([])
  const [brands, setBrands] = useState<FilterOption[]>([])
  const [models, setModels] = useState<FilterOption[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [columnMenuOpen, setColumnMenuOpen] = useState(false)
  const [visibleColumnsBySection, setVisibleColumnsBySection] = useState(loadLifecycleColumnVisibility)
  const [filters, setFilters] = useState({
    item_type_ids: '',
    brand_ids: '',
    model_ids: '',
    lifecycle_reference: '',
    purchase_date_from: '',
    purchase_date_to: '',
    warranty_date_from: '',
    warranty_date_to: '',
    lifecycle_date_from: '',
    lifecycle_date_to: '',
  })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [transitionTarget, setTransitionTarget] = useState<InventoryLifecycleTarget | null>(null)
  const [transitionIds, setTransitionIds] = useState<number[]>([])

  const isPendingScrap = section === 'pending_scrap'
  const pageTitle = lifecycleTitle(section, t)
  const description = lifecycleDescription(section, t)
  const lifecycleDateFieldLabel = section === 'pending_scrap' ? 'ΓΕΝ.118 date' : section === 'scrapped' ? 'ΓΕΝ.36 date' : 'ΓΕΝ.32Α date'
  const lifecycleReferenceFieldLabel = section === 'pending_scrap' ? 'ΓΕΝ.118' : section === 'scrapped' ? 'ΓΕΝ.36' : 'ΓΕΝ.32Α'

  useEffect(() => {
    try {
      sessionStorage.setItem('it-inventory-lifecycle-visible-columns-v2', JSON.stringify(visibleColumnsBySection))
    } catch {
      // Column preferences remain usable for the current page if storage is unavailable.
    }
  }, [visibleColumnsBySection])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      setFilterOptionsLoading(true)
      const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
        body: { action: 'lifecycle_filter_options', lifecycle_status: section },
      })
      if (cancelled) return
      if (requestError || !data?.options) {
        setError(data?.error || requestError?.message || t('Could not load lifecycle filters.'))
      } else {
        const toOptions = (rows: unknown): FilterOption[] => Array.isArray(rows)
          ? rows.map((row: { id: number | string; name: string }) => ({ id: Number(row.id), name: row.name }))
          : []
        setItemTypes(toOptions(data.options.item_types))
        setBrands(toOptions(data.options.brands))
        setModels(toOptions(data.options.models))
      }
      setFilterOptionsLoading(false)
    }
    void loadOptions()
    return () => { cancelled = true }
  }, [section, t])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
      body: {
        action: 'lifecycle_list',
        lifecycle_status: section,
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
        search,
        filters: {
          ...(filters.item_type_ids ? { item_type_ids: [Number(filters.item_type_ids)] } : {}),
          ...(filters.brand_ids ? { brand_ids: [Number(filters.brand_ids)] } : {}),
          ...(filters.model_ids ? { model_ids: [Number(filters.model_ids)] } : {}),
          ...(filters.lifecycle_reference ? { lifecycle_reference: filters.lifecycle_reference } : {}),
          ...(filters.purchase_date_from ? { purchase_date_from: filters.purchase_date_from } : {}),
          ...(filters.purchase_date_to ? { purchase_date_to: filters.purchase_date_to } : {}),
          ...(filters.warranty_date_from ? { warranty_date_from: filters.warranty_date_from } : {}),
          ...(filters.warranty_date_to ? { warranty_date_to: filters.warranty_date_to } : {}),
          ...(filters.lifecycle_date_from ? { lifecycle_date_from: filters.lifecycle_date_from } : {}),
          ...(filters.lifecycle_date_to ? { lifecycle_date_to: filters.lifecycle_date_to } : {}),
        },
      },
    })

    if (requestError || !Array.isArray(data?.items)) {
      let message = data?.error || requestError?.message || t('Could not load lifecycle inventory items.')
      const context = requestError?.context
      if (!data?.error && context && typeof context.clone === 'function') {
        try {
          const responseBody = await context.clone().json()
          message = responseBody?.error || responseBody?.message || message
        } catch {
          // Keep the fallback error.
        }
      }
      setError(t(message))
      setItems([])
      setTotal(0)
    } else {
      setItems(data.items as LifecycleItem[])
      setTotal(Number(data.total ?? 0))
    }
    setLoading(false)
  }, [section, page, pageSize, sortBy, sortOrder, search, filters, t])

  useEffect(() => {
    // Loading is intentionally triggered whenever lifecycle filters or pagination change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    // Selection belongs to the current filter result set.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds([])
  }, [section, search, filters])

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(1)
  }

  const clearFilters = () => {
    setSearchInput('')
    setSearch('')
    setFilters({
      item_type_ids: '', brand_ids: '', model_ids: '', lifecycle_reference: '',
      purchase_date_from: '', purchase_date_to: '',
      warranty_date_from: '', warranty_date_to: '',
      lifecycle_date_from: '', lifecycle_date_to: '',
    })
    setPage(1)
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const currentPageSelected = items.length > 0 && items.every((item) => selectedIds.includes(item.id))

  const togglePageSelection = () => {
    const pageIds = items.map((item) => item.id)
    if (currentPageSelected) {
      setSelectedIds((current) => current.filter((id) => !pageIds.includes(id)))
      return
    }
    const next = [...new Set([...selectedIds, ...pageIds])]
    if (next.length > 500) {
      setError(t('Lifecycle bulk operations support a maximum of 500 selected items.'))
      return
    }
    setSelectedIds(next)
  }

  const openTransition = (ids: number[]) => {
    if (!isPendingScrap || !canManageInventory || ids.length === 0) return
    setTransitionIds(ids)
    setTransitionTarget('scrapped')
  }

  const sort = (field: string) => {
    if (sortBy === field) setSortOrder((current) => current === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortOrder('asc') }
    setPage(1)
  }

  const commonColumns = [
    { key: 'item_code', label: 'Item ID', sort: 'item_code', value: (item: LifecycleItem) => item.item_code },
    { key: 'item_type', label: 'Item Type', value: (item: LifecycleItem) => item.brand?.item_type?.name ?? '—' },
    { key: 'brand', label: 'Brand', value: (item: LifecycleItem) => item.brand?.name ?? '—' },
    { key: 'model', label: 'Model', value: (item: LifecycleItem) => item.model?.name ?? '—' },
    { key: 'serial_number', label: 'S/N', sort: 'serial_number', value: (item: LifecycleItem) => display(item.serial_number) },
    { key: 'mac_address', label: 'MAC', value: (item: LifecycleItem) => display(item.mac_address) },
    { key: 'document_number', label: 'EOASIS Doc. No.', sort: 'document_number', value: (item: LifecycleItem) => display(item.document_number) },
    { key: 'invoice', label: 'Invoice', value: (item: LifecycleItem) => display(item.invoice) },
    { key: 'purchase_date', label: 'Purchase date', sort: 'purchase_date', value: (item: LifecycleItem) => dateCell(item.purchase_date, language) },
    { key: 'warranty_until', label: 'Warranty date', sort: 'warranty_until', value: (item: LifecycleItem) => dateCell(item.warranty_until, language) },
    { key: 'store', label: 'Store', sort: 'store', value: (item: LifecycleItem) => display(item.store) },
    { key: 'notes', label: 'Notes', value: (item: LifecycleItem) => display(item.notes) },
  ]

  const lifecycleColumns = section === 'pending_scrap'
    ? [
        { key: 'gen_118', label: 'ΓΕΝ.118', value: (item: LifecycleItem) => display(item.gen_118) },
        { key: 'gen_118_date', label: 'ΓΕΝ.118 date', sort: 'gen_118_date', value: (item: LifecycleItem) => dateCell(item.gen_118_date, language) },
      ]
    : section === 'scrapped'
      ? [
          { key: 'gen_118', label: 'ΓΕΝ.118', value: (item: LifecycleItem) => display(item.gen_118) },
          { key: 'gen_118_date', label: 'ΓΕΝ.118 date', sort: 'gen_118_date', value: (item: LifecycleItem) => dateCell(item.gen_118_date, language) },
          { key: 'gen_36', label: 'ΓΕΝ.36', value: (item: LifecycleItem) => display(item.gen_36) },
          { key: 'gen_36_date', label: 'ΓΕΝ.36 date', sort: 'gen_36_date', value: (item: LifecycleItem) => dateCell(item.gen_36_date, language) },
        ]
      : [
          { key: 'gen_32a', label: 'ΓΕΝ.32Α', value: (item: LifecycleItem) => display(item.gen_32a) },
          { key: 'service_name', label: 'ΥΠΗΡΕΣΙΑ', value: (item: LifecycleItem) => display(item.service_name) },
          { key: 'gen_32a_date', label: 'ΓΕΝ.32Α date', sort: 'gen_32a_date', value: (item: LifecycleItem) => dateCell(item.gen_32a_date, language) },
        ]

  const columns = [...commonColumns, ...lifecycleColumns]
  const visibleColumns = visibleColumnsBySection[section] ?? DEFAULT_LIFECYCLE_VISIBLE_COLUMNS[section]
  const displayedColumns = columns.filter((column) => visibleColumns.includes(column.key))

  const toggleColumn = (key: string) => {
    setVisibleColumnsBySection((current) => {
      const currentKeys = current[section] ?? DEFAULT_LIFECYCLE_VISIBLE_COLUMNS[section]
      if (currentKeys.includes(key)) {
        if (currentKeys.length <= 1) return current
        return { ...current, [section]: currentKeys.filter((columnKey) => columnKey !== key) }
      }
      return { ...current, [section]: [...currentKeys, key] }
    })
  }

  const resetColumns = () => {
    setVisibleColumnsBySection((current) => ({
      ...current,
      [section]: [...DEFAULT_LIFECYCLE_VISIBLE_COLUMNS[section]],
    }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
        <div>
          <div className="flex items-center gap-2">
            {section === 'pending_scrap' ? <Archive className="text-amber-600" size={22} /> : section === 'scrapped' ? <Trash2 className="text-red-600" size={22} /> : <Gift className="text-blue-600" size={22} />}
            <h2 className="text-2xl font-bold text-slate-900">{pageTitle}</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
        </div>
        <button type="button" onClick={() => void loadItems()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {t('Refresh')}
        </button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t('Search by Item ID, serial number or {reference}...', { reference: lifecycleReferenceFieldLabel })} className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500" />
          </div>
          <button type="button" onClick={() => setFiltersOpen((open) => !open)} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${filtersOpen || activeFilterCount ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
            {t('Filters')} {activeFilterCount > 0 && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">{t('Clear filters')}</button>}
          <div className="relative">
            <button type="button" onClick={() => setColumnMenuOpen((open) => !open)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Columns3 size={16} /> {t('Columns')} <ChevronDown size={15} />
            </button>
            {columnMenuOpen && (
              <>
                <button type="button" aria-label={t('Close column menu')} className="fixed inset-0 z-20 cursor-default" onClick={() => setColumnMenuOpen(false)} />
                <div className="absolute right-0 z-30 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{t('Visible columns')}</p>
                    <button type="button" onClick={resetColumns} className="text-xs font-medium text-blue-600 hover:text-blue-800">{t('Reset')}</button>
                  </div>
                  {columns.map((column) => (
                    <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <input type="checkbox" checked={visibleColumns.includes(column.key)} disabled={visibleColumns.includes(column.key) && visibleColumns.length === 1} onChange={() => toggleColumn(column.key)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                      {t(column.label)}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {filtersOpen && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs font-medium text-slate-600">
              {t('Item Type')}
              <select value={filters.item_type_ids} onChange={(event) => updateFilter('item_type_ids', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">{t('All item types')}</option>
                {itemTypes.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Brand')}
              <select value={filters.brand_ids} onChange={(event) => updateFilter('brand_ids', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">{t('All brands')}</option>
                {brands.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Model')}
              <select value={filters.model_ids} onChange={(event) => updateFilter('model_ids', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">{t('All models')}</option>
                {models.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              {lifecycleReferenceFieldLabel}
              <input type="text" maxLength={100} value={filters.lifecycle_reference} onChange={(event) => updateFilter('lifecycle_reference', event.target.value)} placeholder={lifecycleReferenceFieldLabel} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Purchase date from')}
              <input type="date" value={filters.purchase_date_from} max={filters.purchase_date_to || undefined} onChange={(event) => updateFilter('purchase_date_from', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Purchase date to')}
              <input type="date" value={filters.purchase_date_to} min={filters.purchase_date_from || undefined} onChange={(event) => updateFilter('purchase_date_to', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Warranty date from')}
              <input type="date" value={filters.warranty_date_from} max={filters.warranty_date_to || undefined} onChange={(event) => updateFilter('warranty_date_from', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t('Warranty date to')}
              <input type="date" value={filters.warranty_date_to} min={filters.warranty_date_from || undefined} onChange={(event) => updateFilter('warranty_date_to', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t(`${lifecycleDateFieldLabel} from`)}
              <input type="date" value={filters.lifecycle_date_from} max={filters.lifecycle_date_to || undefined} onChange={(event) => updateFilter('lifecycle_date_from', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t(`${lifecycleDateFieldLabel} to`)}
              <input type="date" value={filters.lifecycle_date_to} min={filters.lifecycle_date_from || undefined} onChange={(event) => updateFilter('lifecycle_date_to', event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
            {filterOptionsLoading && <p className="text-xs text-slate-500">{t('Loading filters…')}</p>}
          </div>
        )}
      </section>

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <h3 className="font-semibold text-slate-900">{pageTitle}</h3>
            <p className="mt-1 text-sm text-slate-500">{total === 1 ? t('1 record') : t('{count} records', { count: formatNumber(total, language) })}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t('Rows per page')}
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>

        {isPendingScrap && canManageInventory && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-3">
            <span className="text-sm font-medium text-red-900">{t('{count} items selected', { count: selectedIds.length })}</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => openTransition(selectedIds)} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700">
                <Trash2 size={15} /> {t('ΑΠΟΣΥΡΣΗ')}
              </button>
              <button type="button" onClick={() => setSelectedIds([])} className="text-sm font-medium text-red-700 hover:text-red-900">{t('Clear selection')}</button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {isPendingScrap && canManageInventory && <th className="px-4 py-3"><input type="checkbox" checked={currentPageSelected} onChange={togglePageSelection} aria-label={t('Select all items on this page')} className="rounded border-slate-300 text-blue-600" /></th>}
                {displayedColumns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">
                    {'sort' in column && column.sort ? (
                      <button type="button" onClick={() => sort(column.sort!)} className="inline-flex items-center gap-1 hover:text-slate-900">
                        {t(column.label)} {sortBy === column.sort && <span>{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                      </button>
                    ) : t(column.label)}
                  </th>
                ))}
                {isPendingScrap && canManageInventory && <th className="px-4 py-3">{t('Actions')}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={displayedColumns.length + (isPendingScrap && canManageInventory ? 2 : 0)} className="px-4 py-12 text-center text-slate-500"><Loader2 size={18} className="mr-2 inline animate-spin" />{t('Loading records…')}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={displayedColumns.length + (isPendingScrap && canManageInventory ? 2 : 0)} className="px-4 py-12 text-center text-slate-500">{t('No records found.')}</td></tr>
              ) : items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50">
                  {isPendingScrap && canManageInventory && <td className="px-4 py-3"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, item.id])].slice(0, 500) : current.filter((id) => id !== item.id))} className="rounded border-slate-300 text-blue-600" /></td>}
                  {displayedColumns.map((column) => {
                    const value = column.value(item)
                    return <td key={column.key} className="max-w-xs px-4 py-3 text-slate-700" title={String(value)}><span className="block max-w-xs truncate">{value}</span></td>
                  })}
                  {isPendingScrap && canManageInventory && <td className="px-4 py-3"><button type="button" onClick={() => openTransition([item.id])} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"><Trash2 size={13} />{t('ΑΠΟΣΥΡΣΗ')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-500">{t('Page {page} of {pages}', { page, pages: totalPages })} · {t('{count} records', { count: formatNumber(total, language) })}</p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40"><ChevronLeft size={16}/>{t('Previous')}</button>
            <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 disabled:opacity-40">{t('Next')}<ChevronRight size={16}/></button>
          </div>
        </div>
      </section>

      {transitionTarget && (
        <LifecycleTransitionDialog
          targetStatus={transitionTarget}
          itemIds={transitionIds}
          onClose={() => setTransitionTarget(null)}
          onSuccess={async () => {
            setTransitionTarget(null)
            setSelectedIds([])
            setPage(1)
            await loadItems()
          }}
        />
      )}
    </div>
  )
}
