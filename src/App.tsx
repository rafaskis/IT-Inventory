
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Accounts from './components/Accounts'
import Catalogues from './components/Catalogues';
import Employees from './components/Employees';
import Locations from './components/Locations';
import Inventory from './components/Inventory';
import AuditLogs from './components/AuditLogs';
import SettingsPage from './components/Settings'
import BatchImportPage from './components/BatchImport';
import GlobalSearch from './components/GlobalSearch';
import Login from './components/Login'
import { LanguageProvider, useLanguage, formatNumber, type Language } from './i18n/LanguageProvider'
import ukFlag from './assets/uk.png'
import greekFlag from './assets/gr.png'
import {
  LayoutDashboard,
  Monitor,
  Users,
  UserCog,
  MapPin,
  Tags,
  FileText,
  FileSpreadsheet,
  Settings,
  Search,
  Plus,
  Package,
  Boxes,
  Menu,
  X,
  Check,
  ChevronDown,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', icon: LayoutDashboard },
  { name: 'Inventory', icon: Monitor },
  { name: 'Employees', icon: Users },
  { name: 'Locations', icon: MapPin },
  { name: 'Catalogues', icon: Tags },
  { name: 'Audit Logs', icon: FileText },
  { name: 'Accounts', icon: UserCog },
  { name: 'Batch Import', icon: FileSpreadsheet },
]

type DashboardInventoryRow = {
  id: number
  item_code: string
  serial_number: string | null
  created_at: string
  brand: { name: string; item_type: { id: number; name: string } | null } | null
  model: { name: string } | null
  location: { name: string } | null
  assignments: { employee: { full_name: string } | null }[] | null
}

function formatDashboardEmployee(assignments: DashboardInventoryRow['assignments']) {
  const names = (assignments ?? [])
    .map((assignment) => assignment.employee?.full_name)
    .filter((name): name is string => Boolean(name))
  if (names.length === 0) return '—'
  if (names.length > 1) return 'SHARED'
  return names[0]
}

function Dashboard({
  username,
  role,
  userId,
  onSignOut,
  preferredPage,
}: {
  username: string
  role: string
  userId: string
  preferredPage: string
  onSignOut: () => void
}) {
  const { t, language, setLanguage } = useLanguage()
  const pageStorageKey = `it-inventory-active-page:${userId}`
  const allowedPages = navigation
    .filter((item) => {
      if (item.name === 'Accounts' || item.name === 'Batch Import') return role === 'administrator'
      if (item.name === 'Audit Logs') return role === 'administrator' || role === 'inventory_manager'
      if (['Catalogues', 'Employees', 'Locations'].includes(item.name)) {
        return role === 'administrator' || role === 'inventory_manager'
      }
      return true
    })
    .map((item) => item.name)
  const [activePage, setActivePage] = useState(() => {
    const savedPage = sessionStorage.getItem(pageStorageKey)
    const validPages = [...allowedPages, 'Settings']
    if (savedPage && validPages.includes(savedPage)) return savedPage
    if (preferredPage && allowedPages.includes(preferredPage)) return preferredPage
    return 'Dashboard'
  })
  useEffect(() => {
    sessionStorage.setItem(pageStorageKey, activePage)
  }, [pageStorageKey, activePage])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const [languageSwitchError, setLanguageSwitchError] = useState('')
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [totalEquipment, setTotalEquipment] = useState(0)
  const [recentInventory, setRecentInventory] = useState<DashboardInventoryRow[]>([])

  async function changeHeaderLanguage(nextLanguage: Language) {
    setLanguageSwitchError('')
    if (nextLanguage === language) {
      setLanguageMenuOpen(false)
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update({ preferred_language: nextLanguage })
      .eq('id', userId)

    if (error) {
      console.error('Unable to save language preference:', error)
      setLanguageSwitchError(t('Unable to save your language preference.'))
      return
    }

    setLanguage(nextLanguage)
    setLanguageMenuOpen(false)
  }

  const loadDashboard = async () => {
    setDashboardLoading(true)
    setDashboardError(null)
    try {
      const [totalResult, recentResult] = await Promise.all([
        supabase.from('inventory_items').select('id', { count: 'exact', head: true }),
        supabase.from('inventory_items').select(`
          id, item_code, serial_number, created_at,
          brand:brands!inventory_items_brand_id_item_type_id_fkey(
            name,
            item_type:item_types!brands_item_type_id_fkey(id, name)
          ),
          model:models!inventory_items_model_id_brand_id_item_type_id_fkey(name),
          location:locations(name),
          assignments:inventory_item_employees(employee:employees(full_name))
        `).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(10),
      ])
      if (totalResult.error) throw totalResult.error
      if (recentResult.error) throw recentResult.error

      setTotalEquipment(totalResult.count ?? 0)
      setRecentInventory((recentResult.data ?? []) as unknown as DashboardInventoryRow[])
    } catch (error) {
      console.error('Dashboard data load failed:', error)
      setDashboardError('Dashboard data could not be loaded. Please try again.')
    } finally {
      setDashboardLoading(false)
    }
  }

  useEffect(() => {
    if (activePage === 'Dashboard') {
      // This effect intentionally starts a data load when the Dashboard becomes active.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDashboard()
    }
  }, [activePage])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setGlobalSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])


  return (
    <div className="min-h-screen bg-slate-100 text-slate-800">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label={t("Close navigation")}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-white transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-slate-700 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
              <Boxes size={23} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wide">MJPO Inventory</h1>
              <p className="text-xs text-slate-400">{t("Management System")}</p>
            </div>
          </div>
          <button
            className="lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label={t("Close menu")}
          >
            <X size={21} />
          </button>
        </div>

        <div className="px-4 pt-7">
          <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{t("Main Menu")}</p>

          <nav className="space-y-1">
{navigation
  .filter((item) => {
    if (item.name === 'Accounts' || item.name === 'Batch Import') return role === 'administrator'
    if (item.name === 'Audit Logs') return role === 'administrator' || role === 'inventory_manager'
    if (
      item.name === 'Catalogues' ||
      item.name === 'Employees' ||
      item.name === 'Locations'
    ) {
      return role === 'administrator' || role === 'inventory_manager'
    }
    return true
  })
  .map((item) => {
              const Icon = item.icon
              const active = activePage === item.name

              return (
                <button
                  key={item.name}
                  onClick={() => {
                    setActivePage(item.name)
                    setSidebarOpen(false)
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition ${
                    active
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/30'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon size={19} />
                  {t(item.name)}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="mt-auto border-t border-slate-700 p-4">
          <button
            onClick={() => setActivePage('Settings')}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm ${
              activePage === 'Settings'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Settings size={19} />{t("Settings")}</button>


<button
  onClick={onSignOut}
  title={t("Sign out")}
  className="mt-4 flex w-full items-center gap-3 rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700"
>
  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500 text-sm font-bold">
    {username.slice(0, 2).toUpperCase()}
  </div>
  <div className="min-w-0">
    <p className="text-sm font-medium">{username}</p>
    <p className="text-xs capitalize text-slate-400">
      {t(role === 'administrator' ? 'Administrator' : role === 'inventory_manager' ? 'Inventory Manager' : 'Viewer')}
    </p>
  </div>
  <span className="ml-auto text-xs text-slate-400">{t("Sign out")}</span>
</button>

        </div>
      </aside>

      <div className="min-h-screen lg:pl-64">
        <header className="sticky top-0 z-20 flex h-20 items-center justify-between border-b border-slate-200 bg-white px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 hover:bg-slate-100 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label={t("Open menu")}
            >
              <Menu size={22} />
            </button>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {t(activePage)}
              </h2>
              <p className="hidden text-xs text-slate-500 sm:block">{t("IT Equipment Management")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <button
              onClick={() => setGlobalSearchOpen(true)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label={t("Search")}
              title={t("Search (Ctrl+K)")}
            >
              <Search size={20} />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setLanguageSwitchError('')
                  setLanguageMenuOpen((open) => !open)
                }}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl shadow-sm hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label={t('Application language')}
                aria-haspopup="menu"
                aria-expanded={languageMenuOpen}
                title={t('Application language')}
              >
                <img
                  src={language === 'el' ? greekFlag : ukFlag}
                  alt=""
                  aria-hidden="true"
                  className="h-7 w-7 object-contain"
                />
                <ChevronDown size={12} className="ml-0.5 text-slate-500" />
              </button>
              {languageMenuOpen && (
                <div
                  role="menu"
                  aria-label={t('Application language')}
                  className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void changeHeaderLanguage('en')}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${language === 'en' ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                  >
                    <img src={ukFlag} alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
                    <span>English</span>
                    {language === 'en' && <Check size={16} className="ml-auto text-emerald-600" />}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void changeHeaderLanguage('el')}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-50 ${language === 'el' ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
                  >
                    <img src={greekFlag} alt="" aria-hidden="true" className="h-6 w-6 object-contain" />
                    <span>Ελληνικά</span>
                    {language === 'el' && <Check size={16} className="ml-auto text-emerald-600" />}
                  </button>
                  {languageSwitchError && (
                    <p role="alert" className="border-t border-slate-100 px-3 py-2 text-xs text-red-600">
                      {languageSwitchError}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="hidden h-8 border-l border-slate-200 sm:block" />
            <div className="hidden text-right sm:block">
<p className="text-sm font-semibold text-slate-800">{username}</p>
<p className="text-xs capitalize text-slate-500">
  {t(role === 'administrator' ? 'Administrator' : role === 'inventory_manager' ? 'Inventory Manager' : 'Viewer')}
</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
              {username.slice(0, 2).toUpperCase()}
            </div>
          </div>
        </header>

        <main className="p-5 sm:p-8">
{activePage === 'Accounts' ? (
  role === 'administrator' ? (
    <Accounts currentUsername={username} />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to access account management.")}</p>
    </div>
  )
) : activePage === 'Batch Import' ? (
  role === 'administrator' ? (
    <BatchImportPage />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to access batch import.")}</p>
    </div>
  )
) : activePage === 'Catalogues' ? (
  role === 'administrator' || role === 'inventory_manager' ? (
    <Catalogues />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to manage catalogues.")}</p>
    </div>
  )
) : activePage === 'Employees' ? (
  role === 'administrator' || role === 'inventory_manager' ? (
    <Employees />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to manage employees.")}</p>
    </div>
  )
) : activePage === 'Locations' ? (
  role === 'administrator' || role === 'inventory_manager' ? (
    <Locations />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to manage locations.")}</p>
    </div>
  )
) : activePage === 'Audit Logs' ? (
  role === 'administrator' || role === 'inventory_manager' ? (
    <AuditLogs role={role} />
  ) : (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
      <h3 className="font-semibold text-red-700">{t("Access denied")}</h3>
      <p className="mt-2 text-sm text-red-600">{t("You do not have permission to access audit history.")}</p>
    </div>
  )
) : activePage === 'Inventory' ? (
  <Inventory />
) : activePage === 'Dashboard' ? (
            <>
              <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-2xl font-bold text-slate-900">{t("Dashboard Overview")}</h3>
                  <p className="mt-1 text-sm text-slate-500">{t("Here's an overview of your company's IT equipment.")}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm" title={t("Total registered inventory items")}>
                    <Package size={17} className="text-blue-600" />
                    <span className="text-xs font-medium text-slate-500">{t("Total Equipment")}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900">{dashboardLoading ? '…' : formatNumber(totalEquipment, language)}</span>
                  </div>
                  <button
                    onClick={() => void loadDashboard()}
                    disabled={dashboardLoading}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {dashboardLoading ? t('Refreshing…') : t('Refresh')}
                  </button>
                  <button
                    onClick={() => setActivePage('Inventory')}
                    className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    <Plus size={18} />{t("View Inventory")}</button>
                </div>
              </div>

              <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col justify-between gap-3 border-b border-slate-200 p-5 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="font-bold text-slate-900">{t("Recent Inventory")}</h3>
                    <p className="mt-1 text-xs text-slate-500">{t("Recently registered equipment")}</p>
                  </div>
                  <button
                    onClick={() => setActivePage('Inventory')}
                    className="text-left text-sm font-semibold text-blue-600 hover:text-blue-800 sm:text-right"
                  >{t("View all inventory →")}</button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-5 py-4 font-semibold">{t("Item ID")}</th>
                        <th className="px-5 py-4 font-semibold">{t("Equipment")}</th>
                        <th className="px-5 py-4 font-semibold">{t("Serial Number")}</th>
                        <th className="px-5 py-4 font-semibold">{t("EMPLOYEE")}</th>
                        <th className="px-5 py-4 font-semibold">{t("Location")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dashboardLoading ? (
                        <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">{t("Loading recent inventory…")}</td></tr>
                      ) : dashboardError ? (
                        <tr><td colSpan={5} className="px-5 py-10 text-center text-red-600">{t(dashboardError)}</td></tr>
                      ) : recentInventory.length === 0 ? (
                        <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-500">{t("No inventory items have been registered yet.")}</td></tr>
                      ) : recentInventory.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-5 py-4 font-medium text-blue-600">{item.item_code}</td>
                          <td className="px-5 py-4">
                            <p className="font-medium text-slate-800">{item.brand?.name ?? '—'} {item.model?.name ?? ''}</p>
                            <p className="mt-1 text-xs text-slate-400">{item.brand?.item_type?.name ?? '—'}</p>
                          </td>
                          <td className="px-5 py-4 text-slate-600">{item.serial_number || '—'}</td>
                          <td className="px-5 py-4 text-slate-600">{formatDashboardEmployee(item.assignments) === 'SHARED' ? t('SHARED') : formatDashboardEmployee(item.assignments)}</td>
                          <td className="px-5 py-4 text-slate-600">{item.location?.name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
                  {dashboardLoading
                    ? t('Loading records…')
                    : recentInventory.length === 1
                      ? t('Εμφανίζεται 1 πιο πρόσφατη καταχώριση')
                      : t('Εμφανίζονται οι πιο πρόσφατες καταχωρίσεις')}
                </div>
              </section>
            </>
          ) : activePage === 'Settings' ? (
            <SettingsPage
              username={username}
              role={role}
              userId={userId}
              preferredPage={preferredPage}
            />
          ) : (
            <div className="flex min-h-[350px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-center">
              <div className="rounded-full bg-blue-50 p-4 text-blue-600">
                <Package size={30} />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-800">
                {t(activePage)}
              </h3>
              <p className="mt-2 max-w-sm text-sm text-slate-500">{t("This section will be developed in a later stage.")}</p>
              <button
                onClick={() => setActivePage('Dashboard')}
                className="mt-5 text-sm font-semibold text-blue-600 hover:text-blue-800"
              >{t("Return to Dashboard")}</button>
            </div>
          )}
        </main>
      </div>
      {globalSearchOpen && (
        <GlobalSearch
          onClose={() => setGlobalSearchOpen(false)}
          onNavigate={(page) => {
            if ((page === 'Accounts' || page === 'Batch Import') && role !== 'administrator') return
            if (['Catalogues', 'Employees', 'Locations'].includes(page) && !['administrator', 'inventory_manager'].includes(role)) return
            setActivePage(page)
          }}
        />
      )}
    </div>
  )
}

function AppContent() {
  const { setLanguage, t } = useLanguage()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<{
    username: string
    role: string
    is_active: boolean
    preferred_language: 'el' | 'en'
    preferred_page: string
  } | null>(null)

  const [authLoading, setAuthLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  // Restore existing sessions and listen for login/logout events.
  useEffect(() => {
    let mounted = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!mounted) return

      setSession(newSession)
      // Preserve the loaded profile during token refreshes. Clear it only
      // when the user signs out or a different user signs in.
      if (!newSession || event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        setProfile(null)
      }
      setAuthLoading(false)
    })

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return

      setSession(data.session)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  // Verify the authenticated user's application profile.
  useEffect(() => {
    if (!session) {
      // The auth listener already clears the profile on sign-out; this handles initial no-session state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(null)
      setLanguage('el')
      setProfileLoading(false)
      return
    }

    let cancelled = false

    async function loadProfile() {
      setProfileLoading(true)

      const { data, error } = await supabase
        .from('profiles')
        .select('username, role, is_active, preferred_language, preferred_page')
        .eq('id', session!.user.id)
        .single()

      if (cancelled) return

      if (error || !data || !data.is_active) {
        setProfile(null)
        await supabase.auth.signOut()
        return
      }

      setProfile(data)
      setLanguage(data.preferred_language === 'en' ? 'en' : 'el')
    }

    loadProfile().finally(() => {
      if (!cancelled) {
        setProfileLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [session, setLanguage])

  // Deactivation bans prevent future token refreshes, but an already-issued
  // access token can remain present in an open tab until it expires. Recheck
  // the user's profile periodically and whenever the tab becomes active so
  // deactivated users are returned to Login promptly.
  const authenticatedUserId = session?.user.id

  useEffect(() => {
    if (!authenticatedUserId) return

    let disposed = false
    let checking = false

    const verifyAccountStatus = async () => {
      if (disposed || checking) return
      checking = true

      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('id', authenticatedUserId)
          .maybeSingle()

        if (disposed) return

        const errorStatus = error && 'status' in error
          ? (error as typeof error & { status?: number }).status
          : undefined
        const authorizationFailure = Boolean(
          error &&
          (error.code === 'PGRST116' ||
            error.code === '42501' ||
            error.code === 'PGRST301' ||
            errorStatus === 401 ||
            errorStatus === 403)
        )

        if ((!error && (!data || !data.is_active)) || authorizationFailure) {
          // Clear the UI immediately; local sign-out avoids depending on a
          // refresh token that may already have been revoked by the admin.
          setProfile(null)
          setSession(null)
          await supabase.auth.signOut({ scope: 'local' })
        } else if (error) {
          // Temporary network/server failures should not sign out an active user.
          console.warn('Account status check temporarily failed:', error)
        }
      } catch (error) {
        console.warn('Account status check temporarily failed:', error)
      } finally {
        checking = false
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void verifyAccountStatus()
      }
    }

    void verifyAccountStatus()
    const intervalId = window.setInterval(() => {
      void verifyAccountStatus()
    }, 15000)
    window.addEventListener('focus', verifyAccountStatus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', verifyAccountStatus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [authenticatedUserId])

  if (authLoading || (session && profileLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm font-medium text-slate-500">{t("Loading MJPO Inventory...")}</p>
      </div>
    )
  }

  if (!session || !profile) {
    return <Login />
  }

  return (
    <Dashboard
      username={profile.username}
      role={profile.role}
      userId={session.user.id}
      preferredPage={profile.preferred_page || 'Dashboard'}
      onSignOut={() => {
        sessionStorage.removeItem(`it-inventory-active-page:${session.user.id}`)
        setLanguage('el')
        void supabase.auth.signOut()
      }}
    />
  )
}

function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  )
}

export default App