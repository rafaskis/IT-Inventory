-- Allow users to choose the document date for each lifecycle transition.
-- Replace the previous RPC signature so all callers must provide an explicit date.
DROP FUNCTION public.inventory_transition_items(BIGINT[], TEXT, TEXT, TEXT, UUID, TEXT);

CREATE FUNCTION public.inventory_transition_items(
    p_item_ids BIGINT[],
    p_target_status TEXT,
    p_reference TEXT,
    p_service_name TEXT,
    p_transition_date DATE,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_item public.inventory_items%ROWTYPE;
    v_found_count BIGINT;
    v_employee_snapshot JSONB;
    v_location_snapshot JSONB;
    v_changes JSONB;
    v_details JSONB;
    v_now TIMESTAMPTZ;
    v_action TEXT;
    v_processed JSONB := '[]'::JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Inventory management access required.' USING ERRCODE = '42501';
    END IF;

    IF p_item_ids IS NULL
       OR pg_catalog.cardinality(p_item_ids) < 1
       OR pg_catalog.cardinality(p_item_ids) > 500
       OR EXISTS (SELECT 1 FROM pg_catalog.unnest(p_item_ids) AS x(id) WHERE id IS NULL OR id <= 0)
       OR (SELECT COUNT(DISTINCT id) FROM pg_catalog.unnest(p_item_ids) AS x(id)) <> pg_catalog.cardinality(p_item_ids) THEN
        RAISE EXCEPTION 'Select between 1 and 500 unique inventory items.';
    END IF;

    IF p_target_status IS NULL OR p_target_status NOT IN ('pending_scrap', 'scrapped', 'gifted') THEN
        RAISE EXCEPTION 'Invalid inventory lifecycle transition.';
    END IF;

    IF p_reference IS NULL
       OR pg_catalog.btrim(p_reference) = ''
       OR pg_catalog.length(pg_catalog.btrim(p_reference)) > 200
       OR pg_catalog.strpos(p_reference, pg_catalog.chr(10)) > 0
       OR pg_catalog.strpos(p_reference, pg_catalog.chr(13)) > 0 THEN
        RAISE EXCEPTION 'A valid single-line document reference of up to 200 characters is required.';
    END IF;

    IF p_target_status = 'gifted' THEN
        IF p_service_name IS NULL
           OR pg_catalog.btrim(p_service_name) = ''
           OR pg_catalog.length(pg_catalog.btrim(p_service_name)) > 200
           OR pg_catalog.strpos(p_service_name, pg_catalog.chr(10)) > 0
           OR pg_catalog.strpos(p_service_name, pg_catalog.chr(13)) > 0 THEN
            RAISE EXCEPTION 'A valid single-line service name of up to 200 characters is required.';
        END IF;
        v_action := 'inventory_item_gifted';
    ELSIF p_target_status = 'pending_scrap' THEN
        IF NULLIF(pg_catalog.btrim(COALESCE(p_service_name, '')), '') IS NOT NULL THEN
            RAISE EXCEPTION 'A service name is not used for this transition.';
        END IF;
        v_action := 'inventory_item_moved_to_pending_scrap';
    ELSE
        IF NULLIF(pg_catalog.btrim(COALESCE(p_service_name, '')), '') IS NOT NULL THEN
            RAISE EXCEPTION 'A service name is not used for this transition.';
        END IF;
        v_action := 'inventory_item_scrapped';
    END IF;

    IF p_transition_date IS NULL THEN
        RAISE EXCEPTION 'A valid lifecycle date is required.';
    END IF;

    -- Lock every selected row in a deterministic order before validating any transition.
    PERFORM i.id
    FROM public.inventory_items AS i
    WHERE i.id = ANY(p_item_ids)
    ORDER BY i.id
    FOR UPDATE;

    SELECT COUNT(*) INTO v_found_count
    FROM public.inventory_items
    WHERE id = ANY(p_item_ids);

    IF v_found_count <> pg_catalog.cardinality(p_item_ids) THEN
        RAISE EXCEPTION 'One or more selected inventory items no longer exist.';
    END IF;

    -- Enable the lifecycle guard only for this transaction and this approved RPC.
    PERFORM pg_catalog.set_config('app.inventory_lifecycle_transition', 'on', TRUE);

    FOR v_item IN
        SELECT *
        FROM public.inventory_items
        WHERE id = ANY(p_item_ids)
        ORDER BY id
    LOOP
        IF (p_target_status IN ('pending_scrap', 'gifted') AND v_item.lifecycle_status <> 'active')
           OR (p_target_status = 'scrapped' AND v_item.lifecycle_status <> 'pending_scrap') THEN
            RAISE EXCEPTION 'Item % is not in the correct state for this transition. No items were changed.', v_item.item_code;
        END IF;

        SELECT COALESCE(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('id', e.id, 'full_name', e.full_name)
                ORDER BY e.full_name, e.id
            ),
            '[]'::JSONB
        )
        INTO v_employee_snapshot
        FROM public.inventory_item_employees AS a
        INNER JOIN public.employees AS e ON e.id = a.employee_id
        WHERE a.inventory_item_id = v_item.id;

        SELECT pg_catalog.jsonb_build_object('id', l.id, 'name', l.name)
        INTO v_location_snapshot
        FROM public.locations AS l
        WHERE l.id = v_item.location_id;

        v_now := pg_catalog.clock_timestamp();

        IF p_target_status = 'pending_scrap' THEN
            UPDATE public.inventory_items
            SET lifecycle_status = 'pending_scrap',
                gen_118 = pg_catalog.btrim(p_reference),
                gen_118_date = p_transition_date,
                location_id = NULL,
                pc_name = NULL,
                ip_address = NULL,
                socket = NULL,
                updated_by = p_actor_id,
                updated_at = v_now
            WHERE id = v_item.id;

            DELETE FROM public.inventory_item_employees
            WHERE inventory_item_id = v_item.id;

            v_changes := pg_catalog.jsonb_build_object(
                'lifecycle_status', pg_catalog.jsonb_build_object('old', 'active', 'new', 'pending_scrap'),
                'employee_assignments', pg_catalog.jsonb_build_object('old', v_employee_snapshot, 'new', '[]'::JSONB),
                'location', pg_catalog.jsonb_build_object('old', v_location_snapshot, 'new', NULL),
                'pc_name', pg_catalog.jsonb_build_object('old', v_item.pc_name, 'new', NULL),
                'ip_address', pg_catalog.jsonb_build_object('old', v_item.ip_address, 'new', NULL),
                'socket', pg_catalog.jsonb_build_object('old', v_item.socket, 'new', NULL),
                'gen_118', pg_catalog.jsonb_build_object('old', NULL, 'new', pg_catalog.btrim(p_reference)),
                'gen_118_date', pg_catalog.jsonb_build_object('old', NULL, 'new', p_transition_date)
            );
            v_details := pg_catalog.jsonb_build_object(
                'item_code', v_item.item_code,
                'from_status', 'active',
                'to_status', 'pending_scrap',
                'gen_118', pg_catalog.btrim(p_reference)
            );

        ELSIF p_target_status = 'scrapped' THEN
            UPDATE public.inventory_items
            SET lifecycle_status = 'scrapped',
                gen_36 = pg_catalog.btrim(p_reference),
                gen_36_date = p_transition_date,
                updated_by = p_actor_id,
                updated_at = v_now
            WHERE id = v_item.id;

            v_changes := pg_catalog.jsonb_build_object(
                'lifecycle_status', pg_catalog.jsonb_build_object('old', 'pending_scrap', 'new', 'scrapped'),
                'gen_36', pg_catalog.jsonb_build_object('old', NULL, 'new', pg_catalog.btrim(p_reference)),
                'gen_36_date', pg_catalog.jsonb_build_object('old', NULL, 'new', p_transition_date)
            );
            v_details := pg_catalog.jsonb_build_object(
                'item_code', v_item.item_code,
                'from_status', 'pending_scrap',
                'to_status', 'scrapped',
                'gen_118', v_item.gen_118,
                'gen_36', pg_catalog.btrim(p_reference)
            );

        ELSE
            UPDATE public.inventory_items
            SET lifecycle_status = 'gifted',
                gen_32a = pg_catalog.btrim(p_reference),
                service_name = pg_catalog.btrim(p_service_name),
                gen_32a_date = p_transition_date,
                location_id = NULL,
                pc_name = NULL,
                ip_address = NULL,
                socket = NULL,
                updated_by = p_actor_id,
                updated_at = v_now
            WHERE id = v_item.id;

            DELETE FROM public.inventory_item_employees
            WHERE inventory_item_id = v_item.id;

            v_changes := pg_catalog.jsonb_build_object(
                'lifecycle_status', pg_catalog.jsonb_build_object('old', 'active', 'new', 'gifted'),
                'employee_assignments', pg_catalog.jsonb_build_object('old', v_employee_snapshot, 'new', '[]'::JSONB),
                'location', pg_catalog.jsonb_build_object('old', v_location_snapshot, 'new', NULL),
                'pc_name', pg_catalog.jsonb_build_object('old', v_item.pc_name, 'new', NULL),
                'ip_address', pg_catalog.jsonb_build_object('old', v_item.ip_address, 'new', NULL),
                'socket', pg_catalog.jsonb_build_object('old', v_item.socket, 'new', NULL),
                'gen_32a', pg_catalog.jsonb_build_object('old', NULL, 'new', pg_catalog.btrim(p_reference)),
                'service_name', pg_catalog.jsonb_build_object('old', NULL, 'new', pg_catalog.btrim(p_service_name)),
                'gen_32a_date', pg_catalog.jsonb_build_object('old', NULL, 'new', p_transition_date)
            );
            v_details := pg_catalog.jsonb_build_object(
                'item_code', v_item.item_code,
                'from_status', 'active',
                'to_status', 'gifted',
                'gen_32a', pg_catalog.btrim(p_reference),
                'service_name', pg_catalog.btrim(p_service_name)
            );
        END IF;

        INSERT INTO public.audit_events (
            entity_type, entity_id, action, actor_user_id, actor_username,
            changes, details, created_at
        )
        VALUES (
            'inventory_item', v_item.id::TEXT, v_action, p_actor_id, p_actor_username,
            v_changes, v_details, v_now
        );

        v_processed := v_processed || pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'id', v_item.id,
                'item_code', v_item.item_code,
                'lifecycle_status', p_target_status
            )
        );
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'updatedCount', pg_catalog.cardinality(p_item_ids),
        'items', v_processed
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.inventory_transition_items(BIGINT[], TEXT, TEXT, TEXT, DATE, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_transition_items(BIGINT[], TEXT, TEXT, TEXT, DATE, UUID, TEXT)
    TO service_role;
