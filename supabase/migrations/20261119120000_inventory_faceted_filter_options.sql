-- Return inventory-backed options for each faceted filter.
-- Each option list is constrained by the other four faceted filters only.
-- Search and purchase/warranty date filters intentionally do not affect facets.

CREATE OR REPLACE FUNCTION public.inventory_filter_options(
    p_item_type_ids BIGINT[],
    p_brand_ids BIGINT[],
    p_model_ids BIGINT[],
    p_location_ids BIGINT[],
    p_employee_ids BIGINT[]
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
                    (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
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
                    (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
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
                    (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
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
                    (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
                    AND (COALESCE(cardinality(p_brand_ids), 0) = 0 OR ii.brand_id = ANY(p_brand_ids))
                    AND (COALESCE(cardinality(p_model_ids), 0) = 0 OR ii.model_id = ANY(p_model_ids))
                    AND (COALESCE(cardinality(p_location_ids), 0) = 0 OR ii.location_id = ANY(p_location_ids))
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
                    (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
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
                UNION
                SELECT l.id, l.name
                FROM public.locations AS l
                WHERE l.id = ANY(COALESCE(p_location_ids, ARRAY[]::BIGINT[]))
            ) AS x
        ), '[]'::JSONB)
    );
$$;

REVOKE ALL ON FUNCTION public.inventory_filter_options(BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_filter_options(BIGINT[], BIGINT[], BIGINT[], BIGINT[], BIGINT[])
    TO service_role;
