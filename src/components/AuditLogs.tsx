import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Monitor,
  MapPin,
  Tags,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatDateTime, useLanguage } from '../i18n/LanguageProvider';
import type { LucideIcon } from 'lucide-react';

type AuditCategory = 'inventory_item' | 'employee' | 'location' | 'catalog' | 'security';
type AuditEvent = {
  id: string | number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_user_id: string | null;
  actor_username: string | null;
  changes: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

const PAGE_SIZE = 50;
const CATEGORY_INFO: Record<Exclude<AuditCategory, 'security'>, { label: string; icon: LucideIcon }> = {
  inventory_item: { label: 'Inventory Items', icon: Monitor },
  employee: { label: 'Employees', icon: UserRound },
  location: { label: 'Locations', icon: MapPin },
  catalog: { label: 'Catalogues', icon: Tags },
};

const ACTION_LABELS: Record<string, string> = {
  inventory_item_created: 'Inventory item created',
  inventory_item_updated: 'Inventory item updated',
  inventory_item_deleted: 'Inventory item deleted',
  inventory_item_moved_to_pending_scrap: 'Inventory item moved to ΠΡΟΣ ΑΠΟΣΥΡΣΗ',
  inventory_item_scrapped: 'Inventory item scrapped',
  inventory_item_gifted: 'Inventory item issued as a gift',
  employee_created: 'Employee created',
  employee_renamed: 'Employee renamed',
  employee_deleted: 'Employee deleted',
  employee_assigned: 'Employee assigned',
  employee_unassigned: 'Employee unassigned',
  equipment_assigned: 'Equipment assigned',
  equipment_removed: 'Equipment removed',
  location_created: 'Location created',
  location_updated: 'Location updated',
  location_deleted: 'Location deleted',
  catalogue_entry_created: 'Catalogue entry created',
  catalogue_entry_renamed: 'Catalogue entry renamed',
  catalogue_entry_deleted: 'Catalogue entry deleted',
  account_updated: 'Account updated',
};

const CATALOGUE_TYPE_LABELS: Record<string, string> = {
  item_type: 'Item type',
  brand: 'Brand',
  model: 'Model',
};

const AUDIT_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  full_name: 'Full name',
  item_type: 'Item Type',
  brand: 'Brand',
  model: 'Model',
  serial_number: 'Serial Number',
  mac_address: 'MAC Address',
  pc_name: 'PC Name',
  ip_address: 'IP Address',
  socket: 'Socket',
  location: 'Location',
  employee: 'Employee',
  document_number: 'Document number',
  invoice: 'Invoice',
  purchase_date: 'Purchase Date',
  warranty_until: 'Warranty until',
  store: 'Store',
  notes: 'Notes',
  old: 'Previous value',
  new: 'New value',
  catalogue_type: 'Catalogue type',
  item_type_id: 'Item type ID',
  brand_id: 'Brand ID',
  employee_id: 'Employee ID',
  employee_ids: 'Employee IDs',
  location_id: 'Location ID',
  item_code: 'Item Code',
  source: 'Source',
  source_row: 'Excel row',
  target_username: 'Target username',
  role: 'Account role',
  is_active: 'Account status',
  lifecycle_status: 'Lifecycle status',
  from_status: 'Previous lifecycle status',
  to_status: 'New lifecycle status',
  employee_assignments: 'Employee assignments',
  gen_118: 'ΓΕΝ.118',
  gen_118_date: 'ΓΕΝ.118 date',
  gen_36: 'ΓΕΝ.36',
  gen_36_date: 'ΓΕΝ.36 date',
  gen_32a: 'ΓΕΝ.32Α',
  gen_32a_date: 'ΓΕΝ.32Α date',
  service_name: 'ΥΠΗΡΕΣΙΑ',
};


function catalogueTypeLabel(type: unknown, t: (key: string, values?: Record<string, string | number>) => string) {
  if (typeof type !== 'string') return t('Catalogue');
  const label = CATALOGUE_TYPE_LABELS[type];
  return label ? t(label) : t('Catalogue');
}

function eventTitle(event: AuditEvent, t: (key: string, values?: Record<string, string | number>) => string) {
  if (event.entity_type === 'catalog' && event.action.startsWith('catalogue_entry_')) {
    const rawType = typeof event.details?.catalogue_type === 'string' ? event.details.catalogue_type : '';
    const typeKey = CATALOGUE_TYPE_LABELS[rawType];
    const verb = event.action.endsWith('_created')
      ? 'created'
      : event.action.endsWith('_renamed')
        ? 'renamed'
        : event.action.endsWith('_deleted')
          ? 'deleted'
          : '';
    if (verb && typeKey) return t(`${typeKey} entry ${verb}`);
  }

  const label = ACTION_LABELS[event.action];
  if (label) return t(label);
  return event.action.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function entityLabel(event: AuditEvent, t: (key: string, values?: Record<string, string | number>) => string) {
  if (event.entity_type === 'catalog') return catalogueTypeLabel(event.details?.catalogue_type, t);
  const labels: Record<string, string> = {
    inventory_item: 'Inventory item',
    employee: 'Employee',
    location: 'Location',
    account: 'Account',
    profile: 'Profile',
    security: 'Security event',
    auth: 'Authentication event',
    user: 'User',
  };
  return t(labels[event.entity_type] ?? 'Audit record');
}

function localizeAuditJson(
  value: unknown,
  t: (key: string, values?: Record<string, string | number>) => string,
  parentKey = '',
): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeAuditJson(item, t, parentKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => {
      const label = AUDIT_FIELD_LABELS[key];
      const nestedParentKey = ['old', 'new'].includes(key)
        && ['lifecycle_status', 'from_status', 'to_status'].includes(parentKey)
        ? parentKey
        : key;
      return [label ? t(label) : key, localizeAuditJson(nested, t, nestedParentKey)];
    }));
  }
  if (typeof value === 'string') {
    if (parentKey === 'catalogue_type') return catalogueTypeLabel(value, t);
    if (parentKey === 'source' && value === 'batch_import') return t('Batch import');
    if (parentKey === 'role') {
      const roles: Record<string, string> = { administrator: 'Administrator', inventory_manager: 'Inventory manager', viewer: 'Viewer' };
      return roles[value] ? t(roles[value]) : value;
    }
    if (parentKey === 'lifecycle_status' || parentKey === 'from_status' || parentKey === 'to_status') {
      const statuses: Record<string, string> = {
        active: 'Main inventory',
        pending_scrap: 'ΠΡΟΣ ΑΠΟΣΥΡΣΗ',
        scrapped: 'ΑΠΟΣΥΡΣΗ',
        gifted: 'ΕΚΔΟΣΗ ΑΓΑΘΩΝ',
      };
      return statuses[value] ? t(statuses[value]) : value;
    }
  }
  if (typeof value === 'boolean' && parentKey === 'is_active') return value ? t('Active') : t('Inactive');
  return value;
}

export default function AuditLogs({ role }: { role: string }) {
  const { t, language } = useLanguage();
  const [category, setCategory] = useState<AuditCategory>('inventory_item');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<string | number | null>(null);
  const [itemCode, setItemCode] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [exporting, setExporting] = useState(false);

  const isAdmin = role === 'administrator';
  const categories = useMemo(() => [
    { key: 'inventory_item' as const, ...CATEGORY_INFO.inventory_item },
    { key: 'employee' as const, ...CATEGORY_INFO.employee },
    { key: 'location' as const, ...CATEGORY_INFO.location },
    { key: 'catalog' as const, ...CATEGORY_INFO.catalog },
    ...(isAdmin ? [{ key: 'security' as const, label: 'Security & Accounts', icon: ShieldCheck }] : []),
  ], [isAdmin]);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('manage-audit', {
      body: { action: 'list', category, page, page_size: PAGE_SIZE },
    });
    if (requestError || !Array.isArray(data?.events)) {
      let message = data?.error || requestError?.message || 'Failed to load audit history.';
      const context = requestError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try {
          const body = await context.clone().json();
          message = body?.error || body?.message || message;
        } catch { /* Keep fallback message. */ }
      }
      setError(message);
      setEvents([]);
      setTotal(0);
    } else {
      setEvents(data.events as AuditEvent[]);
      setTotal(Number(data.total ?? 0));
    }
    setLoading(false);
  }, [category, page]);

  useEffect(() => {
    // Fetching data here is intentional; loadEvents manages the request lifecycle and loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchInput.trim().toLocaleLowerCase(language === 'el' ? 'el-CY' : 'en-GB')), 250);
    return () => window.clearTimeout(handle);
  }, [searchInput, language]);
  useEffect(() => {
    // Reset pagination and the expanded row when the category changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    setExpanded(null);
  }, [category]);

  const filteredEvents = useMemo(() => {
    if (!search) return events;
    return events.filter((event) => {
      const entityId = String(event.entity_id ?? '');
      if (category === 'inventory_item') return [entityId, String(event.details?.item_code ?? '')].join(' ').toLocaleLowerCase(language === 'el' ? 'el-CY' : 'en-GB').includes(search);
      if (category === 'employee' || category === 'location') {
        const searchableValues = [entityId, String((event as AuditEvent & { entity_name?: string }).entity_name ?? '')];
        return searchableValues.join(' ').toLocaleLowerCase(language === 'el' ? 'el-CY' : 'en-GB').includes(search);
      }
      return [entityId, String(event.details?.item_code ?? '')].join(' ').toLocaleLowerCase(language === 'el' ? 'el-CY' : 'en-GB').includes(search);
    });
  }, [events, search, language, category]);

  const searchPlaceholder = category === 'inventory_item'
    ? t('Search by Item ID...')
    : category === 'employee'
      ? t('Search by Employee Name or ID...')
      : category === 'location'
        ? t('Search by Location Name or ID...')
        : t("Search this page's audit events…");

  const exportItemHistory = async () => {
    const code = itemCode.trim().toUpperCase();
    if (!code) {
      setError(t('Enter an Item Code to export its history.'));
      return;
    }
    setExporting(true);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('manage-audit', {
      body: { action: 'item_history', item_code: code },
    });
    if (requestError || !Array.isArray(data?.events)) {
      let message = data?.error || requestError?.message || t('Unable to export item history.');
      const context = requestError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try {
          const body = await context.clone().json();
          message = body?.error || body?.message || message;
        } catch { /* Keep the original function error. */ }
      }
      setError(message);
      setExporting(false);
      return;
    }
    const history = data.events as AuditEvent[];
    const itemDescription = typeof data.item_description === 'string' ? data.item_description : '';
    const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => htmlEntities[character] ?? character);
    const rows = history.map((event) => {
      const changes = localizeAuditJson(event.changes ?? {}, t);
      const changeText = Object.entries(changes as Record<string, unknown>).map(([key, value]) => {
        if (value && typeof value === 'object' && ('old' in value || 'new' in value)) {
          const pair = value as { old?: unknown; new?: unknown };
          return `${t(key)}: ${JSON.stringify(pair.old ?? '—')} → ${JSON.stringify(pair.new ?? '—')}`;
        }
        return `${t(key)}: ${value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}`;
      }).join('\n') || '—';
      return `<tr><td>${escape(formatDateTime(event.created_at, language))}</td><td>${escape(eventTitle(event, t))}</td><td>${escape(event.actor_username || t('Unknown user'))}</td><td>${escape(changeText).replace(/\n/g, '<br>')}</td></tr>`;
    }).join('');
    const exportedAt = formatDateTime(new Date(), language);
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { setError(t('The PDF window was blocked. Allow pop-ups for this site and try again.')); setExporting(false); return; }
    win.document.write(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escape(code)} - ${escape(t('Audit History'))}</title><style>@page{size:A4 landscape;margin:16mm 12mm 18mm;@bottom-right{content:'MJPO Inventory · ' counter(page) ' / ' counter(pages);font:9px Arial,sans-serif;color:#64748b}}body{font:10px Arial,sans-serif;color:#1e293b}header{border-bottom:3px solid #1d4ed8;padding-bottom:12px;margin-bottom:18px}h1{font-size:20px;margin:0 0 6px;color:#0f172a}.brand{font-size:11px;font-weight:bold;color:#1d4ed8;letter-spacing:1px}.meta{color:#475569;font-size:10px}table{width:100%;border-collapse:collapse}th{background:#1e3a8a;color:white;text-align:left;padding:8px}td{border-bottom:1px solid #cbd5e1;padding:7px;vertical-align:top;white-space:normal}tr:nth-child(even){background:#f8fafc}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><header><div class="brand">MJPO INVENTORY</div><h1>${escape(t('Inventory item audit history'))}</h1><div class="meta">${escape(t('Item Code'))}: <b>${escape(code)}</b>${itemDescription ? ` &nbsp; | &nbsp; ${escape(t('Description'))}: ${escape(itemDescription)}` : ''} &nbsp; | &nbsp; ${escape(t('Exported'))}: ${escape(exportedAt)} &nbsp; | &nbsp; ${escape(t('Events'))}: ${history.length}</div></header><table><thead><tr><th>${escape(t('Timestamp'))}</th><th>${escape(t('Action'))}</th><th>${escape(t('Audit user'))}</th><th>${escape(t('Changes'))}</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>{window.print()}</script></body></html>`);
    win.document.close();
    setExporting(false);
  };

  const exportEmployeeHistory = async () => {
    const id = employeeId.trim();
    if (!/^\d+$/.test(id)) {
      setError(t('Enter an Employee ID to export the employee history.'));
      return;
    }
    setExporting(true);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('manage-audit', {
      body: { action: 'employee_history', employee_id: id },
    });
    if (requestError || !Array.isArray(data?.events)) {
      setError(data?.error || requestError?.message || t('Unable to export employee history.'));
      setExporting(false);
      return;
    }
    const history = data.events as AuditEvent[];
    const employeeName = String(data.employee_name ?? '');
    const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => htmlEntities[character] ?? character);
    const rows = history.map((event) => {
      const changes = localizeAuditJson(event.changes ?? {}, t);
      const changeText = Object.entries(changes as Record<string, unknown>).map(([key, value]) => {
        if (value && typeof value === 'object' && ('old' in value || 'new' in value)) {
          const pair = value as { old?: unknown; new?: unknown };
          return `${t(key)}: ${JSON.stringify(pair.old ?? '—')} → ${JSON.stringify(pair.new ?? '—')}`;
        }
        return `${t(key)}: ${value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}`;
      }).join('\n') || '—';
      return `<tr><td>${escape(formatDateTime(event.created_at, language))}</td><td>${escape(eventTitle(event, t))}</td><td>${escape(event.actor_username || t('Unknown user'))}</td><td>${escape(changeText).replace(/\n/g, '<br>')}</td></tr>`;
    }).join('');
    const exportedAt = formatDateTime(new Date(), language);
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { setError(t('The PDF window was blocked. Allow pop-ups for this site and try again.')); setExporting(false); return; }
    win.document.write(`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><title>${escape(employeeName)} - ${escape(t('Audit History'))}</title><style>@page{size:A4 landscape;margin:16mm 12mm 18mm;@bottom-right{content:'MJPO Inventory · ' counter(page) ' / ' counter(pages);font:9px Arial,sans-serif;color:#64748b}}body{font:10px Arial,sans-serif;color:#1e293b}header{border-bottom:3px solid #1d4ed8;padding-bottom:12px;margin-bottom:18px}h1{font-size:20px;margin:0 0 6px;color:#0f172a}.brand{font-size:11px;font-weight:bold;color:#1d4ed8;letter-spacing:1px}.meta{color:#475569;font-size:10px}table{width:100%;border-collapse:collapse}th{background:#1e3a8a;color:white;text-align:left;padding:8px}td{border-bottom:1px solid #cbd5e1;padding:7px;vertical-align:top;white-space:normal}tr:nth-child(even){background:#f8fafc}thead{display:table-header-group}tr{break-inside:avoid}</style></head><body><header><div class="brand">MJPO INVENTORY</div><h1>${escape(t('Employee audit history'))}</h1><div class="meta">${escape(t('Employee'))}: <b>${escape(employeeName)}</b> &nbsp; | &nbsp; ${escape(t('Employee ID'))}: <b>${escape(id)}</b> &nbsp; | &nbsp; ${escape(t('Exported'))}: ${escape(exportedAt)} &nbsp; | &nbsp; ${escape(t('Events'))}: ${history.length}</div></header><table><thead><tr><th>${escape(t('Timestamp'))}</th><th>${escape(t('Action'))}</th><th>${escape(t('Audit user'))}</th><th>${escape(t('Changes'))}</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>{window.print()}</script></body></html>`);
    win.document.close();
    setExporting(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{t('Audit History')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('Read-only record of changes made in the inventory system.')}</p>
        </div>
        <button onClick={() => void loadEvents()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {t('Refresh')}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {categories.map((entry) => {
          const Icon = entry.icon;
          const active = category === entry.key;
          return (
            <button key={entry.key} onClick={() => setCategory(entry.key)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={16} /> {t(entry.label)}
            </button>
          );
        })}
      </div>

      {category === 'inventory_item' && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-700">{t("Export one item's complete history")}</label>
            <input value={itemCode} onChange={(event) => setItemCode(event.target.value)} placeholder={t('e.g. MJPO-000001')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <button onClick={() => void exportItemHistory()} disabled={exporting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            <Download size={16} /> {exporting ? t('Preparing…') : t('Export PDF')}
          </button>
        </div>
      )}

      {category === 'employee' && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-700">{t('Export one employee’s complete history')}</label>
            <input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} inputMode="numeric" placeholder={t('Enter Employee ID')} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <button onClick={() => void exportEmployeeHistory()} disabled={exporting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            <Download size={16} /> {exporting ? t('Preparing…') : t('Export PDF')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={searchPlaceholder} className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </div>
        <p className="text-sm text-slate-500">{t('{count} events · Page {page} of {totalPages}', { count: total.toLocaleString(language === 'el' ? 'el-CY' : 'en-GB'), page, totalPages })}</p>
      </div>

      {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{t(error)}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">{t('Loading audit history…')}</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={30} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">{t('No audit events found')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('Events in this category will appear here when recorded.')}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEvents.map((event) => {
              const open = expanded === event.id;
              const itemCodeValue = event.details?.item_code;
              const actor = event.actor_username || t('Unknown user');
              const entityName = (event as AuditEvent & { entity_name?: string }).entity_name;
              const description = t('{entity} · ID: {id} · By {user}', {
                entity: entityName ? `${entityLabel(event, t)}: ${entityName}` : entityLabel(event, t), id: event.entity_id, user: actor,
              });
              return (
                <div key={event.id}>
                  <button onClick={() => setExpanded(open ? null : event.id)} className="flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800">{eventTitle(event, t)}</span>
                        {Boolean(itemCodeValue) && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{String(itemCodeValue)}</span>}
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{description}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{formatDateTime(event.created_at, language)}</span>
                      <ChevronDown size={17} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {open && (
                    <div className="grid gap-4 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Changes')}</h4>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{JSON.stringify(localizeAuditJson(event.changes ?? {}, t), null, 2)}</pre>
                      </div>
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Additional details')}</h4>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{JSON.stringify(localizeAuditJson(event.details ?? {}, t), null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{t('Showing {count} events on this page.', { count: filteredEvents.length })}</p>
        <div className="flex gap-2">
          <button aria-label={t('Previous page')} onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button aria-label={t('Next page')} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}
