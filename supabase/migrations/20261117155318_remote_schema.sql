SET local check_function_bodies = off;

CREATE TABLE "public"."audit_events" (
  "id"             bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "entity_type"    text                     NOT NULL,
  "entity_id"      text,
  "action"         text                     NOT NULL,
  "actor_user_id"  uuid,
  "actor_username" text                     NOT NULL,
  "changes"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "details"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "audit_events_entity_type_check" CHECK ((entity_type = ANY (ARRAY['inventory_item'::text, 'employee'::text, 'location'::text, 'catalog'::text, 'security'::text]))),
  CONSTRAINT "audit_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audit_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."brands" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "item_type_id" bigint                   NOT NULL,
  "name"         text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "brands_id_item_type_id_key" UNIQUE (id, item_type_id),
  CONSTRAINT "brands_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."brands"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."employees" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "full_name"  text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "employees_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."employees"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."inventory_item_employees" (
  "inventory_item_id" bigint NOT NULL,
  "employee_id"       bigint NOT NULL,
  CONSTRAINT "inventory_item_employees_pkey" PRIMARY KEY (inventory_item_id, employee_id)
);

ALTER TABLE "public"."inventory_item_employees"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."inventory_items" (
  "id"              bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "item_code"       text                     GENERATED ALWAYS AS (('ITEM-'::text || lpad((id)::text, 6, '0'::text))) STORED,
  "item_type_id"    bigint                   NOT NULL,
  "brand_id"        bigint                   NOT NULL,
  "model_id"        bigint                   NOT NULL,
  "serial_number"   text                     NOT NULL,
  "mac_address"     text,
  "pc_name"         text,
  "ip_address"      text,
  "location_id"     bigint                   NOT NULL,
  "document_number" integer,
  "invoice"         text,
  "purchase_date"   date,
  "warranty_until"  date,
  "store"           text,
  "notes"           text,
  "created_by"      uuid,
  "updated_by"      uuid,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_items_item_code_key" UNIQUE (item_code),
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."inventory_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."item_types" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"       text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "item_types_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."item_types"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."locations" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "name"       text                     NOT NULL,
  "notes"      text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "locations_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."locations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."models" (
  "id"           bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "item_type_id" bigint                   NOT NULL,
  "brand_id"     bigint                   NOT NULL,
  "name"         text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "models_id_brand_id_item_type_id_key" UNIQUE (id, brand_id, item_type_id),
  CONSTRAINT "models_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."models"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "username"   text                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'viewer'::text,
  "is_active"  boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['administrator'::text, 'inventory_manager'::text, 'viewer'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT role
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND is_active = TRUE
    LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_active_user()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles
        WHERE id = (SELECT auth.uid())
          AND is_active = TRUE
    );
$function$;

ALTER TABLE "public"."inventory_item_employees"
  ADD CONSTRAINT "inventory_item_employees_employee_id_fkey" FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE RESTRICT;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_brand_id_item_type_id_fkey" FOREIGN KEY (brand_id, item_type_id) REFERENCES public.brands(id, item_type_id) ON DELETE RESTRICT;

ALTER TABLE "public"."inventory_item_employees"
  ADD CONSTRAINT "inventory_item_employees_inventory_item_id_fkey" FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE RESTRICT;

ALTER TABLE "public"."brands"
  ADD CONSTRAINT "brands_item_type_id_fkey" FOREIGN KEY (item_type_id) REFERENCES public.item_types(id) ON DELETE RESTRICT;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE RESTRICT;

ALTER TABLE "public"."models"
  ADD CONSTRAINT "models_brand_id_item_type_id_fkey" FOREIGN KEY (brand_id, item_type_id) REFERENCES public.brands(id, item_type_id) ON DELETE RESTRICT;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_model_id_brand_id_item_type_id_fkey" FOREIGN KEY (model_id, brand_id, item_type_id) REFERENCES public.models(id, brand_id, item_type_id)
    ON DELETE RESTRICT;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."audit_events"
  ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY (actor_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id);

ALTER TABLE "public"."inventory_items"
  ADD CONSTRAINT "inventory_items_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.profiles(id);

CREATE INDEX audit_events_actor_idx ON public.audit_events USING btree (actor_username);

CREATE INDEX audit_events_created_at_idx ON public.audit_events USING btree (created_at DESC);

CREATE INDEX audit_events_entity_idx ON public.audit_events USING btree (entity_type, entity_id);

CREATE UNIQUE INDEX brands_name_per_type_unique ON public.brands USING btree (item_type_id, lower(name));

CREATE UNIQUE INDEX item_types_name_unique ON public.item_types USING btree (lower(name));

CREATE UNIQUE INDEX locations_name_unique ON public.locations USING btree (lower(name));

CREATE UNIQUE INDEX models_name_per_brand_unique ON public.models USING btree (brand_id, lower(name));

CREATE UNIQUE INDEX profiles_username_unique ON public.profiles USING btree (lower(username));

CREATE POLICY "Authorized users can read audit events" ON "public"."audit_events"
  FOR SELECT
  TO "authenticated"
  USING
    (((( SELECT public.current_user_role() AS current_user_role) = 'administrator'::text) OR ((entity_type <> 'security'::text) AND (( SELECT public.current_user_role() AS
    current_user_role) = 'inventory_manager'::text))));

CREATE POLICY "Active users can read brands" ON "public"."brands"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read employees" ON "public"."employees"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read item assignments" ON "public"."inventory_item_employees"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read inventory" ON "public"."inventory_items"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read item types" ON "public"."item_types"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read locations" ON "public"."locations"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Active users can read models" ON "public"."models"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_active_user() AS is_active_user));

CREATE POLICY "Users can read own profile or admin can read all" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT public.current_user_role() AS current_user_role) = 'administrator'::text)));

REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_active_user"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_active_user"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_active_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_active_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_active_user"() TO "service_role";

REVOKE ALL ON SEQUENCE "public"."audit_events_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_events_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."audit_events_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_events_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."audit_events_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_events_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."audit_events_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."audit_events_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."brands_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."brands_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."brands_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."brands_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."brands_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."brands_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."brands_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."brands_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."employees_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."employees_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."employees_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."employees_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."employees_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."employees_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."employees_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."employees_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."inventory_items_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."inventory_items_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."inventory_items_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."inventory_items_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."inventory_items_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."inventory_items_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."inventory_items_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."inventory_items_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."item_types_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."item_types_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."item_types_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."item_types_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."item_types_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."item_types_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."item_types_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."item_types_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."locations_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."locations_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."locations_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."locations_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."locations_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."locations_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."locations_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."locations_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."models_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."models_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."models_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."models_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."models_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."models_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."models_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."models_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."audit_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audit_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."brands" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."brands" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."employees" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."employees" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_item_employees" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."inventory_item_employees" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_item_employees" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_item_employees" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_items" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."inventory_items" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_items" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."inventory_items" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."item_types" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."item_types" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."item_types" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."item_types" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."locations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."locations" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."models" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."models" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."models" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."models" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

