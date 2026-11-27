import { useEffect, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  RefreshCw,
  MapPin,
  AlertCircle,
  Search,
  Package,
  Users,
  FileDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLanguage } from '../i18n/LanguageProvider';
import { normalizeSearchText } from '../lib/searchText';

type LocationApiRow = Record<string, unknown>;

function escapePdfHtml(value: string | number) {
  const entities: Record<string, string> = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  return String(value).replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

type Location = {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  inventory_count: number;
  employee_count: number;
};

export default function Locations() {
  const { t } = useLanguage()
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [canManageLocations, setCanManageLocations] = useState(false);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [search, setSearch] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingNotes, setEditingNotes] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

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

  const loadLocations = async () => {
    setLoading(true);
    setError('');

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-locations', {
        body: { action: 'list' },
      });

    // The list action returns { locations: [...] } rather than { success, locations }.
    if (requestError || !Array.isArray(data?.locations)) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Failed to load locations.'),
        ),
      );
      setLoading(false);
      return;
    }

    const nextLocations: Location[] = data.locations.map((location: LocationApiRow) => ({
      id: String(location.id),
      name: String(location.name),
      notes: typeof location.notes === 'string' ? location.notes : null,
      created_at: String(location.created_at),
      updated_at: String(location.updated_at),
      inventory_count: Number(location.inventory_count ?? 0),
      employee_count: Number(location.employee_count ?? 0),
    }));

    setLocations(nextLocations);
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user || cancelled) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (!cancelled) {
        setCanManageLocations(Boolean(profile?.is_active && ['administrator', 'inventory_manager'].includes(profile.role)));
      }
    }

    void loadRole();
    // Load locations once when this screen mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLocations();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createLocation = async () => {
    const name = newName.trim();

    if (!name) {
      setError(t('Please enter a location name.'));
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-locations', {
        body: {
          action: 'create',
          name,
          notes: newNotes.trim() || null,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Unable to create location.'),
        ),
      );
      setSaving(false);
      return;
    }

    setNewName('');
    setNewNotes('');
    setSuccess(t('Location added successfully.'));

    await loadLocations();
    setSaving(false);
  };

  const updateLocation = async (id: string) => {
    const name = editingName.trim();

    if (!name) {
      setError(t('Please enter a location name.'));
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-locations', {
        body: {
          action: 'update',
          id,
          name,
          notes: editingNotes.trim() || null,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          t('Unable to update location.'),
        ),
      );
      setSaving(false);
      return;
    }

    setEditingId(null);
    setEditingName('');
    setEditingNotes('');
    setSuccess(t('Location updated successfully.'));

    await loadLocations();
    setSaving(false);
  };

  const deleteLocation = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-locations', {
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
          t('Unable to delete location. It may still be used by inventory items.'),
        ),
      );
      setSaving(false);
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget(null);
    setSuccess(t('Location deleted successfully.'));

    await loadLocations();
    setSaving(false);
  };

  const filteredLocations = locations.filter((location) => {
    const term = normalizeSearchText(search);

    return (
      normalizeSearchText(location.name).includes(term) ||
      normalizeSearchText(location.notes ?? '').includes(term)
    );
  });

  const exportLocationsPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(t('The PDF window was blocked. Allow pop-ups for this site and try again.'));
      return;
    }

    // The list endpoint returns locations alphabetically; preserve that exact
    // order and export the complete list, independent of the current search.
    const allLocations = [...locations];
    const rows = allLocations.map((location, index) => `
      <tr>
        <td class="number">${index + 1}</td>
        <td>${escapePdfHtml(location.name)}</td>
        <td class="number">${location.inventory_count}</td>
        <td class="number">${location.employee_count}</td>
      </tr>`).join('');
    const exportedAt = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Nicosia',
    }).format(new Date());

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html><head><meta charset="utf-8"><title>${escapePdfHtml(t('Locations'))}</title>
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
      <h1>${escapePdfHtml(t('Locations'))}</h1>
      <p class="meta">${escapePdfHtml(t('{count} locations registered', { count: allLocations.length }))}</p>
      <table><thead><tr>
        <th>${escapePdfHtml(t('No.'))}</th>
        <th>${escapePdfHtml(t('Location'))}</th>
<th>${escapePdfHtml(t('Equipment'))}</th>
<th>${escapePdfHtml(t('Employees'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>
      <script>window.addEventListener('load',function(){window.focus();setTimeout(function(){window.print();},300);});</${'script'}>
      </body></html>`);
    printWindow.document.close();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('Locations')}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {t('Manage inventory locations and see their assigned equipment and employees.')}
        </p>
        {!canManageLocations && <p className="mt-1 text-xs text-gray-500">
          {t('You have read-only access to locations.')}
        </p>}
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
            <h2 className="font-semibold text-gray-900">{t('Location list')}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('{count} locations registered', { count: locations.length })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={exportLocationsPdf}
              disabled={loading || locations.length === 0}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <FileDown size={15} />
              {t('Export locations (PDF)')}
            </button>
            <button
              onClick={() => void loadLocations()}
              disabled={loading || saving}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={15} />
              {t('Refresh')}
            </button>
          </div>
        </div>

        {canManageLocations && <div className="flex flex-col gap-2 border-b border-gray-200 bg-gray-50 p-4">
          <input
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void createLocation();
            }}
            placeholder={t("Location name")}
            disabled={saving}
            maxLength={200}
            className="min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
          />

          <textarea
            value={newNotes}
            onChange={(event) => setNewNotes(event.target.value)}
            placeholder={t("Notes (optional)")}
            disabled={saving}
            rows={2}
            className="min-w-0 resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
          />

          <div className="flex justify-end">
            <button
              onClick={() => void createLocation()}
              disabled={saving || !newName.trim()}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Plus size={16} />
              {t('Add location')}
            </button>
          </div>
        </div>}

        <div className="border-b border-gray-200 p-4">
          <div className="relative max-w-md">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Search by name or notes...")}
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {t('Loading locations...')}
          </div>
        ) : filteredLocations.length === 0 ? (
          <div className="p-10 text-center">
            <MapPin size={32} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm text-gray-500">
              {locations.length === 0
                ? t('No locations have been added yet.')
                : t('No locations match your search.')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredLocations.map((location) => (
              <div
                key={location.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  {editingId === location.id ? (
                    <div className="max-w-2xl space-y-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void updateLocation(location.id);
                          if (event.key === 'Escape') {
                            setEditingId(null);
                            setEditingName('');
                            setEditingNotes('');
                          }
                        }}
                        maxLength={200}
                        autoFocus
                        placeholder={t("Location name")}
                        className="w-full rounded-lg border border-blue-400 px-3 py-2 text-sm outline-none"
                      />
                      <textarea
                        value={editingNotes}
                        onChange={(event) => setEditingNotes(event.target.value)}
                        rows={2}
                        placeholder={t("Notes (optional)")}
                        className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-800">
                        {location.name}
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {t('Location ID: {id}', { id: location.id })}
                      </p>
                      {location.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-gray-500">
                          {location.notes}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {editingId === location.id ? (
                    <>
                      <button
                        onClick={() => void updateLocation(location.id)}
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
                          setEditingNotes('');
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
                        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs ${location.inventory_count === 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
                        title={t("Inventory items at this location")}
                      >
                        <Package size={14} className={location.inventory_count === 0 ? 'text-red-600' : ''} />
                        <span className={location.inventory_count === 0 ? 'font-semibold text-red-700' : ''}>{location.inventory_count}</span>
                      </div>

                      <div
                        className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs ${location.employee_count === 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
                        title={t("Distinct employees assigned equipment at this location")}
                      >
                        <Users size={14} className={location.employee_count === 0 ? 'text-red-600' : ''} />
                        <span className={location.employee_count === 0 ? 'font-semibold text-red-700' : ''}>{location.employee_count}</span>
                      </div>

                      {canManageLocations && <button
                        onClick={() => {
                          setEditingId(location.id);
                          setEditingName(location.name);
                          setEditingNotes(location.notes ?? '');
                          clearMessages();
                        }}
                        disabled={saving}
                        title={t("Edit location")}
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                      >
                        <Pencil size={16} />
                      </button>}

                      {canManageLocations && <button
                        onClick={() => {
                          setDeleteTarget(location);
                          clearMessages();
                        }}
                        disabled={saving}
                        title={t("Delete location")}
                        className="rounded-lg p-2 text-red-500 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
          {t('Showing {shown} of {total} locations', { shown: filteredLocations.length, total: locations.length })}
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              {t('Delete location?')}
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              {t('Are you sure you want to delete')} {' '}
              <strong>{deleteTarget.name}</strong>?
            </p>

            {deleteTarget.inventory_count > 0 && (
              <p className="mt-3 text-sm text-red-600">
                {t('This location currently has {count}', { count: deleteTarget.inventory_count })}{' '}
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
                onClick={() => void deleteLocation()}
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
