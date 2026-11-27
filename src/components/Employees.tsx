
import { useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  RefreshCw,
  Users,
  AlertCircle,
  Search,
  Package,
  FileDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../i18n/LanguageProvider';
import { normalizeSearchText } from '../lib/searchText';

type EmployeeApiRow = Record<string, unknown>;

function escapePdfHtml(value: string | number) {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return String(value).replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

type Employee = {
  id: string;
  full_name: string;
  created_at: string;
  updated_at: string;
  inventory_count: number;
};

export default function Employees({ role }: { role: string }) {
  const canManage = role === 'administrator' || role === 'inventory_manager'
  const { t } = useLanguage()
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'id_asc' | 'id_desc'>('name_asc');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const getFunctionErrorMessage = async (
    requestError: unknown,
    data: unknown,
    fallback: string,
  ): Promise<string> => {
    const responseData = data && typeof data === 'object'
      ? data as { error?: unknown }
      : null;
    if (typeof responseData?.error === 'string') return t(responseData.error);

    const errorObject = requestError && typeof requestError === 'object'
      ? requestError as { message?: unknown; context?: unknown }
      : null;
    const context = errorObject?.context as { clone?: () => Response } | undefined;

    if (context && typeof context.clone === 'function') {
      try {
        const responseBody: unknown = await context.clone().json();
        if (responseBody && typeof responseBody === 'object') {
          const body = responseBody as { error?: unknown; message?: unknown };
          if (typeof body.error === 'string') return t(body.error);
          if (typeof body.message === 'string') return t(body.message);
        }
      } catch {
        // The response may not contain JSON.
      }
    }

    return typeof errorObject?.message === 'string'
      ? t(errorObject.message)
      : fallback;
  };

  const loadEmployees = async () => {
    setLoading(true);
    setError('');

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-employees', {
        body: { action: 'list' },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Failed to load employees.'),
        ),
      );
      setLoading(false);
      return;
    }

    const nextEmployees: Employee[] = (data.employees ?? []).map(
      (employee: EmployeeApiRow) => ({
        id: String(employee.id),
        full_name: String(employee.full_name),
        created_at: String(employee.created_at),
        updated_at: String(employee.updated_at),
        inventory_count: Number(employee.inventory_count ?? 0),
      }),
    );

    setEmployees(nextEmployees);
    setLoading(false);
  };

  useEffect(() => {
    // Load employees once when this screen mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createEmployee = async () => {
    const fullName = newName.trim();

    if (!fullName) {
      setError(t('Please enter an employee name.'));
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-employees', {
        body: {
          action: 'create',
          fullName,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Unable to create employee.'),
        ),
      );
      setSaving(false);
      return;
    }

    setNewName('');
    setSuccess(t('Employee added successfully.'));

    await loadEmployees();
    setSaving(false);
  };

  const renameEmployee = async (id: string) => {
    const fullName = editingName.trim();

    if (!fullName) {
      setError(t('Please enter an employee name.'));
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-employees', {
        body: {
          action: 'rename',
          id,
          fullName,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Unable to rename employee.'),
        ),
      );
      setSaving(false);
      return;
    }

    setEditingId(null);
    setEditingName('');
    setSuccess(t('Employee renamed successfully.'));

    await loadEmployees();
    setSaving(false);
  };

  const deleteEmployee = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-employees', {
        body: {
          action: 'delete',
          id: deleteTarget.id,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Unable to delete employee. The employee may still be assigned to equipment.'),
        ),
      );
      setSaving(false);
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget(null);
    setSuccess(t('Employee deleted successfully.'));

    await loadEmployees();
    setSaving(false);
  };

  const filteredEmployees = employees
    .filter((employee) =>
      normalizeSearchText(employee.full_name).includes(normalizeSearchText(search)) ||
      employee.id.includes(search.trim()),
    )
    .sort((a, b) => {
      if (sortBy.startsWith('id_')) {
        const comparison = Number(a.id) - Number(b.id);
        return sortBy === 'id_desc' ? -comparison : comparison;
      }
      const nameComparison = a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' });
      if (nameComparison !== 0) return sortBy === 'name_desc' ? -nameComparison : nameComparison;
      return Number(a.id) - Number(b.id);
    });

  const exportEmployeesPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(t('The PDF window was blocked. Allow pop-ups for this site and try again.'));
      return;
    }

    // Export the complete employee list, independent of the current search and sort selection.
    const allEmployees = [...employees].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
      || Number(a.id) - Number(b.id),
    );
    const rows = allEmployees.map((employee, index) => `
      <tr>
        <td class="number">${index + 1}</td>
        <td>${escapePdfHtml(employee.id)}</td>
        <td>${escapePdfHtml(employee.full_name)}</td>
        <td class="number">${employee.inventory_count}</td>
      </tr>`).join('');
    const exportedAt = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Nicosia',
    }).format(new Date());

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html><head><meta charset="utf-8"><title>${escapePdfHtml(t('Employees'))}</title>
      <style>
        @page { size: A4 portrait; margin: 15mm 12mm 18mm; }
        @page { @bottom-left { content: "${escapePdfHtml(t('Export date: {date}', { date: exportedAt }))}"; font: 9px Arial,sans-serif; color:#666; } @bottom-right { content: "${escapePdfHtml(t('Page'))} " counter(page) " ${escapePdfHtml(t('of'))} " counter(pages); font:9px Arial,sans-serif;color:#666; } }
        * { box-sizing:border-box; } body { font-family:Arial,Helvetica,sans-serif;color:#222;font-size:11px; }
        h1 { font-size:20px;margin:0 0 5px; } .meta { color:#666;font-size:10px;margin-bottom:14px; }
        table { width:100%;border-collapse:collapse;font-size:10.5px; } thead { display:table-header-group; }
        th,td { border:1px solid #b9c0c8;padding:6px 7px;text-align:left; } th { background:#e9edf2;font-weight:700; }
        tbody tr:nth-child(even) { background:#f7f8fa; } tr { break-inside:avoid;page-break-inside:avoid; }
        td.number { text-align:center;white-space:nowrap; }
      </style></head><body>
      <h1>${escapePdfHtml(t('Employees'))}</h1>
      <p class="meta">${escapePdfHtml(t('{count} employees registered', { count: allEmployees.length }))}</p>
      <table><thead><tr>
        <th>${escapePdfHtml(t('No.'))}</th>
        <th>${escapePdfHtml(t('Employee ID'))}</th>
        <th>${escapePdfHtml(t('Employee name'))}</th>
        <th>${escapePdfHtml(t('Assigned inventory'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <script>window.addEventListener('load',function(){window.focus();setTimeout(function(){window.print();},300);});</${'script'}>
      </body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('Employees')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('Manage employees and their assigned inventory.')}
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5">
          <div>
            <h2 className="font-semibold text-gray-900">{t('Employee list')}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('{count} employees registered', { count: employees.length })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportEmployeesPdf}
              disabled={loading || employees.length === 0}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileDown size={15} />
              {t('Export employees (PDF)')}
            </button>
            <button
              onClick={() => void loadEmployees()}
              disabled={loading || saving}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={15} />
              {t('Refresh')}
            </button>
          </div>
        </div>

        {canManage && <div className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 p-4 sm:flex-row">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createEmployee();
            }}
            placeholder={t("New employee full name")}
            disabled={saving}
            maxLength={200}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
          />

          <button
            onClick={() => void createEmployee()}
            disabled={saving || !newName.trim()}
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={16} />
            {t('Add employee')}
          </button>
        </div>}

        <div className="flex flex-col gap-3 border-b border-gray-200 p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search by name or employee ID...")}
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <label htmlFor="employee-sort" className="whitespace-nowrap text-sm text-gray-500">{t('Sort by')}</label>
            <select
              id="employee-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
              className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
            >
              <option value="name_asc">{t('Name (A–Z)')}</option>
              <option value="name_desc">{t('Name (Z–A)')}</option>
              <option value="id_asc">{t('Employee ID (ascending)')}</option>
              <option value="id_desc">{t('Employee ID (descending)')}</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('Loading employees...')}
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {employees.length === 0
                ? t('No employees have been added yet.')
                : t('No employees match your search.')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredEmployees.map((employee) => (
              <div
                key={employee.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  {canManage && editingId === employee.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) =>
                        setEditingName(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void renameEmployee(employee.id);
                        }

                        if (event.key === 'Escape') {
                          setEditingId(null);
                          setEditingName('');
                        }
                      }}
                      maxLength={200}
                      autoFocus
                      className="w-full max-w-md rounded-lg border border-blue-400 px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800">
                        {employee.full_name}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {t('Employee ID: {id}', { id: employee.id })}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {canManage && editingId === employee.id ? (
                    <>
                      <button
                        onClick={() => void renameEmployee(employee.id)}
                        disabled={saving || !editingName.trim()}
                        title={t("Save")}
                        className="rounded-lg p-2 text-green-700 hover:bg-green-50 disabled:opacity-50"
                      >
                        <Check size={17} />
                      </button>

                      <button
                        onClick={() => {
                          setEditingId(null);
                          setEditingName('');
                        }}
                        disabled={saving}
                        title={t("Cancel")}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                      >
                        <X size={17} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs ${employee.inventory_count === 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
                        title={t("Assigned inventory items")}
                      >
                        <Package size={14} className={employee.inventory_count === 0 ? 'text-red-600' : ''} />
                        <span className={employee.inventory_count === 0 ? 'font-semibold text-red-700' : ''}>{employee.inventory_count}</span>
                      </div>

                      {canManage && <>
                      <button
                        onClick={() => {
                          setEditingId(employee.id);
                          setEditingName(employee.full_name);
                          clearMessages();
                        }}
                        disabled={saving}
                        title={t("Rename employee")}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => {
                          setDeleteTarget(employee);
                          clearMessages();
                        }}
                        disabled={saving}
                        title={t("Delete employee")}
                        className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                      </>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          {t('Showing {shown} of {total} employees', { shown: filteredEmployees.length, total: employees.length })}
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              {t('Delete employee?')}
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              {t('Are you sure you want to delete')} {' '}
              <strong>{deleteTarget.full_name}</strong>?
            </p>

            {deleteTarget.inventory_count > 0 && (
              <p className="mt-3 text-sm text-red-600">
                {t('This employee currently has {count}', { count: deleteTarget.inventory_count })}{' '}
                {t('assigned inventory item(s). The database will prevent deletion until those assignments are removed.')}
              </p>
            )}

            <p className="mt-2 text-sm text-gray-500">
              {t('This action cannot be undone.')}
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {t('Cancel')}
              </button>

              <button
                onClick={() => void deleteEmployee()}
                disabled={saving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? t('Deleting...') : t('Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
