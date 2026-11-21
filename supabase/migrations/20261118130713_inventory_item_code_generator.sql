-- Sequential inventory item-code generator.
-- Format: ITEM-000001, ITEM-000002, etc.

CREATE SEQUENCE IF NOT EXISTS public.inventory_item_code_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;


-- Generate the item code automatically before each insert.
CREATE OR REPLACE FUNCTION public.generate_inventory_item_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.item_code :=
        'ITEM-' ||
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


-- Attach the generator to inventory_items.
DROP TRIGGER IF EXISTS inventory_item_code_generator
ON public.inventory_items;

CREATE TRIGGER inventory_item_code_generator
BEFORE INSERT ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.generate_inventory_item_code();


-- Item codes must always exist.
ALTER TABLE public.inventory_items
ALTER COLUMN item_code SET NOT NULL;


-- Prevent application users from calling the generator directly.
REVOKE ALL ON FUNCTION public.generate_inventory_item_code()
FROM PUBLIC, anon, authenticated;