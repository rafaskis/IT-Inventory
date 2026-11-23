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
  if (!['administrator', 'inventory_manager'].includes(profile.role)) {
    return response({ error: 'Audit history access is restricted to administrators and inventory managers.' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return response({ error: 'Invalid request body.' }, 400); }

  const action = String(body.action ?? 'list');
  if (action === 'item_history') {
    const itemCode = String(body.item_code ?? '').trim().toUpperCase();
    if (!/^MJPO-\d{6,}$/.test(itemCode)) return response({ error: 'Enter a valid Item Code.' }, 400);
    const { data: item, error: itemError } = await admin
      .from('inventory_items')
      .select('id, item_code')
      .eq('item_code', itemCode)
      .maybeSingle();
    if (itemError) return response({ error: itemError.message }, 400);
    if (!item) return response({ error: 'Inventory item not found.' }, 404);
    const { data: events, error: eventsError } = await admin
      .from('audit_events')
      .select('id, entity_type, entity_id, action, actor_user_id, actor_username, changes, details, created_at')
      .eq('entity_type', 'inventory_item')
      .eq('entity_id', String(item.id))
      .order('created_at', { ascending: true })
      .limit(5000);
    if (eventsError) return response({ error: eventsError.message }, 400);
    return response({ success: true, item_code: item.item_code, events: events ?? [] });
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
  return response({ success: true, events: events ?? [], total: count ?? 0, page, page_size: pageSize });
});
