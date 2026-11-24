-- Atomic, administrator-only batch import for employees.
-- Existing employee create/rename/delete functions remain unchanged.

CREATE OR REPLACE FUNCTION public.employee_batch_import(
    p_rows JSONB,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_row JSONB;
    v_full_name TEXT;
    v_normalized TEXT;
    v_seen JSONB := '{}'::JSONB;
    v_conflicts JSONB := '[]'::JSONB;
    v_created JSONB := '[]'::JSONB;
    v_id BIGINT;
    v_row_number INTEGER;
    v_existing RECORD;
    v_count INTEGER := 0;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_actor_id
          AND p.username = p_actor_username
          AND p.is_active = TRUE
          AND p.role = 'administrator'
    ) THEN
        RAISE EXCEPTION 'Only active administrators can import employees.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The import must be a JSON array.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 1000 THEN
        RAISE EXCEPTION 'The import must contain between 1 and 1,000 rows.' USING ERRCODE = '22023';
    END IF;

    -- Serialize imports and ordinary employee writes during final validation and insert.
    LOCK TABLE public.employees IN SHARE ROW EXCLUSIVE MODE;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        v_count := v_count + 1;
        v_row_number := COALESCE(NULLIF(v_row->>'rowNumber', '')::INTEGER, v_count + 1);
        v_full_name := BTRIM(COALESCE(v_row->>'fullName', ''));

        IF v_full_name = '' THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'invalid',
                'message', 'Employee name is required.'
            ));
            CONTINUE;
        END IF;
        IF LENGTH(v_full_name) > 200 THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'invalid',
                'message', 'Employee name cannot exceed 200 characters.'
            ));
            CONTINUE;
        END IF;

        v_normalized := public.normalize_inventory_name(v_full_name);

        SELECT e.id, e.full_name INTO v_existing
        FROM public.employees e
        WHERE public.normalize_inventory_name(e.full_name) = v_normalized
        LIMIT 1;

        IF FOUND THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'existing',
                'existing', jsonb_build_object('id', v_existing.id, 'full_name', v_existing.full_name),
                'message', 'An employee with an equivalent name already exists.'
            ));
        ELSIF v_seen ? v_normalized THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'within_file',
                'firstRowNumber', (v_seen->>v_normalized)::INTEGER,
                'message', 'This employee duplicates another row in the uploaded file.'
            ));
        ELSE
            v_seen := v_seen || jsonb_build_object(v_normalized, v_row_number);
        END IF;
    END LOOP;

    IF jsonb_array_length(v_conflicts) > 0 THEN
        RETURN jsonb_build_object('success', FALSE, 'conflicts', v_conflicts);
    END IF;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_number := COALESCE(NULLIF(v_row->>'rowNumber', '')::INTEGER, 0);
        v_full_name := BTRIM(v_row->>'fullName');

        INSERT INTO public.employees (full_name)
        VALUES (v_full_name)
        RETURNING id INTO v_id;

        INSERT INTO public.audit_events (
            entity_type, entity_id, action, actor_user_id, actor_username, changes, details
        ) VALUES (
            'employee', v_id::TEXT, 'employee_created', p_actor_id, p_actor_username,
            jsonb_build_object(
                'full_name',
                jsonb_build_object('old', NULL, 'new', v_full_name)
            ),
            jsonb_build_object('source', 'batch_import', 'source_row', v_row_number)
        );

        v_created := v_created || jsonb_build_array(jsonb_build_object('id', v_id, 'full_name', v_full_name));
    END LOOP;

    RETURN jsonb_build_object(
        'success', TRUE,
        'createdCount', jsonb_array_length(v_created),
        'created', v_created
    );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_batch_import(JSONB, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.employee_batch_import(JSONB, UUID, TEXT)
TO service_role;
