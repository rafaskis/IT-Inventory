-- Atomic administrator-only inventory batch import.
-- Uses the existing catalogue and inventory transaction functions so all
-- normal validation, identifier checks, item codes and audit records remain active.

CREATE OR REPLACE FUNCTION public.inventory_batch_import(
    p_rows JSONB,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_row JSONB;
    v_row_number INTEGER;
    v_item_type TEXT;
    v_brand TEXT;
    v_model TEXT;
    v_serial TEXT;
    v_mac TEXT;
    v_eoasis TEXT;
    v_invoice TEXT;
    v_purchase_text TEXT;
    v_warranty_text TEXT;
    v_store TEXT;
    v_location TEXT;
    v_purchase_date DATE;
    v_warranty_date DATE;
    v_document_number INTEGER;
    v_type_id BIGINT;
    v_brand_id BIGINT;
    v_model_id BIGINT;
    v_location_id BIGINT;
    v_canonical TEXT;
    v_result JSONB;
    v_conflicts JSONB := '[]'::JSONB;
    v_created JSONB := '[]'::JSONB;
    v_count INTEGER := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id AND username = p_actor_username
          AND is_active = TRUE AND role = 'administrator'
    ) THEN
        RAISE EXCEPTION 'Only active administrators can import inventory.';
    END IF;

    IF p_rows IS NULL OR pg_catalog.jsonb_typeof(p_rows) <> 'array'
       OR pg_catalog.jsonb_array_length(p_rows) < 1
       OR pg_catalog.jsonb_array_length(p_rows) > 1000 THEN
        RAISE EXCEPTION 'The import must contain between 1 and 1,000 inventory rows.';
    END IF;

    -- Prevent catalogue or inventory writes from racing final validation.
    LOCK TABLE public.item_types, public.brands, public.models,
        public.locations, public.inventory_items IN SHARE ROW EXCLUSIVE MODE;

    CREATE TEMP TABLE inventory_batch_rows (
        row_number INTEGER PRIMARY KEY,
        item_type TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        serial_number TEXT,
        mac_address TEXT,
        document_number INTEGER,
        invoice TEXT,
        purchase_date DATE,
        warranty_until DATE,
        store TEXT,
        location TEXT NOT NULL
    ) ON COMMIT DROP;

    FOR v_row IN SELECT value FROM pg_catalog.jsonb_array_elements(p_rows)
    LOOP
        v_type_id := NULL; v_brand_id := NULL; v_model_id := NULL; v_location_id := NULL;
        v_item_type := pg_catalog.btrim(COALESCE(v_row->>'itemType', ''));
        v_brand := pg_catalog.btrim(COALESCE(v_row->>'brand', ''));
        v_model := pg_catalog.btrim(COALESCE(v_row->>'model', ''));
        v_serial := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'serialNumber', '')), '');
        v_mac := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'macAddress', '')), '');
        v_eoasis := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'eoasis', '')), '');
        v_invoice := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'invoice', '')), '');
        v_purchase_text := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'purchaseDate', '')), '');
        v_warranty_text := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'warrantyDate', '')), '');
        v_store := NULLIF(pg_catalog.btrim(COALESCE(v_row->>'store', '')), '');
        v_location := pg_catalog.btrim(COALESCE(v_row->>'location', ''));

        BEGIN
            v_row_number := (v_row->>'rowNumber')::INTEGER;
        EXCEPTION WHEN OTHERS THEN
            v_row_number := NULL;
        END;
        IF v_row_number IS NULL OR v_row_number < 2 THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', COALESCE(v_row_number, 0), 'field', 'Row', 'type', 'invalid', 'message', 'Invalid Excel row number.'));
            CONTINUE;
        END IF;

        IF v_item_type = '' OR v_brand = '' OR v_model = '' OR v_location = '' THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'Required fields', 'type', 'invalid', 'message', 'Item Type, Brand, Model and Location are required.'));
            CONTINUE;
        END IF;
        IF pg_catalog.length(v_item_type) > 100 OR pg_catalog.length(v_brand) > 100
           OR pg_catalog.length(v_model) > 100 OR pg_catalog.length(v_location) > 100 THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'Catalogue / Location', 'type', 'invalid', 'message', 'Item Type, Brand, Model and Location names cannot exceed 100 characters.'));
            CONTINUE;
        END IF;
        IF v_serial IS NOT NULL AND pg_catalog.length(v_serial) > 500 THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'S/N', 'type', 'invalid', 'message', 'S/N cannot exceed 500 characters.'));
            CONTINUE;
        END IF;
        IF v_mac IS NOT NULL THEN
            IF v_mac ~* '^[0-9a-f]{12}$' THEN
                v_mac := pg_catalog.upper(pg_catalog.substr(v_mac, 1, 2) || ':' || pg_catalog.substr(v_mac, 3, 2) || ':' || pg_catalog.substr(v_mac, 5, 2) || ':' || pg_catalog.substr(v_mac, 7, 2) || ':' || pg_catalog.substr(v_mac, 9, 2) || ':' || pg_catalog.substr(v_mac, 11, 2));
            ELSIF v_mac !~* '^([0-9a-f]{2}:){5}[0-9a-f]{2}$' THEN
                v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'MAC Address', 'type', 'invalid', 'message', 'MAC address must contain 12 hexadecimal characters, e.g. 00:1A:2B:3C:4D:5E.'));
                CONTINUE;
            ELSE
                v_mac := pg_catalog.upper(v_mac);
            END IF;
        END IF;
        IF v_eoasis IS NOT NULL THEN
            IF v_eoasis !~ '^[0-9]+$' THEN
                v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'EOASIS', 'type', 'invalid', 'message', 'EOASIS must be a whole number or empty.'));
                CONTINUE;
            END IF;
            BEGIN v_document_number := v_eoasis::INTEGER;
            EXCEPTION WHEN OTHERS THEN
                v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'EOASIS', 'type', 'invalid', 'message', 'EOASIS is outside the supported whole-number range.'));
                CONTINUE;
            END;
        ELSE v_document_number := NULL;
        END IF;
        BEGIN
            v_purchase_date := CASE WHEN v_purchase_text IS NULL THEN NULL ELSE v_purchase_text::DATE END;
            v_warranty_date := CASE WHEN v_warranty_text IS NULL THEN NULL ELSE v_warranty_text::DATE END;
        EXCEPTION WHEN OTHERS THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'Purchase Date / Warranty Date', 'type', 'invalid', 'message', 'Dates must be valid Excel dates.'));
            CONTINUE;
        END;

        -- Resolve canonical Item Type name from the database or first workbook occurrence.
        SELECT id, name INTO v_type_id, v_canonical FROM public.item_types
        WHERE public.normalize_inventory_name(name) = public.normalize_inventory_name(v_item_type)
        LIMIT 1;
        IF FOUND THEN v_item_type := v_canonical;
        ELSE
            SELECT item_type INTO v_canonical FROM pg_temp.inventory_batch_rows
            WHERE public.normalize_inventory_name(item_type) = public.normalize_inventory_name(v_item_type)
            ORDER BY row_number LIMIT 1;
            IF FOUND THEN v_item_type := v_canonical; END IF;
        END IF;

        -- Resolve Brand within its Item Type parent.
        v_brand_id := NULL;
        IF v_type_id IS NOT NULL THEN
            SELECT id, name INTO v_brand_id, v_canonical FROM public.brands
            WHERE item_type_id = v_type_id
              AND public.normalize_inventory_name(name) = public.normalize_inventory_name(v_brand)
            LIMIT 1;
        END IF;
        IF v_brand_id IS NOT NULL THEN v_brand := v_canonical;
        ELSE
            SELECT brand INTO v_canonical FROM pg_temp.inventory_batch_rows
            WHERE public.normalize_inventory_name(item_type) = public.normalize_inventory_name(v_item_type)
              AND public.normalize_inventory_name(brand) = public.normalize_inventory_name(v_brand)
            ORDER BY row_number LIMIT 1;
            IF FOUND THEN v_brand := v_canonical; END IF;
        END IF;

        -- Resolve Model within its Brand parent.
        v_model_id := NULL;
        IF v_type_id IS NOT NULL AND v_brand_id IS NOT NULL THEN
            SELECT id, name INTO v_model_id, v_canonical FROM public.models
            WHERE item_type_id = v_type_id AND brand_id = v_brand_id
              AND public.normalize_inventory_name(name) = public.normalize_inventory_name(v_model)
            LIMIT 1;
        END IF;
        IF v_model_id IS NOT NULL THEN v_model := v_canonical;
        ELSE
            SELECT model INTO v_canonical FROM pg_temp.inventory_batch_rows
            WHERE public.normalize_inventory_name(item_type) = public.normalize_inventory_name(v_item_type)
              AND public.normalize_inventory_name(brand) = public.normalize_inventory_name(v_brand)
              AND public.normalize_inventory_name(model) = public.normalize_inventory_name(v_model)
            ORDER BY row_number LIMIT 1;
            IF FOUND THEN v_model := v_canonical; END IF;
        END IF;

        -- Resolve Location.
        SELECT id, name INTO v_location_id, v_canonical FROM public.locations
        WHERE public.normalize_inventory_name(name) = public.normalize_inventory_name(v_location)
        LIMIT 1;
        IF FOUND THEN v_location := v_canonical;
        ELSE
            SELECT location INTO v_canonical FROM pg_temp.inventory_batch_rows
            WHERE public.normalize_inventory_name(location) = public.normalize_inventory_name(v_location)
            ORDER BY row_number LIMIT 1;
            IF FOUND THEN v_location := v_canonical; END IF;
        END IF;

        -- Existing S/N and MAC uniqueness follows the app's exact rule:
        -- same Item Type + Brand + Model, case-insensitive and trimmed.
        IF v_serial IS NOT NULL AND v_type_id IS NOT NULL AND v_brand_id IS NOT NULL AND v_model_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.item_type_id = v_type_id AND i.brand_id = v_brand_id AND i.model_id = v_model_id AND pg_catalog.lower(pg_catalog.btrim(i.serial_number)) = pg_catalog.lower(v_serial)) THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'S/N', 'type', 'existing_identifier', 'message', 'This S/N is already used by an item with the same Item Type, Brand and Model.'));
        END IF;
        IF v_mac IS NOT NULL AND v_type_id IS NOT NULL AND v_brand_id IS NOT NULL AND v_model_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM public.inventory_items i WHERE i.item_type_id = v_type_id AND i.brand_id = v_brand_id AND i.model_id = v_model_id AND pg_catalog.lower(pg_catalog.btrim(i.mac_address)) = pg_catalog.lower(v_mac)) THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'MAC Address', 'type', 'existing_identifier', 'message', 'This MAC address is already used by an item with the same Item Type, Brand and Model.'));
        END IF;
        IF v_serial IS NOT NULL AND EXISTS (SELECT 1 FROM pg_temp.inventory_batch_rows r WHERE public.normalize_inventory_name(r.item_type) = public.normalize_inventory_name(v_item_type) AND public.normalize_inventory_name(r.brand) = public.normalize_inventory_name(v_brand) AND public.normalize_inventory_name(r.model) = public.normalize_inventory_name(v_model) AND pg_catalog.lower(pg_catalog.btrim(r.serial_number)) = pg_catalog.lower(v_serial)) THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'S/N', 'type', 'within_file_identifier', 'message', 'This S/N is duplicated in another row for the same Item Type, Brand and Model.'));
        END IF;
        IF v_mac IS NOT NULL AND EXISTS (SELECT 1 FROM pg_temp.inventory_batch_rows r WHERE public.normalize_inventory_name(r.item_type) = public.normalize_inventory_name(v_item_type) AND public.normalize_inventory_name(r.brand) = public.normalize_inventory_name(v_brand) AND public.normalize_inventory_name(r.model) = public.normalize_inventory_name(v_model) AND pg_catalog.lower(pg_catalog.btrim(r.mac_address)) = pg_catalog.lower(v_mac)) THEN
            v_conflicts := v_conflicts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', v_row_number, 'field', 'MAC Address', 'type', 'within_file_identifier', 'message', 'This MAC address is duplicated in another row for the same Item Type, Brand and Model.'));
        END IF;

        INSERT INTO pg_temp.inventory_batch_rows VALUES (
            v_row_number, v_item_type, v_brand, v_model, v_serial, v_mac,
            v_document_number, v_invoice, v_purchase_date, v_warranty_date, v_store, v_location
        );
    END LOOP;

    IF pg_catalog.jsonb_array_length(v_conflicts) > 0 THEN
        RETURN pg_catalog.jsonb_build_object('success', FALSE, 'conflicts', v_conflicts);
    END IF;

    -- All rows are valid. Create/reuse catalogues and locations, then create
    -- each inventory item through the existing transactional create function.
    FOR v_row IN SELECT pg_catalog.to_jsonb(r) FROM pg_temp.inventory_batch_rows r ORDER BY r.row_number
    LOOP
        SELECT id INTO v_type_id FROM public.item_types
        WHERE public.normalize_inventory_name(name) = public.normalize_inventory_name(v_row->>'item_type') LIMIT 1;
        IF v_type_id IS NULL THEN
            v_result := public.catalogue_create_entry('item_type', v_row->>'item_type', NULL, NULL, p_actor_id, p_actor_username);
            v_type_id := (v_result->>'id')::BIGINT;
            UPDATE public.audit_events SET details = details || pg_catalog.jsonb_build_object('source', 'batch_import', 'source_row', (v_row->>'row_number')::INTEGER)
            WHERE entity_type = 'catalog' AND entity_id = v_type_id::TEXT AND action = 'catalogue_entry_created';
        END IF;

        SELECT id INTO v_brand_id FROM public.brands
        WHERE item_type_id = v_type_id AND public.normalize_inventory_name(name) = public.normalize_inventory_name(v_row->>'brand') LIMIT 1;
        IF v_brand_id IS NULL THEN
            v_result := public.catalogue_create_entry('brand', v_row->>'brand', v_type_id, NULL, p_actor_id, p_actor_username);
            v_brand_id := (v_result->>'id')::BIGINT;
            UPDATE public.audit_events SET details = details || pg_catalog.jsonb_build_object('source', 'batch_import', 'source_row', (v_row->>'row_number')::INTEGER)
            WHERE entity_type = 'catalog' AND entity_id = v_brand_id::TEXT AND action = 'catalogue_entry_created';
        END IF;

        SELECT id INTO v_model_id FROM public.models
        WHERE item_type_id = v_type_id AND brand_id = v_brand_id
          AND public.normalize_inventory_name(name) = public.normalize_inventory_name(v_row->>'model') LIMIT 1;
        IF v_model_id IS NULL THEN
            v_result := public.catalogue_create_entry('model', v_row->>'model', v_type_id, v_brand_id, p_actor_id, p_actor_username);
            v_model_id := (v_result->>'id')::BIGINT;
            UPDATE public.audit_events SET details = details || pg_catalog.jsonb_build_object('source', 'batch_import', 'source_row', (v_row->>'row_number')::INTEGER)
            WHERE entity_type = 'catalog' AND entity_id = v_model_id::TEXT AND action = 'catalogue_entry_created';
        END IF;

        SELECT id INTO v_location_id FROM public.locations
        WHERE public.normalize_inventory_name(name) = public.normalize_inventory_name(v_row->>'location') LIMIT 1;
        IF v_location_id IS NULL THEN
            INSERT INTO public.locations(name, notes) VALUES (v_row->>'location', NULL) RETURNING id INTO v_location_id;
            INSERT INTO public.audit_events(entity_type, entity_id, action, actor_user_id, actor_username, changes, details)
            VALUES ('location', v_location_id::TEXT, 'location_created', p_actor_id, p_actor_username,
                pg_catalog.jsonb_build_object('name', pg_catalog.jsonb_build_object('old', NULL, 'new', v_row->>'location')),
                pg_catalog.jsonb_build_object('source', 'batch_import', 'source_row', (v_row->>'row_number')::INTEGER));
        END IF;

        v_result := public.inventory_create_item(
            pg_catalog.jsonb_build_object(
                'item_type_id', v_type_id, 'brand_id', v_brand_id, 'model_id', v_model_id,
                'serial_number', v_row->>'serial_number', 'mac_address', v_row->>'mac_address',
                'document_number', v_row->>'document_number', 'invoice', v_row->>'invoice',
                'purchase_date', v_row->>'purchase_date', 'warranty_until', v_row->>'warranty_until',
                'store', v_row->>'store', 'location_id', v_location_id
            ), ARRAY[]::BIGINT[], p_actor_id, p_actor_username
        );
        UPDATE public.audit_events SET details = details || pg_catalog.jsonb_build_object('source', 'batch_import', 'source_row', (v_row->>'row_number')::INTEGER)
        WHERE entity_type = 'inventory_item' AND entity_id = (v_result->>'id') AND action = 'inventory_item_created';

        v_count := v_count + 1;
        v_created := v_created || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('rowNumber', (v_row->>'row_number')::INTEGER, 'id', v_result->>'id', 'itemCode', v_result->>'item_code'));
    END LOOP;

    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'createdCount', v_count, 'created', v_created);
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_batch_import(JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_batch_import(JSONB, UUID, TEXT) TO service_role;
