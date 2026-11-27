
import { createClient } from 'npm:@supabase/supabase-js@2'

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
}

type UserRole = 'administrator' | 'inventory_manager' | 'viewer'

type RequestBody = {
  action?: string
  id?: string | number
  fullName?: string
  acknowledged?: boolean
  rows?: { rowNumber?: number; fullName?: string }[]
}

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function getDefaultKey(
  pluralName: string,
  legacyName: string,
): string | null {
  const plural = Deno.env.get(pluralName)

  if (plural) {
    try {
      return JSON.parse(plural).default ?? null
    } catch {
      return null
    }
  }

  return Deno.env.get(legacyName) ?? null
}

function validId(value: unknown): value is string | number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
  }

  return (
    typeof value === 'string' &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  )
}

function getDatabaseErrorMessage(error: {
  code?: string
  message?: string
}) {
  const message = (error.message || '').toLowerCase()

  if (
    error.code === '23505' ||
    message.includes('duplicate key') ||
    message.includes('unique constraint')
  ) {
    return 'An employee with this name already exists.'
  }

  if (
    error.code === '23503' ||
    message.includes('foreign key constraint')
  ) {
    return 'This employee is still assigned to inventory items and cannot be deleted.'
  }

  return error.message || 'An unexpected database error occurred.'
}

Deno.serve(async (req) => {
  const originRejection = rejectDisallowedOrigin(req)
  if (originRejection) return originRejection

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return response({ error: 'Method not allowed.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')

  const publishableKey = getDefaultKey(
    'SUPABASE_PUBLISHABLE_KEYS',
    'SUPABASE_ANON_KEY',
  )

  const secretKey = getDefaultKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
  )

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error('Supabase environment configuration is incomplete.')
    return response({ error: 'Server configuration error.' }, 500)
  }

  const authorization = req.headers.get('Authorization')
  const token = authorization?.match(/^Bearer (.+)$/i)?.[1]

  if (!token) {
    return response({ error: 'Authentication required.' }, 401)
  }

  const supabaseUser = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })

  const { data: authData, error: authError } =
    await supabaseUser.auth.getUser()

  if (authError || !authData.user) {
    return response({ error: 'Invalid or expired session.' }, 401)
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const { data: actor, error: actorError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, role, is_active')
    .eq('id', authData.user.id)
    .single()

  if (
    actorError ||
    !actor ||
    !actor.is_active ||
    !(['administrator', 'inventory_manager', 'viewer'] as UserRole[]).includes(
      actor.role,
    )
  ) {
    return response({ error: 'Employee management access required.' }, 403)
  }

  let body: RequestBody

  try {
    body = await req.json()
  } catch {
    return response({ error: 'Invalid request body.' }, 400)
  }

  // BATCH IMPORT PREVIEW — ADMINISTRATORS ONLY
  if (body.action === 'preview_batch') {
    if (!['administrator', 'inventory_manager'].includes(actor.role)) {
      return response({ error: 'Employee import access required.' }, 403)
    }

    const { data: employees, error: listError } = await supabaseAdmin
      .from('employees')
      .select('id, full_name')
      .order('full_name', { ascending: true })

    if (listError) {
      console.error('Employee batch preview failed:', listError.message)
      return response({ error: 'Unable to retrieve existing employees for validation.' }, 500)
    }

    return response({ success: true, employees: employees ?? [] })
  }

  // ATOMIC BATCH IMPORT — FINAL VALIDATION IS PERFORMED IN THE DATABASE
  if (body.action === 'batch_import') {
    if (!['administrator', 'inventory_manager'].includes(actor.role)) {
      return response({ error: 'Employee import access required.' }, 403)
    }
    if (body.acknowledged !== true) {
      return response({ error: 'Explicit import acknowledgement is required.' }, 400)
    }
    if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 1000) {
      return response({ error: 'The import must contain between 1 and 1,000 employee rows.' }, 400)
    }
    if (body.rows.some((row) =>
      !row ||
      !Number.isInteger(row.rowNumber) ||
      (row.rowNumber ?? 0) < 2 ||
      typeof row.fullName !== 'string' ||
      row.fullName.length > 200
    )) {
      return response({ error: 'The employee import contains invalid row data.' }, 400)
    }

    const { data: result, error: importError } = await supabaseAdmin.rpc('employee_batch_import', {
      p_rows: body.rows,
      p_actor_id: actor.id,
      p_actor_username: actor.username,
    })

    if (importError) {
      console.error('Employee batch import failed:', importError.message)
      return response({ error: getDatabaseErrorMessage(importError) }, importError.code === '23505' ? 409 : 400)
    }

    if (result?.success === false) {
      return response({
        error: 'The employee data changed or contains conflicts. Review the affected rows and try again.',
        conflicts: result.conflicts ?? [],
      }, 409)
    }

    return response({
      success: true,
      createdCount: result?.createdCount ?? 0,
      created: result?.created ?? [],
    })
  }

  // LIST EMPLOYEES WITH ASSIGNED INVENTORY COUNTS
  if (body.action === 'list') {
    const { data: employees, error: employeesError } = await supabaseAdmin
      .from('employees')
      .select(`
        id,
        full_name,
        created_at,
        updated_at,
        inventory_item_employees (
          inventory_item_id
        )
      `)
      .order('full_name')

    if (employeesError) {
      console.error('Employee list failed:', employeesError.message)
      return response({ error: 'Unable to retrieve employees.' }, 500)
    }

    const result = (employees ?? []).map((employee) => ({
      id: employee.id,
      full_name: employee.full_name,
      created_at: employee.created_at,
      updated_at: employee.updated_at,
      inventory_count: employee.inventory_item_employees?.length ?? 0,
    }))

    return response({
      success: true,
      employees: result,
    })
  }

  // CREATE EMPLOYEE
  if (body.action === 'create') {
    const fullName =
      typeof body.fullName === 'string' ? body.fullName.trim() : ''

    if (!fullName || fullName.length > 200) {
      return response({
        error: 'Employee name is required and cannot exceed 200 characters.',
      }, 400)
    }

    const { data: created, error: createError } =
      await supabaseAdmin.rpc('employee_create', {
        p_full_name: fullName,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (createError || !created) {
      console.error('Employee creation failed:', createError)

      return response({
        error: createError
          ? getDatabaseErrorMessage(createError)
          : 'Unable to create employee.',
      }, createError?.code === '23505' ? 409 : 400)
    }

    return response({
      success: true,
      employee: created,
    }, 201)
  }

  // RENAME EMPLOYEE
  if (body.action === 'rename') {
    if (!validId(body.id)) {
      return response({ error: 'A valid employee ID is required.' }, 400)
    }

    const fullName =
      typeof body.fullName === 'string' ? body.fullName.trim() : ''

    if (!fullName || fullName.length > 200) {
      return response({
        error: 'Employee name is required and cannot exceed 200 characters.',
      }, 400)
    }

    const { data: updated, error: updateError } =
      await supabaseAdmin.rpc('employee_rename', {
        p_id: body.id,
        p_full_name: fullName,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (updateError || !updated) {
      console.error('Employee rename failed:', updateError)

      return response({
        error: updateError
          ? getDatabaseErrorMessage(updateError)
          : 'Unable to rename employee.',
      }, updateError?.code === '23505' ? 409 : 400)
    }

    return response({
      success: true,
      employee: updated,
    })
  }

  // DELETE EMPLOYEE
  if (body.action === 'delete') {
    if (!validId(body.id)) {
      return response({ error: 'A valid employee ID is required.' }, 400)
    }

    const { data: deleted, error: deleteError } =
      await supabaseAdmin.rpc('employee_delete', {
        p_id: body.id,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (deleteError || !deleted) {
      console.error('Employee deletion failed:', deleteError)

      return response({
        error: deleteError
          ? getDatabaseErrorMessage(deleteError)
          : 'Unable to delete employee.',
      }, deleteError?.code === '23503' ? 409 : 400)
    }

    return response({ success: true })
  }

  return response({ error: 'Unknown employee action.' }, 400)
})
