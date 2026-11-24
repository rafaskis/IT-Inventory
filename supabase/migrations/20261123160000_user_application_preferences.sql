-- Persist each user's application language and preferred landing page.
-- Users may update only these two preference columns; role/account fields remain
-- protected for administrator-only Edge Function operations.
ALTER TABLE public.profiles
  ADD COLUMN preferred_language text NOT NULL DEFAULT 'el',
  ADD COLUMN preferred_page text NOT NULL DEFAULT 'Dashboard';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_language_check
    CHECK (preferred_language IN ('el', 'en')),
  ADD CONSTRAINT profiles_preferred_page_check
    CHECK (preferred_page IN (
      'Dashboard',
      'Inventory',
      'Employees',
      'Locations',
      'Catalogues',
      'Audit Logs',
      'Accounts'
    ));

REVOKE UPDATE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (preferred_language, preferred_page)
  ON TABLE public.profiles TO authenticated;

CREATE POLICY "Users can update their own application preferences"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()) AND is_active = TRUE)
  WITH CHECK (id = (SELECT auth.uid()) AND is_active = TRUE);
