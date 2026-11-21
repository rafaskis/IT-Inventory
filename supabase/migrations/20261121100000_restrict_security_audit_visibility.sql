-- Keep security/account audit records visible only to administrators.
-- Inventory managers retain access to operational audit history.

BEGIN;

DROP POLICY IF EXISTS "Authorized users can read audit events"
ON public.audit_events;

CREATE POLICY "Authorized users can read audit events"
ON public.audit_events
FOR SELECT
TO authenticated
USING (
    (SELECT public.current_user_role()) = 'administrator'
    OR (
        (SELECT public.current_user_role()) = 'inventory_manager'
        AND entity_type NOT IN ('account', 'profile', 'security', 'auth', 'user')
    )
);

COMMIT;
