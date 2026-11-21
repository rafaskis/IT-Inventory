import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  RefreshCw,
  Search,
  Filter,
  X,
  Plus,
  Pencil,
  FileDown,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type Employee = {
  id: number;
  full_name: string;
};

type InventoryItem = {
  id: number;
  item_code: string;
  item_type_id: number;
  brand_id: number;
  model_id: number;
  serial_number: string | null;
  mac_address: string | null;
  pc_name: string | null;
  ip_address: string | null;
  socket: string | null;
  location_id: number;
  notes: string | null;
  document_number: number | null;
  invoice: string | null;
  purchase_date: string | null;
  warranty_until: string | null;
  store: string | null;
  created_at: string;
  updated_at: string;
  brand: {
    id: number;
    name: string;
    item_type: { id: number; name: string } | null;
  } | null;
  model: { id: number; name: string } | null;
  location: { id: number; name: string } | null;
  employees: Employee[];
};

type SortField =
  | 'item_code'
  | 'item_type'
  | 'brand'
  | 'model'
  | 'serial_number'
  | 'mac_address'
  | 'pc_name'
  | 'ip_address'
  | 'socket'
  | 'employee'
  | 'location'
  | 'document_number'
  | 'purchase_date'
  | 'warranty_until'
  | 'store'
  | 'created_at'
  | 'updated_at';

type ColumnKey =
  | 'item_code'
  | 'item_type'
  | 'brand'
  | 'model'
  | 'serial_number'
  | 'employee'
  | 'location'
  | 'notes'
  | 'document_number'
  | 'mac_address'
  | 'pc_name'
  | 'ip_address'
  | 'socket'
  | 'purchase_date'
  | 'warranty_until'
  | 'invoice'
  | 'store';

type ColumnDefinition = {
  key: ColumnKey;
  label: string;
  sortField?: SortField;
  defaultVisible: boolean;
};

const COLUMNS: ColumnDefinition[] = [
  { key: 'item_code', label: 'Item Code', sortField: 'item_code', defaultVisible: false },
  { key: 'item_type', label: 'Item Type', sortField: 'item_type', defaultVisible: true },
  { key: 'brand', label: 'Brand', sortField: 'brand', defaultVisible: true },
  { key: 'model', label: 'Model', sortField: 'model', defaultVisible: true },
  { key: 'serial_number', label: 'S/N', sortField: 'serial_number', defaultVisible: true },
  { key: 'employee', label: 'Employee', sortField: 'employee', defaultVisible: true },
  { key: 'location', label: 'Location', sortField: 'location', defaultVisible: true },
  { key: 'notes', label: 'Notes', defaultVisible: true },
  { key: 'document_number', label: 'EOASIS Doc. No.', sortField: 'document_number', defaultVisible: false },
  { key: 'mac_address', label: 'MAC', sortField: 'mac_address', defaultVisible: false },
  { key: 'pc_name', label: 'PC Name', sortField: 'pc_name', defaultVisible: false },
  { key: 'ip_address', label: 'IP', sortField: 'ip_address', defaultVisible: false },
  { key: 'socket', label: 'SOCKET', sortField: 'socket', defaultVisible: false },
  { key: 'purchase_date', label: 'Purchase date', sortField: 'purchase_date', defaultVisible: false },
  { key: 'warranty_until', label: 'Warranty date', sortField: 'warranty_until', defaultVisible: false },
  { key: 'invoice', label: 'Invoice', defaultVisible: false },
  { key: 'store', label: 'Store', sortField: 'store', defaultVisible: false },
];

const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter((column) => column.defaultVisible).map((column) => column.key);
const STANDARD_PDF_DEFAULT_COLUMNS: ColumnKey[] = ['item_type', 'brand', 'model', 'serial_number', 'employee', 'location'];
const VOUCHER_PDF_DEFAULT_COLUMNS: ColumnKey[] = ['item_type', 'brand', 'model', 'serial_number', 'location'];

function normalizeEmployeeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
}

function displayValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function displayEmployees(employees: Employee[] | null | undefined) {
  if (!employees || employees.length === 0) return '—';
  if (employees.length > 1) return 'ΚΟΙΝΟΧΡΗΣΤΟ';
  return employees[0].full_name;
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB').format(date);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inventoryCellValue(item: InventoryItem, key: ColumnKey) {
  switch (key) {
    case 'item_code': return item.item_code;
    case 'item_type': return item.brand?.item_type?.name ?? '—';
    case 'brand': return item.brand?.name ?? '—';
    case 'model': return item.model?.name ?? '—';
    case 'serial_number': return displayValue(item.serial_number);
    case 'employee': return displayEmployees(item.employees);
    case 'location': return item.location?.name ?? '—';
    case 'notes': return displayValue(item.notes);
    case 'document_number': return displayValue(item.document_number);
    case 'mac_address': return displayValue(item.mac_address);
    case 'pc_name': return displayValue(item.pc_name);
    case 'ip_address': return displayValue(item.ip_address);
    case 'socket': return displayValue(item.socket);
    case 'purchase_date': return formatDate(item.purchase_date);
    case 'warranty_until': return formatDate(item.warranty_until);
    case 'invoice': return displayValue(item.invoice);
    case 'store': return displayValue(item.store);
  }
}

function buildInventoryPrintHtml(
  rows: InventoryItem[],
  columns: ColumnKey[],
  title: string,
  signatureEmployee?: string,
) {
  const definitions = COLUMNS.filter((column) => columns.includes(column.key));
  const headers = definitions.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('');
  const body = rows.map((item) => `<tr>${definitions.map((column) => `<td>${escapeHtml(inventoryCellValue(item, column.key))}</td>`).join('')}</tr>`).join('');
  const exportedAt = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Nicosia',
  }).format(new Date());
  const debitFooter = signatureEmployee ? `
    <div class="signature-footer">
      <div class="employee-name">${escapeHtml(signatureEmployee)}</div>
      <div class="signature-line"></div>
      <div class="signature-label">Signature</div>
    </div>` : '';
  const pageMargin = signatureEmployee ? '10mm 10mm 38mm 10mm' : '10mm 10mm 16mm 10mm';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: ${pageMargin}; }
      @page { @bottom-left { content: "${escapeHtml(title)} · ${escapeHtml(exportedAt)}"; font: 8px Arial, sans-serif; color: #666; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8px Arial, sans-serif; color: #666; } }
      * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; color: #222; font-size: 9px; }
      h1 { font-size: 18px; margin: 0 0 5px; } .meta { color: #555; font-size: 9px; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; table-layout: auto; } thead { display: table-header-group; }
      th { background: #e9edf2; font-weight: 700; text-align: left; } th, td { border: 1px solid #b9c0c8; padding: 5px 4px; vertical-align: top; overflow-wrap: anywhere; }
      tr { break-inside: avoid; page-break-inside: avoid; } tbody tr:nth-child(even) { background: #f7f8fa; }
      .signature-footer { position: fixed; right: 0; bottom: 0; width: 62mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
      .employee-name { font-size: 10px; font-weight: 700; margin-bottom: 12mm; }
      .signature-line { border-top: 1px solid #222; width: 100%; } .signature-label { margin-top: 3px; font-size: 9px; }
      @media screen { body { margin: 18px; } }
    </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">${rows.length.toLocaleString()} item${rows.length === 1 ? '' : 's'} · Exported ${escapeHtml(exportedAt)}</div>
      <table><thead><tr>${headers}</tr></thead><tbody>${body || `<tr><td colspan="${Math.max(definitions.length, 1)}">No inventory items found.</td></tr>`}</tbody></table>
      ${debitFooter}
      <script>window.addEventListener('load', function(){ window.focus(); setTimeout(function(){ window.print(); }, 300); });</${'script'}>
    </body></html>`;
}


type FilterOption = { id: number; name: string };

type InventoryFilters = {
  item_type_ids: number[];
  brand_ids: number[];
  model_ids: number[];
  employee_ids: number[];
  location_ids: number[];
  purchase_date_from: string;
  purchase_date_to: string;
  warranty_date_from: string;
  warranty_date_to: string;
};

type CreateDraft = {
  item_type_id: string; brand_id: string; model_id: string; location_id: string;
  serial_number: string; mac_address: string; pc_name: string; ip_address: string; socket: string;
  notes: string; document_number: string; invoice: string; purchase_date: string; warranty_until: string; store: string;
};
const EMPTY_CREATE_DRAFT: CreateDraft = {
  item_type_id: '', brand_id: '', model_id: '', location_id: '', serial_number: '',
  mac_address: '', pc_name: '', ip_address: '', socket: '', notes: '', document_number: '',
  invoice: '', purchase_date: '', warranty_until: '', store: '',
};

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  disabled = false,
}: {
  label: string;
  options: FilterOption[];
  selected: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedNames = options
    .filter((option) => selected.includes(option.id))
    .map((option) => option.name);

  return (
    <div className="relative min-w-[190px]">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <span className="min-w-0 truncate">
          {label}
          {selected.length > 0 && (
            <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown size={15} className="shrink-0 text-gray-400" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label={`Close ${label} filter`}
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 z-30 mt-2 max-h-64 w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
            <div className="mb-1 flex items-center justify-between px-2 py-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {label}
              </span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                Clear
              </button>
            </div>
            {options.length === 0 ? (
              <p className="px-2 py-3 text-sm text-gray-500">No options available.</p>
            ) : (
              options.map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.id)}
                    onChange={() =>
                      onChange(
                        selected.includes(option.id)
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id],
                      )
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="min-w-0 truncate">{option.name}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
      {selected.length > 0 && selectedNames.length === 0 && (
        <span className="sr-only">{selected.length} selected values</span>
      )}
    </div>
  );
}

export default function Inventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(() => {
    try {
      const saved = sessionStorage.getItem('it-inventory-visible-columns');
      if (saved) {
        const parsed = JSON.parse(saved) as string[];
        const validKeys = parsed.filter((key): key is ColumnKey =>
          COLUMNS.some((column) => column.key === key),
        );
        return validKeys.length > 0 ? validKeys : DEFAULT_VISIBLE_COLUMNS;
      }
    } catch {
      // Use the default layout if session storage is unavailable or invalid.
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [exportType, setExportType] = useState<'standard' | 'debit' | null>(null);
  const [exportColumns, setExportColumns] = useState<ColumnKey[]>(DEFAULT_VISIBLE_COLUMNS);
  const [exportEmployees, setExportEmployees] = useState<Employee[]>([]);
  const [exportEmployeeId, setExportEmployeeId] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [hideShared, setHideShared] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(true);
  const [filterOptionsError, setFilterOptionsError] = useState('');
  const [itemTypes, setItemTypes] = useState<FilterOption[]>([]);
  const [brands, setBrands] = useState<FilterOption[]>([]);
  const [models, setModels] = useState<FilterOption[]>([]);
  const [employees, setEmployees] = useState<FilterOption[]>([]);
  const [locations, setLocations] = useState<FilterOption[]>([]);
  const [filters, setFilters] = useState<InventoryFilters>({
    item_type_ids: [],
    brand_ids: [],
    model_ids: [],
    employee_ids: [],
    location_ids: [],
    purchase_date_from: '',
    purchase_date_to: '',
    warranty_date_from: '',
    warranty_date_to: '',
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE_DRAFT);
  const [createItemTypes, setCreateItemTypes] = useState<FilterOption[]>([]);
  const [createBrands, setCreateBrands] = useState<(FilterOption & { item_type_id: number })[]>([]);
  const [createModels, setCreateModels] = useState<(FilterOption & { brand_id: number })[]>([]);
  const [createEmployees, setCreateEmployees] = useState<Employee[]>([]);
  const [createLocations, setCreateLocations] = useState<FilterOption[]>([]);
  const [createEmployeeIds, setCreateEmployeeIds] = useState<number[]>([]);
  const [newItemTypeName, setNewItemTypeName] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newLocationName, setNewLocationName] = useState('');
  const [newEmployeeNames, setNewEmployeeNames] = useState('');

  const [canManageInventory, setCanManageInventory] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editDraft, setEditDraft] = useState<CreateDraft>(EMPTY_CREATE_DRAFT);
  const [editEmployeeIds, setEditEmployeeIds] = useState<number[]>([]);
  const [editNewItemTypeName, setEditNewItemTypeName] = useState('');
  const [editNewBrandName, setEditNewBrandName] = useState('');
  const [editNewModelName, setEditNewModelName] = useState('');
  const [editNewLocationName, setEditNewLocationName] = useState('');
  const [editEmployeeSearch, setEditEmployeeSearch] = useState('');
  const [editNewEmployeeInput, setEditNewEmployeeInput] = useState('');
  const [editNewEmployeeNames, setEditNewEmployeeNames] = useState<string[]>([]);
  const [editEmployeePickerError, setEditEmployeePickerError] = useState('');

  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkPreviewItems, setBulkPreviewItems] = useState<InventoryItem[]>([]);
  const [bulkApplyEmployees, setBulkApplyEmployees] = useState(false);
  const [bulkEmployeeIds, setBulkEmployeeIds] = useState<number[]>([]);
  const [bulkEmployeeSearch, setBulkEmployeeSearch] = useState('');
  const [bulkNewEmployeeInput, setBulkNewEmployeeInput] = useState('');
  const [bulkNewEmployeeNames, setBulkNewEmployeeNames] = useState<string[]>([]);
  const [bulkEmployeePickerError, setBulkEmployeePickerError] = useState('');
  const [bulkClearEmployees, setBulkClearEmployees] = useState(false);
  const [bulkApplyLocation, setBulkApplyLocation] = useState(false);
  const [bulkLocationId, setBulkLocationId] = useState('');
  const [bulkApplyNotes, setBulkApplyNotes] = useState(false);
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkClearNotes, setBulkClearNotes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadManagementPermission() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user || cancelled) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', userData.user.id)
        .maybeSingle();
      if (!cancelled) {
        setCanManageInventory(Boolean(profile?.is_active && ['administrator', 'inventory_manager'].includes(profile.role)));
      }
    }
    void loadManagementPermission();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadFilterOptions() {
      setFilterOptionsLoading(true);
      setFilterOptionsError('');

      const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
        body: {
          action: 'filter_options',
          search,
          show_shared: !hideShared,
          filters: {
            item_type_ids: filters.item_type_ids,
            brand_ids: filters.brand_ids,
            model_ids: filters.model_ids,
            employee_ids: filters.employee_ids,
            location_ids: filters.location_ids,
          },
        },
      });

      if (cancelled) return;

      if (requestError || !data?.options) {
        let message = data?.error || requestError?.message || 'Could not load inventory filter options.';
        const context = requestError?.context;
        if (!data?.error && context && typeof context.clone === 'function') {
          try {
            const responseBody = await context.clone().json();
            message = responseBody?.error || responseBody?.message || message;
          } catch {
            // The response may not contain JSON.
          }
        }
        setFilterOptionsError(message);
      } else {
        const options = data.options;
        const toOptions = (value: unknown): FilterOption[] =>
          Array.isArray(value)
            ? value.map((row: { id: number | string; name: string }) => ({
                id: Number(row.id),
                name: row.name,
              }))
            : [];

        setItemTypes(toOptions(options.item_types));
        setBrands(toOptions(options.brands));
        setModels(toOptions(options.models));
        setEmployees(toOptions(options.employees));
        setLocations(toOptions(options.locations));
      }

      setFilterOptionsLoading(false);
    }

    void loadFilterOptions();
    return () => {
      cancelled = true;
    };
  }, [
    filters.item_type_ids,
    filters.brand_ids,
    filters.model_ids,
    filters.employee_ids,
    filters.location_ids,
    search,
    hideShared,
  ]);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
      body: {
        action: 'list',
        show_shared: !hideShared,
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
        search,
        filters: {
          item_type_ids: filters.item_type_ids,
          brand_ids: filters.brand_ids,
          model_ids: filters.model_ids,
          employee_ids: filters.employee_ids,
          location_ids: filters.location_ids,
          ...(filters.purchase_date_from ? { purchase_date_from: filters.purchase_date_from } : {}),
          ...(filters.purchase_date_to ? { purchase_date_to: filters.purchase_date_to } : {}),
          ...(filters.warranty_date_from ? { warranty_date_from: filters.warranty_date_from } : {}),
          ...(filters.warranty_date_to ? { warranty_date_to: filters.warranty_date_to } : {}),
        },
      },
    });

    if (requestError || !Array.isArray(data?.items)) {
      let message = data?.error || requestError?.message || 'Failed to load inventory.';
      const context = requestError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try {
          const responseBody = await context.clone().json();
          message = responseBody?.error || responseBody?.message || message;
        } catch {
          // The response may not contain JSON.
        }
      }
      setError(message);
      setItems([]);
      setTotal(0);
      setTotalPages(0);
      setLoading(false);
      return;
    }

    setItems(data.items as InventoryItem[]);
    setTotal(Number(data.total ?? 0));
    setTotalPages(Number(data.total_pages ?? 0));
    setLoading(false);
  }, [page, pageSize, sortBy, sortOrder, search, filters, hideShared]);

  useEffect(() => {
    // Reload inventory whenever search, filters, sorting or pagination changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInventory();
  }, [loadInventory]);

  useEffect(() => {
    // Selection is scoped to the current result set; clear it when that set changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedItemIds([]);
  }, [search, filters, hideShared]);

  useEffect(() => {
    try {
      sessionStorage.setItem('it-inventory-visible-columns', JSON.stringify(visibleColumns));
    } catch {
      // Column preferences remain usable for the current render if storage is unavailable.
    }
  }, [visibleColumns]);

  const availableBrands = brands;
  const availableModels = models;

  const updateFilter = <K extends keyof InventoryFilters,>(
    key: K,
    value: InventoryFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearchInput('');
    setSearch('');
    setHideShared(false);
    setFilters({
      item_type_ids: [],
      brand_ids: [],
      model_ids: [],
      employee_ids: [],
      location_ids: [],
      purchase_date_from: '',
      purchase_date_to: '',
      warranty_date_from: '',
      warranty_date_to: '',
    });
    setPage(1);
  };

  const activeFilterCount =
    filters.item_type_ids.length +
    filters.brand_ids.length +
    filters.model_ids.length +
    filters.employee_ids.length +
    filters.location_ids.length +
    Number(Boolean(filters.purchase_date_from || filters.purchase_date_to)) +
    Number(Boolean(filters.warranty_date_from || filters.warranty_date_to)) +
    Number(hideShared);

  const visibleColumnDefinitions = useMemo(
    () => COLUMNS.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  );

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((current) =>
      current.includes(key)
        ? current.filter((column) => column !== key)
        : [...current, key],
    );
  };

  const resetColumns = () => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);

  const handleSort = (field?: SortField) => {
    if (!field) return;
    if (sortBy === field) {
      setSortOrder((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const renderCell = (item: InventoryItem, key: ColumnKey) => {
    switch (key) {
      case 'item_code': return displayValue(item.item_code);
      case 'item_type': return displayValue(item.brand?.item_type?.name);
      case 'brand': return displayValue(item.brand?.name);
      case 'model': return displayValue(item.model?.name);
      case 'serial_number': return displayValue(item.serial_number);
      case 'employee': return displayEmployees(item.employees);
      case 'location': return displayValue(item.location?.name);
      case 'notes': return displayValue(item.notes);
      case 'document_number': return displayValue(item.document_number);
      case 'mac_address': return displayValue(item.mac_address);
      case 'pc_name': return displayValue(item.pc_name);
      case 'ip_address': return displayValue(item.ip_address);
      case 'socket': return displayValue(item.socket);
      case 'purchase_date': return formatDate(item.purchase_date);
      case 'warranty_until': return formatDate(item.warranty_until);
      case 'invoice': return displayValue(item.invoice);
      case 'store': return displayValue(item.store);
    }
  };

  const openCreateForm = async () => {
    setCreateError('');
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setCreateEmployeeIds([]);
    setNewItemTypeName(''); setNewBrandName(''); setNewModelName(''); setNewLocationName(''); setNewEmployeeNames('');
    setCreateOpen(true);
    const [types, brandRows, modelRows, employeeRows, locationRows] = await Promise.all([
      supabase.from('item_types').select('id, name').order('name'),
      supabase.from('brands').select('id, name, item_type_id').order('name'),
      supabase.from('models').select('id, name, brand_id').order('name'),
      supabase.from('employees').select('id, full_name').order('full_name'),
      supabase.from('locations').select('id, name').order('name'),
    ]);
    const failed = [types.error, brandRows.error, modelRows.error, employeeRows.error, locationRows.error].some(Boolean);
    if (failed) { setCreateError('Could not load the item creation lists. Close this form and try again.'); return; }
    setCreateItemTypes((types.data ?? []).map((x: { id: number; name: string }) => ({ id: Number(x.id), name: x.name })));
    setCreateBrands((brandRows.data ?? []).map((x: { id: number; name: string; item_type_id: number }) => ({ id: Number(x.id), name: x.name, item_type_id: Number(x.item_type_id) })));
    setCreateModels((modelRows.data ?? []).map((x: { id: number; name: string; brand_id: number }) => ({ id: Number(x.id), name: x.name, brand_id: Number(x.brand_id) })));
    setCreateEmployees((employeeRows.data ?? []).map((x: { id: number; full_name: string }) => ({ id: Number(x.id), full_name: x.full_name })));
    setCreateLocations((locationRows.data ?? []).map((x: { id: number; name: string }) => ({ id: Number(x.id), name: x.name })));
  };

  const submitCreateItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError('');
    if ((!createDraft.item_type_id && !newItemTypeName.trim()) || (!createDraft.brand_id && !newBrandName.trim()) || (!createDraft.model_id && !newModelName.trim()) || (!createDraft.location_id && !newLocationName.trim())) {
      setCreateError('Item Type, Brand, Model and Location are required. Select an existing value or enter a new one.'); return;
    }
    const names = newEmployeeNames.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    if (names.length > 50) { setCreateError('You can add a maximum of 50 new employees at once.'); return; }
    if (createDraft.document_number && !/^\d+$/.test(createDraft.document_number)) { setCreateError('Document No. must be a whole number.'); return; }
    setCreateSaving(true);
    const item: Record<string, unknown> = {
      serial_number: createDraft.serial_number,
      mac_address: createDraft.mac_address, pc_name: createDraft.pc_name,
      ip_address: createDraft.ip_address, socket: createDraft.socket,
      notes: createDraft.notes, document_number: createDraft.document_number,
      invoice: createDraft.invoice, purchase_date: createDraft.purchase_date,
      warranty_until: createDraft.warranty_until, store: createDraft.store,
    };
    if (createDraft.item_type_id) item.item_type_id = Number(createDraft.item_type_id);
    if (createDraft.brand_id) item.brand_id = Number(createDraft.brand_id);
    if (createDraft.model_id) item.model_id = Number(createDraft.model_id);
    if (createDraft.location_id) item.location_id = Number(createDraft.location_id);
    const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', {
      body: { action: 'create', item, employee_ids: createEmployeeIds,
        new_employee_names: names, new_item_type_name: newItemTypeName.trim(),
        new_brand_name: newBrandName.trim(), new_model_name: newModelName.trim(),
        new_location_name: newLocationName.trim() },
    });
    if (invokeError || data?.error || !data?.success) {
      let message = data?.error || invokeError?.message || 'Could not create the inventory item.';
      const context = invokeError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try { const body = await context.clone().json(); message = body?.error || body?.message || message; } catch { /* no JSON response */ }
      }
      setCreateError(message); setCreateSaving(false); return;
    }
    setCreateSaving(false); setCreateOpen(false); setPage(1);
    await loadInventory();
  };

  const openEditForm = async (listItem: InventoryItem) => {
    setEditError('');
    setEditNewItemTypeName(''); setEditNewBrandName(''); setEditNewModelName(''); setEditNewLocationName('');
    setEditEmployeeSearch(''); setEditNewEmployeeInput(''); setEditNewEmployeeNames([]); setEditEmployeePickerError('');
    setEditingItem(listItem);
    setEditOpen(true);
    setEditSaving(true);

    const [itemResult, types, brandRows, modelRows, employeeRows, locationRows] = await Promise.all([
      supabase.functions.invoke('manage-inventory', { body: { action: 'get', id: listItem.id } }),
      supabase.from('item_types').select('id, name').order('name'),
      supabase.from('brands').select('id, name, item_type_id').order('name'),
      supabase.from('models').select('id, name, brand_id').order('name'),
      supabase.from('employees').select('id, full_name').order('full_name'),
      supabase.from('locations').select('id, name').order('name'),
    ]);

    const loadError = [types.error, brandRows.error, modelRows.error, employeeRows.error, locationRows.error].some(Boolean);
    if (itemResult.error || itemResult.data?.error || !itemResult.data?.item || loadError) {
      setEditError(itemResult.data?.error || itemResult.error?.message || 'Could not load the item details and editing lists.');
      setEditSaving(false);
      return;
    }

    const item = itemResult.data.item as InventoryItem;
    setEditingItem(item);
    setCreateItemTypes((types.data ?? []).map((x: { id: number; name: string }) => ({ id: Number(x.id), name: x.name })));
    setCreateBrands((brandRows.data ?? []).map((x: { id: number; name: string; item_type_id: number }) => ({ id: Number(x.id), name: x.name, item_type_id: Number(x.item_type_id) })));
    setCreateModels((modelRows.data ?? []).map((x: { id: number; name: string; brand_id: number }) => ({ id: Number(x.id), name: x.name, brand_id: Number(x.brand_id) })));
    setCreateEmployees((employeeRows.data ?? []).map((x: { id: number; full_name: string }) => ({ id: Number(x.id), full_name: x.full_name })));
    setCreateLocations((locationRows.data ?? []).map((x: { id: number; name: string }) => ({ id: Number(x.id), name: x.name })));
    setEditEmployeeIds((item.employees ?? []).map((employee) => Number(employee.id)));
    setEditDraft({
      item_type_id: String(item.item_type_id ?? ''),
      brand_id: String(item.brand_id ?? ''),
      model_id: String(item.model_id ?? ''),
      location_id: String(item.location_id ?? ''),
      serial_number: item.serial_number ?? '',
      mac_address: item.mac_address ?? '',
      pc_name: item.pc_name ?? '',
      ip_address: item.ip_address ?? '',
      socket: item.socket ?? '',
      notes: item.notes ?? '',
      document_number: item.document_number == null ? '' : String(item.document_number),
      invoice: item.invoice ?? '',
      purchase_date: item.purchase_date ?? '',
      warranty_until: item.warranty_until ?? '',
      store: item.store ?? '',
    });
    setEditSaving(false);
  };

  const submitEditItem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingItem) return;
    setEditError('');
    if ((!editDraft.item_type_id && !editNewItemTypeName.trim()) || (!editDraft.brand_id && !editNewBrandName.trim()) || (!editDraft.model_id && !editNewModelName.trim()) || (!editDraft.location_id && !editNewLocationName.trim())) {
      setEditError('Item Type, Brand, Model and Location are required. Select an existing value or enter a new one.');
      return;
    }
    if (editDraft.document_number && !/^\d+$/.test(editDraft.document_number)) {
      setEditError('Document No. must be a whole number.');
      return;
    }
    setEditSaving(true);
    const item: Record<string, unknown> = {
      serial_number: editDraft.serial_number,
      mac_address: editDraft.mac_address,
      pc_name: editDraft.pc_name,
      ip_address: editDraft.ip_address,
      socket: editDraft.socket,
      notes: editDraft.notes,
      document_number: editDraft.document_number,
      invoice: editDraft.invoice,
      purchase_date: editDraft.purchase_date,
      warranty_until: editDraft.warranty_until,
      store: editDraft.store,
    };
    if (editDraft.item_type_id) item.item_type_id = Number(editDraft.item_type_id);
    if (editDraft.brand_id) item.brand_id = Number(editDraft.brand_id);
    if (editDraft.model_id) item.model_id = Number(editDraft.model_id);
    if (editDraft.location_id) item.location_id = Number(editDraft.location_id);
    const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', {
      body: {
        action: 'update_with_related',
        id: editingItem.id,
        item,
        employee_ids: editEmployeeIds,
        new_employee_names: editNewEmployeeNames,
        new_item_type_name: editNewItemTypeName.trim(),
        new_brand_name: editNewBrandName.trim(),
        new_model_name: editNewModelName.trim(),
        new_location_name: editNewLocationName.trim(),
      },
    });
    if (invokeError || data?.error || !data?.success) {
      let message = data?.error || invokeError?.message || 'Could not update the inventory item.';
      const context = invokeError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try { const body = await context.clone().json(); message = body?.error || body?.message || message; } catch { /* no JSON response */ }
      }
      setEditError(message);
      setEditSaving(false);
      return;
    }
    setEditSaving(false);
    setEditOpen(false);
    setEditingItem(null);
    await loadInventory();
  };

  const addEditEmployees = () => {
    setEditEmployeePickerError('');
    const name = editNewEmployeeInput.trim();
    if (!name) return;
    if (name.length > 150) {
      setEditEmployeePickerError('Employee names cannot exceed 150 characters.');
      return;
    }
    const normalized = normalizeEmployeeSearch(name);
    const normalizedExisting = new Set(createEmployees.map((employee) => normalizeEmployeeSearch(employee.full_name)));
    const normalizedAssigned = new Set(editNewEmployeeNames.map(normalizeEmployeeSearch));
    if (normalizedExisting.has(normalized) || normalizedAssigned.has(normalized)) {
      setEditEmployeePickerError(`“${name}” already exists or has already been added.`);
      return;
    }
    setEditNewEmployeeNames((current) => [...current, name]);
    setEditNewEmployeeInput('');
  };

  const editAvailableEmployees = editEmployeeSearch.trim()
    ? createEmployees
        .filter((employee) => !editEmployeeIds.includes(employee.id))
        .filter((employee) => normalizeEmployeeSearch(employee.full_name).includes(normalizeEmployeeSearch(editEmployeeSearch)))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
    : [];
  const editEmployeeMatches = editAvailableEmployees.slice(0, 10);

  const currentPageSelected = items.length > 0 && items.every((item) => selectedItemIds.includes(item.id));
  const selectedEmployeeOptions = createEmployees
    .filter((employee) => bulkEmployeeIds.includes(employee.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  const bulkAvailableEmployees = bulkEmployeeSearch.trim()
    ? createEmployees
        .filter((employee) => !bulkEmployeeIds.includes(employee.id))
        .filter((employee) => normalizeEmployeeSearch(employee.full_name).includes(normalizeEmployeeSearch(bulkEmployeeSearch)))
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
    : [];
  const bulkEmployeeMatches = bulkAvailableEmployees.slice(0, 10);

  const toggleCurrentPageSelection = () => {
    const pageIds = items.map((item) => item.id);
    setSelectedItemIds((current) => {
      if (currentPageSelected) return current.filter((id) => !pageIds.includes(id));
      const next = [...new Set([...current, ...pageIds])];
      if (next.length > 500) { setError('Bulk editing supports a maximum of 500 selected items.'); return current; }
      return next;
    });
  };

  const selectAllMatchingItems = async () => {
    if (total > 500) {
      setError('There are more than 500 matching items. Narrow your filters or select items page by page (maximum 500).');
      return;
    }
    setError('');
    setLoading(true);
    const ids: number[] = [];
    const pages = Math.ceil(total / 100);
    for (let targetPage = 1; targetPage <= pages; targetPage += 1) {
      const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
        body: {
          action: 'list', show_shared: !hideShared, page: targetPage, page_size: 100,
          sort_by: sortBy, sort_order: sortOrder, search,
          filters: {
            item_type_ids: filters.item_type_ids, brand_ids: filters.brand_ids,
            model_ids: filters.model_ids, employee_ids: filters.employee_ids,
            location_ids: filters.location_ids,
            ...(filters.purchase_date_from ? { purchase_date_from: filters.purchase_date_from } : {}),
            ...(filters.purchase_date_to ? { purchase_date_to: filters.purchase_date_to } : {}),
            ...(filters.warranty_date_from ? { warranty_date_from: filters.warranty_date_from } : {}),
            ...(filters.warranty_date_to ? { warranty_date_to: filters.warranty_date_to } : {}),
          },
        },
      });
      if (requestError || !Array.isArray(data?.items)) {
        setError(data?.error || requestError?.message || 'Could not select all matching items.');
        setLoading(false);
        return;
      }
      ids.push(...data.items.map((item: InventoryItem) => Number(item.id)));
    }
    setSelectedItemIds(ids);
    setLoading(false);
  };

  const openBulkForm = async () => {
    if (selectedItemIds.length < 2) return;
    setBulkError('');
    setBulkLoading(true);
    setBulkOpen(true);
    setBulkApplyEmployees(false); setBulkEmployeeIds([]); setBulkEmployeeSearch('');
    setBulkNewEmployeeInput(''); setBulkNewEmployeeNames([]); setBulkEmployeePickerError('');
    setBulkClearEmployees(false); setBulkApplyLocation(false); setBulkLocationId('');
    setBulkApplyNotes(false); setBulkNotes(''); setBulkClearNotes(false);
    const [previewResult, employeeRows, locationRows] = await Promise.all([
      supabase.functions.invoke('manage-inventory', { body: { action: 'get_many', item_ids: selectedItemIds } }),
      supabase.from('employees').select('id, full_name').order('full_name'),
      supabase.from('locations').select('id, name').order('name'),
    ]);
    if (previewResult.error || !Array.isArray(previewResult.data?.items) || employeeRows.error || locationRows.error) {
      setBulkError(previewResult.data?.error || previewResult.error?.message || 'Could not load the bulk-edit preview and selection lists.');
      setBulkLoading(false);
      return;
    }
    setBulkPreviewItems(previewResult.data.items as InventoryItem[]);
    setCreateEmployees((employeeRows.data ?? []).map((row: { id: number; full_name: string }) => ({ id: Number(row.id), full_name: row.full_name })));
    setCreateLocations((locationRows.data ?? []).map((row: { id: number; name: string }) => ({ id: Number(row.id), name: row.name })));
    setBulkLoading(false);
  };

  const addBulkEmployee = () => {
    setBulkEmployeePickerError('');
    const name = bulkNewEmployeeInput.trim();
    if (!name) return;
    if (name.length > 150) { setBulkEmployeePickerError('Employee names cannot exceed 150 characters.'); return; }
    const normalized = normalizeEmployeeSearch(name);
    const exists = createEmployees.some((employee) => normalizeEmployeeSearch(employee.full_name) === normalized)
      || bulkNewEmployeeNames.some((entry) => normalizeEmployeeSearch(entry) === normalized);
    if (exists) { setBulkEmployeePickerError(`“${name}” already exists or has already been added.`); return; }
    setBulkNewEmployeeNames((current) => [...current, name]);
    setBulkNewEmployeeInput('');
    setBulkClearEmployees(false);
  };

  const submitBulkUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBulkError('');
    if (!bulkApplyEmployees && !bulkApplyLocation && !bulkApplyNotes) {
      setBulkError('Select at least one field to update.'); return;
    }
    if (bulkApplyEmployees && !bulkClearEmployees && bulkEmployeeIds.length === 0 && bulkNewEmployeeNames.length === 0) {
      setBulkError('Choose at least one employee, or explicitly select Clear all assignments.'); return;
    }
    if (bulkApplyLocation && !bulkLocationId) { setBulkError('Select a location.'); return; }
    if (bulkApplyNotes && !bulkClearNotes && !bulkNotes.trim()) { setBulkError('Enter replacement notes or select Clear notes.'); return; }
    const item: Record<string, unknown> = {};
    if (bulkApplyLocation) item.location_id = Number(bulkLocationId);
    if (bulkApplyNotes) item.notes = bulkClearNotes ? null : (bulkNotes.trim() || null);
    setBulkSaving(true);
    const { data, error: invokeError } = await supabase.functions.invoke('manage-inventory', {
      body: {
        action: 'bulk_update', item_ids: selectedItemIds, item,
        ...(bulkApplyEmployees ? { employee_ids: bulkClearEmployees ? [] : bulkEmployeeIds, new_employee_names: bulkClearEmployees ? [] : bulkNewEmployeeNames } : {}),
      },
    });
    if (invokeError || data?.error || !data?.success) {
      let message = data?.error || invokeError?.message || 'The bulk update could not be completed.';
      const context = invokeError?.context;
      if (!data?.error && context && typeof context.clone === 'function') {
        try { const body = await context.clone().json(); message = body?.error || body?.message || message; } catch { /* no JSON response */ }
      }
      setBulkError(message); setBulkSaving(false); return;
    }
    setBulkSaving(false); setBulkOpen(false); setSelectedItemIds([]); setPage(1);
    await loadInventory();
  };

  const openExportDialog = async (type: 'standard' | 'debit') => {
    setExportType(type);
    setExportColumns(type === 'debit' ? VOUCHER_PDF_DEFAULT_COLUMNS : STANDARD_PDF_DEFAULT_COLUMNS);
    setExportEmployeeId('');
    setExportError('');
    if (type === 'debit') {
      const { data, error: employeeError } = await supabase
        .from('employees')
        .select('id, full_name')
        .order('full_name', { ascending: true });
      if (employeeError) {
        setExportError(employeeError.message);
        setExportEmployees([]);
      } else {
        setExportEmployees((data ?? []).map((employee) => ({ id: Number(employee.id), full_name: employee.full_name })));
      }
    }
  };

  const generateInventoryPdf = async () => {
    if (!exportType) return;
    if (exportColumns.length === 0) { setExportError('Select at least one column to include.'); return; }
    const selectedEmployee = exportType === 'debit'
      ? exportEmployees.find((employee) => String(employee.id) === exportEmployeeId)
      : undefined;
    if (exportType === 'debit' && !selectedEmployee) { setExportError('Select an employee for the Export Issue Voucher.'); return; }

    // Open the print window immediately from the user click so the browser does not block it.
    const printWindow = window.open('', '_blank');
    if (!printWindow) { setExportError('The PDF window was blocked. Allow pop-ups for this site and try again.'); return; }

    setExportLoading(true);
    setExportError('');
    try {
      const allRows: InventoryItem[] = [];
      let targetPages = 1;
      for (let targetPage = 1; targetPage <= targetPages; targetPage += 1) {
        const { data, error: requestError } = await supabase.functions.invoke('manage-inventory', {
          body: {
            action: 'list', show_shared: !hideShared, page: targetPage, page_size: 100,
            sort_by: sortBy, sort_order: sortOrder, search,
            filters: {
              item_type_ids: filters.item_type_ids, brand_ids: filters.brand_ids,
              model_ids: filters.model_ids, employee_ids: filters.employee_ids,
              location_ids: filters.location_ids,
              ...(filters.purchase_date_from ? { purchase_date_from: filters.purchase_date_from } : {}),
              ...(filters.purchase_date_to ? { purchase_date_to: filters.purchase_date_to } : {}),
              ...(filters.warranty_date_from ? { warranty_date_from: filters.warranty_date_from } : {}),
              ...(filters.warranty_date_to ? { warranty_date_to: filters.warranty_date_to } : {}),
            },
          },
        });
        if (requestError || !Array.isArray(data?.items)) {
          throw new Error(data?.error || requestError?.message || 'Could not load all filtered inventory items.');
        }
        allRows.push(...(data.items as InventoryItem[]));
        targetPages = Math.max(1, Number(data.total_pages ?? 1));
      }
      const title = exportType === 'debit' ? 'Χρεωστικό σημείωμα' : 'Inventory';
      printWindow.document.open();
      printWindow.document.write(buildInventoryPrintHtml(allRows, exportColumns, title, selectedEmployee?.full_name));
      printWindow.document.close();
      setExportType(null);
    } catch (caught) {
      printWindow.close();
      setExportError(caught instanceof Error ? caught.message : 'PDF export failed.');
    } finally {
      setExportLoading(false);
    }
  };

  const firstRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRecord = Math.min(page * pageSize, total);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">
            Browse and manage registered IT equipment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void openExportDialog('standard')} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <FileDown size={16} /> Export PDF
          </button>
          <button type="button" onClick={() => void openExportDialog('debit')} className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <FileDown size={16} /> Export Issue Voucher
          </button>
          <button type="button" onClick={() => void openCreateForm()} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            <Plus size={16} /> Add Item
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setColumnMenuOpen((open) => !open)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Columns3 size={16} />
              Columns
              <ChevronDown size={15} />
            </button>
            {columnMenuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close column menu"
                  className="fixed inset-0 z-20 cursor-default"
                  onClick={() => setColumnMenuOpen(false)}
                />
                <div className="absolute right-0 z-30 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">Visible columns</p>
                    <button
                      type="button"
                      onClick={resetColumns}
                      className="text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                      Reset
                    </button>
                  </div>
                  {COLUMNS.map((column) => (
                    <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.key)}
                        onChange={() => toggleColumn(column.key)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {column.label}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadInventory()}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search item code, S/N, MAC, PC name, invoice, store, EOASIS Doc. No. or notes..."
              className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={15} />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm ${
              filtersOpen || activeFilterCount > 0
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Filter size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-xs text-white">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown size={14} className={filtersOpen ? 'rotate-180' : ''} />
          </button>
          {(search || activeFilterCount > 0 || hideShared) && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-sm font-medium text-blue-600 hover:text-blue-800"
            >
              Clear all
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            {filterOptionsError && (
              <p className="text-sm text-red-600">
                Filter options could not be loaded: {filterOptionsError}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <MultiSelectFilter
                label="Item Type"
                options={itemTypes}
                selected={filters.item_type_ids}
                onChange={(value) => updateFilter('item_type_ids', value)}
                disabled={filterOptionsLoading}
              />
              <MultiSelectFilter
                label="Brand"
                options={availableBrands}
                selected={filters.brand_ids}
                onChange={(value) => updateFilter('brand_ids', value)}
                disabled={filterOptionsLoading}
              />
              <MultiSelectFilter
                label="Model"
                options={availableModels}
                selected={filters.model_ids}
                onChange={(value) => updateFilter('model_ids', value)}
                disabled={filterOptionsLoading}
              />
              <MultiSelectFilter
                label="Employee"
                options={employees}
                selected={filters.employee_ids}
                onChange={(value) => updateFilter('employee_ids', value)}
                disabled={filterOptionsLoading}
              />
              <MultiSelectFilter
                label="Location"
                options={locations}
                selected={filters.location_ids}
                onChange={(value) => updateFilter('location_ids', value)}
                disabled={filterOptionsLoading}
              />
              <label className="flex min-h-[38px] cursor-pointer items-center gap-2 rounded-lg px-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={hideShared}
                  onChange={(event) => {
                    setHideShared(event.target.checked);
                    setPage(1);
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Hide κοινόχρηστα;</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Purchase date
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    From
                    <input
                      type="date"
                      value={filters.purchase_date_from}
                      max={filters.purchase_date_to || undefined}
                      onChange={(event) => updateFilter('purchase_date_from', event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    To
                    <input
                      type="date"
                      value={filters.purchase_date_to}
                      min={filters.purchase_date_from || undefined}
                      onChange={(event) => updateFilter('purchase_date_to', event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Warranty date
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    From
                    <input
                      type="date"
                      value={filters.warranty_date_from}
                      max={filters.warranty_date_to || undefined}
                      onChange={(event) => updateFilter('warranty_date_from', event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-500">
                    To
                    <input
                      type="date"
                      value={filters.warranty_date_to}
                      min={filters.warranty_date_from || undefined}
                      onChange={(event) => updateFilter('warranty_date_to', event.target.value)}
                      className="rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-700 outline-none focus:border-blue-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-5">
          <div>
            <h2 className="font-semibold text-gray-900">Inventory list</h2>
            <p className="mt-1 text-sm text-gray-500">
              {total.toLocaleString()} items registered
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 outline-none focus:border-blue-500"
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
        </div>

        {canManageInventory && selectedItemIds.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-blue-50 px-5 py-3">
          <div className="text-sm text-blue-900"><strong>{selectedItemIds.length}</strong> item{selectedItemIds.length === 1 ? '' : 's'} selected{total > items.length ? ' across the inventory list' : ''}.</div>
          <div className="flex flex-wrap items-center gap-3">
            {total > items.length && total <= 500 && selectedItemIds.length !== total && <button type="button" onClick={() => void selectAllMatchingItems()} className="text-sm font-medium text-blue-700 underline hover:text-blue-900">Select all {total} matching items</button>}
            {total > 500 && <span className="text-xs text-blue-800">Select all is available when filters return 500 items or fewer.</span>}
            <button type="button" onClick={() => void openBulkForm()} disabled={selectedItemIds.length < 2 || bulkLoading} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{bulkLoading ? 'Loading preview…' : `Bulk edit ${selectedItemIds.length} items`}</button>
            <button type="button" onClick={() => setSelectedItemIds([])} className="text-sm text-blue-700 hover:text-blue-900">Clear selection</button>
          </div>
        </div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-20 px-4 py-3">
                  {canManageInventory && <input type="checkbox" checked={currentPageSelected} onChange={toggleCurrentPageSelection} aria-label="Select all items on this page" className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />}
                </th>
                {visibleColumnDefinitions.map((column) => (
                  <th key={column.key} className="whitespace-nowrap px-4 py-3 font-semibold">
                    {column.sortField ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.sortField)}
                        className="inline-flex items-center gap-1.5 hover:text-gray-900"
                      >
                        {column.label}
                        {sortBy === column.sortField ? (
                          <span className="text-blue-600">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                        ) : (
                          <ChevronsUpDown size={13} className="text-gray-400" />
                        )}
                      </button>
                    ) : column.key === 'notes' ? (
                      column.label
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={visibleColumnDefinitions.length + 1} className="px-5 py-12 text-center text-sm text-gray-500">
                    Loading inventory...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumnDefinitions.length + 1} className="px-5 py-12 text-center text-sm text-gray-500">
                    {total === 0 ? 'No inventory items have been registered yet.' : 'No inventory items found on this page.'}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3">
                      {canManageInventory && <div className="flex items-center gap-2">
                        <input type="checkbox" checked={selectedItemIds.includes(item.id)} onChange={(event) => setSelectedItemIds((current) => { if (!event.target.checked) return current.filter((id) => id !== item.id); if (current.length >= 500) { setError('Bulk editing supports a maximum of 500 selected items.'); return current; } return [...new Set([...current, item.id])]; })} aria-label={`Select ${item.item_code}`} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        <button type="button" onClick={() => void openEditForm(item)} title={`Edit ${item.item_code}`} aria-label={`Edit ${item.item_code}`} className="rounded-md p-1.5 text-gray-500 hover:bg-blue-50 hover:text-blue-700"><Pencil size={15} /></button>
                      </div>}
                    </td>
                    {visibleColumnDefinitions.map((column) => (
                      <td key={column.key} className={`max-w-[260px] px-4 py-3 text-gray-700 ${column.key === 'item_code' ? 'whitespace-nowrap font-medium text-blue-700' : ''} ${column.key === 'notes' ? 'min-w-[180px] whitespace-pre-wrap' : 'whitespace-nowrap'}`}>
                        {renderCell(item, column.key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-500">
            Showing {firstRecord.toLocaleString()}–{lastRecord.toLocaleString()} of {total.toLocaleString()} items
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={loading || page <= 1}
              className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous page"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="min-w-24 text-center text-sm text-gray-600">
              Page {totalPages === 0 ? 0 : page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={loading || page >= totalPages}
              className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {exportType && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <div className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{exportType === 'debit' ? 'Export Issue Voucher' : 'Export Inventory PDF'}</h2>
                <p className="mt-1 text-sm text-gray-500">Exports all {total.toLocaleString()} items matching the current search, filters and sort order.</p>
              </div>
              <button type="button" onClick={() => { if (!exportLoading) setExportType(null); }} disabled={exportLoading} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="Close"><X size={18}/></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">Columns to include</p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setExportColumns(COLUMNS.map(column => column.key))} className="text-xs font-medium text-blue-600 hover:text-blue-800">Select all</button>
                  <button type="button" onClick={() => setExportColumns([])} className="text-xs font-medium text-blue-600 hover:text-blue-800">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COLUMNS.map(column => <label key={column.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"><input type="checkbox" checked={exportColumns.includes(column.key)} onChange={event => setExportColumns(current => event.target.checked ? [...current, column.key] : current.filter(key => key !== column.key))} className="rounded border-gray-300 text-blue-600"/>{column.label}</label>)}
              </div>
              {exportType === 'debit' && <div><label className="mb-1 block text-sm font-medium text-gray-700">Employee for signature *</label><select value={exportEmployeeId} onChange={event => setExportEmployeeId(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"><option value="">Select employee</option>{exportEmployees.map(employee => <option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select><p className="mt-1 text-xs text-gray-500">The selected employee will appear in the signature area on every page, even if they are not assigned to every listed item.</p></div>}
              {exportError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{exportError}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button type="button" onClick={() => setExportType(null)} disabled={exportLoading} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void generateInventoryPdf()} disabled={exportLoading || (exportType === 'debit' && exportEmployees.length === 0)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"><FileDown size={16}/>{exportLoading ? 'Preparing…' : exportType === 'debit' ? 'Generate Export Issue Voucher' : 'Generate PDF'}</button>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <form onSubmit={submitBulkUpdate} className="my-auto w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div><h2 className="text-lg font-semibold text-gray-900">Bulk Edit Inventory</h2><p className="text-sm text-gray-500">Apply the selected changes to {selectedItemIds.length} inventory items. Unselected fields will remain untouched.</p></div>
              <button type="button" onClick={() => setBulkOpen(false)} disabled={bulkSaving} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close"><X size={18}/></button>
            </div>
            {bulkLoading ? <div className="p-8 text-center text-sm text-gray-500">Preparing preview…</div> : <div className="space-y-5 p-6">
              <div className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-800">Selected items</h3><span className="text-xs text-gray-500">{bulkPreviewItems.length} items</span></div>
                <div className="max-h-36 overflow-y-auto divide-y divide-gray-100">
                  {bulkPreviewItems.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"><span className="font-medium text-blue-700">{item.item_code}</span><span className="text-gray-600">{displayEmployees(item.employees)} · {item.location?.name ?? '—'}</span></div>)}
                </div>
              </div>

              <section className="rounded-lg border border-gray-200 p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800"><input type="checkbox" checked={bulkApplyEmployees} onChange={(e) => { setBulkApplyEmployees(e.target.checked); setBulkClearEmployees(false); }} className="rounded border-gray-300 text-blue-600"/> Employee assignments</label>
                {bulkApplyEmployees && <div className="space-y-3 pl-6">
                  <p className="text-xs text-gray-500">The selected employee assignments will replace the existing assignments on every selected item.</p>
                  <div className="flex items-center justify-between"><label className="text-sm font-medium text-gray-700">Employees to assign</label><span className="text-xs text-gray-500">{bulkEmployeeIds.length + bulkNewEmployeeNames.length} selected</span></div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                    {bulkEmployeeIds.length === 0 && bulkNewEmployeeNames.length === 0 ? <p className="p-2 text-sm text-gray-500">No employees selected yet.</p> : <div className="space-y-1">
                      {selectedEmployeeOptions.map((employee) => <div key={employee.id} className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm"><span>{employee.full_name}</span><button type="button" onClick={() => setBulkEmployeeIds(ids => ids.filter(id => id !== employee.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${employee.full_name}`}><X size={14}/></button></div>)}
                      {bulkNewEmployeeNames.map((name) => <div key={normalizeEmployeeSearch(name)} className="flex items-center justify-between rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800"><span>{name} <span className="text-xs">(new)</span></span><button type="button" onClick={() => setBulkNewEmployeeNames(names => names.filter(entry => entry !== name))} className="rounded p-1 text-blue-500 hover:bg-white" aria-label={`Remove ${name}`}><X size={14}/></button></div>)}
                    </div>}
                  </div>
                  <div><label className="mb-1 block text-sm font-medium text-gray-700">Find an existing employee</label><input value={bulkEmployeeSearch} onChange={e=>setBulkEmployeeSearch(e.target.value)} placeholder="Start typing a name…" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>
                    {bulkEmployeeSearch.trim() && <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-gray-200 p-1">{bulkEmployeeMatches.length === 0 ? <p className="px-3 py-3 text-sm text-gray-500">No available employees match your search.</p> : bulkEmployeeMatches.map(employee => <button key={employee.id} type="button" onClick={() => setBulkEmployeeIds(ids => [...ids, employee.id])} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-blue-50"><span>{employee.full_name}</span><Plus size={15} className="text-blue-600"/></button>)}{bulkAvailableEmployees.length > 10 && <p className="px-3 py-2 text-xs text-gray-500">Showing 10 of {bulkAvailableEmployees.length} matches. Refine your search.</p>}</div>}
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3"><label className="mb-2 block text-sm font-medium text-gray-700">Create a new employee and assign all selected items</label><div className="flex items-center gap-2"><input type="text" maxLength={150} value={bulkNewEmployeeInput} onChange={e=>setBulkNewEmployeeInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addBulkEmployee();}}} placeholder="Employee name" className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"/><button type="button" onClick={addBulkEmployee} disabled={!bulkNewEmployeeInput.trim()} aria-label="Add new employee" title="Add employee" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40"><Plus size={19}/></button></div>{bulkEmployeePickerError && <p role="alert" className="mt-2 text-sm text-red-600">{bulkEmployeePickerError}</p>}</div>
                  <label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" checked={bulkClearEmployees} onChange={(e) => { setBulkClearEmployees(e.target.checked); if (e.target.checked) { setBulkEmployeeIds([]); setBulkNewEmployeeNames([]); } }} className="rounded border-gray-300"/> Clear all employee assignments on selected items</label>
                </div>}
              </section>

              <section className="rounded-lg border border-gray-200 p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800"><input type="checkbox" checked={bulkApplyLocation} onChange={(e) => setBulkApplyLocation(e.target.checked)} className="rounded border-gray-300 text-blue-600"/> Location</label>
                {bulkApplyLocation && <div className="pl-6"><label className="mb-1 block text-sm font-medium text-gray-700">Replace location with</label><select value={bulkLocationId} onChange={e=>setBulkLocationId(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Select Location</option>{createLocations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></div>}
              </section>

              <section className="rounded-lg border border-gray-200 p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-800"><input type="checkbox" checked={bulkApplyNotes} onChange={(e) => setBulkApplyNotes(e.target.checked)} className="rounded border-gray-300 text-blue-600"/> Notes</label>
                {bulkApplyNotes && <div className="space-y-2 pl-6"><label className="block text-sm font-medium text-gray-700">Replace notes with</label><textarea rows={3} value={bulkNotes} disabled={bulkClearNotes} onChange={e=>setBulkNotes(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"/><label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" checked={bulkClearNotes} onChange={e=>setBulkClearNotes(e.target.checked)} className="rounded border-gray-300"/> Clear notes on selected items</label></div>}
              </section>

              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900"><strong>Preview</strong><p className="mt-1">{selectedItemIds.length} items will be processed. {bulkApplyEmployees ? `Employee assignments: ${bulkClearEmployees ? 'clear all' : [...selectedEmployeeOptions.map(x=>x.full_name), ...bulkNewEmployeeNames].join(', ') || 'none selected'}. ` : ''}{bulkApplyLocation ? `Location: ${createLocations.find(x=>String(x.id)===bulkLocationId)?.name ?? 'not selected'}. ` : ''}{bulkApplyNotes ? `Notes: ${bulkClearNotes ? 'clear' : (bulkNotes.trim() || 'empty')}.` : ''}</p></div>
            </div>}
            {bulkError && <div role="alert" aria-live="polite" className="mx-6 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{bulkError}</div>}
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4"><button type="button" onClick={() => setBulkOpen(false)} disabled={bulkSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button><button type="submit" disabled={bulkSaving || bulkLoading} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{bulkSaving ? 'Applying…' : 'Apply bulk changes'}</button></div>
          </form>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <form onSubmit={submitCreateItem} className="my-auto w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div><h2 className="text-lg font-semibold text-gray-900">Add Inventory Item</h2><p className="text-sm text-gray-500">New related records are saved only if the item is created successfully.</p></div>
              <button type="button" onClick={() => setCreateOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Close"><X size={18}/></button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <div><label className="mb-1 block text-sm font-medium text-gray-700">Item Type *</label><select value={newItemTypeName ? '__new' : createDraft.item_type_id} onChange={e=>{setNewItemTypeName('');setCreateDraft(d=>({...d,item_type_id:e.target.value==='__new'?'':e.target.value,brand_id:'',model_id:''}));}} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Select Item Type</option>{createItemTypes.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}<option value="__new">+ Create new Item Type</option></select>{(newItemTypeName || !createDraft.item_type_id) && <input value={newItemTypeName} onChange={e=>{setNewItemTypeName(e.target.value);setNewBrandName('');setNewModelName('');setCreateDraft(d=>({...d,brand_id:'',model_id:''}));}} placeholder="New Item Type name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>}</div>
              <div><label className="mb-1 block text-sm font-medium text-gray-700">Brand *</label><select disabled={!createDraft.item_type_id && !newItemTypeName.trim()} value={newBrandName ? '__new' : createDraft.brand_id} onChange={e=>{setNewBrandName('');setNewModelName('');setCreateDraft(d=>({...d,brand_id:e.target.value==='__new'?'':e.target.value,model_id:''}));}} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"><option value="">Select Brand</option>{createBrands.filter(x=>x.item_type_id===Number(createDraft.item_type_id)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}<option value="__new">+ Create new Brand</option></select>{(newBrandName || !createDraft.brand_id) && <input disabled={!createDraft.item_type_id && !newItemTypeName.trim()} value={newBrandName} onChange={e=>{setNewBrandName(e.target.value);setNewModelName('');setCreateDraft(d=>({...d,model_id:''}));}} placeholder="New Brand name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"/>}</div>
              <div><label className="mb-1 block text-sm font-medium text-gray-700">Model *</label><select disabled={!createDraft.brand_id && !newBrandName.trim()} value={newModelName ? '__new' : createDraft.model_id} onChange={e=>{setNewModelName('');setCreateDraft(d=>({...d,model_id:e.target.value==='__new'?'':e.target.value}));}} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"><option value="">Select Model</option>{createModels.filter(x=>x.brand_id===Number(createDraft.brand_id)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}<option value="__new">+ Create new Model</option></select>{(newModelName || !createDraft.model_id) && <input disabled={!createDraft.brand_id && !newBrandName.trim()} value={newModelName} onChange={e=>setNewModelName(e.target.value)} placeholder="New Model name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"/>}</div>
              <div><label className="mb-1 block text-sm font-medium text-gray-700">Location *</label><select value={newLocationName ? '__new' : createDraft.location_id} onChange={e=>{setNewLocationName('');setCreateDraft(d=>({...d,location_id:e.target.value==='__new'?'':e.target.value}));}} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">Select Location</option>{createLocations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}<option value="__new">+ Create new Location</option></select>{(newLocationName || !createDraft.location_id) && <input value={newLocationName} onChange={e=>setNewLocationName(e.target.value)} placeholder="New Location name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>}</div>
              {([['serial_number','S/N'],['mac_address','MAC'],['pc_name','PC Name'],['ip_address','IP'],['socket','SOCKET'],['document_number','EOASIS Doc. No.'],['invoice','Invoice'],['purchase_date','Purchase Date'],['warranty_until','Warranty Date'],['store','Store']] as [keyof CreateDraft,string][]).map(([key,label])=><div key={key}><label className="mb-1 block text-sm font-medium text-gray-700">{label}{key==='serial_number'?' (optional)':''}</label><input type={key==='purchase_date'||key==='warranty_until'?'date':'text'} inputMode={key==='document_number'?'numeric':undefined} value={createDraft[key]} onChange={e=>setCreateDraft(d=>({...d,[key]:e.target.value}))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/></div>)}
              <div className="md:col-span-2"><label className="mb-1 block text-sm font-medium text-gray-700">Employees</label><div className="max-h-40 overflow-y-auto rounded-lg border border-gray-300 p-2">{createEmployees.length===0?<p className="p-2 text-sm text-gray-500">No employees available.</p>:createEmployees.map(e=><label key={e.id} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700"><input type="checkbox" checked={createEmployeeIds.includes(e.id)} onChange={ev=>setCreateEmployeeIds(ids=>ev.target.checked?[...ids,e.id]:ids.filter(id=>id!==e.id))}/>{e.full_name}</label>)}</div><label className="mt-2 block text-sm font-medium text-gray-700">Add new employees (one name per line)</label><textarea rows={3} value={newEmployeeNames} onChange={e=>setNewEmployeeNames(e.target.value)} placeholder={'Employee One\nEmployee Two'} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/></div>
              <div className="md:col-span-2"><label className="mb-1 block text-sm font-medium text-gray-700">Notes</label><textarea rows={3} value={createDraft.notes} onChange={e=>setCreateDraft(d=>({...d,notes:e.target.value}))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/></div>
            </div>
            {createError && <div role="alert" aria-live="polite" className="mx-6 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createError}</div>}
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4"><button type="button" onClick={()=>setCreateOpen(false)} disabled={createSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button><button type="submit" disabled={createSaving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{createSaving?'Creating...':'Create Item'}</button></div>
          </form>
        </div>
      )}

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
          <form onSubmit={submitEditItem} className="my-auto w-full max-w-4xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Edit Inventory Item</h2>
                <p className="text-sm text-gray-500">{editingItem?.item_code ?? 'Loading item...'}</p>
              </div>
              <button type="button" onClick={() => { if (!editSaving) { setEditOpen(false); setEditingItem(null); } }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50" aria-label="Close" disabled={editSaving}><X size={18}/></button>
            </div>
            <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Item Type *</label>
                <select value={editNewItemTypeName ? '__new' : editDraft.item_type_id} onChange={e => { setEditNewItemTypeName(''); setEditNewBrandName(''); setEditNewModelName(''); setEditDraft(d => ({...d, item_type_id:e.target.value==='__new'?'':e.target.value, brand_id:'', model_id:''})); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select Item Type</option>
                  {createItemTypes.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="__new">+ Create new Item Type</option>
                </select>
                {(editNewItemTypeName || !editDraft.item_type_id) && <input value={editNewItemTypeName} onChange={e=>{setEditNewItemTypeName(e.target.value);setEditNewBrandName('');setEditNewModelName('');setEditDraft(d=>({...d,brand_id:'',model_id:''}));}} placeholder="New Item Type name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Brand *</label>
                <select disabled={!editDraft.item_type_id && !editNewItemTypeName.trim()} value={editNewBrandName ? '__new' : editDraft.brand_id} onChange={e => { setEditNewBrandName(''); setEditNewModelName(''); setEditDraft(d => ({...d, brand_id:e.target.value==='__new'?'':e.target.value, model_id:''})); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">Select Brand</option>
                  {createBrands.filter(x=>x.item_type_id===Number(editDraft.item_type_id)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="__new">+ Create new Brand</option>
                </select>
                {(editNewBrandName || !editDraft.brand_id) && <input disabled={!editDraft.item_type_id && !editNewItemTypeName.trim()} value={editNewBrandName} onChange={e=>{setEditNewBrandName(e.target.value);setEditNewModelName('');setEditDraft(d=>({...d,model_id:''}));}} placeholder="New Brand name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"/>}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Model *</label>
                <select disabled={!editDraft.brand_id && !editNewBrandName.trim()} value={editNewModelName ? '__new' : editDraft.model_id} onChange={e => { setEditNewModelName(''); setEditDraft(d => ({...d, model_id:e.target.value==='__new'?'':e.target.value})); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">Select Model</option>
                  {createModels.filter(x=>x.brand_id===Number(editDraft.brand_id)).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="__new">+ Create new Model</option>
                </select>
                {(editNewModelName || !editDraft.model_id) && <input disabled={!editDraft.brand_id && !editNewBrandName.trim()} value={editNewModelName} onChange={e=>setEditNewModelName(e.target.value)} placeholder="New Model name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"/>}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Location *</label>
                <select value={editNewLocationName ? '__new' : editDraft.location_id} onChange={e => { setEditNewLocationName(''); setEditDraft(d => ({...d, location_id:e.target.value==='__new'?'':e.target.value})); }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                  <option value="">Select Location</option>
                  {createLocations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="__new">+ Create new Location</option>
                </select>
                {(editNewLocationName || !editDraft.location_id) && <input value={editNewLocationName} onChange={e=>setEditNewLocationName(e.target.value)} placeholder="New Location name" className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>}
              </div>
              {([['serial_number','S/N'],['mac_address','MAC'],['pc_name','PC Name'],['ip_address','IP'],['socket','SOCKET'],['document_number','EOASIS Doc. No.'],['invoice','Invoice'],['purchase_date','Purchase Date'],['warranty_until','Warranty Date'],['store','Store']] as [keyof CreateDraft,string][]).map(([key,label])=><div key={key}><label className="mb-1 block text-sm font-medium text-gray-700">{label}{key==='serial_number'?' (optional)':''}</label><input type={key==='purchase_date'||key==='warranty_until'?'date':'text'} inputMode={key==='document_number'?'numeric':undefined} value={editDraft[key]} onChange={e=>setEditDraft(d=>({...d,[key]:e.target.value}))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/></div>)}
              <div className="md:col-span-2 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-sm font-medium text-gray-700">Assigned Employees</label>
                  <span className="text-xs text-gray-500">{editEmployeeIds.length + editNewEmployeeNames.length} assigned</span>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                  {editEmployeeIds.length === 0 && editNewEmployeeNames.length === 0 ? <p className="p-2 text-sm text-gray-500">No employees assigned.</p> : (
                    <div className="space-y-1">
                      {createEmployees.filter(employee => editEmployeeIds.includes(employee.id)).sort((a,b)=>a.full_name.localeCompare(b.full_name)).map(employee => (
                        <div key={employee.id} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm text-gray-700">
                          <span>{employee.full_name}</span>
                          <button type="button" onClick={() => setEditEmployeeIds(ids => ids.filter(id => id !== employee.id))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${employee.full_name}`}><X size={15}/></button>
                        </div>
                      ))}
                      {editNewEmployeeNames.map(name => (
                        <div key={normalizeEmployeeSearch(name)} className="flex items-center justify-between gap-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                          <span>{name} <span className="text-xs text-blue-600">(new)</span></span>
                          <button type="button" onClick={() => setEditNewEmployeeNames(names => names.filter(entry => entry !== name))} className="rounded p-1 text-blue-500 hover:bg-white" aria-label={`Remove ${name}`}><X size={15}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Find an existing employee</label>
                  <input value={editEmployeeSearch} onChange={e=>setEditEmployeeSearch(e.target.value)} placeholder="Start typing a name..." className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  {editEmployeeSearch.trim() && (
                    <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white p-1">
                      {editEmployeeMatches.length === 0 ? <p className="px-3 py-3 text-sm text-gray-500">No available employees match your search.</p> : editEmployeeMatches.map(employee => (
                        <button key={employee.id} type="button" onClick={() => setEditEmployeeIds(ids => [...ids, employee.id])} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-blue-50">
                          <span>{employee.full_name}</span><Plus size={15} className="text-blue-600" />
                        </button>
                      ))}
                      {editAvailableEmployees.length > 10 && <p className="px-3 py-2 text-xs text-gray-500">Showing 10 of {editAvailableEmployees.length} matches. Refine your search.</p>}
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <label className="mb-2 block text-sm font-medium text-gray-700">Create a new employee and assign the item</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={150}
                      value={editNewEmployeeInput}
                      onChange={e=>setEditNewEmployeeInput(e.target.value)}
                      onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addEditEmployees();}}}
                      placeholder="Employee name"
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={addEditEmployees}
                      disabled={!editNewEmployeeInput.trim()}
                      aria-label="Add new employee to assigned employees"
                      title="Add and assign employee"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40"
                    ><Plus size={19}/></button>
                  </div>
                  {editEmployeePickerError && <p role="alert" className="mt-2 text-sm text-red-600">{editEmployeePickerError}</p>}
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
                <textarea rows={3} value={editDraft.notes} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"/>
              </div>
            </div>
            {editError && <div role="alert" aria-live="polite" className="mx-6 mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{editError}</div>}
            <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
              <button type="button" onClick={()=>{setEditOpen(false);setEditingItem(null);}} disabled={editSaving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button type="submit" disabled={editSaving || !editingItem} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{editSaving?'Saving...':'Save Changes'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
