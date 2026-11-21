
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
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type EmployeeApiRow = Record<string, unknown>;

type Employee = {
  id: string;
  full_name: string;
  created_at: string;
  updated_at: string;
  inventory_count: number;
};

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'id'>('name');

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
    if (typeof responseData?.error === 'string') return responseData.error;

    const errorObject = requestError && typeof requestError === 'object'
      ? requestError as { message?: unknown; context?: unknown }
      : null;
    const context = errorObject?.context as { clone?: () => Response } | undefined;

    if (context && typeof context.clone === 'function') {
      try {
        const responseBody: unknown = await context.clone().json();
        if (responseBody && typeof responseBody === 'object') {
          const body = responseBody as { error?: unknown; message?: unknown };
          if (typeof body.error === 'string') return body.error;
          if (typeof body.message === 'string') return body.message;
        }
      } catch {
        // The response may not contain JSON.
      }
    }

    return typeof errorObject?.message === 'string'
      ? errorObject.message
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
          'Failed to load employees.',
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
      setError('Please enter an employee name.');
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
          'Unable to create employee.',
        ),
      );
      setSaving(false);
      return;
    }

    setNewName('');
    setSuccess('Employee added successfully.');

    await loadEmployees();
    setSaving(false);
  };

  const renameEmployee = async (id: string) => {
    const fullName = editingName.trim();

    if (!fullName) {
      setError('Please enter an employee name.');
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
          'Unable to rename employee.',
        ),
      );
      setSaving(false);
      return;
    }

    setEditingId(null);
    setEditingName('');
    setSuccess('Employee renamed successfully.');

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
          'Unable to delete employee. The employee may still be assigned to equipment.',
        ),
      );
      setSaving(false);
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget(null);
    setSuccess('Employee deleted successfully.');

    await loadEmployees();
    setSaving(false);
  };

  const filteredEmployees = employees
    .filter((employee) =>
      employee.full_name.toLowerCase().includes(search.trim().toLowerCase()) ||
      employee.id.includes(search.trim()),
    )
    .sort((a, b) => {
      if (sortBy === 'id') {
        return Number(a.id) - Number(b.id);
      }
      return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
        || Number(a.id) - Number(b.id);
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage employees and their assigned inventory.
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
            <h2 className="font-semibold text-gray-900">Employee list</h2>
            <p className="mt-1 text-sm text-gray-500">
              {employees.length} employees registered
            </p>
          </div>

          <button
            onClick={() => void loadEmployees()}
            disabled={loading || saving}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 p-4 sm:flex-row">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createEmployee();
            }}
            placeholder="New employee full name"
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
            Add employee
          </button>
        </div>

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
              placeholder="Search by name or employee ID..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2 sm:ml-auto">
            <label htmlFor="employee-sort" className="whitespace-nowrap text-sm text-gray-500">Sort by</label>
            <select
              id="employee-sort"
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as 'name' | 'id')}
              className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
            >
              <option value="name">Name (A–Z)</option>
              <option value="id">Employee ID (ascending)</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Loading employees...
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {employees.length === 0
                ? 'No employees have been added yet.'
                : 'No employees match your search.'}
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
                  {editingId === employee.id ? (
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
                        Employee ID: {employee.id}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {editingId === employee.id ? (
                    <>
                      <button
                        onClick={() => void renameEmployee(employee.id)}
                        disabled={saving || !editingName.trim()}
                        title="Save"
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
                        title="Cancel"
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                      >
                        <X size={17} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div
                        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs ${employee.inventory_count === 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
                        title="Assigned inventory items"
                      >
                        <Package size={14} className={employee.inventory_count === 0 ? 'text-red-600' : ''} />
                        <span className={employee.inventory_count === 0 ? 'font-semibold text-red-700' : ''}>{employee.inventory_count}</span>
                      </div>

                      <button
                        onClick={() => {
                          setEditingId(employee.id);
                          setEditingName(employee.full_name);
                          clearMessages();
                        }}
                        disabled={saving}
                        title="Rename employee"
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
                        title="Delete employee"
                        className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          Showing {filteredEmployees.length} of {employees.length} employees
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete employee?
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete{' '}
              <strong>{deleteTarget.full_name}</strong>?
            </p>

            {deleteTarget.inventory_count > 0 && (
              <p className="mt-3 text-sm text-red-600">
                This employee currently has {deleteTarget.inventory_count}{' '}
                assigned inventory item(s). The database will prevent deletion
                until those assignments are removed.
              </p>
            )}

            <p className="mt-2 text-sm text-gray-500">
              This action cannot be undone.
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>

              <button
                onClick={() => void deleteEmployee()}
                disabled={saving}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
