
-- ============================================================
-- EMPLOYEE CREATE
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_create(
    p_full_name TEXT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_full_name TEXT;
    v_id BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Employee management access required.';
    END IF;

    v_full_name := pg_catalog.btrim(p_full_name);

    IF v_full_name IS NULL
       OR v_full_name = ''
       OR pg_catalog.length(v_full_name) > 200 THEN
        RAISE EXCEPTION 'Employee name is required and cannot exceed 200 characters.';
    END IF;

    INSERT INTO public.employees (full_name)
    VALUES (v_full_name)
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
        'employee',
        v_id::TEXT,
        'employee_created',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'full_name',
            pg_catalog.jsonb_build_object(
                'old', NULL,
                'new', v_full_name
            )
        ),
        '{}'::JSONB
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', v_id,
        'full_name', v_full_name
    );
END;
$function$;


-- ============================================================
-- EMPLOYEE RENAME
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_rename(
    p_id BIGINT,
    p_full_name TEXT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_full_name TEXT;
    v_old_name TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Employee management access required.';
    END IF;

    v_full_name := pg_catalog.btrim(p_full_name);

    IF v_full_name IS NULL
       OR v_full_name = ''
       OR pg_catalog.length(v_full_name) > 200 THEN
        RAISE EXCEPTION 'Employee name is required and cannot exceed 200 characters.';
    END IF;

    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'A valid employee ID is required.';
    END IF;

    SELECT full_name
    INTO v_old_name
    FROM public.employees
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    UPDATE public.employees
    SET
        full_name = v_full_name,
        updated_at = pg_catalog.now()
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
        'employee',
        p_id::TEXT,
        'employee_renamed',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'full_name',
            pg_catalog.jsonb_build_object(
                'old', v_old_name,
                'new', v_full_name
            )
        ),
        '{}'::JSONB
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', p_id,
        'full_name', v_full_name
    );
END;
$function$;


-- ============================================================
-- EMPLOYEE DELETE
-- ============================================================

CREATE OR REPLACE FUNCTION public.employee_delete(
    p_id BIGINT,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_full_name TEXT;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Employee management access required.';
    END IF;

    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'A valid employee ID is required.';
    END IF;

    SELECT full_name
    INTO v_full_name
    FROM public.employees
    WHERE id = p_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    DELETE FROM public.employees
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
        'employee',
        p_id::TEXT,
        'employee_deleted',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'full_name',
            pg_catalog.jsonb_build_object(
                'old', v_full_name,
                'new', NULL
            )
        ),
        '{}'::JSONB
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', p_id,
        'full_name', v_full_name
    );
END;
$function$;


-- ============================================================
-- RESTRICT FUNCTION EXECUTION
-- Only the Edge Function service role can call these functions.
-- ============================================================

REVOKE ALL ON FUNCTION public.employee_create(TEXT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.employee_rename(BIGINT, TEXT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.employee_delete(BIGINT, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.employee_create(TEXT, UUID, TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.employee_rename(BIGINT, TEXT, UUID, TEXT)
TO service_role;

GRANT EXECUTE ON FUNCTION public.employee_delete(BIGINT, UUID, TEXT)
TO service_role;
