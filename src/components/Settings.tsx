import { useEffect, useMemo, useState } from 'react'
import { Check, User, Monitor, KeyRound, Languages, ChevronDown, Database } from 'lucide-react'
import { useLanguage, type Language } from '../i18n/LanguageProvider'
import { supabase } from '../lib/supabase'

type SettingsPageProps = {
  username: string
  role: string
  userId: string
  preferredPage: string
}

export default function SettingsPage({ username, role, userId, preferredPage }: SettingsPageProps) {
  const { language, setLanguage, t } = useLanguage()
  const availablePages = useMemo(() => {
    const pages = ['Dashboard', 'Inventory']
    pages.push('Employees', 'Locations', 'Catalogues', 'Audit Logs')
    if (role === 'administrator') pages.push('Accounts')
    if (role === 'administrator' || role === 'inventory_manager') pages.push('Batch Import')
    return pages
  }, [role])

  const [defaultPage, setDefaultPage] = useState(
    availablePages.includes(preferredPage) ? preferredPage : 'Dashboard',
  )
  const [saved, setSaved] = useState(false)
  const [savingPage, setSavingPage] = useState(false)
  const [languageError, setLanguageError] = useState('')
  const [languageSaved, setLanguageSaved] = useState(false)
  const [pageError, setPageError] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordWarning, setPasswordWarning] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [flushSummary, setFlushSummary] = useState<Record<string, number> | null>(null)
  const [flushPassword, setFlushPassword] = useState('')
  const [flushConfirmation, setFlushConfirmation] = useState('')
  const [flushError, setFlushError] = useState('')
  const [flushResult, setFlushResult] = useState('')
  const [loadingFlushPreview, setLoadingFlushPreview] = useState(false)
  const [flushingDatabase, setFlushingDatabase] = useState(false)
  const [verifyingFlushPassword, setVerifyingFlushPassword] = useState(false)
  const [showFlushConfirm, setShowFlushConfirm] = useState(false)

  useEffect(() => {
    if (role !== 'administrator') return
    let cancelled = false
    async function loadFlushPreview() {
      setLoadingFlushPreview(true)
      const { data, error } = await supabase.functions.invoke('manage-db-flush', { body: { action: 'preview' } })
      if (cancelled) return
      if (error || !data?.success || !data?.counts) {
        let message = data?.error || error?.message || t('Unable to load the database deletion summary.')
        const context = error?.context
        if (!data?.error && context && typeof context.clone === 'function') {
          try {
            const body = await context.clone().json()
            message = body?.error || body?.message || message
          } catch { /* Keep the original function error. */ }
        }
        setFlushError(message)
      } else {
        setFlushSummary(data.counts)
      }
      setLoadingFlushPreview(false)
    }
    void loadFlushPreview()
    return () => { cancelled = true }
  }, [role, t])

  async function flushDatabase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFlushError('')
    setFlushResult('')
    if (flushConfirmation !== 'FLUSH DATABASE') {
      setFlushError(t('Type FLUSH DATABASE exactly to confirm.'))
      return
    }
    if (!flushPassword) {
      setFlushError(t('Enter the dedicated flush password.'))
      return
    }
    // Verify the dedicated password with the server before showing the final
    // destructive-action modal. A wrong password must never open that modal.
    setVerifyingFlushPassword(true)
    try {
      const { data, error } = await supabase.functions.invoke('manage-db-flush', {
        body: { action: 'verify_password', flushPassword },
      })
      if (error || data?.error || !data?.success) {
        let message = data?.error || error?.message || t('Database flush password verification failed.')
        const context = error?.context
        if (!data?.error && context && typeof context.clone === 'function') {
          try {
            const body = await context.clone().json()
            message = body?.error || body?.message || message
          } catch { /* Keep the original function error. */ }
        }
        setFlushError(message)
        setShowFlushConfirm(false)
        return
      }
      setShowFlushConfirm(true)
    } catch {
      setFlushError(t('Database flush password verification failed.'))
      setShowFlushConfirm(false)
    } finally {
      setVerifyingFlushPassword(false)
    }
  }

  async function confirmFlushDatabase() {
    if (flushingDatabase) return
    setFlushError('')
    setFlushingDatabase(true)
    try {
      const { data, error } = await supabase.functions.invoke('manage-db-flush', {
        body: { action: 'flush', flushPassword, confirmation: flushConfirmation },
      })
      if (error || data?.error || !data?.success) {
        let message = data?.error || error?.message || t('Database flush failed.')
        const context = error?.context
        if (!data?.error && context && typeof context.clone === 'function') {
          try {
            const body = await context.clone().json()
            message = body?.error || body?.message || message
          } catch {
            // Keep the original function error when the response is not JSON.
          }
        }
        setFlushError(message)
        setShowFlushConfirm(false)
        return
      }
      setFlushPassword('')
      setFlushConfirmation('')
      setShowFlushConfirm(false)
      setFlushResult(t('Database flush completed. Your administrator account remains active.'))
    } catch {
      setFlushError(t('Database flush failed. Check the connection and contact the system administrator.'))
      setShowFlushConfirm(false)
    } finally {
      setFlushingDatabase(false)
    }
  }


  async function changeLanguage(nextLanguage: Language) {
    setLanguageError('')
    setLanguageSaved(false)
    if (nextLanguage === language) return

    const { error } = await supabase
      .from('profiles')
      .update({ preferred_language: nextLanguage })
      .eq('id', userId)

    if (error) {
      setLanguageError(t('Unable to save your language preference.'))
      return
    }

    setLanguage(nextLanguage)
    setLanguageSaved(true)
  }

  async function saveDefaultPage() {
    setPageError('')
    setSavingPage(true)
    const { error } = await supabase
      .from('profiles')
      .update({ preferred_page: defaultPage })
      .eq('id', userId)

    setSavingPage(false)
    if (error) {
      setPageError(t('Unable to save your default page preference.'))
      setSaved(false)
      return
    }
    setSaved(true)
  }

  async function handlePasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')
    setPasswordWarning('')

    if (newPassword.length < 8 || newPassword.length > 32) {
      setPasswordError(t('The new password must contain between 8 and 32 characters.'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('The new passwords do not match.'))
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError(t('The new password must be different from your current password.'))
      return
    }

    setChangingPassword(true)
    try {
      const { data, error: functionError } = await supabase.functions.invoke('manage-users', {
        body: { action: 'change_own_password', currentPassword, password: newPassword },
      })
      if (functionError || data?.error) {
        setPasswordError(t(data?.error || functionError?.message || 'Unable to change your password.'))
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess(t('Your password has been changed successfully.'))
      if (data?.warning) setPasswordWarning(t(data.warning))
    } catch {
      setPasswordError(t('Unable to change your password. Please try again.'))
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('Settings')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('Manage your account and personal application preferences.')}
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><User size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">{t('Account information')}</h2>
            <p className="text-xs text-slate-500">{t('Your current application account')}</p>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('Username')}</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{username}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t('Role')}</p>
            <p className="mt-1 text-sm font-medium capitalize text-slate-800">{t(role === 'administrator' ? 'Administrator' : role === 'inventory_manager' ? 'Inventory Manager' : 'Viewer')}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-600"><KeyRound size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">{t('Change password')}</h2>
          </div>
        </div>
        <form onSubmit={handlePasswordChange} className="max-w-xl space-y-4 p-5">
          <div>
            <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-slate-700">{t('Current password')}</label>
            <input id="current-password" type="password" required autoComplete="current-password"
              value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={changingPassword} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700">{t('New password')}</label>
            <input id="new-password" type="password" required minLength={8} maxLength={32} autoComplete="new-password"
              value={newPassword} onChange={(event) => setNewPassword(event.target.value)}
              disabled={changingPassword} placeholder={t('8–32 characters')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <div>
            <label htmlFor="confirm-new-password" className="mb-1.5 block text-sm font-medium text-slate-700">{t('Confirm new password')}</label>
            <input id="confirm-new-password" type="password" required minLength={8} maxLength={32} autoComplete="new-password"
              value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={changingPassword} placeholder={t('Enter the new password again')}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          {passwordError && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div>}
          {passwordSuccess && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{passwordSuccess}</div>}
          {passwordWarning && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{passwordWarning}</div>}
          <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
            <KeyRound size={16} /> {changingPassword ? t('Changing password…') : t('Change password')}
          </button>
          <p className="text-xs leading-5 text-slate-500">{t('Passwords must be 8–32 characters. No additional character-composition rules are imposed.')}</p>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-violet-50 p-2 text-violet-600"><Monitor size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">{t('Application preferences')}</h2>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="max-w-md">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Languages size={16} /> <label htmlFor="application-language">{t('Application language')}</label>
            </div>
            <select id="application-language" value={language}
              onChange={(event) => void changeLanguage(event.target.value as Language)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
              <option value="el">Ελληνικά</option>
              <option value="en">English</option>
            </select>
            {languageSaved && <p role="status" className="mt-2 text-sm text-green-700">{t('Language changed successfully.')}</p>}
            {languageError && <p role="alert" className="mt-2 text-sm text-red-700">{languageError}</p>}
          </div>
          <div className="max-w-md">
            <label htmlFor="default-page" className="mb-2 block text-sm font-medium text-slate-700">
              {t('Default page after signing in')}
            </label>
            <select id="default-page" value={defaultPage}
              onChange={(event) => { setDefaultPage(event.target.value); setSaved(false); setPageError('') }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
              {availablePages.map((page) => <option key={page} value={page}>{t(page)}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => void saveDefaultPage()} disabled={savingPage}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
              <Check size={16} /> {savingPage ? t('Saving…') : t('Save preferences')}
            </button>
            {saved && <span className="text-sm font-medium text-green-700">{t('Preference saved.')}</span>}
          </div>
          {pageError && <p role="alert" className="text-sm text-red-700">{pageError}</p>}
        </div>
      </section>

      {role === 'administrator' && (
        <details className="group overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-red-50 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-lg bg-red-100 p-2 text-red-700"><Database size={19} /></div>
              <div>
                <h2 className="font-semibold text-red-900">{t('Flush whole database')}</h2>
                <p className="mt-1 text-sm text-red-800">{t('Danger zone · Administrator only')}</p>
              </div>
            </div>
            <ChevronDown size={18} className="shrink-0 text-red-700 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-red-200">
            <p className="px-5 pt-4 text-sm text-red-800">{t('Permanently deletes all inventory, assignments, employees, locations, catalogue entries and audit history, and deletes every other user account. The administrator performing the flush is preserved.')}</p>
          <form onSubmit={flushDatabase} className="space-y-4 p-5">
            {flushSummary && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="mb-2 font-semibold">{t('Deletion summary')}</p>
              <ul className="grid gap-1 sm:grid-cols-2">
                <li>{t('Inventory items')}: {flushSummary.inventory_items ?? 0}</li>
                <li>{t('Assignments')}: {flushSummary.inventory_item_employees ?? 0}</li>
                <li>{t('Employees')}: {flushSummary.employees ?? 0}</li>
                <li>{t('Locations')}: {flushSummary.locations ?? 0}</li>
                <li>{t('Item types')}: {flushSummary.item_types ?? 0}</li>
                <li>{t('Brands')}: {flushSummary.brands ?? 0}</li>
                <li>{t('Models')}: {flushSummary.models ?? 0}</li>
                <li>{t('Audit events')}: {flushSummary.audit_events ?? 0}</li>
                <li>{t('Other user accounts to delete')}: {Math.max(0, (flushSummary.profiles ?? 0) - 1)}</li>
              </ul>
              <p className="mt-2 text-xs">{t('The administrator performing this operation will remain active with the Administrator role.')}</p>
            </div>}
            <div>
              <label htmlFor="db-flush-password" className="mb-1 block text-sm font-medium text-slate-700">{t('Dedicated database flush password')}</label>
              <input id="db-flush-password" type="password" autoComplete="off" required value={flushPassword} onChange={(event) => setFlushPassword(event.target.value)} disabled={flushingDatabase} className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              <p className="mt-1 text-xs text-slate-500">{t('This password is verified by the server and is not stored in the application.')}</p>
            </div>
            <div>
              <label htmlFor="flush-confirmation" className="mb-1 block text-sm font-medium text-slate-700">{t('Type FLUSH DATABASE to confirm')}</label>
              <input id="flush-confirmation" required value={flushConfirmation} onChange={(event) => setFlushConfirmation(event.target.value)} disabled={flushingDatabase} placeholder="FLUSH DATABASE" className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </div>
            {flushError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{flushError}</p>}
            {flushResult && <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">{flushResult}</p>}
            <button type="submit" disabled={loadingFlushPreview || flushingDatabase || verifyingFlushPassword || !flushPassword || flushConfirmation !== 'FLUSH DATABASE'} className="rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50">{loadingFlushPreview ? t('Loading deletion summary…') : verifyingFlushPassword ? t('Verifying password…') : flushingDatabase ? t('Flushing database…') : t('Flush whole database')}</button>
          </form>
          </div>
        </details>
      )}

      {showFlushConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4" role="presentation">
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="flush-confirm-title"
            aria-describedby="flush-confirm-description"
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10"
          >
            <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-6 py-5">
              <div className="mt-0.5 rounded-full bg-red-100 p-2 text-red-700"><Database size={21} /></div>
              <div className="min-w-0">
                <h2 id="flush-confirm-title" className="text-lg font-semibold text-red-950">{t('Confirm database flush')}</h2>
                <p className="mt-1 text-sm text-red-800">{t('Irreversible administrator action')}</p>
              </div>
            </div>
            <div className="space-y-3 px-6 py-5">
              <p id="flush-confirm-description" className="text-sm leading-6 text-slate-700">
                {t('This will permanently delete all inventory, assignments, employees, locations, catalogue entries and audit history, and all other user accounts. The administrator performing this operation will be preserved. This action cannot be undone.')}
              </p>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                <p className="font-semibold">{t('Final deletion summary')}</p>
                <p className="mt-1">{t('Inventory items')}: {flushSummary?.inventory_items ?? 0} · {t('Employees')}: {flushSummary?.employees ?? 0} · {t('Locations')}: {flushSummary?.locations ?? 0}</p>
                <p>{t('Audit events')}: {flushSummary?.audit_events ?? 0} · {t('Other user accounts to delete')}: {Math.max(0, (flushSummary?.profiles ?? 0) - 1)}</p>
              </div>
              <p className="text-sm font-medium text-slate-900">{t('Are you absolutely sure you want to permanently flush the database?')}</p>
              {flushingDatabase && <p role="status" className="text-sm text-red-700">{t('Flushing database…')}</p>}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end">
              <button type="button" disabled={flushingDatabase} onClick={() => setShowFlushConfirm(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                {t('Cancel')}
              </button>
              <button type="button" disabled={flushingDatabase} onClick={() => void confirmFlushDatabase()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60">
                <Database size={16} /> {flushingDatabase ? t('Flushing database…') : t('Yes, permanently flush database')}
              </button>
            </div>
          </section>
        </div>
      )}

    </div>
  )
}
