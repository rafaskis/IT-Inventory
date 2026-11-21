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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Nicosia',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(date);
}

function prettyAction(action: string) {
  return action.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function AuditLogs({ role }: { role: string }) {
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
      body: {
        action: 'list',
        category,
        page,
        page_size: PAGE_SIZE,
      },
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
    // Fetch audit events whenever the selected category or page changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadEvents();
  }, [loadEvents]);
  useEffect(() => {
    const handle = window.setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => window.clearTimeout(handle);
  }, [searchInput]);
  useEffect(() => {
    // Reset pagination and the expanded row when the category changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    setExpanded(null);
  }, [category]);

  const filteredEvents = useMemo(() => {
    if (!search) return events;
    return events.filter((event) => [
      event.entity_id, event.action, event.actor_username,
      JSON.stringify(event.details ?? {}), JSON.stringify(event.changes ?? {}),
    ].join(' ').toLowerCase().includes(search));
  }, [events, search]);

  const exportItemHistory = async () => {
    const code = itemCode.trim().toUpperCase();
    if (!code) {
      setError('Enter an Item Code to export its history.');
      return;
    }
    setExporting(true);
    setError('');
    const { data, error: requestError } = await supabase.functions.invoke('manage-audit', {
      body: { action: 'item_history', item_code: code },
    });
    if (requestError || !Array.isArray(data?.events)) {
      setError(data?.error || requestError?.message || 'Unable to export item history.');
      setExporting(false);
      return;
    }
    const lines = [
      `Inventory Item Audit History: ${code}`,
      `Exported: ${formatDate(new Date().toISOString())}`,
      `Events: ${data.events.length}`,
      '',
    ];
    for (const event of data.events as AuditEvent[]) {
      lines.push(
        `[${formatDate(event.created_at)}] ${prettyAction(event.action)}`,
        `Actor: ${event.actor_username || '—'}`,
        `Item: ${code}`,
        `Changes: ${JSON.stringify(event.changes ?? {}, null, 2)}`,
        `Details: ${JSON.stringify(event.details ?? {}, null, 2)}`,
        '------------------------------------------------------------',
      );
    }
    downloadText(`${code}-audit-history.txt`, lines.join('\r\n'));
    setExporting(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Audit History</h2>
          <p className="mt-1 text-sm text-slate-500">Read-only record of changes made in the inventory system.</p>
        </div>
        <button onClick={() => void loadEvents()} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {categories.map((entry) => {
          const Icon = entry.icon;
          const active = category === entry.key;
          return (
            <button key={entry.key} onClick={() => setCategory(entry.key)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${active ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
              <Icon size={16} /> {entry.label}
            </button>
          );
        })}
      </div>

      {category === 'inventory_item' && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-slate-700">Export one item's complete history</label>
            <input value={itemCode} onChange={(event) => setItemCode(event.target.value)} placeholder="e.g. ITEM-000001" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
          </div>
          <button onClick={() => void exportItemHistory()} disabled={exporting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50">
            <Download size={16} /> {exporting ? 'Preparing…' : 'Download TXT'}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search this page's audit events…" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
        </div>
        <p className="text-sm text-slate-500">{total.toLocaleString()} events · Page {page} of {totalPages}</p>
      </div>

      {error && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={17} className="mt-0.5 shrink-0" />{error}</div>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-12 text-center text-sm text-slate-500">Loading audit history…</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center">
            <FileText size={30} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-medium text-slate-700">No audit events found</p>
            <p className="mt-1 text-xs text-slate-500">Events in this category will appear here when recorded.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredEvents.map((event) => {
              const open = expanded === event.id;
              const itemCodeValue = event.details?.item_code;
              return (
                <div key={event.id}>
                  <button onClick={() => setExpanded(open ? null : event.id)} className="flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800">{prettyAction(event.action)}</span>
                        {Boolean(itemCodeValue) && <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{String(itemCodeValue)}</span>}
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">{event.entity_type} · ID: {event.entity_id} · By {event.actor_username || 'Unknown user'}</p>
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <span className="whitespace-nowrap text-xs tabular-nums text-slate-500">{formatDate(event.created_at)}</span>
                      <ChevronDown size={17} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {open && (
                    <div className="grid gap-4 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2">
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Changes</h4>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{JSON.stringify(event.changes ?? {}, null, 2)}</pre>
                      </div>
                      <div>
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Additional details</h4>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{JSON.stringify(event.details ?? {}, null, 2)}</pre>
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
        <p className="text-xs text-slate-500">Showing {filteredEvents.length} events on this page.</p>
        <div className="flex gap-2">
          <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={18} /></button>
          <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}
