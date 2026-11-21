
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  RefreshCw,
  Tags,
  Package,
  Layers,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type ItemType = {
  id: string;
  name: string;
  inventory_count: number;
};

type Brand = {
  id: string;
  item_type_id: string;
  name: string;
  inventory_count: number;
};

type Model = {
  id: string;
  item_type_id: string;
  brand_id: string;
  name: string;
  inventory_count: number;
};

type CatalogueType = 'item_type' | 'brand' | 'model';

type CatalogueEntry = ItemType | Brand | Model;
type ApiRow = Record<string, unknown>;

export default function Catalogues() {
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [models, setModels] = useState<Model[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [activeSection, setActiveSection] =
    useState<CatalogueType>('item_type');

  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [selectedBrandId, setSelectedBrandId] = useState('');

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    inventory_count: number;
  } | null>(null);

  const filteredBrands = useMemo(
    () => brands.filter((brand) => brand.item_type_id === selectedTypeId),
    [brands, selectedTypeId]
  );

  const filteredModels = useMemo(
    () => models.filter((model) => model.brand_id === selectedBrandId),
    [models, selectedBrandId]
  );

  const loadCatalogues = async () => {
    setLoading(true);
    setError('');

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-catalogues', {
        body: { action: 'list' },
      });

    if (requestError) {
      setError(requestError.message || 'Failed to load catalogues.');
      setLoading(false);
      return;
    }

    if (!data?.success) {
      setError(data?.error || 'Failed to load catalogues.');
      setLoading(false);
      return;
    }

const nextTypes: ItemType[] = (data.itemTypes ?? []).map((item: ApiRow) => ({
  id: String(item.id),
  name: String(item.name),
  inventory_count: Number(item.inventory_count ?? 0),
}));

const nextBrands: Brand[] = (data.brands ?? []).map((brand: ApiRow) => ({
  id: String(brand.id),
  item_type_id: String(brand.item_type_id),
  name: String(brand.name),
  inventory_count: Number(brand.inventory_count ?? 0),
}));

const nextModels: Model[] = (data.models ?? []).map((model: ApiRow) => ({
  id: String(model.id),
  item_type_id: String(model.item_type_id),
  brand_id: String(model.brand_id),
  name: String(model.name),
  inventory_count: Number(model.inventory_count ?? 0),
}));

    setItemTypes(nextTypes);
    setBrands(nextBrands);
    setModels(nextModels);

    setSelectedTypeId((current) =>
      nextTypes.some((item) => item.id === current)
        ? current
        : nextTypes[0]?.id ?? ''
    );

    setSelectedBrandId((current) =>
      nextBrands.some(
        (brand) =>
          brand.id === current &&
          brand.item_type_id === selectedTypeId
      )
        ? current
        : ''
    );

    setLoading(false);
  };

  useEffect(() => {
    // Load catalogue data once when this screen mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCatalogues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      selectedBrandId &&
      !filteredBrands.some((brand) => brand.id === selectedBrandId)
    ) {
      // Clear a brand selection that no longer belongs to the selected item type.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedBrandId('');
    }
  }, [selectedTypeId, filteredBrands, selectedBrandId]);

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const getParentIds = () => ({
    itemTypeId:
      activeSection === 'brand' || activeSection === 'model'
        ? selectedTypeId
        : undefined,
    brandId:
      activeSection === 'model' ? selectedBrandId : undefined,
  });

  const createEntry = async () => {
    const name = newName.trim();

    if (!name) {
      setError('Please enter a name.');
      return;
    }

    if (activeSection === 'brand' && !selectedTypeId) {
      setError('Select an item type first.');
      return;
    }

    if (activeSection === 'model' && !selectedBrandId) {
      setError('Select a brand first.');
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-catalogues', {
        body: {
          action: 'create',
          catalogueType: activeSection,
          name,
          ...getParentIds(),
        },
      });

    if (requestError || !data?.success) {
      setError(
        data?.error ||
          requestError?.message ||
          'Unable to create entry.'
      );
      setSaving(false);
      return;
    }

    setNewName('');
    setSuccess('Entry created successfully.');
    await loadCatalogues();
    setSaving(false);
  };

  const renameEntry = async (id: string) => {
    const name = editingName.trim();

    if (!name) {
      setError('Please enter a name.');
      return;
    }

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-catalogues', {
        body: {
          action: 'rename',
          catalogueType: activeSection,
          id,
          name,
        },
      });

    if (requestError || !data?.success) {
      setError(
        data?.error ||
          requestError?.message ||
          'Unable to rename entry.'
      );
      setSaving(false);
      return;
    }

    setEditingId(null);
    setEditingName('');
    setSuccess('Entry renamed successfully.');
    await loadCatalogues();
    setSaving(false);
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

  const deleteEntry = async () => {
    if (!deleteTarget) return;

    setSaving(true);
    clearMessages();

    const { data, error: requestError } =
      await supabase.functions.invoke('manage-catalogues', {
        body: {
          action: 'delete',
          catalogueType: activeSection,
          id: deleteTarget.id,
        },
      });

    if (requestError || !data?.success) {
      setError(
        await getFunctionErrorMessage(
          requestError,
          data,
          'Unable to delete entry. It may still be in use.',
        ),
      );
      setSaving(false);
      setDeleteTarget(null);
      return;
    }

    setDeleteTarget(null);
    setSuccess('Entry deleted successfully.');
    await loadCatalogues();
    setSaving(false);
  };

  const getEntries = (): CatalogueEntry[] => {
    if (activeSection === 'item_type') return itemTypes;
    if (activeSection === 'brand') return filteredBrands;
    return filteredModels;
  };

  const sectionTitle = {
    item_type: 'Item Types',
    brand: 'Brands',
    model: 'Models',
  }[activeSection];

  const sectionDescription = {
    item_type: 'Manage the types of equipment in your inventory.',
    brand: 'Manage brands belonging to an item type.',
    model: 'Manage models belonging to a brand.',
  }[activeSection];

  const getEmptyMessage = () => {
    if (activeSection === 'item_type') {
      return 'No item types have been added yet.';
    }

    if (activeSection === 'brand') {
      return selectedTypeId
        ? 'No brands exist for this item type.'
        : 'Add an item type first.';
    }

    return selectedBrandId
      ? 'No models exist for this brand.'
      : 'Select an item type and brand first.';
  };

  const entries = getEntries();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Catalogues</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage inventory item types, brands and models.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setActiveSection('item_type');
            clearMessages();
            setEditingId(null);
          }}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
            activeSection === 'item_type'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Layers size={16} />
          Item Types
        </button>

        <button
          onClick={() => {
            setActiveSection('brand');
            clearMessages();
            setEditingId(null);
          }}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
            activeSection === 'brand'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Tags size={16} />
          Brands
        </button>

        <button
          onClick={() => {
            setActiveSection('model');
            clearMessages();
            setEditingId(null);
          }}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
            activeSection === 'model'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
          }`}
        >
          <Package size={16} />
          Models
        </button>
      </div>

      {(activeSection === 'brand' || activeSection === 'model') && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Item Type
          </label>

          <select
            value={selectedTypeId}
            onChange={(event) => {
              setSelectedTypeId(event.target.value);
              setSelectedBrandId('');
              clearMessages();
            }}
            className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            <option value="">Select an item type</option>
            {itemTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>

          {activeSection === 'model' && (
            <>
              <label className="mb-2 mt-4 block text-sm font-medium text-gray-700">
                Brand
              </label>

              <select
                value={selectedBrandId}
                onChange={(event) => {
                  setSelectedBrandId(event.target.value);
                  clearMessages();
                }}
                disabled={!selectedTypeId}
                className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select a brand</option>
                {filteredBrands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

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
            <h2 className="font-semibold text-gray-900">{sectionTitle}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {sectionDescription}
            </p>
          </div>

          <button
            onClick={() => void loadCatalogues()}
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
              if (event.key === 'Enter') void createEntry();
            }}
            placeholder={`New ${activeSection.replace('_', ' ')} name`}
            disabled={
              saving ||
              (activeSection === 'brand' && !selectedTypeId) ||
              (activeSection === 'model' && !selectedBrandId)
            }
            maxLength={100}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-gray-100"
          />

          <button
            onClick={() => void createEntry()}
            disabled={
              saving ||
              !newName.trim() ||
              (activeSection === 'brand' && !selectedTypeId) ||
              (activeSection === 'model' && !selectedBrandId)
            }
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={16} />
            Add
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">
            Loading catalogues...
          </div>
        ) : entries.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-500">
            {getEmptyMessage()}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  {editingId === entry.id ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(event) =>
                        setEditingName(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void renameEntry(entry.id);
                        }
                        if (event.key === 'Escape') {
                          setEditingId(null);
                          setEditingName('');
                        }
                      }}
                      maxLength={100}
                      autoFocus
                      className="w-full max-w-md rounded-lg border border-blue-400 px-3 py-2 text-sm outline-none"
                    />
                  ) : (
                    <span className="text-sm font-medium text-gray-800">
                      {entry.name}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {editingId !== entry.id && (
                    <div
                      className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs ${entry.inventory_count === 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-600'}`}
                      title="Assigned inventory items"
                    >
                      <Package size={14} className={entry.inventory_count === 0 ? 'text-red-600' : ''} />
                      <span className={entry.inventory_count === 0 ? 'font-semibold text-red-700' : ''}>{entry.inventory_count}</span>
                    </div>
                  )}
                  {editingId === entry.id ? (
                    <>
                      <button
                        onClick={() => void renameEntry(entry.id)}
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
                      <button
                        onClick={() => {
                          setEditingId(entry.id);
                          setEditingName(entry.name);
                          clearMessages();
                        }}
                        disabled={saving}
                        title="Rename"
                        className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        onClick={() => {
                          setDeleteTarget({
                            id: entry.id,
                            name: entry.name,
                            inventory_count: entry.inventory_count,
                          });
                          clearMessages();
                        }}
                        disabled={saving}
                        title="Delete"
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
          {entries.length} {activeSection.replace('_', ' ')}
          {entries.length === 1 ? '' : 's'}
        </div>
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Delete entry?
            </h3>

            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete{' '}
              <strong>{deleteTarget.name}</strong>?
            </p>

            {deleteTarget.inventory_count > 0 && (
              <p className="mt-3 text-sm text-red-600">
                This {activeSection === 'item_type' ? 'item type' : activeSection} currently has {deleteTarget.inventory_count}{' '}
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
                onClick={() => void deleteEntry()}
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
