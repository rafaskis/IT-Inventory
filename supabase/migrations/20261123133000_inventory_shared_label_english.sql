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
            (COALESCE(cardinality(p_item_type_ids), 0) = 0 OR ii.item_type_id = ANY(p_item_type_ids))
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