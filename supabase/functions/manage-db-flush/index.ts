import { createClient } from 'npm:@supabase/supabase-js@2'

const allowedOrigin = (Deno.env.get('APP_ALLOWED_ORIGIN') || 'http://localhost:5173').trim()
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

const response = (body: object, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

function getConfiguredKey(pluralName: string, legacyNames: string[]): string | null {
  const plural = Deno.env.get(pluralName)
  if (plural) {
    try {
      const parsed = JSON.parse(plural)
      if (typeof parsed === 'string' && parsed.length > 0) return parsed
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.default === 'string' && parsed.default.length > 0) return parsed.default
        if (Array.isArray(parsed)) {
          const preferred = parsed.find((entry) =>
            entry && typeof entry === 'object' && (entry.name === 'default' || entry.is_default === true)
          )
          if (typeof preferred?.key === 'string') return preferred.key
          if (typeof preferred?.value === 'string') return preferred.value
        }
      }
    } catch {
      // Older local Supabase CLI versions may expose only the legacy variable.
    }
  }
  for (const name of legacyNames) {
    const value = Deno.env.get(name)
    if (value) return value
  }
  return null
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder()
  const a = encoder.encode(left)
  const b = encoder.encode(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return difference === 0
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (origin && origin !== allowedOrigin) return response({ error: 'This application origin is not allowed.' }, 403)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'Method not allowed.' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const publishableKey = getConfiguredKey('SUPABASE_PUBLISHABLE_KEYS', ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'])
    const serviceKey = getConfiguredKey('SUPABASE_SECRET_KEYS', ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'])
    if (!url || !publishableKey || !serviceKey) {
      const missing = [
        !url ? 'SUPABASE_URL' : '',
        !publishableKey ? 'SUPABASE_PUBLISHABLE_KEYS or SUPABASE_ANON_KEY' : '',
        !serviceKey ? 'SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY' : '',
      ].filter(Boolean)
      return response({ error: `Local Edge Function configuration is missing: ${missing.join(', ')}. Restart 'supabase functions serve' after starting Supabase.` }, 500)
    }

    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return response({ error: 'Authentication required.' }, 401)

    const userClient = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: authData, error: authError } = await userClient.auth.getUser(token)
    if (authError || !authData.user) {
      console.error('Flush auth validation failed:', authError?.message ?? 'No user returned')
      return response({ error: `Your session could not be verified: ${authError?.message ?? 'No authenticated user was returned.'}` }, 401)
    }

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: actor, error: actorError } = await admin.from('profiles')
      .select('id, username, role, is_active').eq('id', authData.user.id).maybeSingle()
    if (actorError) {
      console.error('Flush actor profile lookup failed:', actorError.message)
      return response({ error: `Unable to verify your application profile: ${actorError.message}` }, 500)
    }
    if (!actor?.is_active || actor.role !== 'administrator') {
      return response({ error: 'Only an active administrator can use the database flush operation.' }, 403)
    }

    let body: Record<string, unknown>
    try { body = await req.json() } catch { return response({ error: 'Invalid request body.' }, 400) }

    if (body.action === 'preview') {
      // No administrator enumeration is necessary: the authenticated actor is
      // always the account that will be retained if this actor confirms a flush.
      const tableNames = [
        'inventory_items', 'inventory_item_employees', 'employees', 'locations',
        'item_types', 'brands', 'models', 'audit_events', 'profiles',
      ] as const
      const countResults = await Promise.all(tableNames.map((table) =>
        admin.from(table).select('*', { count: 'exact', head: true })
      ))
      const failedCountIndex = countResults.findIndex((result) => result.error)
      if (failedCountIndex !== -1) {
        const failedTable = tableNames[failedCountIndex]
        const reason = countResults[failedCountIndex].error?.message ?? 'Unknown database error'
        console.error(`Unable to count rows in ${failedTable}:`, reason)
        return response({ error: `Unable to prepare deletion summary for '${failedTable}': ${reason}` }, 500)
      }

      const counts = Object.fromEntries(tableNames.map((table, index) => [table, countResults[index].count ?? 0]))
      return response({
        success: true,
        counts,
        retainedAdministrator: { id: actor.id, username: actor.username },
      })
    }

    if (body.action !== 'verify_password' && body.action !== 'flush') {
      return response({ error: 'Invalid action.' }, 400)
    }

    const configuredPassword = Deno.env.get('DB_FLUSH_PASSWORD')
    if (!configuredPassword) {
      return response({ error: 'DB_FLUSH_PASSWORD is not available to this Edge Function. Check the exact variable name in supabase/.env.local and restart the Edge Functions.' }, 503)
    }
    if (configuredPassword.length < 16) {
      return response({ error: 'DB_FLUSH_PASSWORD must contain at least 16 characters. Update it in supabase/.env.local and restart the Edge Functions.' }, 503)
    }
    if (typeof body.flushPassword !== 'string' || body.flushPassword.length > 512 || !constantTimeEqual(body.flushPassword, configuredPassword)) {
      return response({ error: 'The database flush password is incorrect.' }, 403)
    }
    if (body.action === 'verify_password') {
      return response({ success: true, passwordVerified: true })
    }
    if (body.confirmation !== 'FLUSH DATABASE') return response({ error: 'Type FLUSH DATABASE exactly to confirm.' }, 400)

    // The authenticated administrator performing the operation is always retained.
    // Ignore any retainedAdminId supplied by older clients; the client cannot
    // choose a different account to preserve.
    const { data: result, error: flushError } = await admin.rpc('flush_application_database', {
      p_actor_id: actor.id,
      p_retained_admin_id: actor.id,
    })
    if (flushError) {
      console.error('Database flush failed:', flushError.message)
      return response({ error: `Database flush failed: ${flushError.message}` }, 400)
    }
    return response({ success: true, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Unexpected manage-db-flush error:', message)
    return response({ error: `Unexpected database flush service error: ${message}` }, 500)
  }
})
