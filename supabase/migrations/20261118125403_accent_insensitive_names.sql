CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- ============================================================
-- SHARED NAME NORMALIZATION
-- Case-insensitive, accent-insensitive, whitespace-trimmed
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_inventory_name(
    p_name TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = ''
AS $$
    SELECT pg_catalog.lower(
        extensions.unaccent(
            'extensions.unaccent'::pg_catalog.regdictionary,
            pg_catalog.btrim(p_name)
        )
    );
$$;


-- ============================================================
-- LOCATIONS
-- ============================================================

DROP INDEX IF EXISTS public.locations_name_unique;

CREATE UNIQUE INDEX locations_name_unique
ON public.locations (
    public.normalize_inventory_name(name)
);


-- ============================================================
-- EMPLOYEES
-- ============================================================

DROP INDEX IF EXISTS public.employees_full_name_unique;

CREATE UNIQUE INDEX employees_full_name_unique
ON public.employees (
    public.normalize_inventory_name(full_name)
);


-- ============================================================
-- ITEM TYPES
-- ============================================================

DROP INDEX IF EXISTS public.item_types_name_unique;

CREATE UNIQUE INDEX item_types_name_unique
ON public.item_types (
    public.normalize_inventory_name(name)
);


-- ============================================================
-- BRANDS
-- Preserve uniqueness within each item type
-- ============================================================

DROP INDEX IF EXISTS public.brands_name_per_type_unique;

CREATE UNIQUE INDEX brands_name_per_type_unique
ON public.brands (
    item_type_id,
    public.normalize_inventory_name(name)
);


-- ============================================================
-- MODELS
-- Preserve uniqueness within each brand
-- ============================================================

DROP INDEX IF EXISTS public.models_name_per_brand_unique;

CREATE UNIQUE INDEX models_name_per_brand_unique
ON public.models (
    brand_id,
    public.normalize_inventory_name(name)
);
