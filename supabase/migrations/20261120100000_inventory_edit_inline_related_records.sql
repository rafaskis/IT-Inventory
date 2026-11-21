-- Allow editing an inventory item while creating related catalogue, location and employee records atomically.
-- Existing inventory_update_item remains the single source of truth for item updates and audit history.
CREATE OR REPLACE FUNCTION public.inventory_update_item_with_related(
    p_id BIGINT,
    p_item JSONB,
    p_employee_ids BIGINT[],
    p_new_employee_names TEXT[],
    p_new_item_type_name TEXT,
    p_new_brand_name TEXT,
    p_new_model_name TEXT,
    p_new_location_name TEXT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_item JSONB := p_item;
    v_type_id BIGINT;
    v_brand_id BIGINT;
    v_model_id BIGINT;
    v_location_id BIGINT;
    v_employee_ids BIGINT[] := COALESCE(p_employee_ids, ARRAY[]::BIGINT[]);
    v_name TEXT;
    v_employee_id BIGINT;
    v_result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id AND username = p_actor_username
          AND is_active = TRUE AND role IN ('administrator', 'inventory_manager')
    ) THEN RAISE EXCEPTION 'Inventory management access required.'; END IF;
    IF p_id IS NULL OR p_id <= 0 THEN RAISE EXCEPTION 'A valid inventory item ID is required.'; END IF;
    IF p_item IS NULL OR pg_catalog.jsonb_typeof(p_item) <> 'object' THEN
        RAISE EXCEPTION 'Invalid inventory item data.';
    END IF;

    -- Resolve/create Item Type.
    IF NULLIF(pg_catalog.btrim(p_new_item_type_name), '') IS NOT NULL THEN
        v_result := public.catalogue_create_entry('item_type', p_new_item_type_name, NULL, NULL, p_actor_id, p_actor_username);
        v_type_id := (v_result->>'id')::BIGINT;
    ELSE
        v_type_id := NULLIF(v_item->>'item_type_id', '')::BIGINT;
    END IF;
    IF v_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.item_types WHERE id = v_type_id) THEN
        RAISE EXCEPTION 'Select an Item Type or enter a new Item Type name.';
    END IF;

    -- Resolve/create Brand under the selected Item Type.
    IF NULLIF(pg_catalog.btrim(p_new_brand_name), '') IS NOT NULL THEN
        v_result := public.catalogue_create_entry('brand', p_new_brand_name, v_type_id, NULL, p_actor_id, p_actor_username);
        v_brand_id := (v_result->>'id')::BIGINT;
    ELSE
        v_brand_id := NULLIF(v_item->>'brand_id', '')::BIGINT;
    END IF;
    IF v_brand_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.brands WHERE id = v_brand_id AND item_type_id = v_type_id
    ) THEN RAISE EXCEPTION 'Select a Brand or enter a new Brand name.'; END IF;

    -- Resolve/create Model under the selected Brand.
    IF NULLIF(pg_catalog.btrim(p_new_model_name), '') IS NOT NULL THEN
        v_result := public.catalogue_create_entry('model', p_new_model_name, v_type_id, v_brand_id, p_actor_id, p_actor_username);
        v_model_id := (v_result->>'id')::BIGINT;
    ELSE
        v_model_id := NULLIF(v_item->>'model_id', '')::BIGINT;
    END IF;
    IF v_model_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.models WHERE id = v_model_id AND brand_id = v_brand_id AND item_type_id = v_type_id
    ) THEN RAISE EXCEPTION 'Select a Model or enter a new Model name.'; END IF;

    -- Resolve/create Location.
    IF NULLIF(pg_catalog.btrim(p_new_location_name), '') IS NOT NULL THEN
        v_name := pg_catalog.btrim(p_new_location_name);
        IF pg_catalog.length(v_name) > 100 THEN RAISE EXCEPTION 'Location name cannot exceed 100 characters.'; END IF;
        INSERT INTO public.locations(name, notes) VALUES (v_name, NULL) RETURNING id INTO v_location_id;
        INSERT INTO public.audit_events(entity_type, entity_id, action, actor_user_id, actor_username, changes, details)
        VALUES ('location', v_location_id::TEXT, 'location_created', p_actor_id, p_actor_username,
            pg_catalog.jsonb_build_object('name', pg_catalog.jsonb_build_object('old', NULL, 'new', v_name)),
            pg_catalog.jsonb_build_object('source', 'inventory_edit'));
    ELSE
        v_location_id := NULLIF(v_item->>'location_id', '')::BIGINT;
    END IF;
    IF v_location_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.locations WHERE id = v_location_id) THEN
        RAISE EXCEPTION 'Select a Location or enter a new Location name.';
    END IF;

    -- Create new employees and append their IDs to the requested final assignment list.
    IF pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[])) > 50 THEN
        RAISE EXCEPTION 'You can add a maximum of 50 new employees at once.';
    END IF;
    FOREACH v_name IN ARRAY COALESCE(p_new_employee_names, ARRAY[]::TEXT[])
    LOOP
        v_name := pg_catalog.btrim(v_name);
        IF v_name = '' THEN CONTINUE; END IF;
        IF pg_catalog.length(v_name) > 150 THEN RAISE EXCEPTION 'Employee names cannot exceed 150 characters.'; END IF;
        INSERT INTO public.employees(full_name) VALUES (v_name) RETURNING id INTO v_employee_id;
        v_employee_ids := pg_catalog.array_append(v_employee_ids, v_employee_id);
        INSERT INTO public.audit_events(entity_type, entity_id, action, actor_user_id, actor_username, changes, details)
        VALUES ('employee', v_employee_id::TEXT, 'employee_created', p_actor_id, p_actor_username,
            pg_catalog.jsonb_build_object('full_name', pg_catalog.jsonb_build_object('old', NULL, 'new', v_name)),
            pg_catalog.jsonb_build_object('source', 'inventory_edit'));
    END LOOP;

    v_item := v_item || pg_catalog.jsonb_build_object(
        'item_type_id', v_type_id, 'brand_id', v_brand_id,
        'model_id', v_model_id, 'location_id', v_location_id
    );
    SELECT COALESCE(pg_catalog.array_agg(DISTINCT x ORDER BY x), ARRAY[]::BIGINT[])
    INTO v_employee_ids FROM pg_catalog.unnest(v_employee_ids) AS t(x);

    v_result := public.inventory_update_item(p_id, v_item, v_employee_ids, p_actor_id, p_actor_username);
    RETURN v_result || pg_catalog.jsonb_build_object(
        'created_related', pg_catalog.jsonb_build_object(
            'item_type', NULLIF(pg_catalog.btrim(p_new_item_type_name), '') IS NOT NULL,
            'brand', NULLIF(pg_catalog.btrim(p_new_brand_name), '') IS NOT NULL,
            'model', NULLIF(pg_catalog.btrim(p_new_model_name), '') IS NOT NULL,
            'location', NULLIF(pg_catalog.btrim(p_new_location_name), '') IS NOT NULL,
            'employees', pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[]))
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_update_item_with_related(BIGINT, JSONB, BIGINT[], TEXT[], TEXT, TEXT, TEXT, TEXT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_update_item_with_related(BIGINT, JSONB, BIGINT[], TEXT[], TEXT, TEXT, TEXT, TEXT, UUID, TEXT)
TO service_role;
