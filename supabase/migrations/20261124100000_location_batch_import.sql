-- Atomic, administrator-only batch import for locations.
-- Existing location CRUD functions and their audit behaviour remain unchanged.

CREATE OR REPLACE FUNCTION public.location_batch_import(
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
    v_name TEXT;
    v_notes TEXT;
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
        RAISE EXCEPTION 'Only active administrators can import locations.' USING ERRCODE = '42501';
    END IF;

    IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The import must be a JSON array.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_rows) < 1 OR jsonb_array_length(p_rows) > 1000 THEN
        RAISE EXCEPTION 'The import must contain between 1 and 1,000 rows.' USING ERRCODE = '22023';
    END IF;

    -- Prevent concurrent normal creates/imports from slipping between validation and insertion.
    LOCK TABLE public.locations IN SHARE ROW EXCLUSIVE MODE;

    FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
    LOOP
        v_count := v_count + 1;
        v_row_number := COALESCE(NULLIF(v_row->>'rowNumber', '')::INTEGER, v_count + 1);
        v_name := BTRIM(COALESCE(v_row->>'name', ''));
        v_notes := NULLIF(BTRIM(COALESCE(v_row->>'notes', '')), '');

        IF v_name = '' THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('rowNumber', v_row_number, 'type', 'invalid', 'message', 'Location name is required.'));
            CONTINUE;
        END IF;
        IF LENGTH(v_name) > 200 THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('rowNumber', v_row_number, 'type', 'invalid', 'message', 'Location name cannot exceed 200 characters.'));
            CONTINUE;
        END IF;

        v_normalized := public.normalize_inventory_name(v_name);
        SELECT l.id, l.name, l.notes INTO v_existing
        FROM public.locations l
        WHERE public.normalize_inventory_name(l.name) = v_normalized
        LIMIT 1;

        IF FOUND THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'existing',
                'existing', jsonb_build_object('id', v_existing.id, 'name', v_existing.name, 'notes', v_existing.notes),
                'message', 'A location with an equivalent name already exists.'
            ));
        ELSIF v_seen ? v_normalized THEN
            v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
                'rowNumber', v_row_number, 'type', 'within_file',
                'firstRowNumber', (v_seen->>v_normalized)::INTEGER,
                'message', 'This location duplicates another row in the uploaded file.'
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
        v_name := BTRIM(v_row->>'name');
        v_notes := NULLIF(BTRIM(COALESCE(v_row->>'notes', '')), '');

        INSERT INTO public.locations (name, notes)
        VALUES (v_name, v_notes)
        RETURNING id INTO v_id;

        INSERT INTO public.audit_events (
            entity_type, entity_id, action, actor_user_id, actor_username, changes, details
        ) VALUES (
            'location', v_id::TEXT, 'location_created', p_actor_id, p_actor_username,
            jsonb_build_object('old', NULL, 'new', jsonb_build_object('name', v_name, 'notes', v_notes)),
            jsonb_build_object('source', 'batch_import', 'source_row', v_row_number)
        );

        v_created := v_created || jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_name));
    END LOOP;

    RETURN jsonb_build_object('success', TRUE, 'createdCount', jsonb_array_length(v_created), 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.location_batch_import(JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.location_batch_import(JSONB, UUID, TEXT) TO service_role;
