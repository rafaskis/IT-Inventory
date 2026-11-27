import { createClient } from 'npm:@supabase/supabase-js@2';

const allowedOrigin = (Deno.env.get('APP_ALLOWED_ORIGIN') || 'http://localhost:5173').trim()

const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

function rejectDisallowedOrigin(req: Request): Response | null {
  const requestOrigin = req.headers.get('Origin')
  if (!requestOrigin || requestOrigin === allowedOrigin) return null

  return new Response(JSON.stringify({ error: 'This application origin is not allowed.' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Vary': 'Origin' },
  })
};

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getDefaultKey(pluralName: string, legacyName: string): string | null {
  const plural = Deno.env.get(pluralName);
  if (plural) {
    try { return JSON.parse(plural).default ?? null; } catch { return null; }
  }
  return Deno.env.get(legacyName) ?? null;
}

function validPage(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback;
}

Deno.serve(async (req) => {
  const originRejection = rejectDisallowedOrigin(req)
  if (originRejection) return originRejection

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return response({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = getDefaultKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
  const serviceKey = getDefaultKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceKey) {
    return response({ error: 'Server configuration is incomplete.' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'Authentication required.' }, 401);

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'Your session is invalid or expired.' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, username, role, is_active')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    return response({ error: 'An active application account is required.' }, 403);
  }
  if (!['administrator', 'inventory_manager', 'viewer'].includes(profile.role)) {
    return response({ error: 'Audit history access is not available for this account.' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }

  const action = String(body.action ?? 'list');
  if (action === 'employee_history') {
    const employeeId = String(body.employee_id ?? '').trim();
    if (!/^\d+$/.test(employeeId)) return response({ error: 'Enter a valid Employee ID.' }, 400);
    const { data: employee, error: employeeError } = await admin
      .from('employees').select('id, full_name').eq('id', employeeId).maybeSingle();
    if (employeeError) return response({ error: employeeError.message }, 400);
    if (!employee) return response({ error: 'Employee not found.' }, 404);
    const { data: events, error: eventsError } = await admin
      .from('audit_events')
      .select('id, entity_type, entity_id, action, actor_user_id, actor_username, changes, details, created_at')
      .eq('entity_type', 'employee').eq('entity_id', employeeId)
      .order('created_at', { ascending: true }).limit(5000);
    if (eventsError) return response({ error: eventsError.message }, 400);
    return response({ success: true, employee_id: employeeId, employee_name: employee.full_name, events: events ?? [] });
  }

  if (action === 'item_history') {
    const itemCode = String(body.item_code ?? '').trim().toUpperCase();
    // The application generates item codes with the MJPO- prefix.
    // Use a single validator; do not accept the obsolete ITEM- prefix.
    if (!/^MJPO-\d{6,}$/.test(itemCode)) {
      return response({ error: 'Enter a valid Item Code (for example, MJPO-000001).' }, 400);
    }
    const { data: item, error: itemError } = await admin
      .from('inventory_items')
      .select('id, item_code, item_type_id, brand_id, model_id, serial_number')
      .eq('item_code', itemCode)
      .maybeSingle();
    if (itemError) return response({ error: `Unable to load inventory item: ${itemError.message}` }, 400);
    if (!item) return response({ error: 'Inventory item not found.' }, 404);

    const [typeResult, brandResult, modelResult] = await Promise.all([
      admin.from('item_types').select('name').eq('id', item.item_type_id).maybeSingle(),
      admin.from('brands').select('name').eq('id', item.brand_id).maybeSingle(),
      admin.from('models').select('name').eq('id', item.model_id).maybeSingle(),
    ]);
    const catalogueError = typeResult.error || brandResult.error || modelResult.error;
    if (catalogueError) {
      return response({ error: `Unable to load item description: ${catalogueError.message}` }, 400);
    }

    const { data: events, error: eventsError } = await admin
      .from('audit_events')
      .select('id, entity_type, entity_id, action, actor_user_id, actor_username, changes, details, created_at')
      .eq('entity_type', 'inventory_item')
      .eq('entity_id', String(item.id))
      .order('created_at', { ascending: true })
      .limit(5000);
    if (eventsError) return response({ error: eventsError.message }, 400);
    const typeName = typeResult.data?.name ?? '';
    const brandName = brandResult.data?.name ?? '';
    const modelName = modelResult.data?.name ?? '';
    const itemDescription = [typeName, brandName, modelName, item.serial_number].filter(Boolean).join(' · ');
    return response({ success: true, item_code: item.item_code, item_description: itemDescription, events: events ?? [] });
  }

  if (action !== 'list') return response({ error: 'Unsupported audit action.' }, 400);

  const category = String(body.category ?? 'inventory_item');
  const page = validPage(body.page, 1, 100000);
  const pageSize = validPage(body.page_size, 50, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const securityTypes = ['account', 'profile', 'security', 'auth', 'user'];
  const operationalTypes = ['inventory_item', 'employee', 'location', 'catalog'];
  if (category === 'security' && profile.role !== 'administrator') {
    return response({ error: 'Security and account history is available to administrators only.' }, 403);
  }
  if (category !== 'security' && !operationalTypes.includes(category)) {
    return response({ error: 'Invalid audit category.' }, 400);
  }

  let query = admin
    .from('audit_events')
    .select('id, entity_type, entity_id, action, actor_user_id, actor_username, changes, details, created_at', { count: 'exact' });

  if (category === 'security') query = query.in('entity_type', securityTypes);
  else query = query.eq('entity_type', category);

  const { data: events, error: eventsError, count } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (eventsError) return response({ error: eventsError.message }, 400);
  let enrichedEvents = events ?? [];
  if (category === 'employee' || category === 'location') {
    const ids = [...new Set(enrichedEvents.map((event) => event.entity_id).filter((id) => /^\d+$/.test(id)))];
    if (ids.length) {
      const table = category === 'employee' ? 'employees' : 'locations';
      const nameColumn = category === 'employee' ? 'full_name' : 'name';
      const { data: targets } = await admin.from(table).select(`id, ${nameColumn}`).in('id', ids);
      const names = new Map((targets ?? []).map((target: Record<string, unknown>) => [String(target.id), String(target[nameColumn] ?? '')]));
      enrichedEvents = enrichedEvents.map((event) => {
        const changes = (event.changes ?? {}) as Record<string, unknown>;
        const snapshotName = category === 'employee'
          ? (() => {
              const nameChange = changes.full_name as { old?: unknown; new?: unknown } | undefined;
              return String(nameChange?.new ?? nameChange?.old ?? '');
            })()
          : (() => {
              const locationChange = changes as { old?: { name?: unknown } | null; new?: { name?: unknown } | null };
              return String(locationChange.new?.name ?? locationChange.old?.name ?? '');
            })();
        return { ...event, entity_name: names.get(event.entity_id) || snapshotName || null };
      });
    }
  }
  return response({ success: true, events: enrichedEvents, total: count ?? 0, page, page_size: pageSize });
});
