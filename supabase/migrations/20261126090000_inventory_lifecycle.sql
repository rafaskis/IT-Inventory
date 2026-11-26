-- Inventory lifecycle management.
-- Keeps one inventory_items row and its original ID throughout every lifecycle stage.
-- Lifecycle changes are performed atomically by a service-role-only RPC.

ALTER TABLE public.inventory_items
    ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN gen_118 TEXT,
    ADD COLUMN gen_118_date DATE,
    ADD COLUMN gen_36 TEXT,
    ADD COLUMN gen_36_date DATE,
    ADD COLUMN gen_32a TEXT,
    ADD COLUMN service_name TEXT,
    ADD COLUMN gen_32a_date DATE;

ALTER TABLE public.inventory_items
    ALTER COLUMN location_id DROP NOT NULL;

ALTER TABLE public.inventory_items
    ADD CONSTRAINT inventory_items_lifecycle_status_check
        CHECK (lifecycle_status IN ('active', 'pending_scrap', 'scrapped', 'gifted')),
    ADD CONSTRAINT inventory_items_lifecycle_fields_check
        CHECK (
            (
                lifecycle_status = 'active'
                AND location_id IS NOT NULL
                AND gen_118 IS NULL AND gen_118_date IS NULL
                AND gen_36 IS NULL AND gen_36_date IS NULL
                AND gen_32a IS NULL AND service_name IS NULL AND gen_32a_date IS NULL
            )
            OR
            (
                lifecycle_status = 'pending_scrap'
                AND location_id IS NULL
                AND pc_name IS NULL AND ip_address IS NULL AND socket IS NULL
                AND gen_118 IS NOT NULL AND gen_118_date IS NOT NULL
                AND gen_36 IS NULL AND gen_36_date IS NULL
                AND gen_32a IS NULL AND service_name IS NULL AND gen_32a_date IS NULL
            )
            OR
            (
                lifecycle_status = 'scrapped'
                AND location_id IS NULL
                AND pc_name IS NULL AND ip_address IS NULL AND socket IS NULL
                AND gen_118 IS NOT NULL AND gen_118_date IS NOT NULL
                AND gen_36 IS NOT NULL AND gen_36_date IS NOT NULL
                AND gen_32a IS NULL AND service_name IS NULL AND gen_32a_date IS NULL
            )
            OR
            (
                lifecycle_status = 'gifted'
                AND location_id IS NULL
                AND pc_name IS NULL AND ip_address IS NULL AND socket IS NULL
                AND gen_118 IS NULL AND gen_118_date IS NULL
                AND gen_36 IS NULL AND gen_36_date IS NULL
                AND gen_32a IS NOT NULL AND service_name IS NOT NULL AND gen_32a_date IS NOT NULL
            )
        );

CREATE INDEX inventory_items_lifecycle_created_idx
    ON public.inventory_items (lifecycle_status, created_at DESC, id);

CREATE INDEX inventory_items_lifecycle_type_idx
    ON public.inventory_items (lifecycle_status, item_type_id, brand_id, model_id);

-- Prevent normal inventory edit RPCs or direct SQL updates from changing lifecycle state
-- or modifying an item after it has left active inventory.
CREATE OR REPLACE FUNCTION public.guard_inventory_item_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.lifecycle_status <> 'active'
           AND pg_catalog.current_setting('app.inventory_lifecycle_transition', TRUE) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Items outside active inventory cannot be deleted.'
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
       AND pg_catalog.current_setting('app.inventory_lifecycle_transition', TRUE) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Inventory lifecycle changes must use the approved transition operation.'
            USING ERRCODE = '42501';
    END IF;

    IF OLD.lifecycle_status <> 'active'
       AND pg_catalog.current_setting('app.inventory_lifecycle_transition', TRUE) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Items outside active inventory are read-only.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER inventory_items_lifecycle_guard
    BEFORE UPDATE OR DELETE ON public.inventory_items
    FOR EACH ROW
    EXECUTE FUNCTION public.guard_inventory_item_lifecycle();

-- An item that has left active inventory cannot receive employee assignments.
CREATE OR REPLACE FUNCTION public.ensure_active_inventory_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_lifecycle_status TEXT;
BEGIN
    SELECT lifecycle_status
    INTO v_lifecycle_status
    FROM public.inventory_items
    WHERE id = NEW.inventory_item_id
    FOR UPDATE;

    IF NOT FOUND OR v_lifecycle_status <> 'active' THEN
        RAISE EXCEPTION 'Employee assignments are only allowed for active inventory items.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER inventory_item_employees_active_guard
    BEFORE INSERT OR UPDATE ON public.inventory_item_employees
    FOR EACH ROW
    EXECUTE FUNCTION public.ensure_active_inventory_assignment();

REVOKE ALL ON FUNCTION public.guard_inventory_item_lifecycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_active_inventory_assignment() FROM PUBLIC, anon, authenticated;

-- Atomic, one-way lifecycle transition. One common document reference is applied to every
-- selected item; each item receives its own timestamp and audit event.
CREATE OR REPLACE FUNCTION public.inventory_transition_items(
    p_item_ids BIGINT[],
    p_target_status TEXT,
    p_reference TEXT,
    p_service_name TEXT,
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
    v_transition_date DATE;
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
        v_transition_date := (v_now AT TIME ZONE 'Europe/Nicosia')::DATE;

        IF p_target_status = 'pending_scrap' THEN
            UPDATE public.inventory_items
            SET lifecycle_status = 'pending_scrap',
                gen_118 = pg_catalog.btrim(p_reference),
                gen_118_date = v_transition_date,
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
                'gen_118_date', pg_catalog.jsonb_build_object('old', NULL, 'new', v_transition_date)
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
                gen_36_date = v_transition_date,
                updated_by = p_actor_id,
                updated_at = v_now
            WHERE id = v_item.id;

            v_changes := pg_catalog.jsonb_build_object(
                'lifecycle_status', pg_catalog.jsonb_build_object('old', 'pending_scrap', 'new', 'scrapped'),
                'gen_36', pg_catalog.jsonb_build_object('old', NULL, 'new', pg_catalog.btrim(p_reference)),
                'gen_36_date', pg_catalog.jsonb_build_object('old', NULL, 'new', v_transition_date)
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
                gen_32a_date = v_transition_date,
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
                'gen_32a_date', pg_catalog.jsonb_build_object('old', NULL, 'new', v_transition_date)
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

REVOKE ALL ON FUNCTION public.inventory_transition_items(BIGINT[], TEXT, TEXT, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_transition_items(BIGINT[], TEXT, TEXT, TEXT, UUID, TEXT)
    TO service_role;


-- Keep the ordinary inventory list scoped to active items.
-- Replace the shared employee display label with English.
-- Preserve the existing inventory search, filtering, sorting and pagination logic.

CREATE OR REPLACE FUNCTION public.inventory_list_item_ids(
    p_search TEXT,
    p_item_type_ids BIGINT[],
    p_brand_ids BIGINT[],
    p_model_ids BIGINT[],
    p_location_ids BIGINT[],
    p_employee_ids BIGINT[],
    p_purchase_date_from DATE,
    p_purchase_date_to DATE,
    p_warranty_from DATE,
    p_warranty_to DATE,
    p_sort_by TEXT,
    p_sort_order TEXT,
    p_page INTEGER,
    p_page_size INTEGER,
    p_show_shared BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total BIGINT;
    v_ids JSONB;
BEGIN
    IF p_page IS NULL OR p_page < 1 OR p_page > 100000 THEN
        RAISE EXCEPTION 'Invalid page number.' USING ERRCODE = '22023';
    END IF;

    IF p_page_size IS NULL OR p_page_size < 1 OR p_page_size > 100 THEN
        RAISE EXCEPTION 'Invalid page size.' USING ERRCODE = '22023';
    END IF;

    IF p_sort_order NOT IN ('asc', 'desc') THEN
        RAISE EXCEPTION 'Invalid sort order.' USING ERRCODE = '22023';
    END IF;

    IF p_sort_by NOT IN (
        'item_code', 'item_type', 'brand', 'model', 'serial_number', 'mac_address',
        'pc_name', 'ip_address', 'socket', 'location', 'employee', 'document_number',
        'purchase_date', 'warranty_until', 'store', 'created_at', 'updated_at'
    ) THEN
        RAISE EXCEPTION 'Invalid sort field.' USING ERRCODE = '22023';
    END IF;

    IF COALESCE(cardinality(p_item_type_ids), 0) > 100
       OR COALESCE(cardinality(p_brand_ids), 0) > 100
       OR COALESCE(cardinality(p_model_ids), 0) > 100
       OR COALESCE(cardinality(p_location_ids), 0) > 100
       OR COALESCE(cardinality(p_employee_ids), 0) > 100 THEN
        RAISE EXCEPTION 'A maximum of 100 values is allowed per filter.' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_item_type_ids, ARRAY[]::BIGINT[])) AS v(id) WHERE v.id IS NULL OR v.id <= 0)
       OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_brand_ids, ARRAY[]::BIGINT[])) AS v(id) WHERE v.id IS NULL OR v.id <= 0)
       OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_model_ids, ARRAY[]::BIGINT[])) AS v(id) WHERE v.id IS NULL OR v.id <= 0)
       OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_location_ids, ARRAY[]::BIGINT[])) AS v(id) WHERE v.id IS NULL OR v.id <= 0)
       OR EXISTS (SELECT 1 FROM unnest(COALESCE(p_employee_ids, ARRAY[]::BIGINT[])) AS v(id) WHERE v.id IS NULL OR v.id <= 0) THEN
        RAISE EXCEPTION 'Filter IDs must be positive integers.' USING ERRCODE = '22023';
    END IF;

    WITH employee_summary AS (
        SELECT
            iie.inventory_item_id,
            COUNT(*)::INTEGER AS employee_count,
            MIN(e.full_name) AS single_employee_name
        FROM public.inventory_item_employees AS iie
        INNER JOIN public.employees AS e ON e.id = iie.employee_id
        GROUP BY iie.inventory_item_id
    ),
    filtered AS (
        SELECT
            ii.id,
            ii.item_code,
            ii.serial_number,
            ii.mac_address,
            ii.pc_name,
            ii.ip_address,
            ii.socket,
            ii.document_number,
            ii.purchase_date,
            ii.warranty_until,
            ii.store,
            ii.created_at,
            ii.updated_at,
            it.name AS item_type_name,
            b.name AS brand_name,
            m.name AS model_name,
            l.name AS location_name,
            CASE
                WHEN COALESCE(es.employee_count, 0) = 0 THEN ''
                WHEN es.employee_count = 1 THEN es.single_employee_name
                ELSE 'SHARED'
            END AS employee_display
        FROM public.inventory_items AS ii
        INNER JOIN public.brands AS b
            ON b.id = ii.brand_id
           AND b.item_type_id = ii.item_type_id
        INNER JOIN public.item_types AS it ON it.id = b.item_type_id
        INNER JOIN public.models AS m
            ON m.id = ii.model_id
           AND m.brand_id = ii.brand_id
           AND m.item_type_id = ii.item_type_id
        INNER JOIN public.locations AS l ON l.id = ii.location_id
        LEFT JOIN employee_summary AS es ON es.inventory_item_id = ii.id
        WHERE
            ii.lifecycle_status = 'active'
            AND (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
            AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
            AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
            AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
            AND (
                COALESCE(cardinality(p_employee_ids), 0) = 0
                OR EXISTS (
                    SELECT 1
                    FROM public.inventory_item_employees AS filter_assignment
                    WHERE filter_assignment.inventory_item_id = ii.id
                      AND filter_assignment.employee_id = ANY(p_employee_ids)
                )
            )
            AND (COALESCE(p_show_shared, TRUE) OR COALESCE(es.employee_count, 0) <= 1)
            AND (p_purchase_date_from IS NULL OR ii.purchase_date >= p_purchase_date_from)
            AND (p_purchase_date_to IS NULL OR ii.purchase_date <= p_purchase_date_to)
            AND (p_warranty_from IS NULL OR ii.warranty_until >= p_warranty_from)
            AND (p_warranty_to IS NULL OR ii.warranty_until <= p_warranty_to)
            AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
    ),
    ordered AS (
        SELECT
            f.id,
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE WHEN p_sort_order = 'asc' THEN
                        CASE p_sort_by
                            WHEN 'item_code' THEN f.item_code
                            WHEN 'item_type' THEN f.item_type_name
                            WHEN 'brand' THEN f.brand_name
                            WHEN 'model' THEN f.model_name
                            WHEN 'serial_number' THEN f.serial_number
                            WHEN 'mac_address' THEN f.mac_address
                            WHEN 'pc_name' THEN f.pc_name
                            WHEN 'ip_address' THEN f.ip_address
                            WHEN 'socket' THEN f.socket
                            WHEN 'location' THEN f.location_name
                            WHEN 'employee' THEN f.employee_display
                            WHEN 'store' THEN f.store
                        END
                    END ASC NULLS LAST,
                    CASE WHEN p_sort_order = 'desc' THEN
                        CASE p_sort_by
                            WHEN 'item_code' THEN f.item_code
                            WHEN 'item_type' THEN f.item_type_name
                            WHEN 'brand' THEN f.brand_name
                            WHEN 'model' THEN f.model_name
                            WHEN 'serial_number' THEN f.serial_number
                            WHEN 'mac_address' THEN f.mac_address
                            WHEN 'pc_name' THEN f.pc_name
                            WHEN 'ip_address' THEN f.ip_address
                            WHEN 'socket' THEN f.socket
                            WHEN 'location' THEN f.location_name
                            WHEN 'employee' THEN f.employee_display
                            WHEN 'store' THEN f.store
                        END
                    END DESC NULLS LAST,
                    CASE WHEN p_sort_order = 'asc' THEN
                        CASE WHEN p_sort_by = 'document_number' THEN f.document_number END
                    END ASC NULLS LAST,
                    CASE WHEN p_sort_order = 'desc' THEN
                        CASE WHEN p_sort_by = 'document_number' THEN f.document_number END
                    END DESC NULLS LAST,
                    CASE WHEN p_sort_order = 'asc' THEN
                        CASE p_sort_by
                            WHEN 'purchase_date' THEN f.purchase_date
                            WHEN 'warranty_until' THEN f.warranty_until
                        END
                    END ASC NULLS LAST,
                    CASE WHEN p_sort_order = 'desc' THEN
                        CASE p_sort_by
                            WHEN 'purchase_date' THEN f.purchase_date
                            WHEN 'warranty_until' THEN f.warranty_until
                        END
                    END DESC NULLS LAST,
                    CASE WHEN p_sort_order = 'asc' THEN
                        CASE p_sort_by
                            WHEN 'created_at' THEN f.created_at
                            WHEN 'updated_at' THEN f.updated_at
                        END
                    END ASC NULLS LAST,
                    CASE WHEN p_sort_order = 'desc' THEN
                        CASE p_sort_by
                            WHEN 'created_at' THEN f.created_at
                            WHEN 'updated_at' THEN f.updated_at
                        END
                    END DESC NULLS LAST,
                    f.id ASC
            ) AS row_number
        FROM filtered AS f
    )
    SELECT
        (SELECT COUNT(*) FROM filtered),
        COALESCE(
            (
                SELECT jsonb_agg(o.id ORDER BY o.row_number)
                FROM ordered AS o
                WHERE o.row_number > ((p_page - 1)::BIGINT * p_page_size)
                  AND o.row_number <= (p_page::BIGINT * p_page_size)
            ),
            '[]'::JSONB
        )
    INTO v_total, v_ids;

    RETURN jsonb_build_object('ids', v_ids, 'total', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_list_item_ids(
    TEXT, BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], DATE, DATE, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.inventory_list_item_ids(
    TEXT, BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], DATE, DATE, DATE, DATE, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO service_role;
-- Keep the ordinary inventory filter facets scoped to active items.
CREATE OR REPLACE FUNCTION public.inventory_filter_options(
    p_search TEXT,
    p_item_type_ids BIGINT[],
    p_brand_ids BIGINT[],
    p_model_ids BIGINT[],
    p_location_ids BIGINT[],
    p_employee_ids BIGINT[],
    p_show_shared BOOLEAN
)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT jsonb_build_object(
        'item_types', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
            FROM (
                SELECT DISTINCT it.id, it.name
                FROM public.inventory_items AS ii
                INNER JOIN public.item_types AS it ON it.id = ii.item_type_id
                WHERE
                    ii.lifecycle_status = 'active'
                    AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
                    AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
                    AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
                    AND (
                        COALESCE(cardinality(p_employee_ids), 0) = 0
                        OR EXISTS (
                            SELECT 1 FROM public.inventory_item_employees AS a
                            WHERE a.inventory_item_id = ii.id
                              AND a.employee_id = ANY(p_employee_ids)
                        )
                    )
                    AND (
                        COALESCE(p_show_shared, TRUE)
                        OR (
                            SELECT COUNT(*)
                            FROM public.inventory_item_employees AS shared_assignment
                            WHERE shared_assignment.inventory_item_id = ii.id
                        ) <= 1
                    )
                    AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
                UNION
                SELECT it.id, it.name
                FROM public.item_types AS it
                WHERE it.id = ANY(COALESCE(p_item_type_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB),
        'brands', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
            FROM (
                SELECT DISTINCT b.id, b.name
                FROM public.inventory_items AS ii
                INNER JOIN public.brands AS b ON b.id = ii.brand_id
                WHERE
                    ii.lifecycle_status = 'active'
                    AND (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
                    AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
                    AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
                    AND (
                        COALESCE(cardinality(p_employee_ids), 0) = 0
                        OR EXISTS (
                            SELECT 1 FROM public.inventory_item_employees AS a
                            WHERE a.inventory_item_id = ii.id
                              AND a.employee_id = ANY(p_employee_ids)
                        )
                    )
                    AND (
                        COALESCE(p_show_shared, TRUE)
                        OR (
                            SELECT COUNT(*)
                            FROM public.inventory_item_employees AS shared_assignment
                            WHERE shared_assignment.inventory_item_id = ii.id
                        ) <= 1
                    )
                    AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
                UNION
                SELECT b.id, b.name
                FROM public.brands AS b
                WHERE b.id = ANY(COALESCE(p_brand_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB),
        'models', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
            FROM (
                SELECT DISTINCT m.id, m.name
                FROM public.inventory_items AS ii
                INNER JOIN public.models AS m ON m.id = ii.model_id
                WHERE
                    ii.lifecycle_status = 'active'
                    AND (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
                    AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
                    AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
                    AND (
                        COALESCE(cardinality(p_employee_ids), 0) = 0
                        OR EXISTS (
                            SELECT 1 FROM public.inventory_item_employees AS a
                            WHERE a.inventory_item_id = ii.id
                              AND a.employee_id = ANY(p_employee_ids)
                        )
                    )
                    AND (
                        COALESCE(p_show_shared, TRUE)
                        OR (
                            SELECT COUNT(*)
                            FROM public.inventory_item_employees AS shared_assignment
                            WHERE shared_assignment.inventory_item_id = ii.id
                        ) <= 1
                    )
                    AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
                UNION
                SELECT m.id, m.name
                FROM public.models AS m
                WHERE m.id = ANY(COALESCE(p_model_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB),
        'employees', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name) ORDER BY x.full_name)
            FROM (
                SELECT DISTINCT e.id, e.full_name
                FROM public.inventory_items AS ii
                INNER JOIN public.inventory_item_employees AS a ON a.inventory_item_id = ii.id
                INNER JOIN public.employees AS e ON e.id = a.employee_id
                WHERE
                    ii.lifecycle_status = 'active'
                    AND (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
                    AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
                    AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
                    AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
                    AND (
                        COALESCE(p_show_shared, TRUE)
                        OR (
                            SELECT COUNT(*)
                            FROM public.inventory_item_employees AS shared_assignment
                            WHERE shared_assignment.inventory_item_id = ii.id
                        ) <= 1
                    )
                    AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
                UNION
                SELECT e.id, e.full_name
                FROM public.employees AS e
                WHERE e.id = ANY(COALESCE(p_employee_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB),
        'locations', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name)
            FROM (
                SELECT DISTINCT l.id, l.name
                FROM public.inventory_items AS ii
                INNER JOIN public.locations AS l ON l.id = ii.location_id
                WHERE
                    ii.lifecycle_status = 'active'
                    AND (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
                    AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
                    AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
                    AND (
                        COALESCE(cardinality(p_employee_ids), 0) = 0
                        OR EXISTS (
                            SELECT 1 FROM public.inventory_item_employees AS a
                            WHERE a.inventory_item_id = ii.id
                              AND a.employee_id = ANY(p_employee_ids)
                        )
                    )
                    AND (
                        COALESCE(p_show_shared, TRUE)
                        OR (
                            SELECT COUNT(*)
                            FROM public.inventory_item_employees AS shared_assignment
                            WHERE shared_assignment.inventory_item_id = ii.id
                        ) <= 1
                    )
                    AND (
                NULLIF(BTRIM(p_search), '') IS NULL
                OR ii.item_code ILIKE '%' || p_search || '%'
                OR ii.serial_number ILIKE '%' || p_search || '%'
                OR ii.mac_address ILIKE '%' || p_search || '%'
                OR ii.pc_name ILIKE '%' || p_search || '%'
                OR ii.invoice ILIKE '%' || p_search || '%'
                OR ii.store ILIKE '%' || p_search || '%'
                OR ii.document_number::TEXT ILIKE '%' || p_search || '%'
                OR ii.notes ILIKE '%' || p_search || '%'
            )
                UNION
                SELECT l.id, l.name
                FROM public.locations AS l
                WHERE l.id = ANY(COALESCE(p_location_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB)
    );
$$;

REVOKE ALL ON FUNCTION public.inventory_filter_options(TEXT, BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], BOOLEAN)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_filter_options(TEXT, BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[], BOOLEAN)
    TO service_role;
