-- Switch inventory item codes from ITEM- to MJPO-.
-- Preserve existing item IDs and regenerate codes from their numeric IDs.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'inventory_items'
          AND column_name = 'item_code'
          AND is_generated = 'ALWAYS'
    ) THEN
        ALTER TABLE public.inventory_items
            ALTER COLUMN item_code DROP EXPRESSION;
    END IF;
END;
$$;

UPDATE public.inventory_items
SET item_code = 'MJPO-' || pg_catalog.lpad(id::TEXT, 6, '0');

CREATE OR REPLACE FUNCTION public.generate_inventory_item_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.item_code :=
        'MJPO-' ||
        pg_catalog.lpad(
            pg_catalog.nextval(
                'public.inventory_item_code_seq'::pg_catalog.regclass
            )::TEXT,
            6,
            '0'
        );

    RETURN NEW;
END;
$$;

-- Both environments are confirmed empty. Start the new prefix at MJPO-000001.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.inventory_items) THEN
        ALTER SEQUENCE public.inventory_item_code_seq RESTART WITH 1;
    END IF;
END;
$$;
