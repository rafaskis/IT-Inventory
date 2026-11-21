-- ============================================================
-- LOCATION MANAGEMENT: TRANSACTIONAL FUNCTIONS + AUDIT
-- ============================================================

-- 1. CREATE LOCATION
CREATE OR REPLACE FUNCTION public.location_create(
    p_name TEXT,
    p_notes TEXT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name TEXT;
    v_notes TEXT;
    v_id BIGINT;
BEGIN
    v_name := BTRIM(p_name);
    v_notes := NULLIF(BTRIM(p_notes), '');

    IF v_name IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Location name is required.';
    END IF;

    IF LENGTH(v_name) > 200 THEN
        RAISE EXCEPTION 'Location name cannot exceed 200 characters.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_actor_id
          AND p.username = p_actor_username
          AND p.is_active = TRUE
          AND p.role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'You are not authorized to manage locations.';
    END IF;

    INSERT INTO public.locations (name, notes)
    VALUES (v_name, v_notes)
    RETURNING id INTO v_id;

    INSERT INTO public.audit_events (
        entity_type,
        entity_id,
        action,
        actor_user_id,
        actor_username,
        changes,
        details
    )
    VALUES (
        'location',
        v_id::TEXT,
        'location_created',
        p_actor_id,
        p_actor_username,
        jsonb_build_object(
            'old', NULL,
            'new', jsonb_build_object(
                'name', v_name,
                'notes', v_notes
            )
        ),
        '{}'::JSONB
    );

    RETURN v_id;
END;
$$;


-- 2. RENAME / UPDATE LOCATION
CREATE OR REPLACE FUNCTION public.location_update(
    p_id BIGINT,
    p_name TEXT,
    p_notes TEXT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name TEXT;
    v_notes TEXT;
    v_old_name TEXT;
    v_old_notes TEXT;
BEGIN
    v_name := BTRIM(p_name);
    v_notes := NULLIF(BTRIM(p_notes), '');

    IF v_name IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Location name is required.';
    END IF;

    IF LENGTH(v_name) > 200 THEN
        RAISE EXCEPTION 'Location name cannot exceed 200 characters.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_actor_id
          AND p.username = p_actor_username
          AND p.is_active = TRUE
          AND p.role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'You are not authorized to manage locations.';
    END IF;

    SELECT l.name, l.notes
    INTO v_old_name, v_old_notes
    FROM public.locations l
    WHERE l.id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Location not found.';
    END IF;

    UPDATE public.locations
    SET
        name = v_name,
        notes = v_notes,
        updated_at = NOW()
    WHERE id = p_id;

    INSERT INTO public.audit_events (
        entity_type,
        entity_id,
        action,
        actor_user_id,
        actor_username,
        changes,
        details
    )
    VALUES (
        'location',
        p_id::TEXT,
        'location_updated',
        p_actor_id,
        p_actor_username,
        jsonb_build_object(
            'old', jsonb_build_object(
                'name', v_old_name,
                'notes', v_old_notes
            ),
            'new', jsonb_build_object(
                'name', v_name,
                'notes', v_notes
            )
        ),
        '{}'::JSONB
    );
END;
$$;


-- 3. DELETE LOCATION
CREATE OR REPLACE FUNCTION public.location_delete(
    p_id BIGINT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_name TEXT;
    v_notes TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = p_actor_id
          AND p.username = p_actor_username
          AND p.is_active = TRUE
          AND p.role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'You are not authorized to manage locations.';
    END IF;

    SELECT l.name, l.notes
    INTO v_name, v_notes
    FROM public.locations l
    WHERE l.id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Location not found.';
    END IF;

    DELETE FROM public.locations
    WHERE id = p_id;

    INSERT INTO public.audit_events (
        entity_type,
        entity_id,
        action,
        actor_user_id,
        actor_username,
        changes,
        details
    )
    VALUES (
        'location',
        p_id::TEXT,
        'location_deleted',
        p_actor_id,
        p_actor_username,
        jsonb_build_object(
            'old', jsonb_build_object(
                'name', v_name,
                'notes', v_notes
            ),
            'new', NULL
        ),
        '{}'::JSONB
    );
END;
$$;


-- 4. SECURITY: ONLY SERVICE ROLE CAN EXECUTE THESE FUNCTIONS

REVOKE ALL ON FUNCTION public.location_create(TEXT, TEXT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.location_update(BIGINT, TEXT, TEXT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.location_delete(BIGINT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.location_create(TEXT, TEXT, UUID, TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.location_update(BIGINT, TEXT, TEXT, UUID, TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.location_delete(BIGINT, UUID, TEXT)
TO service_role;