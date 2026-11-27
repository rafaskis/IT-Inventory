-- Allow the administrator-only database flush to remove inventory records
-- from every lifecycle state without weakening normal lifecycle protections.
--
-- The lifecycle guard permits deletion of non-active inventory only while
-- app.inventory_lifecycle_transition is transaction-locally set to 'on'.
-- This function is SECURITY DEFINER, executable only by service_role, and
-- verifies that the caller is an active administrator before enabling it.

BEGIN;

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

  -- This is the same narrowly scoped transaction-local bypass used by the
  -- approved inventory lifecycle transition RPC. It is enabled only inside
  -- this administrator-validated, service-role-only flush transaction.
  -- Normal application DELETE/UPDATE operations remain protected.
  PERFORM pg_catalog.set_config('app.inventory_lifecycle_transition', 'on', TRUE);

  DELETE FROM public.inventory_items WHERE TRUE;
  DELETE FROM public.employees WHERE TRUE;
  DELETE FROM public.locations WHERE TRUE;
  DELETE FROM public.models WHERE TRUE;
  DELETE FROM public.brands WHERE TRUE;
  DELETE FROM public.item_types WHERE TRUE;

  -- Delete all Auth users except the authenticated administrator performing
  -- this flush. Auth cascades remove their profiles and identity/session data.
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
