
import { useState } from 'react'
import { Eye, EyeOff, LockKeyhole, User } from 'lucide-react'
import cyprusLogo from '../assets/cyprus-republic-logo.png'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')

    const normalizedUsername = username.trim().toLowerCase()

    if (!normalizedUsername || !password) {
      setError('Please enter your username and password.')
      return
    }

    if (!/^[a-z0-9._-]+$/.test(normalizedUsername)) {
      setError('Invalid username or password.')
      return
    }

    setLoading(true)

    try {
      const internalEmail =
        `${normalizedUsername}@users.it-inventory.invalid`

      const { data, error: authError } =
        await supabase.auth.signInWithPassword({
          email: internalEmail,
          password,
        })

      if (authError || !data.user) {
        setError('Invalid username or password.')
        return
      }

      const { data: profile, error: profileError } =
        await supabase
          .from('profiles')
          .select('username, role, is_active')
          .eq('id', data.user.id)
          .single()

      if (profileError || !profile || !profile.is_active) {
        await supabase.auth.signOut()
        setError('Your account is inactive or unavailable.')
        return
      }

      // The parent application will detect the authenticated session.
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center">
            <img
              src={cyprusLogo}
              alt="Republic of Cyprus emblem"
              className="h-full w-full object-contain"
            />
          </div>

          <h1 className="mt-5 text-2xl font-bold text-slate-900">
            MJPO Inventory
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Internal IT Equipment Management System
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">
            Welcome back
          </h2>

          <p className="mt-2 text-sm text-slate-500">
            Sign in to access the inventory system.
          </p>

          <form onSubmit={handleLogin} className="mt-7 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Username
              </label>

              <div className="relative">
                <User
                  size={19}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="Enter your username"
                  disabled={loading}
                  className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Password
              </label>

              <div className="relative">
                <LockKeyhole
                  size={19}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />

                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  disabled={loading}
                  className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-12 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />

                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Authorized personnel only
        </p>
      </div>
    </div>
  )
}
