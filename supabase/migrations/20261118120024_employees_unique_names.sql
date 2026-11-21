-- Ensure employee names are unique, ignoring case and surrounding spaces.

CREATE UNIQUE INDEX employees_full_name_unique
ON public.employees (LOWER(BTRIM(full_name)));