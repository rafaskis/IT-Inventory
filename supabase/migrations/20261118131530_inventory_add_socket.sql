-- Add optional free-text SOCKET field.
-- Positioned after IP in the logical inventory field order.

ALTER TABLE public.inventory_items
ADD COLUMN socket TEXT;