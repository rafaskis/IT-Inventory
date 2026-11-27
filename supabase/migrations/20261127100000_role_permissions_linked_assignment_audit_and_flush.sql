BEGIN;


-- Preserve the existing atomic batch-import implementations while widening
-- their database-side authorization from Administrator to both write roles.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef('public.location_batch_import(jsonb,uuid,text)'::regprocedure);
  IF position($needle$p.role = 'administrator'$needle$ in v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected location_batch_import authorization definition; refusing unsafe migration.';
  END IF;
  v_definition := replace(v_definition, $needle$p.role = 'administrator'$needle$, $replacement$p.role IN ('administrator', 'inventory_manager')$replacement$);
  EXECUTE v_definition;

  v_definition := pg_get_functiondef('public.employee_batch_import(jsonb,uuid,text)'::regprocedure);
  IF position($needle$p.role = 'administrator'$needle$ in v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected employee_batch_import authorization definition; refusing unsafe migration.';
  END IF;
  v_definition := replace(v_definition, $needle$p.role = 'administrator'$needle$, $replacement$p.role IN ('administrator', 'inventory_manager')$replacement$);
  EXECUTE v_definition;

  v_definition := pg_get_functiondef('public.inventory_batch_import(jsonb,uuid,text)'::regprocedure);
  IF position($needle$role = 'administrator'$needle$ in v_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected inventory_batch_import authorization definition; refusing unsafe migration.';
  END IF;
  v_definition := replace(v_definition, $needle$role = 'administrator'$needle$, $replacement$role IN ('administrator', 'inventory_manager')$replacement$);
  EXECUTE v_definition;
END;
$migration$;

-- View permissions are shared by all active roles; write permissions remain in
-- the server-side Edge Functions and SECURITY DEFINER transaction functions.
DROP POLICY IF EXISTS "Authorized users can read audit events" ON public.audit_events;
CREATE POLICY "Authorized users can read audit events"
ON public.audit_events FOR SELECT TO authenticated
USING (
  public.current_user_role() = 'administrator'
  OR (
    public.current_user_role() IN ('inventory_manager', 'viewer')
    AND entity_type NOT IN ('account', 'profile', 'security', 'auth', 'user')
  )
);

-- Employee, location and catalogue tables already have active-user SELECT
-- policies. Explicitly recreate the same policy for clarity and consistency.
DROP POLICY IF EXISTS "Active users can read employees" ON public.employees;
CREATE POLICY "Active users can read employees" ON public.employees
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Active users can read locations" ON public.locations;
CREATE POLICY "Active users can read locations" ON public.locations
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Active users can read item types" ON public.item_types;
CREATE POLICY "Active users can read item types" ON public.item_types
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Active users can read brands" ON public.brands;
CREATE POLICY "Active users can read brands" ON public.brands
FOR SELECT TO authenticated USING (public.is_active_user());
DROP POLICY IF EXISTS "Active users can read models" ON public.models;
CREATE POLICY "Active users can read models" ON public.models
FOR SELECT TO authenticated USING (public.is_active_user());

-- Mirror assignment/location changes from inventory history into the affected
-- employee/location histories. The trigger runs in the same transaction as the
-- inventory audit event, so failures roll back the original operation.
CREATE OR REPLACE FUNCTION public.mirror_inventory_assignment_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item_code text;
  v_employee_id bigint;
  v_location_id bigint;
  v_location_name text;
  v_old jsonb;
  v_new jsonb;
  v_entry jsonb;
BEGIN
  IF NEW.entity_type <> 'inventory_item' THEN RETURN NEW; END IF;
  v_item_code := COALESCE(NEW.details->>'item_code', '');

  IF NEW.action IN ('employee_assigned', 'employee_unassigned') THEN
    v_employee_id := NULLIF(NEW.details->>'employee_id', '')::bigint;
    IF v_employee_id IS NOT NULL THEN
      INSERT INTO public.audit_events (
        entity_type, entity_id, action, actor_user_id, actor_username,
        changes, details, created_at
      ) VALUES (
        'employee', v_employee_id::text,
        CASE WHEN NEW.action = 'employee_assigned' THEN 'equipment_assigned' ELSE 'equipment_removed' END,
        NEW.actor_user_id, NEW.actor_username, '{}'::jsonb,
        jsonb_build_object('item_code', v_item_code), NEW.created_at
      );
    END IF;
  END IF;

  -- Lifecycle events carry the previous employee snapshot and clear all links.
  IF NEW.action IN ('inventory_item_moved_to_pending_scrap', 'inventory_item_gifted')
     AND jsonb_typeof(NEW.changes->'employee_assignments'->'old') = 'array' THEN
    FOR v_entry IN SELECT value FROM jsonb_array_elements(NEW.changes->'employee_assignments'->'old')
    LOOP
      v_employee_id := NULLIF(v_entry->>'id', '')::bigint;
      IF v_employee_id IS NOT NULL THEN
        INSERT INTO public.audit_events (
          entity_type, entity_id, action, actor_user_id, actor_username,
          changes, details, created_at
        ) VALUES (
          'employee', v_employee_id::text, 'equipment_removed',
          NEW.actor_user_id, NEW.actor_username, '{}'::jsonb,
          jsonb_build_object('item_code', v_item_code), NEW.created_at
        );
      END IF;
    END LOOP;
  END IF;

  -- Location changes are represented either as a name string (ordinary edit)
  -- or as an {id,name} snapshot (lifecycle transition).
  IF NEW.changes ? 'location' OR NEW.changes ? 'item' THEN
    v_old := COALESCE(NEW.changes->'location'->'old', NEW.changes->'item'->'old'->'location');
    v_new := COALESCE(NEW.changes->'location'->'new', NEW.changes->'item'->'new'->'location');
    IF v_old IS NOT NULL AND v_old <> 'null'::jsonb THEN
      v_location_id := NULLIF(v_old->>'id', '')::bigint;
      v_location_name := CASE WHEN jsonb_typeof(v_old) = 'string' THEN trim(both '"' from v_old::text) ELSE v_old->>'name' END;
      IF v_location_id IS NULL AND v_location_name IS NOT NULL THEN
        SELECT id INTO v_location_id FROM public.locations WHERE name = v_location_name ORDER BY id LIMIT 1;
      END IF;
      IF v_location_id IS NOT NULL THEN
        INSERT INTO public.audit_events (
          entity_type, entity_id, action, actor_user_id, actor_username,
          changes, details, created_at
        ) VALUES (
          'location', v_location_id::text, 'equipment_removed',
          NEW.actor_user_id, NEW.actor_username, '{}'::jsonb,
          jsonb_build_object('item_code', v_item_code), NEW.created_at
        );
      END IF;
    END IF;
    IF v_new IS NOT NULL AND v_new <> 'null'::jsonb THEN
      v_location_id := NULLIF(v_new->>'id', '')::bigint;
      v_location_name := CASE WHEN jsonb_typeof(v_new) = 'string' THEN trim(both '"' from v_new::text) ELSE v_new->>'name' END;
      IF v_location_id IS NULL AND v_location_name IS NOT NULL THEN
        SELECT id INTO v_location_id FROM public.locations WHERE name = v_location_name ORDER BY id LIMIT 1;
      END IF;
      IF v_location_id IS NOT NULL THEN
        INSERT INTO public.audit_events (
          entity_type, entity_id, action, actor_user_id, actor_username,
          changes, details, created_at
        ) VALUES (
          'location', v_location_id::text, 'equipment_assigned',
          NEW.actor_user_id, NEW.actor_username, '{}'::jsonb,
          jsonb_build_object('item_code', v_item_code), NEW.created_at
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mirror_inventory_assignment_audit ON public.audit_events;
CREATE TRIGGER trg_mirror_inventory_assignment_audit
AFTER INSERT ON public.audit_events
FOR EACH ROW EXECUTE FUNCTION public.mirror_inventory_assignment_audit();

REVOKE ALL ON FUNCTION public.mirror_inventory_assignment_audit() FROM PUBLIC, anon, authenticated;

-- A single database transaction clears all application data and Auth users,
-- preserving exactly one verified active administrator. No flush audit event
-- is written; audit history is intentionally deleted as part of the operation.
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
    SELECT 1 FROM public.profiles
    WHERE id = p_actor_id AND is_active = true AND role = 'administrator'
  ) THEN
    RAISE EXCEPTION 'Active administrator access required.';
  END IF;
  IF p_retained_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_retained_admin_id AND is_active = true AND role = 'administrator'
  ) THEN
    RAISE EXCEPTION 'Select one active administrator account to retain.';
  END IF;

  DELETE FROM public.audit_events;
  DELETE FROM public.inventory_item_employees;
  DELETE FROM public.inventory_items;
  DELETE FROM public.employees;
  DELETE FROM public.locations;
  DELETE FROM public.models;
  DELETE FROM public.brands;
  DELETE FROM public.item_types;

  -- Deleting auth.users cascades to profiles and Auth identity/session records.
  DELETE FROM auth.users WHERE id <> p_retained_admin_id;
  GET DIAGNOSTICS v_deleted_users = ROW_COUNT;

  UPDATE public.profiles
  SET role = 'administrator', is_active = true
  WHERE id = p_retained_admin_id;

  RETURN jsonb_build_object(
    'success', true,
    'retained_admin_id', p_retained_admin_id,
    'deleted_user_count', v_deleted_users,
    'application_data_cleared', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.flush_application_database(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flush_application_database(uuid, uuid) TO service_role;

COMMIT;
