import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { readInventoryWorkbook, type InventoryImportRow } from '../lib/inventoryXlsx'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageProvider'

type CatalogueItem = { id: number; name: string; item_type_id?: number; brand_id?: number }
type ExistingIdentifier = { item_type_id: number; brand_id: number; model_id: number; serial_number: string | null; mac_address: string | null }
type LookupData = { itemTypes: CatalogueItem[]; brands: CatalogueItem[]; models: CatalogueItem[]; locations: CatalogueItem[]; identifiers: ExistingIdentifier[] }
type FieldStatus = 'new' | 'existing' | 'invalid'
type ReviewedRow = InventoryImportRow & {
  excluded: boolean
  itemTypeStatus: FieldStatus
  brandStatus: FieldStatus
  modelStatus: FieldStatus
  locationStatus: FieldStatus
  issues: string[]
  serverIssue?: string
}
type Canonical = { name: string; id?: number; firstRowNumber?: number }

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
}
function identifier(value: string) { return value.trim().toLocaleLowerCase() }
function displayDate(value: string) {
  if (!value) return ''
  const [year, month, day] = value.split('-')
  return year && month && day ? `${day}/${month}/${year}` : value
}

export default function InventoryBatchImport() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<ReviewedRow[]>([])
  const [lookup, setLookup] = useState<LookupData | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)

  function validateRows(source: InventoryImportRow[], data: LookupData): ReviewedRow[] {
    const types = new Map(data.itemTypes.map((x) => [normalize(x.name), { name: x.name, id: x.id } as Canonical]))
    const brands = new Map<string, Canonical>()
    const models = new Map<string, Canonical>()
    const locations = new Map(data.locations.map((x) => [normalize(x.name), { name: x.name, id: x.id } as Canonical]))
    const seenSerial = new Map<string, number>()
    const seenMac = new Map<string, number>()

    return source.map((sourceRow): ReviewedRow => {
      const row: ReviewedRow = { ...sourceRow, excluded: Boolean((sourceRow as ReviewedRow).excluded), itemTypeStatus: 'new', brandStatus: 'new', modelStatus: 'new', locationStatus: 'new', issues: [] }
      if (row.excluded) return row
      if (!row.itemType.trim() || !row.brand.trim() || !row.model.trim() || !row.location.trim()) row.issues.push(t('Item Type, Brand, Model and Location are required.'))
      if ([row.itemType, row.brand, row.model, row.location].some((value) => value.length > 100)) row.issues.push(t('Item Type, Brand, Model and Location cannot exceed 100 characters.'))
      if (row.serialNumber.length > 500 || row.invoice.length > 500 || row.store.length > 500) row.issues.push(t('S/N, Invoice and Store cannot exceed 500 characters.'))
      if (row.eoasis && (!/^\d+$/.test(row.eoasis) || Number(row.eoasis) > 2147483647)) row.issues.push(t('EOASIS must be a whole number or empty.'))
      if (row.macAddress && !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(row.macAddress) && !/^[0-9a-f]{12}$/i.test(row.macAddress)) row.issues.push(t('Invalid MAC address format.'))
      if (row.macAddress && /^[0-9a-f]{12}$/i.test(row.macAddress)) row.macAddress = row.macAddress.match(/.{2}/g)!.join(':').toUpperCase()
      if (row.purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.purchaseDate)) row.issues.push(t('Purchase Date must be a valid Excel date.'))
      if (row.warrantyDate && !/^\d{4}-\d{2}-\d{2}$/.test(row.warrantyDate)) row.issues.push(t('Warranty Date must be a valid Excel date.'))
      if (row.issues.length) { row.itemTypeStatus = row.brandStatus = row.modelStatus = row.locationStatus = 'invalid'; return row }

      const typeKey = normalize(row.itemType)
      let type = types.get(typeKey)
      if (type) { row.itemType = type.name; row.itemTypeStatus = type.id || type.firstRowNumber !== row.rowNumber ? 'existing' : 'new' }
      else { type = { name: row.itemType, firstRowNumber: row.rowNumber }; types.set(typeKey, type); row.itemTypeStatus = 'new' }

      const brandKey = `${typeKey}|${normalize(row.brand)}`
      let brand = brands.get(brandKey)
      if (!brand && type.id) {
        const match = data.brands.find((x) => x.item_type_id === type!.id && normalize(x.name) === normalize(row.brand))
        if (match) brand = { name: match.name, id: match.id }
      }
      if (brand) { row.brand = brand.name; row.brandStatus = brand.id || brand.firstRowNumber !== row.rowNumber ? 'existing' : 'new' }
      else { brand = { name: row.brand, firstRowNumber: row.rowNumber }; brands.set(brandKey, brand); row.brandStatus = 'new' }
      if (!brands.has(brandKey)) brands.set(brandKey, brand)

      const modelKey = `${brandKey}|${normalize(row.model)}`
      let model = models.get(modelKey)
      if (!model && type.id && brand.id) {
        const match = data.models.find((x) => x.item_type_id === type!.id && x.brand_id === brand!.id && normalize(x.name) === normalize(row.model))
        if (match) model = { name: match.name, id: match.id }
      }
      if (model) { row.model = model.name; row.modelStatus = model.id || model.firstRowNumber !== row.rowNumber ? 'existing' : 'new' }
      else { model = { name: row.model, firstRowNumber: row.rowNumber }; models.set(modelKey, model); row.modelStatus = 'new' }
      if (!models.has(modelKey)) models.set(modelKey, model)

      const locationKey = normalize(row.location)
      let location = locations.get(locationKey)
      if (location) { row.location = location.name; row.locationStatus = location.id || location.firstRowNumber !== row.rowNumber ? 'existing' : 'new' }
      else { location = { name: row.location, firstRowNumber: row.rowNumber }; locations.set(locationKey, location); row.locationStatus = 'new' }

      const comboKey = `${typeKey}|${normalize(row.brand)}|${normalize(row.model)}`
      const dbType = type.id; const dbBrand = brand.id; const dbModel = model.id
      if (dbType && dbBrand && dbModel) {
        if (row.serialNumber && data.identifiers.some((x) => x.item_type_id === dbType && x.brand_id === dbBrand && x.model_id === dbModel && identifier(x.serial_number ?? '') === identifier(row.serialNumber))) {
          row.issues.push(t('This S/N is already used for this Item Type, Brand and Model.'))
        }
        if (row.macAddress && data.identifiers.some((x) => x.item_type_id === dbType && x.brand_id === dbBrand && x.model_id === dbModel && identifier(x.mac_address ?? '') === identifier(row.macAddress))) {
          row.issues.push(t('This MAC Address is already used for this Item Type, Brand and Model.'))
        }
      }
      if (row.serialNumber) {
        const key = `${comboKey}|${identifier(row.serialNumber)}`; const first = seenSerial.get(key)
        if (first) row.issues.push(t('S/N duplicates Excel row {row}.', { row: first }))
        else seenSerial.set(key, row.rowNumber)
      }
      if (row.macAddress) {
        const key = `${comboKey}|${identifier(row.macAddress)}`; const first = seenMac.get(key)
        if (first) row.issues.push(t('MAC Address duplicates Excel row {row}.', { row: first }))
        else seenMac.set(key, row.rowNumber)
      }
      return row
    })
  }

  async function handleFile(file?: File) {
    if (!file) return
    setError(''); setSuccess(''); setRows([]); setFileName(''); setAcknowledged(false); setLoading(true)
    try {
      const parsed = await readInventoryWorkbook(file)
      const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', { body: { action: 'preview_batch' } })
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || t('Unable to validate the uploaded inventory.'))
      const current: LookupData = { itemTypes: data.itemTypes ?? [], brands: data.brands ?? [], models: data.models ?? [], locations: data.locations ?? [], identifiers: data.identifiers ?? [] }
      setLookup(current); setRows(validateRows(parsed, current)); setFileName(file.name)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Unable to read the uploaded Excel file.')) }
    finally { setLoading(false) }
  }

  function updateRow(index: number, patch: Partial<InventoryImportRow & { excluded: boolean }>) {
    if (!lookup) return
    setRows((current) => validateRows(current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row), lookup))
    setAcknowledged(false); setError('')
  }

  async function commitImport() {
    const included = rows.filter((row) => !row.excluded)
    if (!included.length || included.some((row) => row.issues.length || row.serverIssue) || !acknowledged) return
    setCommitting(true); setError(''); setSuccess('')
    try {
      const payloadRows = included.map(({ rowNumber, itemType, brand, model, serialNumber, macAddress, eoasis, invoice, purchaseDate, warrantyDate, store, location }) => ({ rowNumber, itemType, brand, model, serialNumber, macAddress, eoasis, invoice, purchaseDate, warrantyDate, store, location }))
      const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', { body: { action: 'batch_import', acknowledged: true, rows: payloadRows } })
      let responseData: { error?: string; createdCount?: number; conflicts?: { rowNumber: number; message: string }[] } | null = data
      if (!responseData && invokeError?.context instanceof Response) {
        try { responseData = await invokeError.context.clone().json() } catch { responseData = null }
      }
      if (invokeError || responseData?.error) {
        const conflicts = Array.isArray(responseData?.conflicts) ? responseData.conflicts : []
        if (conflicts.length) {
          const { data: refreshed } = await supabase.functions.invoke('manage-inventory', { body: { action: 'preview_batch' } })
          if (refreshed && !refreshed.error) {
            const freshLookup: LookupData = { itemTypes: refreshed.itemTypes ?? [], brands: refreshed.brands ?? [], models: refreshed.models ?? [], locations: refreshed.locations ?? [], identifiers: refreshed.identifiers ?? [] }
            setLookup(freshLookup)
            const messages = new Map<number, string>()
            conflicts.forEach((item) => messages.set(item.rowNumber, [messages.get(item.rowNumber), item.message].filter(Boolean).join(' ')))
            setRows((current) => validateRows(current, freshLookup).map((row) => row.issues.length ? row : { ...row, serverIssue: messages.get(row.rowNumber) }))
          } else {
            setRows((current) => current.map((row) => ({ ...row, serverIssue: conflicts.filter((x) => x.rowNumber === row.rowNumber).map((x) => x.message).join(' ') || undefined })))
          }
          setAcknowledged(false)
        }
        throw new Error(responseData?.error || invokeError?.message || t('The import could not be completed.'))
      }
      setSuccess(t('Successfully imported {count} inventory items.', { count: responseData?.createdCount ?? included.length }))
      setRows([]); setLookup(null); setFileName(''); setAcknowledged(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('The import could not be completed.')) }
    finally { setCommitting(false) }
  }

  const included = rows.filter((row) => !row.excluded)
  const readyCount = included.filter((row) => row.issues.length === 0 && !row.serverIssue).length
  const issueCount = included.length - readyCount
  const excludedCount = rows.length - included.length
  const statusText = (status: FieldStatus) => status === 'existing' ? t('Will be reused') : status === 'new' ? t('Will be created') : t('Needs attention')
  const statusClass = (status: FieldStatus) => status === 'existing' ? 'text-blue-700' : status === 'new' ? 'text-green-700' : 'text-red-700'

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="font-semibold text-slate-800">{t('Inventory')}</div><p className="mt-1 text-sm text-slate-500">{t('Excel columns: Item Type, Brand, Model, S/N, MAC Address, EOASIS, Invoice, Purchase Date, Warranty Date, Store, Location.')}</p></div>
        <a href={`${import.meta.env.BASE_URL}inventory-import-template.xlsx`} download className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16} /> {t('Download Excel template')}</a>
      </div>
      <div className="space-y-2"><label htmlFor="inventory-import-file" className="block text-sm font-medium text-slate-700">{t('Upload completed template')}</label>
        <input id="inventory-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loading || committing} onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = '' }} className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
        <p className="text-xs text-slate-500">{t('Maximum 1,000 rows and 5 MB. Only .xlsx files are accepted.')}</p>
      </div>
      {loading && <p className="text-sm text-blue-700">{t('Reading and validating Excel file…')}</p>}
      {fileName && <p className="text-xs text-slate-500">{t('Selected file')}: {fileName}</p>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {success && <div role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{success}</div>}
      {rows.length > 0 && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold text-slate-900">{t('Review import')}</h3><p className="text-xs text-slate-500">{t('{count} rows · {ready} ready · {issues} need attention · {excluded} excluded', { count: rows.length, ready: readyCount, issues: issueCount, excluded: excludedCount })}</p></div>
          <button type="button" onClick={() => { setRows([]); setLookup(null); setFileName(''); setAcknowledged(false); setError('') }} className="text-sm font-medium text-slate-600 hover:text-slate-900">{t('Discard review')}</button></div>
        <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-[1900px] w-full text-left text-xs"><thead className="bg-slate-50 text-slate-600"><tr>{['Excel row','Item Type','Brand','Model','S/N','MAC Address','EOASIS','Invoice','Purchase Date','Warranty Date','Store','Location','Validation','Action'].map((label) => <th key={label} className="px-2 py-2 font-semibold">{t(label)}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((row, index) => <tr key={`${row.rowNumber}-${index}`} className={row.excluded ? 'bg-slate-50 opacity-60' : ''}>
            <td className="px-2 py-2 align-top tabular-nums">{row.rowNumber}</td>
            {([['itemType','itemTypeStatus'],['brand','brandStatus'],['model','modelStatus']] as const).map(([field,status]) => <td key={field} className="px-2 py-2 align-top"><input value={row[field]} disabled={row.excluded || committing} onChange={(e) => updateRow(index, { [field]: e.target.value } as Partial<InventoryImportRow>) } className="w-36 rounded border border-slate-300 px-2 py-1.5" /><div className={`mt-1 ${statusClass(row[status])}`}>{statusText(row[status])}</div></td>)}
            {([['serialNumber','text'],['macAddress','text'],['eoasis','text'],['invoice','text'],['purchaseDate','date'],['warrantyDate','date'],['store','text'],['location','text']] as const).map(([field,type]) => <td key={field} className="px-2 py-2 align-top"><input type={type} value={row[field]} disabled={row.excluded || committing} onChange={(e) => updateRow(index, { [field]: e.target.value } as Partial<InventoryImportRow>)} className="w-32 rounded border border-slate-300 px-2 py-1.5" />{(field === 'serialNumber' || field === 'macAddress') && <div className={`mt-1 ${row.issues.some((issue) => issue.includes(field === 'serialNumber' ? 'S/N' : 'MAC')) ? 'text-red-700' : 'text-green-700'}`}>{row[field] ? (row.issues.some((issue) => issue.includes(field === 'serialNumber' ? 'S/N' : 'MAC')) ? t('Already used / duplicated') : t('Available')) : t('Optional')}</div>}{(field === 'purchaseDate' || field === 'warrantyDate') && row[field] && <div className="mt-1 text-slate-500">{displayDate(row[field])}</div>}{field === 'location' && <div className={`mt-1 ${statusClass(row.locationStatus)}`}>{statusText(row.locationStatus)}</div>}</td>)}
            <td className="max-w-xs px-2 py-2 align-top">{row.issues.length || row.serverIssue ? <div className="space-y-1 text-red-700">{row.issues.map((issue, i) => <p key={i}>{issue}</p>)}{row.serverIssue && <p>{row.serverIssue}</p>}</div> : <span className="font-medium text-green-700">{t('Ready')}</span>}</td>
            <td className="px-2 py-2 align-top"><button type="button" disabled={committing} onClick={() => updateRow(index, { excluded: !row.excluded })} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">{row.excluded ? <><RotateCcw size={14} />{t('Include')}</> : <><Trash2 size={14} />{t('Exclude')}</>}</button></td>
          </tr>)}</tbody></table></div>
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4"><div className="flex items-start gap-2 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{t('Inventory imports cannot be undone. Existing catalogue entries and locations will be reused, never overwritten. New catalogue entries and locations will be created only when the import is committed.')}</p></div>
          <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={acknowledged} disabled={committing} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5" />{t('I understand that this import cannot be undone and confirm that the reviewed inventory items should be created.')}</label>
          <button type="button" onClick={() => void commitImport()} disabled={committing || !acknowledged || readyCount === 0 || issueCount > 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"><Upload size={16} /> {committing ? t('Importing…') : t('Import {count} inventory items', { count: readyCount })}</button>
        </div>
      </div>}
    </div>
  )
}
