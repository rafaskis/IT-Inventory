import { useState } from 'react'
import { FileSpreadsheet, Download, Upload, AlertTriangle, Trash2, RotateCcw, CheckCircle2 } from 'lucide-react'
import { readLocationsWorkbook, type LocationImportRow } from '../lib/locationXlsx'
import EmployeeBatchImport from './EmployeeBatchImport'
import InventoryBatchImport from './InventoryBatchImport'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageProvider'

type ImportStatus = 'new' | 'existing' | 'duplicate' | 'invalid'
type ReviewedLocationRow = LocationImportRow & {
  excluded: boolean
  status: ImportStatus
  message: string
  existing?: { id: number; name: string; notes: string | null }
  firstRowNumber?: number
}

function normalizeImportName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
}

export default function BatchImportPage() {
  const { t } = useLanguage()
  const [importRows, setImportRows] = useState<ReviewedLocationRow[]>([])
  const [existingLocations, setExistingLocations] = useState<{ id: number; name: string; notes: string | null }[]>([])
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [importAcknowledged, setImportAcknowledged] = useState(false)
  const [loadingImport, setLoadingImport] = useState(false)
  const [committingImport, setCommittingImport] = useState(false)

  function reviewLocationRows(rows: LocationImportRow[], existing: { id: number; name: string; notes: string | null }[]) {
    const existingByName = new Map(existing.map((location) => [normalizeImportName(location.name), location]))
    const firstRows = new Map<string, { rowNumber: number; name: string }>()
    return rows.map((row): ReviewedLocationRow => {
      const name = row.name.trim()
      if (!name) return { ...row, excluded: false, status: 'invalid', message: t('Location name is required.') }
      if (name.length > 200) return { ...row, excluded: false, status: 'invalid', message: t('Location name cannot exceed 200 characters.') }
      const key = normalizeImportName(name)
      const match = existingByName.get(key)
      if (match) return { ...row, name: match.name, excluded: false, status: 'existing', message: t('An equivalent location already exists.'), existing: match }
      const firstRowNumber = firstRows.get(key)
      if (firstRowNumber !== undefined) return { ...row, name: firstRowNumber.name, excluded: false, status: 'duplicate', message: t('Duplicates row {row}.', { row: firstRowNumber.rowNumber }), firstRowNumber: firstRowNumber.rowNumber }
      firstRows.set(key, { rowNumber: row.rowNumber, name })
      return { ...row, excluded: false, status: 'new', message: t('Will be created.') }
    })
  }

  async function handleLocationFile(file?: File) {
    if (!file) return
    setImportError('')
    setImportSuccess('')
    setImportRows([])
    setImportFileName('')
    setImportAcknowledged(false)
    setLoadingImport(true)
    try {
      const parsed = await readLocationsWorkbook(file)
      const { data, error } = await supabase.functions.invoke('manage-locations', { body: { action: 'preview_batch' } })
      if (error || data?.error) throw new Error(data?.error || error?.message || t('Unable to validate the uploaded locations.'))
      setExistingLocations(data.locations ?? [])
      setImportRows(reviewLocationRows(parsed, data.locations ?? []))
      setImportFileName(file.name)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('Unable to read the uploaded Excel file.'))
    } finally {
      setLoadingImport(false)
    }
  }

  function updateImportRow(index: number, patch: Partial<Pick<ReviewedLocationRow, 'name' | 'notes' | 'excluded'>>) {
    setImportRows((current) => {
      const updated = current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)
      const allExisting = existingLocations
      // Keep the canonical database snapshot separately from row edits by rebuilding only validation states.
      const seen = new Map<string, { rowNumber: number; name: string }>()
      return updated.map((row) => {
        if (row.excluded) return { ...row, status: 'new' as ImportStatus, message: t('Excluded from this import.'), existing: undefined, firstRowNumber: undefined }
        const name = row.name.trim()
        if (!name) return { ...row, status: 'invalid' as ImportStatus, message: t('Location name is required.'), existing: undefined }
        if (name.length > 200) return { ...row, status: 'invalid' as ImportStatus, message: t('Location name cannot exceed 200 characters.'), existing: undefined }
        const key = normalizeImportName(name)
        const databaseMatch = allExisting.find((item) => normalizeImportName(item.name) === key)
        if (databaseMatch) return { ...row, status: 'existing' as ImportStatus, message: t('An equivalent location already exists.'), existing: databaseMatch }
        const first = seen.get(key)
        if (first !== undefined) return { ...row, name: first.name, status: 'duplicate' as ImportStatus, message: t('Duplicates row {row}.', { row: first.rowNumber }), firstRowNumber: first.rowNumber, existing: undefined }
        seen.set(key, { rowNumber: row.rowNumber, name })
        return { ...row, status: 'new' as ImportStatus, message: t('Will be created.'), existing: undefined, firstRowNumber: undefined }
      })
    })
    setImportAcknowledged(false)
    setImportError('')
  }

  async function commitLocationImport() {
    const rows = importRows.filter((row) => !row.excluded)
    if (!rows.length || rows.some((row) => row.status !== 'new') || !importAcknowledged) return
    setCommittingImport(true)
    setImportError('')
    setImportSuccess('')
    try {
      const { data, error } = await supabase.functions.invoke('manage-locations', {
        body: { action: 'batch_import', acknowledged: true, rows: rows.map(({ rowNumber, name, notes }) => ({ rowNumber, name, notes })) },
      })
      if (error || data?.error) {
        let responseData: { error?: string; conflicts?: { rowNumber: number; type: string; message: string; existing?: ReviewedLocationRow['existing']; firstRowNumber?: number }[] } | null = data
        if (!responseData && error?.context instanceof Response) {
          try { responseData = await error.context.clone().json() } catch { responseData = null }
        }
        if (Array.isArray(responseData?.conflicts)) {
          const conflictPayload = responseData.conflicts
          const conflicts = new Map<number, { type: string; message: string; existing?: ReviewedLocationRow['existing']; firstRowNumber?: number }>(conflictPayload.map((item) => [item.rowNumber, item] as const))
          setExistingLocations((current) => [...current, ...conflictPayload.map((item) => item.existing).filter((item): item is NonNullable<ReviewedLocationRow['existing']> => Boolean(item))])
          setImportRows((current) => current.map((row) => {
            const conflict = conflicts.get(row.rowNumber)
            if (!conflict) return row
            const firstRow = conflict.firstRowNumber === undefined ? undefined : current.find((item) => item.rowNumber === conflict.firstRowNumber)
            return { ...row, name: conflict.existing?.name ?? firstRow?.name ?? row.name, status: conflict.type === 'existing' ? 'existing' : conflict.type === 'within_file' ? 'duplicate' : 'invalid', message: conflict.message, existing: conflict.existing, firstRowNumber: conflict.firstRowNumber }
          }))
        }
        throw new Error(responseData?.error || error?.message || t('The import could not be completed.'))
      }
      setImportSuccess(t('Successfully imported {count} locations.', { count: data.createdCount ?? rows.length }))
      setImportRows([])
      setExistingLocations([])
      setImportFileName('')
      setImportAcknowledged(false)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('The import could not be completed.'))
    } finally {
      setCommittingImport(false)
    }
  }


  const locationImportSection = (
    <>
              <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{t('Locations')}</div>
                  <p className="mt-1 text-sm text-slate-500">{t('Excel columns: Location Name, Notes. Existing locations will never be overwritten.')}</p>
                </div>
                <a href={`${import.meta.env.BASE_URL}location-import-template.xlsx`} download className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  <Download size={16} /> {t('Download Excel template')}
                </a>
              </div>
              <div className="space-y-2">
                <label htmlFor="location-import-file" className="block text-sm font-medium text-slate-700">{t('Upload completed template')}</label>
                <input id="location-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loadingImport || committingImport}
                  onChange={(event) => { void handleLocationFile(event.target.files?.[0]); event.currentTarget.value = '' }}
                  className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
                <p className="text-xs text-slate-500">{t('Maximum 1,000 rows and 5 MB. Only .xlsx files are accepted.')}</p>
              </div>
              {loadingImport && <p className="text-sm text-blue-700">{t('Reading and validating Excel file…')}</p>}
              {importFileName && <p className="text-xs text-slate-500">{t('Selected file')}: {importFileName}</p>}
              {importError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{importError}</div>}
              {importSuccess && <div role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{importSuccess}</div>}
              {importRows.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{t('Review import')}</h3>
                      <p className="text-xs text-slate-500">{t('{count} rows · {ready} ready · {issues} need attention · {excluded} excluded', { count: importRows.length, ready: importRows.filter((row) => !row.excluded && row.status === 'new').length, issues: importRows.filter((row) => !row.excluded && row.status !== 'new').length, excluded: importRows.filter((row) => row.excluded).length })}</p>
                    </div>
                    <button type="button" onClick={() => { setImportRows([]); setExistingLocations([]); setImportFileName(''); setImportAcknowledged(false); setImportError('') }} className="text-sm font-medium text-slate-600 hover:text-slate-900">{t('Discard review')}</button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-[850px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">{t('Excel row')}</th><th className="px-3 py-2">{t('Location Name')}</th><th className="px-3 py-2">{t('Notes')}</th><th className="px-3 py-2">{t('Validation')}</th><th className="px-3 py-2">{t('Action')}</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {importRows.map((row, index) => <tr key={`${row.rowNumber}-${index}`} className={row.excluded ? 'bg-slate-50 opacity-60' : ''}>
                          <td className="px-3 py-2 align-top tabular-nums">{row.rowNumber}</td>
                          <td className="px-3 py-2 align-top"><input aria-label={t('Location Name')} value={row.name} disabled={row.excluded || committingImport} onChange={(event) => updateImportRow(index, { name: event.target.value })} className="w-52 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100" />{row.existing && <p className="mt-1 max-w-xs text-xs text-slate-500">{t('Existing')}: {row.existing.name}</p>}</td>
                          <td className="px-3 py-2 align-top"><textarea aria-label={t('Notes')} rows={2} value={row.notes} disabled={row.excluded || committingImport} onChange={(event) => updateImportRow(index, { notes: event.target.value })} className="w-64 rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100" />{row.existing?.notes && <p className="mt-1 max-w-xs text-xs text-slate-500">{t('Existing notes')}: {row.existing.notes}</p>}</td>
                          <td className="px-3 py-2 align-top"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${row.excluded ? 'bg-slate-100 text-slate-500' : row.status === 'new' ? 'bg-green-100 text-green-800' : row.status === 'existing' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{row.excluded ? t('Excluded') : row.status === 'new' ? t('New — will be created') : row.status === 'existing' ? t('Existing duplicate') : row.status === 'duplicate' ? t('Duplicate in file') : t('Invalid')}</span><p className="mt-1 max-w-xs text-xs text-slate-500">{row.message}</p></td>
                          <td className="px-3 py-2 align-top"><button type="button" disabled={committingImport} onClick={() => updateImportRow(index, { excluded: !row.excluded })} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">{row.excluded ? <><RotateCcw size={14} />{t('Include')}</> : <><Trash2 size={14} />{t('Exclude')}</>}</button></td>
                        </tr>)}
                      </tbody>
                    </table>
                  </div>
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex items-start gap-2 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{t('Imports cannot be undone. Existing locations and their notes will not be changed. Rows with validation issues must be edited or excluded before continuing.')}</p></div>
                    <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={importAcknowledged} disabled={committingImport} onChange={(event) => setImportAcknowledged(event.target.checked)} className="mt-0.5" />{t('I understand that this import cannot be undone and confirm that the reviewed locations should be created.')}</label>
                    <button type="button" onClick={() => void commitLocationImport()} disabled={committingImport || !importAcknowledged || !importRows.some((row) => !row.excluded) || importRows.some((row) => !row.excluded && row.status !== 'new')} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                      <Upload size={16} /> {committingImport ? t('Importing…') : t('Import {count} locations', { count: importRows.filter((row) => !row.excluded).length })}
                    </button>
                  </div>
                </div>
              )}
    </>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('Batch Import')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('Import data using prepared Excel templates. Inventory, employees and locations are available.')}</p>
      </div>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><FileSpreadsheet size={19} /></div>
          <div><h2 className="font-semibold text-slate-900">{t('Batch Import')}</h2><p className="text-xs text-slate-500">{t('Batch Import is intended for initial population of the database and for newly bulk purchased items.')}</p></div>
        </div>
            <div className="space-y-5 border-t border-slate-200 p-5">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                {t('Batch Import is intended for initial population of the database and for newly bulk purchased items.')}
              </div>
              <InventoryBatchImport />
              <EmployeeBatchImport />
              {locationImportSection}
            </div>
      </section>
    </div>
  )
}
