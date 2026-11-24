import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, RotateCcw, Trash2, Upload } from 'lucide-react'
import { readEmployeesWorkbook, type EmployeeImportRow } from '../lib/employeeXlsx'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageProvider'

type EmployeeStatus = 'new' | 'existing' | 'duplicate' | 'invalid'
type ExistingEmployee = { id: number; full_name: string }
type ReviewedEmployeeRow = EmployeeImportRow & {
  excluded: boolean
  status: EmployeeStatus
  message: string
  existing?: ExistingEmployee
  firstRowNumber?: number
}

function normalizeName(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase()
}

export default function EmployeeBatchImport() {
  const { t } = useLanguage()
  const [rows, setRows] = useState<ReviewedEmployeeRow[]>([])
  const [existingEmployees, setExistingEmployees] = useState<ExistingEmployee[]>([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)

  function validateRows(sourceRows: EmployeeImportRow[], existing: ExistingEmployee[]) {
    const existingByName = new Map(existing.map((employee) => [normalizeName(employee.full_name), employee]))
    const seen = new Map<string, { rowNumber: number; fullName: string }>()
    return sourceRows.map((row): ReviewedEmployeeRow => {
      const fullName = row.fullName.trim()
      if (!fullName) return { ...row, excluded: false, status: 'invalid', message: t('Employee name is required.') }
      if (fullName.length > 200) return { ...row, excluded: false, status: 'invalid', message: t('Employee name cannot exceed 200 characters.') }
      const key = normalizeName(fullName)
      const match = existingByName.get(key)
      if (match) return { ...row, fullName: match.full_name, excluded: false, status: 'existing', message: t('An equivalent employee already exists.'), existing: match }
      const first = seen.get(key)
      if (first) return { ...row, fullName: first.fullName, excluded: false, status: 'duplicate', message: t('Duplicates row {row}.', { row: first.rowNumber }), firstRowNumber: first.rowNumber }
      seen.set(key, { rowNumber: row.rowNumber, fullName })
      return { ...row, excluded: false, status: 'new', message: t('Will be created.') }
    })
  }

  async function handleFile(file?: File) {
    if (!file) return
    setError('')
    setSuccess('')
    setRows([])
    setFileName('')
    setAcknowledged(false)
    setLoading(true)
    try {
      const parsed = await readEmployeesWorkbook(file)
      const { data, error: invokeError } = await supabase.functions.invoke('manage-employees', { body: { action: 'preview_batch' } })
      if (invokeError || data?.error) throw new Error(data?.error || invokeError?.message || t('Unable to validate the uploaded employees.'))
      const existing = (data.employees ?? []) as ExistingEmployee[]
      setExistingEmployees(existing)
      setRows(validateRows(parsed, existing))
      setFileName(file.name)
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t('Unable to read the uploaded Excel file.'))
    } finally {
      setLoading(false)
    }
  }

  function updateRow(index: number, patch: Partial<Pick<ReviewedEmployeeRow, 'fullName' | 'excluded'>>) {
    setRows((current) => {
      const updated = current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row)
      const existingByName = new Map(existingEmployees.map((employee) => [normalizeName(employee.full_name), employee]))
      const seen = new Map<string, { rowNumber: number; fullName: string }>()
      return updated.map((row) => {
        if (row.excluded) return { ...row, status: 'new' as EmployeeStatus, message: t('Excluded from this import.'), existing: undefined, firstRowNumber: undefined }
        const fullName = row.fullName.trim()
        if (!fullName) return { ...row, status: 'invalid' as EmployeeStatus, message: t('Employee name is required.'), existing: undefined, firstRowNumber: undefined }
        if (fullName.length > 200) return { ...row, status: 'invalid' as EmployeeStatus, message: t('Employee name cannot exceed 200 characters.'), existing: undefined, firstRowNumber: undefined }
        const key = normalizeName(fullName)
        const match = existingByName.get(key)
        if (match) return { ...row, fullName: match.full_name, status: 'existing' as EmployeeStatus, message: t('An equivalent employee already exists.'), existing: match, firstRowNumber: undefined }
        const first = seen.get(key)
        if (first) return { ...row, fullName: first.fullName, status: 'duplicate' as EmployeeStatus, message: t('Duplicates row {row}.', { row: first.rowNumber }), existing: undefined, firstRowNumber: first.rowNumber }
        seen.set(key, { rowNumber: row.rowNumber, fullName })
        return { ...row, status: 'new' as EmployeeStatus, message: t('Will be created.'), existing: undefined, firstRowNumber: undefined }
      })
    })
    setAcknowledged(false)
    setError('')
  }

  async function commitImport() {
    const included = rows.filter((row) => !row.excluded)
    if (!included.length || included.some((row) => row.status !== 'new') || !acknowledged) return
    setCommitting(true)
    setError('')
    setSuccess('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('manage-employees', {
        body: { action: 'batch_import', acknowledged: true, rows: included.map(({ rowNumber, fullName }) => ({ rowNumber, fullName })) },
      })
      if (invokeError || data?.error) {
        let responseData: { error?: string; conflicts?: { rowNumber: number; type: string; message: string; existing?: ExistingEmployee; firstRowNumber?: number }[] } | null = data
        if (!responseData && invokeError?.context instanceof Response) {
          try { responseData = await invokeError.context.clone().json() } catch { responseData = null }
        }
        if (Array.isArray(responseData?.conflicts)) {
          const conflicts = new Map(responseData.conflicts.map((item) => [item.rowNumber, item] as const))
          setExistingEmployees((current) => [...current, ...responseData!.conflicts!.map((item) => item.existing).filter((item): item is ExistingEmployee => Boolean(item))])
          setRows((current) => current.map((row) => {
            const conflict = conflicts.get(row.rowNumber)
            if (!conflict) return row
            const first = conflict.firstRowNumber === undefined ? undefined : current.find((item) => item.rowNumber === conflict.firstRowNumber)
            return {
              ...row,
              fullName: conflict.existing?.full_name ?? first?.fullName ?? row.fullName,
              status: conflict.type === 'existing' ? 'existing' : conflict.type === 'within_file' ? 'duplicate' : 'invalid',
              message: conflict.message,
              existing: conflict.existing,
              firstRowNumber: conflict.firstRowNumber,
            }
          }))
        }
        throw new Error(responseData?.error || invokeError?.message || t('The import could not be completed.'))
      }
      setSuccess(t('Successfully imported {count} employees.', { count: data.createdCount ?? included.length }))
      setRows([])
      setExistingEmployees([])
      setFileName('')
      setAcknowledged(false)
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t('The import could not be completed.'))
    } finally {
      setCommitting(false)
    }
  }

  const readyCount = rows.filter((row) => !row.excluded && row.status === 'new').length
  const issueCount = rows.filter((row) => !row.excluded && row.status !== 'new').length
  const excludedCount = rows.filter((row) => row.excluded).length

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-slate-800">{t('Employees')}</div>
          <p className="mt-1 text-sm text-slate-500">{t('Excel column: Full name. Existing employees will not be duplicated or modified.')}</p>
        </div>
        <a href={`${import.meta.env.BASE_URL}employee-import-template.xlsx`} download className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <Download size={16} /> {t('Download Excel template')}
        </a>
      </div>
      <div className="space-y-2">
        <label htmlFor="employee-import-file" className="block text-sm font-medium text-slate-700">{t('Upload completed template')}</label>
        <input id="employee-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={loading || committing}
          onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = '' }}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
        <p className="text-xs text-slate-500">{t('Maximum 1,000 rows and 5 MB. Only .xlsx files are accepted.')}</p>
      </div>
      {loading && <p className="text-sm text-blue-700">{t('Reading and validating Excel file…')}</p>}
      {fileName && <p className="text-xs text-slate-500">{t('Selected file')}: {fileName}</p>}
      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={17} className="mt-0.5 shrink-0" />{error}</div>}
      {success && <div role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700"><CheckCircle2 size={17} className="mt-0.5 shrink-0" />{success}</div>}
      {rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900">{t('Review import')}</h3>
              <p className="text-xs text-slate-500">{t('{count} rows · {ready} ready · {issues} need attention · {excluded} excluded', { count: rows.length, ready: readyCount, issues: issueCount, excluded: excludedCount })}</p>
            </div>
            <button type="button" onClick={() => { setRows([]); setExistingEmployees([]); setFileName(''); setAcknowledged(false); setError('') }} className="text-sm font-medium text-slate-600 hover:text-slate-900">{t('Discard review')}</button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[620px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">{t('Excel row')}</th><th className="px-3 py-2">{t('Full name')}</th><th className="px-3 py-2">{t('Validation')}</th><th className="px-3 py-2">{t('Action')}</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row, index) => <tr key={`${row.rowNumber}-${index}`} className={row.excluded ? 'bg-slate-50 opacity-60' : ''}>
                  <td className="px-3 py-2 align-top tabular-nums">{row.rowNumber}</td>
                  <td className="px-3 py-2 align-top"><input aria-label={t('Full name')} value={row.fullName} disabled={row.excluded || committing} onChange={(event) => updateRow(index, { fullName: event.target.value })} className="w-72 max-w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100" />{row.existing && <p className="mt-1 text-xs text-slate-500">{t('Existing')}: {row.existing.full_name}</p>}</td>
                  <td className="px-3 py-2 align-top"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${row.excluded ? 'bg-slate-100 text-slate-500' : row.status === 'new' ? 'bg-green-100 text-green-800' : row.status === 'existing' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{row.excluded ? t('Excluded') : row.status === 'new' ? t('New — will be created') : row.status === 'existing' ? t('Existing duplicate') : row.status === 'duplicate' ? t('Duplicate in file') : t('Invalid')}</span><p className="mt-1 max-w-xs text-xs text-slate-500">{row.message}</p></td>
                  <td className="px-3 py-2 align-top"><button type="button" disabled={committing} onClick={() => updateRow(index, { excluded: !row.excluded })} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">{row.excluded ? <><RotateCcw size={14} />{t('Include')}</> : <><Trash2 size={14} />{t('Exclude')}</>}</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-2 text-sm text-amber-900"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{t('Imports cannot be undone. Existing employees will not be modified. Rows with validation issues must be edited or excluded before continuing.')}</p></div>
            <label className="flex items-start gap-2 text-sm text-slate-800"><input type="checkbox" checked={acknowledged} disabled={committing} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5" />{t('I understand that this import cannot be undone and confirm that the reviewed employees should be created.')}</label>
            <button type="button" onClick={() => void commitImport()} disabled={committing || !acknowledged || readyCount === 0 || issueCount > 0} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Upload size={16} /> {committing ? t('Importing…') : t('Import {count} employees', { count: readyCount })}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
