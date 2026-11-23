
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type UserRole = 'administrator' | 'inventory_manager' | 'viewer'

type Account = {
  id: string
  username: string
  role: UserRole
  is_active: boolean
  created_at: string
}

type AccountsProps = {
  currentUsername: string
}

export default function Accounts({ currentUsername }: AccountsProps) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('viewer')

  const [resetTarget, setResetTarget] = useState<Account | null>(null)
const [resetPassword, setResetPassword] = useState('')
const [confirmPassword, setConfirmPassword] = useState('')
const [resetting, setResetting] = useState(false)

  async function loadAccounts() {
    setLoading(true)
    setError('')

    const { data, error: functionError } =
      await supabase.functions.invoke('manage-users', {
        body: { action: 'list' },
      })

    if (functionError || data?.error) {
      setError(data?.error || functionError?.message || 'Unable to load accounts.')
      setLoading(false)
      return
    }

    setAccounts(data.users || [])
    setLoading(false)
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setCreating(true)

    const { data, error: functionError } =
      await supabase.functions.invoke('manage-users', {
        body: {
          action: 'create',
          username: username.trim().toLowerCase(),
          password,
          role,
        },
      })

    if (functionError || data?.error) {
      setError(data?.error || functionError?.message || 'Unable to create account.')
      setCreating(false)
      return
    }

    setUsername('')
    setPassword('')
    setRole('viewer')
    setSuccess(`Account "${data.user.username}" was created successfully.`)

    await loadAccounts()
    setCreating(false)
  }

  async function handleUpdate(
    account: Account,
    newRole: UserRole,
    newActive: boolean,
  ) {
    setError('')
    setSuccess('')

    if (account.username === currentUsername) {
      if (newRole !== 'administrator' || !newActive) {
        setError('You cannot remove your own Administrator access.')
        return
      }
    }

    if (
      account.is_active &&
      !newActive &&
      !window.confirm(`Are you sure you want to deactivate "${account.username}"?`)
    ) {
      return
    }

    setUpdatingId(account.id)

    const { data, error: functionError } =
      await supabase.functions.invoke('manage-users', {
        body: {
          action: 'update_profile',
          userId: account.id,
          role: newRole,
          isActive: newActive,
        },
      })

    if (functionError || data?.error) {
      setError(data?.error || functionError?.message || 'Unable to update account.')
      setUpdatingId(null)
      return
    }

    setSuccess(`Account "${account.username}" was updated successfully.`)
    await loadAccounts()
    setUpdatingId(null)
  }

async function handleResetPassword(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault()
  setError('')
  setSuccess('')

  if (!resetTarget) return

  if (resetPassword.length < 8 || resetPassword.length > 32) {
    setError('Password must contain between 8 and 32 characters.')
    return
  }

  if (resetPassword !== confirmPassword) {
    setError('The passwords do not match.')
    return
  }

  setResetting(true)

  const { data, error: functionError } =
    await supabase.functions.invoke('manage-users', {
      body: {
        action: 'reset_password',
        userId: resetTarget.id,
        password: resetPassword,
      },
    })

  if (functionError || data?.error) {
    setError(data?.error || functionError?.message || 'Unable to reset password.')
    setResetting(false)
    return
  }

  setSuccess(`Password for "${resetTarget.username}" was reset successfully.`)
  if (data?.warning) {
    setError(data.warning)
  }

  setResetTarget(null)
  setResetPassword('')
  setConfirmPassword('')
  setResetting(false)
}

  useEffect(() => {
    // Load the account list once when this screen mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-800">
          Account Management
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Create and manage application user accounts.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="font-semibold text-slate-800">Create New Account</h3>
        <p className="mt-1 text-sm text-slate-500">
          Only Administrators can create accounts.
        </p>

        <form onSubmit={handleCreate} className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Username
            </label>
            <input
              type="text"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-zA-Z0-9._-]+"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. j.smith"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              3–40 characters: letters, numbers, dots, hyphens and underscores.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Temporary Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              maxLength={32}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8–32 characters"
              autoComplete="new-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Account Role
            </label>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="viewer">Viewer</option>
              <option value="inventory_manager">Inventory Manager</option>
              <option value="administrator">Administrator</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {creating ? 'Creating account...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-5">
          <div>
            <h3 className="font-semibold text-slate-800">User Accounts</h3>
            <p className="text-sm text-slate-500">
              {accounts.length} account{accounts.length !== 1 ? 's' : ''}
            </p>
          </div>

          <button
            onClick={loadAccounts}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Loading accounts...
          </div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No accounts found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Username</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => {
                  const isSelf = account.username === currentUsername
                  const updating = updatingId === account.id

                  return (
                    <tr key={account.id}>
<td className="px-5 py-4 font-medium text-slate-800">
  {account.username}
  {isSelf && (
    <span className="ml-2 text-xs text-blue-600">
      You
    </span>
  )}
</td>

                      <td className="px-5 py-4">
                        <select
                          value={account.role}
                          disabled={isSelf || updating}
                          onChange={(event) =>
                            handleUpdate(
                              account,
                              event.target.value as UserRole,
                              account.is_active,
                            )
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm capitalize disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          <option value="administrator">Administrator</option>
                          <option value="inventory_manager">Inventory Manager</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>

                      <td className="px-5 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                            account.is_active
                              ? 'bg-green-100 text-green-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {account.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      <td className="px-5 py-4 text-slate-500">
                        {new Date(account.created_at).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>

<td className="px-5 py-4">
  <div className="flex items-center gap-2">
    <button
      disabled={isSelf || updating || resetting}
      onClick={() => {
        setResetTarget(account)
        setResetPassword('')
        setConfirmPassword('')
        setError('')
        setSuccess('')
      }}
      title={isSelf ? 'Change your password in Settings' : 'Reset password'}
      className="whitespace-nowrap rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      Reset Password
    </button>

    <button
      disabled={isSelf || updating}
      onClick={() =>
        handleUpdate(
          account,
          account.role,
          !account.is_active,
        )
      }
      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
        account.is_active
          ? 'bg-red-50 text-red-700 hover:bg-red-100'
          : 'bg-green-50 text-green-700 hover:bg-green-100'
      }`}
    >
      {updating
        ? 'Updating...'
        : account.is_active
          ? 'Deactivate'
          : 'Activate'}
    </button>
  </div>
</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {resetTarget && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
      <h3 className="text-lg font-semibold text-slate-900">
        Reset Password
      </h3>

      <p className="mt-2 text-sm text-slate-500">
        Set a new password for <strong>{resetTarget.username}</strong>.
        The user will need to use the new password at their next login.
      </p>

      <form onSubmit={handleResetPassword} className="mt-5 space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            New Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            maxLength={32}
            autoComplete="new-password"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
            placeholder="8–32 characters"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Confirm New Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            maxLength={32}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Enter the password again"
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            disabled={resetting}
            onClick={() => {
              setResetTarget(null)
              setResetPassword('')
              setConfirmPassword('')
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>

          <button
            type="submit"
            disabled={resetting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {resetting ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
    </div>
  )
}
