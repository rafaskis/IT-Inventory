BEGIN;

-- The local Supabase database may enforce safe updates, which rejects DELETE
-- statements without an explicit WHERE clause. The flush intentionally removes
-- every row from these application tables, so WHERE TRUE makes that intent
-- explicit while remaining compatible with safe-update enforcement.
--
-- The authenticated administrator performing the flush is the only account
-- that may be retained. The Edge Function passes the authenticated actor ID;
-- this database-side check prevents retaining a different administrator even
-- if the RPC is ever called incorrectly.

CREATE OR REPLACE FUNCTION public.flush_application_database(
  p_actor_id uuid,
  p_retained_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted_users integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = p_actor_id
      AND is_active = true
      AND role = 'administrator'
  ) THEN
    RAISE EXCEPTION 'Active administrator access required.';
  END IF;

  IF p_retained_admin_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'Only the administrator performing the flush can be retained.';
  END IF;

  DELETE FROM public.audit_events WHERE TRUE;
  DELETE FROM public.inventory_item_employees WHERE TRUE;
  DELETE FROM public.inventory_items WHERE TRUE;
  DELETE FROM public.employees WHERE TRUE;
  DELETE FROM public.locations WHERE TRUE;
  DELETE FROM public.models WHERE TRUE;
  DELETE FROM public.brands WHERE TRUE;
  DELETE FROM public.item_types WHERE TRUE;

  -- Deleting Auth users cascades to their profiles and Auth identity/session
  -- records. The active administrator performing this operation is preserved.
  DELETE FROM auth.users
  WHERE id <> p_actor_id;

  GET DIAGNOSTICS v_deleted_users = ROW_COUNT;

  UPDATE public.profiles
  SET role = 'administrator',
      is_active = true
  WHERE id = p_actor_id;

  RETURN jsonb_build_object(
    'success', true,
    'retained_admin_id', p_actor_id,
    'deleted_user_count', v_deleted_users,
    'application_data_cleared', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.flush_application_database(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flush_application_database(uuid, uuid)
  TO service_role;

COMMIT;
