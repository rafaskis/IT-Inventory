-- Improve duplicate inventory identifier validation messages.
-- The uniqueness rules and trigger behavior remain unchanged.

CREATE OR REPLACE FUNCTION public.enforce_inventory_identifier_uniqueness()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_serial TEXT := NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.serial_number)), '');
    v_mac TEXT := NULLIF(pg_catalog.lower(pg_catalog.btrim(NEW.mac_address)), '');
    v_key TEXT;
    v_keys TEXT[] := ARRAY[]::TEXT[];
BEGIN
    IF v_serial IS NOT NULL THEN
        v_keys := pg_catalog.array_append(v_keys,
            'serial|' || NEW.item_type_id::TEXT || '|' || NEW.brand_id::TEXT || '|' || NEW.model_id::TEXT || '|' || v_serial);
    END IF;
    IF v_mac IS NOT NULL THEN
        v_keys := pg_catalog.array_append(v_keys,
            'mac|' || NEW.item_type_id::TEXT || '|' || NEW.brand_id::TEXT || '|' || NEW.model_id::TEXT || '|' || v_mac);
    END IF;

    FOR v_key IN SELECT x FROM pg_catalog.unnest(v_keys) AS t(x) ORDER BY x LOOP
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
    END LOOP;

    IF v_serial IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.inventory_items i
        WHERE i.item_type_id = NEW.item_type_id
          AND i.brand_id = NEW.brand_id
          AND i.model_id = NEW.model_id
          AND pg_catalog.lower(pg_catalog.btrim(i.serial_number)) = v_serial
          AND (TG_OP = 'INSERT' OR i.id <> NEW.id)
    ) THEN
        RAISE EXCEPTION 'Another item with the same Item Type, Brand, Model and S/N already exists.';
    END IF;

    IF v_mac IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.inventory_items i
        WHERE i.item_type_id = NEW.item_type_id
          AND i.brand_id = NEW.brand_id
          AND i.model_id = NEW.model_id
          AND pg_catalog.lower(pg_catalog.btrim(i.mac_address)) = v_mac
          AND (TG_OP = 'INSERT' OR i.id <> NEW.id)
    ) THEN
        RAISE EXCEPTION 'Another item with the same Item Type, Brand, Model and MAC already exists.';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_inventory_identifier_uniqueness()
FROM PUBLIC, anon, authenticated;
