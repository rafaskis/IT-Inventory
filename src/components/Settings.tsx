import { useMemo, useState } from 'react'
import { Check, Settings, User, Monitor, Info, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'

type SettingsPageProps = {
  username: string
  role: string
  userId: string
  onDefaultPageChange: (page: string) => void
}

export default function SettingsPage({
  username,
  role,
  userId,
  onDefaultPageChange,
}: SettingsPageProps) {
  const storageKey = `it-inventory-default-page:${userId}`
  const availablePages = useMemo(() => {
    const pages = ['Dashboard', 'Inventory']
    if (role === 'administrator' || role === 'inventory_manager') {
      pages.push('Employees', 'Locations', 'Catalogues', 'Audit Logs')
    }
    if (role === 'administrator') pages.push('Accounts')
    return pages
  }, [role])

  const [defaultPage, setDefaultPage] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved && availablePages.includes(saved) ? saved : 'Dashboard'
  })
  const [saved, setSaved] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [passwordWarning, setPasswordWarning] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const saveDefaultPage = () => {
    onDefaultPageChange(defaultPage)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2500)
  }

  async function handlePasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    setPasswordSuccess('')
    setPasswordWarning('')

    if (newPassword.length < 8 || newPassword.length > 32) {
      setPasswordError('The new password must contain between 8 and 32 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }

    if (newPassword === currentPassword) {
      setPasswordError('The new password must be different from your current password.')
      return
    }

    setChangingPassword(true)

    try {
      // The Edge Function verifies the current password, changes the credential,
      // and writes the security audit event using the authenticated account identity.
      const { data, error: functionError } =
        await supabase.functions.invoke('manage-users', {
          body: {
            action: 'change_own_password',
            currentPassword,
            password: newPassword,
          },
        })

      if (functionError || data?.error) {
        setPasswordError(data?.error || functionError?.message || 'Unable to change your password.')
        return
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSuccess('Your password has been changed successfully.')

      if (data?.warning) {
        setPasswordWarning(data.warning)
      }
    } catch {
      setPasswordError('Unable to change your password. Please try again.')
    } finally {
      setChangingPassword(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account and personal application preferences.
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-blue-50 p-2 text-blue-600"><User size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Account information</h2>
            <p className="text-xs text-slate-500">Your current application account</p>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Username</p>
            <p className="mt-1 text-sm font-medium text-slate-800">{username}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Role</p>
            <p className="mt-1 text-sm font-medium capitalize text-slate-800">{role.replaceAll('_', ' ')}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-amber-50 p-2 text-amber-600"><KeyRound size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Change password</h2>
            <p className="text-xs text-slate-500">Verify your current password before setting a new one.</p>
          </div>
        </div>
        <form onSubmit={handlePasswordChange} className="max-w-xl space-y-4 p-5">
          <div>
            <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-slate-700">Current password</label>
            <input
              id="current-password"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              disabled={changingPassword}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700">New password</label>
            <input
              id="new-password"
              type="password"
              required
              minLength={8}
              maxLength={32}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={changingPassword}
              placeholder="8–32 characters"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label htmlFor="confirm-new-password" className="mb-1.5 block text-sm font-medium text-slate-700">Confirm new password</label>
            <input
              id="confirm-new-password"
              type="password"
              required
              minLength={8}
              maxLength={32}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={changingPassword}
              placeholder="Enter the new password again"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {passwordError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{passwordError}</div>
          )}
          {passwordSuccess && (
            <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{passwordSuccess}</div>
          )}
          {passwordWarning && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{passwordWarning}</div>
          )}

          <button
            type="submit"
            disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <KeyRound size={16} /> {changingPassword ? 'Changing password…' : 'Change password'}
          </button>
          <p className="text-xs leading-5 text-slate-500">
            Passwords must be 8–32 characters. No additional character-composition rules are imposed.
          </p>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-4">
          <div className="rounded-lg bg-violet-50 p-2 text-violet-600"><Monitor size={19} /></div>
          <div>
            <h2 className="font-semibold text-slate-900">Application preferences</h2>
            <p className="text-xs text-slate-500">Choose how MJPO Inventory opens for you</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="max-w-md">
            <label htmlFor="default-page" className="mb-2 block text-sm font-medium text-slate-700">
              Default page after signing in
            </label>
            <select
              id="default-page"
              value={defaultPage}
              onChange={(event) => { setDefaultPage(event.target.value); setSaved(false) }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {availablePages.map((page) => <option key={page} value={page}>{page}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={saveDefaultPage}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Check size={16} /> Save preference
            </button>
            {saved && <span className="text-sm font-medium text-green-700">Preference saved.</span>}
          </div>
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
            <Info size={16} className="mt-0.5 shrink-0" />
            This preference is stored in this browser for your account. It is used when you sign in; your last visited page is still remembered while your current session is active.
          </div>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <Settings size={17} className="mt-0.5 shrink-0 text-slate-500" />
        Additional settings can be added here as the application develops.
      </div>
    </div>
  )
}
