
CREATE OR REPLACE FUNCTION public.admin_update_profile(
    p_target_id UUID,
    p_new_role TEXT,
    p_is_active BOOLEAN,
    p_actor_id UUID,
    p_actor_username TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target public.profiles%ROWTYPE;
    v_admin_count INTEGER;
BEGIN
    -- Serialize account-management changes.
    PERFORM pg_catalog.pg_advisory_xact_lock(8142026, 1);

    -- Verify that the requesting account is an active administrator.
    IF NOT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND role = 'administrator'
          AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Administrator access required.';
    END IF;

    -- Validate requested values.
    IF p_new_role NOT IN (
        'administrator',
        'inventory_manager',
        'viewer'
    ) THEN
        RAISE EXCEPTION 'Invalid account role.';
    END IF;

    IF p_is_active IS NULL THEN
        RAISE EXCEPTION 'Account status is required.';
    END IF;

    -- Lock the target account.
    SELECT *
    INTO v_target
    FROM public.profiles
    WHERE id = p_target_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account not found.';
    END IF;

    -- Prevent an administrator from removing their own
    -- administrative access through this operation.
    IF p_target_id = p_actor_id
       AND (
           p_new_role <> 'administrator'
           OR p_is_active = FALSE
       )
    THEN
        RAISE EXCEPTION 'You cannot remove your own administrator access.';
    END IF;

    -- Protect the last active administrator.
    IF v_target.role = 'administrator'
       AND v_target.is_active = TRUE
       AND (
           p_new_role <> 'administrator'
           OR p_is_active = FALSE
       )
    THEN
        SELECT COUNT(*)
        INTO v_admin_count
        FROM public.profiles
        WHERE role = 'administrator'
          AND is_active = TRUE;

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot deactivate or demote the last active administrator.';
        END IF;
    END IF;

    -- Update the account.
    UPDATE public.profiles
    SET
        role = p_new_role,
        is_active = p_is_active,
        updated_at = NOW()
    WHERE id = p_target_id;

    -- Record the change in the audit log.
    -- Failure to record the audit event rolls back the update.
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
        'security',
        p_target_id::TEXT,
        'account_updated',
        p_actor_id,
        p_actor_username,
        jsonb_build_object(
            'role', jsonb_build_object(
                'old', v_target.role,
                'new', p_new_role
            ),
            'is_active', jsonb_build_object(
                'old', v_target.is_active,
                'new', p_is_active
            )
        ),
        jsonb_build_object(
            'target_username', v_target.username
        )
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'user_id', p_target_id,
        'username', v_target.username,
        'role', p_new_role,
        'is_active', p_is_active
    );
END;
$$;


-- Only the trusted server-side function may execute this.
REVOKE ALL ON FUNCTION public.admin_update_profile(
    UUID, TEXT, BOOLEAN, UUID, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_update_profile(
    UUID, TEXT, BOOLEAN, UUID, TEXT
) TO service_role;
