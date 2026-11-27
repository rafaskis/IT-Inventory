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

type CatalogueType = 'item_type' | 'brand' | 'model'
type UserRole = 'administrator' | 'inventory_manager' | 'viewer'

type RequestBody = {
  action?: string
  catalogueType?: CatalogueType
  id?: string
  name?: string
  itemTypeId?: string
  brandId?: string
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

const validTypes: CatalogueType[] = [
  'item_type',
  'brand',
  'model',
]

function validId(value: unknown): value is string | number {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0
  }

  return typeof value === 'string' &&
    /^[1-9]\d*$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
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
    !(['administrator', 'inventory_manager', 'viewer'] as UserRole[]).includes(actor.role)
  ) {
    return response({ error: 'Catalogue management access required.' }, 403)
  }

  let body: RequestBody

  try {
    body = await req.json()
  } catch {
    return response({ error: 'Invalid request body.' }, 400)
  }

  // LIST ALL CATALOGUES
  if (body.action === 'list') {
    const [
      { data: itemTypes, error: typesError },
      { data: brands, error: brandsError },
      { data: models, error: modelsError },
    ] = await Promise.all([
      supabaseAdmin
        .from('item_types')
        .select('id, name, created_at, updated_at')
        .order('name'),

      supabaseAdmin
        .from('brands')
        .select('id, item_type_id, name, created_at, updated_at')
        .order('name'),

      supabaseAdmin
        .from('models')
        .select('id, item_type_id, brand_id, name, created_at, updated_at')
        .order('name'),

    ])

    if (typesError || brandsError || modelsError) {
      console.error('Catalogue list failed:', {
        typesError,
        brandsError,
        modelsError,
      })

      return response({ error: 'Unable to retrieve catalogues.' }, 500)
    }

    // Read inventory in pages so counts remain accurate beyond the API row limit.
    const inventoryItems: Array<{
      item_type_id: number | string
      brand_id: number | string
      model_id: number | string
    }> = []

    for (let from = 0; ; from += 1000) {
      const { data: page, error: inventoryError } = await supabaseAdmin
        .from('inventory_items')
        .select('item_type_id, brand_id, model_id')
        .range(from, from + 999)

      if (inventoryError) {
        console.error('Catalogue inventory counts failed:', inventoryError)
        return response({ error: 'Unable to retrieve catalogue inventory counts.' }, 500)
      }

      inventoryItems.push(...(page ?? []))
      if (!page || page.length < 1000) break
    }

    const countBy = (key: 'item_type_id' | 'brand_id' | 'model_id') => {
      const counts = new Map<string, number>()
      for (const item of inventoryItems ?? []) {
        const id = String(item[key])
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
      return counts
    }

    const itemTypeCounts = countBy('item_type_id')
    const brandCounts = countBy('brand_id')
    const modelCounts = countBy('model_id')

    const withCount = <T extends { id: string | number }>(entries: T[] | null, counts: Map<string, number>) =>
      (entries ?? []).map((entry) => ({
        ...entry,
        inventory_count: counts.get(String(entry.id)) ?? 0,
      }))

    return response({
      success: true,
      itemTypes: withCount(itemTypes, itemTypeCounts),
      brands: withCount(brands, brandCounts),
      models: withCount(models, modelCounts),
    })
  }

  // VALIDATE CATALOGUE TYPE
  if (!body.catalogueType || !validTypes.includes(body.catalogueType)) {
    return response({ error: 'Invalid catalogue type.' }, 400)
  }

  const catalogueType = body.catalogueType

   // CREATE ENTRY
  if (body.action === 'create') {
    const name = body.name?.trim()

    if (!name || name.length > 100) {
      return response({
        error: 'Name is required and cannot exceed 100 characters.',
      }, 400)
    }

    if (
      (catalogueType === 'brand' || catalogueType === 'model') &&
      !validId(body.itemTypeId)
    ) {
      return response({ error: 'A valid item type is required.' }, 400)
    }

    if (catalogueType === 'model' && !validId(body.brandId)) {
      return response({ error: 'A valid brand is required.' }, 400)
    }

    const { data: created, error: createError } =
      await supabaseAdmin.rpc('catalogue_create_entry', {
        p_catalogue_type: catalogueType,
        p_name: name,
        p_item_type_id: body.itemTypeId ?? null,
        p_brand_id: body.brandId ?? null,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (createError || !created) {
      console.error('Catalogue creation failed:', createError?.message)

      const message = createError?.message || ''

      const duplicate =
        createError?.code === '23505' ||
        message.toLowerCase().includes('duplicate key') ||
        message.toLowerCase().includes('unique constraint')

      return response({
        error: duplicate
          ? 'An entry with this name already exists in this catalogue.'
          : message || 'Unable to create catalogue entry.',
      }, duplicate ? 409 : 400)
    }

    return response({
      success: true,
      entry: created,
    }, 201)
  }

    // RENAME ENTRY
  if (body.action === 'rename') {
    if (!validId(body.id)) {
      return response({ error: 'A valid entry ID is required.' }, 400)
    }

    const name = body.name?.trim()

    if (!name || name.length > 100) {
      return response({
        error: 'Name is required and cannot exceed 100 characters.',
      }, 400)
    }

    const { data: updated, error: updateError } =
      await supabaseAdmin.rpc('catalogue_rename_entry', {
        p_catalogue_type: catalogueType,
        p_id: body.id,
        p_name: name,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (updateError || !updated) {
      console.error('Catalogue rename failed:', updateError?.message)

      const message = updateError?.message || ''

      const duplicate =
        updateError?.code === '23505' ||
        message.toLowerCase().includes('duplicate key') ||
        message.toLowerCase().includes('unique constraint')

      return response({
        error: duplicate
          ? 'An entry with this name already exists in this catalogue.'
          : message || 'Unable to rename catalogue entry.',
      }, duplicate ? 409 : 400)
    }

    return response({
      success: true,
      entry: updated,
    })
  }

  // DELETE ENTRY
  if (body.action === 'delete') {
    if (!validId(body.id)) {
      return response({ error: 'A valid entry ID is required.' }, 400)
    }

    const { data: deleted, error: deleteError } =
      await supabaseAdmin.rpc('catalogue_delete_entry', {
        p_catalogue_type: catalogueType,
        p_id: body.id,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (deleteError || !deleted) {
      console.error('Catalogue deletion failed:', deleteError?.message)

      const message = deleteError?.message || ''

      const isForeignKey =
        deleteError?.code === '23503' ||
        message.toLowerCase().includes('foreign key constraint')
      const referencesInventory =
        isForeignKey && message.toLowerCase().includes('inventory_items')

      const entryName = {
        item_type: 'item type',
        brand: 'brand',
        model: 'model',
      }[catalogueType]

      return response({
        error: referencesInventory
          ? `This ${entryName} is still assigned to inventory items and cannot be deleted.`
          : isForeignKey
            ? `This ${entryName} is still used by other catalogue entries and cannot be deleted.`
            : message || 'Unable to delete catalogue entry.',
      }, isForeignKey ? 409 : 400)
    }

    return response({ success: true })
  }
  return response({ error: 'Unknown catalogue action.' }, 400)
})