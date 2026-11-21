-- Bulk edit supports only Employee assignments, Location and Notes.
-- New employees and all inventory updates are committed atomically.

CREATE OR REPLACE FUNCTION public.inventory_bulk_update_items_with_employees(
    p_item_ids BIGINT[],
    p_item JSONB,
    p_employee_ids BIGINT[],
    p_new_employee_names TEXT[],
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_name TEXT;
    v_employee_id BIGINT;
    v_employee_ids BIGINT[] := COALESCE(p_employee_ids, ARRAY[]::BIGINT[]);
    v_result JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Inventory management access required.';
    END IF;

    IF p_item IS NULL OR pg_catalog.jsonb_typeof(p_item) <> 'object' THEN
        RAISE EXCEPTION 'Invalid bulk update data.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(p_item) AS k(key)
        WHERE key NOT IN ('location_id', 'notes')
    ) THEN
        RAISE EXCEPTION 'Bulk editing supports only Employee, Location and Notes.';
    END IF;

    IF p_item ? 'location_id' AND
       (pg_catalog.jsonb_typeof(p_item->'location_id') <> 'number' OR
        (p_item->>'location_id')::BIGINT <= 0) THEN
        RAISE EXCEPTION 'Select a valid Location.';
    END IF;

    IF p_item ? 'notes' AND
       pg_catalog.jsonb_typeof(p_item->'notes') NOT IN ('string', 'null') THEN
        RAISE EXCEPTION 'Notes must be text or null.';
    END IF;

    IF p_item = '{}'::JSONB AND p_employee_ids IS NULL AND
       pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[])) = 0 THEN
        RAISE EXCEPTION 'No changes were specified.';
    END IF;

    IF pg_catalog.cardinality(COALESCE(p_item_ids, ARRAY[]::BIGINT[])) = 0 OR
       pg_catalog.cardinality(p_item_ids) > 500 THEN
        RAISE EXCEPTION 'Select between 1 and 500 inventory items.';
    END IF;

    IF pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[])) > 50 THEN
        RAISE EXCEPTION 'You can add a maximum of 50 new employees at once.';
    END IF;

    IF pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[])) > 0 AND p_employee_ids IS NULL THEN
        RAISE EXCEPTION 'Employee assignments must be enabled when creating employees.';
    END IF;

    FOREACH v_name IN ARRAY COALESCE(p_new_employee_names, ARRAY[]::TEXT[])
    LOOP
        v_name := pg_catalog.btrim(v_name);
        IF v_name = '' THEN CONTINUE; END IF;
        IF pg_catalog.length(v_name) > 150 THEN
            RAISE EXCEPTION 'Employee names cannot exceed 150 characters.';
        END IF;
        INSERT INTO public.employees(full_name) VALUES (v_name) RETURNING id INTO v_employee_id;
        v_employee_ids := pg_catalog.array_append(v_employee_ids, v_employee_id);
        INSERT INTO public.audit_events(entity_type, entity_id, action, actor_user_id, actor_username, changes, details)
        VALUES (
            'employee', v_employee_id::TEXT, 'employee_created', p_actor_id, p_actor_username,
            pg_catalog.jsonb_build_object('full_name', pg_catalog.jsonb_build_object('old', NULL, 'new', v_name)),
            pg_catalog.jsonb_build_object('source', 'inventory_bulk_update')
        );
    END LOOP;

    SELECT COALESCE(pg_catalog.array_agg(DISTINCT employee_id ORDER BY employee_id), ARRAY[]::BIGINT[])
    INTO v_employee_ids
    FROM pg_catalog.unnest(v_employee_ids) AS u(employee_id);

    v_result := public.inventory_bulk_update_items(
        p_item_ids, p_item,
        CASE WHEN p_employee_ids IS NULL THEN NULL ELSE v_employee_ids END,
        p_actor_id, p_actor_username
    );

    RETURN v_result || pg_catalog.jsonb_build_object(
        'created_employee_count', pg_catalog.cardinality(COALESCE(p_new_employee_names, ARRAY[]::TEXT[]))
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_bulk_update_items_with_employees(
    BIGINT[], JSONB, BIGINT[], TEXT[], UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_bulk_update_items_with_employees(
    BIGINT[], JSONB, BIGINT[], TEXT[], UUID, TEXT
) TO service_role;
