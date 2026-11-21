CREATE OR REPLACE FUNCTION public.catalogue_create_entry(
    p_catalogue_type TEXT,
    p_name TEXT,
    p_item_type_id BIGINT,
    p_brand_id BIGINT,
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
    v_id BIGINT;
    v_item_type_id BIGINT;
    v_brand_id BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Catalogue management access required.';
    END IF;

    v_name := pg_catalog.btrim(p_name);

    IF v_name IS NULL OR v_name = '' OR pg_catalog.length(v_name) > 100 THEN
        RAISE EXCEPTION 'Name is required and cannot exceed 100 characters.';
    END IF;

    IF p_catalogue_type = 'item_type' THEN
        INSERT INTO public.item_types (name)
        VALUES (v_name)
        RETURNING id INTO v_id;

    ELSIF p_catalogue_type = 'brand' THEN
        IF p_item_type_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.item_types WHERE id = p_item_type_id
        ) THEN
            RAISE EXCEPTION 'Item type not found.';
        END IF;

        INSERT INTO public.brands (item_type_id, name)
        VALUES (p_item_type_id, v_name)
        RETURNING id INTO v_id;

        v_item_type_id := p_item_type_id;

    ELSIF p_catalogue_type = 'model' THEN
        IF p_item_type_id IS NULL OR p_brand_id IS NULL THEN
            RAISE EXCEPTION 'Item type and brand are required.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.brands
            WHERE id = p_brand_id AND item_type_id = p_item_type_id
        ) THEN
            RAISE EXCEPTION 'The selected brand does not belong to this item type.';
        END IF;

        INSERT INTO public.models (item_type_id, brand_id, name)
        VALUES (p_item_type_id, p_brand_id, v_name)
        RETURNING id INTO v_id;

        v_item_type_id := p_item_type_id;
        v_brand_id := p_brand_id;

    ELSE
        RAISE EXCEPTION 'Invalid catalogue type.';
    END IF;

    INSERT INTO public.audit_events (
        entity_type, entity_id, action,
        actor_user_id, actor_username, changes, details
    )
    VALUES (
        'catalog',
        v_id::TEXT,
        'catalogue_entry_created',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'name',
            pg_catalog.jsonb_build_object('old', NULL, 'new', v_name)
        ),
        pg_catalog.jsonb_build_object(
            'catalogue_type', p_catalogue_type,
            'item_type_id', v_item_type_id,
            'brand_id', v_brand_id
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', v_id,
        'name', v_name,
        'catalogue_type', p_catalogue_type,
        'item_type_id', v_item_type_id,
        'brand_id', v_brand_id
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.catalogue_rename_entry(
    p_catalogue_type TEXT,
    p_id BIGINT,
    p_name TEXT,
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
    v_old_name TEXT;
    v_item_type_id BIGINT;
    v_brand_id BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Catalogue management access required.';
    END IF;

    v_name := pg_catalog.btrim(p_name);

    IF v_name IS NULL OR v_name = '' OR pg_catalog.length(v_name) > 100 THEN
        RAISE EXCEPTION 'Name is required and cannot exceed 100 characters.';
    END IF;

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'A valid entry ID is required.';
    END IF;

    IF p_catalogue_type = 'item_type' THEN
        SELECT name INTO v_old_name
        FROM public.item_types WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        UPDATE public.item_types
        SET name = v_name, updated_at = pg_catalog.now()
        WHERE id = p_id;

    ELSIF p_catalogue_type = 'brand' THEN
        SELECT name, item_type_id
        INTO v_old_name, v_item_type_id
        FROM public.brands WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        UPDATE public.brands
        SET name = v_name, updated_at = pg_catalog.now()
        WHERE id = p_id;

    ELSIF p_catalogue_type = 'model' THEN
        SELECT name, item_type_id, brand_id
        INTO v_old_name, v_item_type_id, v_brand_id
        FROM public.models WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        UPDATE public.models
        SET name = v_name, updated_at = pg_catalog.now()
        WHERE id = p_id;

    ELSE
        RAISE EXCEPTION 'Invalid catalogue type.';
    END IF;

    INSERT INTO public.audit_events (
        entity_type, entity_id, action,
        actor_user_id, actor_username, changes, details
    )
    VALUES (
        'catalog',
        p_id::TEXT,
        'catalogue_entry_renamed',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'name',
            pg_catalog.jsonb_build_object('old', v_old_name, 'new', v_name)
        ),
        pg_catalog.jsonb_build_object(
            'catalogue_type', p_catalogue_type,
            'item_type_id', v_item_type_id,
            'brand_id', v_brand_id
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', p_id,
        'name', v_name,
        'catalogue_type', p_catalogue_type
    );
END;
$function$;


CREATE OR REPLACE FUNCTION public.catalogue_delete_entry(
    p_catalogue_type TEXT,
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
    v_name TEXT;
    v_item_type_id BIGINT;
    v_brand_id BIGINT;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = p_actor_id
          AND username = p_actor_username
          AND is_active = TRUE
          AND role IN ('administrator', 'inventory_manager')
    ) THEN
        RAISE EXCEPTION 'Catalogue management access required.';
    END IF;

    IF p_id IS NULL THEN
        RAISE EXCEPTION 'A valid entry ID is required.';
    END IF;

    IF p_catalogue_type = 'item_type' THEN
        SELECT name INTO v_name
        FROM public.item_types WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        DELETE FROM public.item_types WHERE id = p_id;

    ELSIF p_catalogue_type = 'brand' THEN
        SELECT name, item_type_id
        INTO v_name, v_item_type_id
        FROM public.brands WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        DELETE FROM public.brands WHERE id = p_id;

    ELSIF p_catalogue_type = 'model' THEN
        SELECT name, item_type_id, brand_id
        INTO v_name, v_item_type_id, v_brand_id
        FROM public.models WHERE id = p_id FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Catalogue entry not found.';
        END IF;

        DELETE FROM public.models WHERE id = p_id;

    ELSE
        RAISE EXCEPTION 'Invalid catalogue type.';
    END IF;

    INSERT INTO public.audit_events (
        entity_type, entity_id, action,
        actor_user_id, actor_username, changes, details
    )
    VALUES (
        'catalog',
        p_id::TEXT,
        'catalogue_entry_deleted',
        p_actor_id,
        p_actor_username,
        pg_catalog.jsonb_build_object(
            'name',
            pg_catalog.jsonb_build_object('old', v_name, 'new', NULL)
        ),
        pg_catalog.jsonb_build_object(
            'catalogue_type', p_catalogue_type,
            'item_type_id', v_item_type_id,
            'brand_id', v_brand_id
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'id', p_id,
        'name', v_name,
        'catalogue_type', p_catalogue_type
    );
END;
$function$;