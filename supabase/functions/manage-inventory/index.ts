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

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

const isPositiveInteger = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(number) && number > 0
}

const isSingleLineText = (value: unknown, maxLength = 200): value is string =>
  typeof value === 'string'
  && value.trim().length > 0
  && value.trim().length <= maxLength
  && !/[\r\n]/.test(value)

const isValidDateOnly = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

const normalizeMacAddress = (item: Record<string, unknown>): string | null => {
  if (!Object.prototype.hasOwnProperty.call(item, 'mac_address')) return null
  const value = item.mac_address
  if (value === null || value === '') return null
  if (typeof value !== 'string') return 'MAC address must be text or empty.'

  const trimmed = value.trim()
  const isCompact = /^[0-9a-f]{12}$/i.test(trimmed)
  const isColonSeparated = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(trimmed)
  if (!isCompact && !isColonSeparated) {
    return 'MAC address must contain exactly 12 hexadecimal characters in the format 00:1A:2B:3C:4D:5E, or be left empty.'
  }

  const hex = trimmed.replace(/:/g, '').toUpperCase()
  item.mac_address = hex.match(/.{2}/g)!.join(':')
  return null
}

const normalizeFilterIds = (value: unknown): number[] | null => {
  if (value === undefined || value === null || value === '') return []
  const values = Array.isArray(value) ? value : [value]
  if (values.length > 100 || !values.every(isPositiveInteger)) return null
  return [...new Set(values.map(Number))]
}

const normalizeEmployeeIds = (value: unknown): number[] | null => {
  if (!Array.isArray(value) || !value.every(isPositiveInteger)) return null
  return [...new Set(value.map(Number))]
}

const mapRpcError = (error: { code?: string; message?: string }) => {
  const message = error.message ?? 'The inventory operation failed.'

  if (error.code === '42501') {
    return jsonResponse({ error: message }, 403)
  }
  if (error.code === '23505') {
    return jsonResponse({ error: 'A record with one of these values already exists.' }, 409)
  }
  if (error.code === '23503') {
    return jsonResponse({ error: 'One of the selected catalogue, employee or location records is no longer available.' }, 409)
  }
  if (error.code === 'P0001' || error.code === '22023') {
    return jsonResponse({ error: message }, 400)
  }
  if (message.toLowerCase().includes('not found')) {
    return jsonResponse({ error: message }, 404)
  }

  console.error('Inventory RPC error:', error)
  return jsonResponse({ error: 'The inventory operation could not be completed.' }, 500)
}

Deno.serve(async (req) => {
  const originRejection = rejectDisallowedOrigin(req)
  if (originRejection) return originRejection

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized.' }, 401)
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    })

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser()

    if (authError || !user) {
      return jsonResponse({ error: 'Invalid or expired session.' }, 401)
    }

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('username, role, is_active')
      .eq('id', user.id)
      .single()

    if (profileError || !profile || !profile.is_active) {
      return jsonResponse({ error: 'Your account is inactive or not authorized.' }, 403)
    }

    const canRead = ['administrator', 'inventory_manager', 'viewer'].includes(profile.role)
    const canManage = ['administrator', 'inventory_manager'].includes(profile.role)
    const isAdministrator = profile.role === 'administrator'

    if (!canRead) {
      return jsonResponse({ error: 'You are not authorized to access inventory.' }, 403)
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Request body must contain valid JSON.' }, 400)
    }

    const action = body.action
    const showShared = body.show_shared === undefined ? true : body.show_shared
    if (typeof showShared !== 'boolean') {
      return jsonResponse({ error: 'Invalid shared-items visibility setting.' }, 400)
    }

    if (!['list', 'filter_options', 'get', 'create', 'update', 'update_with_related', 'bulk_update', 'get_many', 'preview_batch', 'batch_import', 'lifecycle_list', 'lifecycle_filter_options', 'transition_lifecycle'].includes(String(action))) {
      return jsonResponse({ error: 'Invalid action.' }, 400)
    }

    if (['create', 'update', 'update_with_related', 'bulk_update', 'get_many', 'transition_lifecycle'].includes(String(action)) && !canManage) {
      return jsonResponse({ error: 'You are not authorized to modify inventory.' }, 403)
    }

    const actorId = user.id
    const actorUsername = profile.username

    // BATCH IMPORT PREVIEW — ADMINISTRATORS ONLY
    if (action === 'preview_batch') {
      if (!isAdministrator) return jsonResponse({ error: 'Only administrators can import inventory.' }, 403)
      const [types, brands, models, locations] = await Promise.all([
        serviceClient.from('item_types').select('id, name').order('name'),
        serviceClient.from('brands').select('id, item_type_id, name').order('name'),
        serviceClient.from('models').select('id, item_type_id, brand_id, name').order('name'),
        serviceClient.from('locations').select('id, name').order('name'),
      ])
      const failed = [types, brands, models, locations].find((result) => result.error)
      if (failed?.error) {
        console.error('Inventory batch preview failed:', failed.error.message)
        return jsonResponse({ error: 'Unable to retrieve existing inventory and catalogue data for validation.' }, 500)
      }
      const identifiers: Record<string, unknown>[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data: page, error: pageError } = await serviceClient
          .from('inventory_items')
          .select('id, item_type_id, brand_id, model_id, serial_number, mac_address')
          .order('id', { ascending: true })
          .range(offset, offset + 999)
        if (pageError) {
          console.error('Inventory batch identifier preview failed:', pageError.message)
          return jsonResponse({ error: 'Unable to retrieve existing inventory identifiers for validation.' }, 500)
        }
        identifiers.push(...(page ?? []))
        if (!page || page.length < 1000) break
      }
      return jsonResponse({
        success: true,
        itemTypes: types.data ?? [], brands: brands.data ?? [], models: models.data ?? [],
        locations: locations.data ?? [], identifiers,
      })
    }

    // ATOMIC INVENTORY BATCH IMPORT — DATABASE REVALIDATES BEFORE WRITING
    if (action === 'batch_import') {
      if (!isAdministrator) return jsonResponse({ error: 'Only administrators can import inventory.' }, 403)
      if (body.acknowledged !== true) return jsonResponse({ error: 'Explicit import acknowledgement is required.' }, 400)
      if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 1000) {
        return jsonResponse({ error: 'The import must contain between 1 and 1,000 inventory rows.' }, 400)
      }
      const validText = (value: unknown, max = 500) => typeof value === 'string' && value.length <= max
      if (body.rows.some((value) => {
        if (!value || typeof value !== 'object') return true
        const row = value as Record<string, unknown>
        return !Number.isInteger(row.rowNumber) || Number(row.rowNumber) < 2
          || !validText(row.itemType, 100) || !validText(row.brand, 100) || !validText(row.model, 100)
          || !validText(row.serialNumber) || !validText(row.macAddress) || !validText(row.eoasis, 20)
          || !validText(row.invoice) || !validText(row.purchaseDate, 10) || !validText(row.warrantyDate, 10)
          || !validText(row.store) || !validText(row.location, 100)
      })) return jsonResponse({ error: 'The inventory import contains invalid row data.' }, 400)
      const rowNumbers = body.rows.map((value) => (value as Record<string, unknown>).rowNumber)
      if (new Set(rowNumbers).size !== rowNumbers.length) return jsonResponse({ error: 'The inventory import contains repeated Excel row numbers.' }, 400)
      const payloadSize = JSON.stringify(body.rows).length
      if (payloadSize > 5 * 1024 * 1024) return jsonResponse({ error: 'The import data cannot exceed 5 MB.' }, 413)
      const { data, error } = await serviceClient.rpc('inventory_batch_import', {
        p_rows: body.rows, p_actor_id: actorId, p_actor_username: actorUsername,
      })
      if (error) {
        console.error('Inventory batch import failed:', error.message, error.code)
        if (error.code === '42501') return jsonResponse({ error: 'Only active administrators can import inventory.' }, 403)
        if (error.code === '23505') return jsonResponse({ error: 'An inventory identifier or catalogue value changed during import. Review the rows and try again.' }, 409)
        return jsonResponse({ error: error.message || 'The inventory could not be imported. No records were created.' }, 400)
      }
      if (data?.success === false) return jsonResponse({ error: 'Some rows need your attention. No records were created.', conflicts: data.conflicts ?? [] }, 409)
      return jsonResponse({ success: true, createdCount: data?.createdCount ?? 0, created: data?.created ?? [] })
    }

const inventorySelect = `
  id,
  item_code,
  item_type_id,
  brand_id,
  model_id,
  serial_number,
  mac_address,
  pc_name,
  ip_address,
  socket,
  location_id,
  notes,
  document_number,
  invoice,
  purchase_date,
  warranty_until,
  store,
  lifecycle_status,
  gen_118,
  gen_118_date,
  gen_36,
  gen_36_date,
  gen_32a,
  service_name,
  gen_32a_date,
  created_by,
  updated_by,
  created_at,
  updated_at,
  brand:brands!inventory_items_brand_id_item_type_id_fkey(
    id,
    name,
    item_type:item_types!brands_item_type_id_fkey(id, name)
  ),
  model:models!inventory_items_model_id_brand_id_item_type_id_fkey(id, name),
  location:locations(id, name),
  assignments:inventory_item_employees(
    employee:employees(id, full_name)
  )
    `

    const lifecycleSelect = `
  id,
  item_code,
  item_type_id,
  brand_id,
  model_id,
  serial_number,
  mac_address,
  notes,
  document_number,
  invoice,
  purchase_date,
  warranty_until,
  store,
  lifecycle_status,
  gen_118,
  gen_118_date,
  gen_36,
  gen_36_date,
  gen_32a,
  service_name,
  gen_32a_date,
  created_by,
  updated_by,
  created_at,
  updated_at,
  brand:brands!inventory_items_brand_id_item_type_id_fkey(
    id,
    name,
    item_type:item_types!brands_item_type_id_fkey(id, name)
  ),
  model:models!inventory_items_model_id_brand_id_item_type_id_fkey(id, name)
    `

    const attachActorNames = async (items: Record<string, unknown>[]) => {
      const actorIds = [...new Set(
        items.flatMap((item) => [item.created_by, item.updated_by])
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      )]

      let usernames = new Map<string, string>()
      if (actorIds.length > 0) {
        const { data: actors, error } = await serviceClient
          .from('profiles')
          .select('id, username')
          .in('id', actorIds)

        if (error) throw new Error('Could not load inventory creator/updater names.')
        usernames = new Map((actors ?? []).map((actor) => [actor.id, actor.username]))
      }

      return items.map((item) => ({
        ...item,
        created_by_username:
          typeof item.created_by === 'string' ? usernames.get(item.created_by) ?? null : null,
        updated_by_username:
          typeof item.updated_by === 'string' ? usernames.get(item.updated_by) ?? null : null,
        employees: ((item.assignments as Array<{
          employee: { id: number; full_name: string } | null
        }> | null) ?? [])
          .map((assignment) => assignment.employee)
          .filter((employee): employee is { id: number; full_name: string } => employee !== null)
          .sort((a, b) => a.full_name.localeCompare(b.full_name)),
      }))
    }

    if (action === 'lifecycle_filter_options') {
      const lifecycleStatus = String(body.lifecycle_status ?? '')
      if (!['pending_scrap', 'scrapped', 'gifted'].includes(lifecycleStatus)) {
        return jsonResponse({ error: 'Invalid inventory lifecycle section.' }, 400)
      }

      const [types, brandRows, modelRows] = await Promise.all([
        serviceClient.from('item_types').select('id, name').order('name'),
        serviceClient.from('brands').select('id, item_type_id, name').order('name'),
        serviceClient.from('models').select('id, item_type_id, brand_id, name').order('name'),
      ])
      const failed = [types, brandRows, modelRows].find((result) => result.error)
      if (failed?.error) {
        console.error('Lifecycle filter options error:', failed.error.message)
        return jsonResponse({ error: 'Could not load lifecycle filter options.' }, 500)
      }
      return jsonResponse({
        options: {
          item_types: types.data ?? [],
          brands: brandRows.data ?? [],
          models: modelRows.data ?? [],
        },
      })
    }

    if (action === 'lifecycle_list') {
      const lifecycleStatus = String(body.lifecycle_status ?? '')
      if (!['pending_scrap', 'scrapped', 'gifted'].includes(lifecycleStatus)) {
        return jsonResponse({ error: 'Invalid inventory lifecycle section.' }, 400)
      }

      const page = Math.max(1, Math.min(100000, Number.parseInt(String(body.page ?? 1), 10) || 1))
      const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(body.page_size ?? 25), 10) || 25))
      const allowedSortColumns = [
        'item_code', 'serial_number', 'document_number', 'purchase_date',
        'warranty_until', 'store', 'created_at', 'updated_at',
        'gen_118_date', 'gen_36_date', 'gen_32a_date',
      ]
      const requestedSort = String(body.sort_by ?? 'updated_at')
      if (!allowedSortColumns.includes(requestedSort)) {
        return jsonResponse({ error: 'Invalid sort field.' }, 400)
      }
      const sortOrder = body.sort_order === undefined ? 'desc' : String(body.sort_order)
      if (!['asc', 'desc'].includes(sortOrder)) {
        return jsonResponse({ error: 'Invalid sort order.' }, 400)
      }

      const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
        ? body.filters as Record<string, unknown>
        : {}
      const allowedFilterNames = new Set([
        'item_type_ids', 'brand_ids', 'model_ids', 'lifecycle_reference',
        'purchase_date_from', 'purchase_date_to',
        'warranty_date_from', 'warranty_date_to',
        'lifecycle_date_from', 'lifecycle_date_to',
      ])
      const unknownFilters = Object.keys(filters).filter((field) => !allowedFilterNames.has(field))
      if (unknownFilters.length > 0) {
        return jsonResponse({ error: `Unknown filter: ${unknownFilters[0]}.` }, 400)
      }

      const lifecycleReferenceValue = filters.lifecycle_reference
      if (lifecycleReferenceValue !== undefined && lifecycleReferenceValue !== null
          && (typeof lifecycleReferenceValue !== 'string'
            || lifecycleReferenceValue.length > 100
            || /[\r\n]/.test(lifecycleReferenceValue))) {
        return jsonResponse({ error: 'Invalid lifecycle document reference filter.' }, 400)
      }
      const lifecycleReference = typeof lifecycleReferenceValue === 'string'
        ? lifecycleReferenceValue.trim().replace(/[%_]/g, '')
        : ''

      const idFilters: Record<string, number[]> = {
        item_type_ids: [], brand_ids: [], model_ids: [],
      }
      for (const field of Object.keys(idFilters)) {
        const normalized = normalizeFilterIds(filters[field])
        if (normalized === null) {
          return jsonResponse({ error: `Invalid ${field} filter. Supply up to 100 positive integer IDs.` }, 400)
        }
        idFilters[field] = normalized
      }

      const dateFilterNames = [
        'purchase_date_from', 'purchase_date_to',
        'warranty_date_from', 'warranty_date_to',
        'lifecycle_date_from', 'lifecycle_date_to',
      ] as const
      const dateFilters: Record<(typeof dateFilterNames)[number], string | null> = {
        purchase_date_from: null, purchase_date_to: null,
        warranty_date_from: null, warranty_date_to: null,
        lifecycle_date_from: null, lifecycle_date_to: null,
      }
      for (const field of dateFilterNames) {
        const value = filters[field]
        if (value !== undefined && value !== null && value !== '') {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return jsonResponse({ error: `Invalid ${field} date.` }, 400)
          }
          dateFilters[field] = value
        }
      }
      if (dateFilters.purchase_date_from && dateFilters.purchase_date_to
          && dateFilters.purchase_date_from > dateFilters.purchase_date_to) {
        return jsonResponse({ error: 'Purchase date start cannot be after purchase date end.' }, 400)
      }
      if (dateFilters.warranty_date_from && dateFilters.warranty_date_to
          && dateFilters.warranty_date_from > dateFilters.warranty_date_to) {
        return jsonResponse({ error: 'Warranty date start cannot be after warranty date end.' }, 400)
      }
      if (dateFilters.lifecycle_date_from && dateFilters.lifecycle_date_to
          && dateFilters.lifecycle_date_from > dateFilters.lifecycle_date_to) {
        return jsonResponse({ error: 'Lifecycle date start cannot be after lifecycle date end.' }, 400)
      }

      const search = typeof body.search === 'string' ? body.search.trim().slice(0, 100) : ''
      const safeSearch = search.replace(/[,%()"\\]/g, ' ').replace(/\s+/g, ' ').trim()
      let query = serviceClient
        .from('inventory_items')
        .select(lifecycleSelect, { count: 'exact' })
        .eq('lifecycle_status', lifecycleStatus)

      if (safeSearch) {
        const pattern = `%${safeSearch}%`
        const lifecycleReferenceColumn = lifecycleStatus === 'pending_scrap'
          ? 'gen_118'
          : lifecycleStatus === 'scrapped' ? 'gen_36' : 'gen_32a'
        query = query.or([
          `item_code.ilike.${pattern}`,
          `serial_number.ilike.${pattern}`,
          `${lifecycleReferenceColumn}.ilike.${pattern}`,
        ].join(','))
      }
      if (idFilters.item_type_ids.length) query = query.in('item_type_id', idFilters.item_type_ids)
      if (idFilters.brand_ids.length) query = query.in('brand_id', idFilters.brand_ids)
      if (idFilters.model_ids.length) query = query.in('model_id', idFilters.model_ids)
      if (dateFilters.purchase_date_from) query = query.gte('purchase_date', dateFilters.purchase_date_from)
      if (dateFilters.purchase_date_to) query = query.lte('purchase_date', dateFilters.purchase_date_to)
      if (dateFilters.warranty_date_from) query = query.gte('warranty_until', dateFilters.warranty_date_from)
      if (dateFilters.warranty_date_to) query = query.lte('warranty_until', dateFilters.warranty_date_to)
      const lifecycleDateColumn = lifecycleStatus === 'pending_scrap'
        ? 'gen_118_date'
        : lifecycleStatus === 'scrapped' ? 'gen_36_date' : 'gen_32a_date'
      const lifecycleReferenceColumn = lifecycleStatus === 'pending_scrap'
        ? 'gen_118'
        : lifecycleStatus === 'scrapped' ? 'gen_36' : 'gen_32a'
      if (lifecycleReference) query = query.ilike(lifecycleReferenceColumn, `%${lifecycleReference}%`)
      if (dateFilters.lifecycle_date_from) query = query.gte(lifecycleDateColumn, dateFilters.lifecycle_date_from)
      if (dateFilters.lifecycle_date_to) query = query.lte(lifecycleDateColumn, dateFilters.lifecycle_date_to)

      const { data, error, count } = await query
        .order(requestedSort, { ascending: sortOrder === 'asc', nullsFirst: false })
        .order('id', { ascending: true })
        .range((page - 1) * pageSize, page * pageSize - 1)

      if (error) {
        console.error('Lifecycle inventory list error:', error.message)
        return jsonResponse({ error: 'Could not load lifecycle inventory items.' }, 500)
      }
      const items = await attachActorNames((data ?? []) as unknown as Record<string, unknown>[])
      const total = count ?? 0
      return jsonResponse({
        items, total, page, page_size: pageSize,
        total_pages: Math.ceil(total / pageSize),
      })
    }

    if (action === 'transition_lifecycle') {
      const lifecycleStatus = String(body.target_status ?? '')
      if (!['pending_scrap', 'scrapped', 'gifted'].includes(lifecycleStatus)) {
        return jsonResponse({ error: 'Invalid inventory lifecycle transition.' }, 400)
      }
      if (!Array.isArray(body.item_ids)
          || body.item_ids.length < 1
          || body.item_ids.length > 500
          || !body.item_ids.every(isPositiveInteger)) {
        return jsonResponse({ error: 'Select between 1 and 500 inventory items.' }, 400)
      }
      const itemIds = [...new Set(body.item_ids.map(Number))]
      if (itemIds.length !== body.item_ids.length) {
        return jsonResponse({ error: 'The selection contains duplicate inventory items.' }, 400)
      }
      const reference = body.reference
      if (!isSingleLineText(reference, 200)) {
        return jsonResponse({ error: 'A valid single-line document reference of up to 200 characters is required.' }, 400)
      }
      const transitionDate = body.transition_date
      if (!isValidDateOnly(transitionDate)) {
        return jsonResponse({ error: 'Select a valid lifecycle date.' }, 400)
      }
      const serviceName = body.service_name
      if (lifecycleStatus === 'gifted') {
        if (!isSingleLineText(serviceName, 200)) {
          return jsonResponse({ error: 'A valid single-line service name of up to 200 characters is required.' }, 400)
        }
      } else if (serviceName !== undefined && serviceName !== null && serviceName !== '') {
        return jsonResponse({ error: 'A service name is only required for the goods issue transition.' }, 400)
      }
      const normalizedServiceName = lifecycleStatus === 'gifted' ? String(serviceName).trim() : null

      const { data, error } = await serviceClient.rpc('inventory_transition_items', {
        p_item_ids: itemIds,
        p_target_status: lifecycleStatus,
        p_reference: reference.trim(),
        p_service_name: normalizedServiceName,
        p_transition_date: transitionDate,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })
      if (error) return mapRpcError(error)
      return jsonResponse(data ?? { success: true, updatedCount: itemIds.length })
    }

    if (action === 'filter_options') {
      const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
        ? body.filters as Record<string, unknown>
        : {}

      const filterNames = [
        'item_type_ids',
        'brand_ids',
        'model_ids',
        'location_ids',
        'employee_ids',
      ] as const

      const idFilters: Record<(typeof filterNames)[number], number[]> = {
        item_type_ids: [],
        brand_ids: [],
        model_ids: [],
        location_ids: [],
        employee_ids: [],
      }

      const unknownFilters = Object.keys(filters).filter((field) => !filterNames.includes(field as typeof filterNames[number]))
      if (unknownFilters.length > 0) {
        return jsonResponse({ error: `Unknown filter: ${unknownFilters[0]}.` }, 400)
      }

      for (const field of filterNames) {
        const normalized = normalizeFilterIds(filters[field])
        if (normalized === null) {
          return jsonResponse({ error: `Invalid ${field} filter. Supply up to 100 positive integer IDs.` }, 400)
        }
        idFilters[field] = normalized
      }

      const search = typeof body.search === 'string'
        ? body.search.trim().slice(0, 100)
        : ''
      const safeSearch = search
        .replace(/[,%()"\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const { data, error } = await serviceClient.rpc('inventory_filter_options', {
        p_search: safeSearch || null,
        p_show_shared: showShared,
        p_item_type_ids: idFilters.item_type_ids,
        p_brand_ids: idFilters.brand_ids,
        p_model_ids: idFilters.model_ids,
        p_location_ids: idFilters.location_ids,
        p_employee_ids: idFilters.employee_ids,
      })

      if (error) {
        console.error('Inventory filter options error:', error)
        return jsonResponse({ error: 'Could not load inventory filter options.' }, 500)
      }

      return jsonResponse({ options: data ?? {} })
    }

    if (action === 'list') {
      const page = Math.max(1, Math.min(100000, Number.parseInt(String(body.page ?? 1), 10) || 1))
      const pageSize = Math.max(1, Math.min(100, Number.parseInt(String(body.page_size ?? 25), 10) || 25))

      const allowedSortColumns = [
        'item_code', 'item_type', 'brand', 'model', 'serial_number', 'mac_address',
        'pc_name', 'ip_address', 'socket', 'location', 'employee', 'document_number',
        'purchase_date', 'warranty_until', 'store', 'created_at', 'updated_at',
      ]
      const requestedSort = String(body.sort_by ?? 'created_at')
      if (!allowedSortColumns.includes(requestedSort)) {
        return jsonResponse({ error: 'Invalid sort field.' }, 400)
      }
      const sortOrder = body.sort_order === undefined ? 'desc' : String(body.sort_order)
      if (!['asc', 'desc'].includes(sortOrder)) {
        return jsonResponse({ error: 'Invalid sort order.' }, 400)
      }

      const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
        ? body.filters as Record<string, unknown>
        : {}

      const filterAliases = [
        ['item_type_ids', 'item_type_id'],
        ['brand_ids', 'brand_id'],
        ['model_ids', 'model_id'],
        ['location_ids', 'location_id'],
        ['employee_ids', 'employee_id'],
      ] as const

      const allowedFilterNames = new Set([
        ...filterAliases.flatMap(([plural, singular]) => [plural, singular]),
        'purchase_date_from',
        'purchase_date_to',
        'warranty_date_from',
        'warranty_date_to',
      ])

      const unknownFilters = Object.keys(filters).filter((field) => !allowedFilterNames.has(field))
      if (unknownFilters.length > 0) {
        return jsonResponse({ error: `Unknown filter: ${unknownFilters[0]}.` }, 400)
      }

      const idFilters: Record<string, number[]> = {
        item_type_ids: [],
        brand_ids: [],
        model_ids: [],
        location_ids: [],
        employee_ids: [],
      }

      for (const [plural, singular] of filterAliases) {
        if (filters[plural] !== undefined && filters[singular] !== undefined) {
          return jsonResponse({ error: `Use either ${plural} or ${singular}, not both.` }, 400)
        }
        const value = filters[plural] !== undefined ? filters[plural] : filters[singular]
        const normalized = normalizeFilterIds(value)
        if (normalized === null) {
          return jsonResponse({ error: `Invalid ${plural} filter. Supply up to 100 positive integer IDs.` }, 400)
        }
        idFilters[plural] = normalized
      }

      const dateFilterNames = [
        'purchase_date_from',
        'purchase_date_to',
        'warranty_date_from',
        'warranty_date_to',
      ] as const
      const dateFilters: Record<(typeof dateFilterNames)[number], string | null> = {
        purchase_date_from: null,
        purchase_date_to: null,
        warranty_date_from: null,
        warranty_date_to: null,
      }

      for (const field of dateFilterNames) {
        const value = filters[field]
        if (value !== undefined && value !== null && value !== '') {
          if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return jsonResponse({ error: `Invalid ${field} date.` }, 400)
          }
          dateFilters[field] = value
        }
      }

      if (dateFilters.purchase_date_from && dateFilters.purchase_date_to
          && dateFilters.purchase_date_from > dateFilters.purchase_date_to) {
        return jsonResponse({ error: 'Purchase date start cannot be after purchase date end.' }, 400)
      }
      if (dateFilters.warranty_date_from && dateFilters.warranty_date_to
          && dateFilters.warranty_date_from > dateFilters.warranty_date_to) {
        return jsonResponse({ error: 'Warranty date start cannot be after warranty date end.' }, 400)
      }

      const search = typeof body.search === 'string'
        ? body.search.trim().slice(0, 100)
        : ''
      const safeSearch = search
        .replace(/[,%()"\\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const { data: pageResult, error: pageError } = await serviceClient.rpc('inventory_list_item_ids', {
        p_search: safeSearch || null,
        p_show_shared: showShared,
        p_item_type_ids: idFilters.item_type_ids,
        p_brand_ids: idFilters.brand_ids,
        p_model_ids: idFilters.model_ids,
        p_location_ids: idFilters.location_ids,
        p_employee_ids: idFilters.employee_ids,
        p_purchase_date_from: dateFilters.purchase_date_from,
        p_purchase_date_to: dateFilters.purchase_date_to,
        p_warranty_from: dateFilters.warranty_date_from,
        p_warranty_to: dateFilters.warranty_date_to,
        p_sort_by: requestedSort,
        p_sort_order: sortOrder,
        p_page: page,
        p_page_size: pageSize,
      })

      if (pageError) {
        console.error('Inventory list ordering error:', pageError)
        return jsonResponse({ error: 'Could not load inventory items.' }, 500)
      }

      const itemIds = Array.isArray(pageResult?.ids)
        ? pageResult.ids.map((id: unknown) => Number(id))
        : []
      const total = Number(pageResult?.total ?? 0)

      if (itemIds.length === 0) {
        return jsonResponse({
          items: [],
          total,
          page,
          page_size: pageSize,
          total_pages: Math.ceil(total / pageSize),
        })
      }

      const { data, error } = await serviceClient
        .from('inventory_items')
        .select(inventorySelect)
        .in('id', itemIds)
        .eq('lifecycle_status', 'active')

      if (error) {
        console.error('Inventory list item fetch error:', error)
        return jsonResponse({ error: 'Could not load inventory items.' }, 500)
      }

      const fetchedItems = await attachActorNames((data ?? []) as unknown as Record<string, unknown>[])
      const itemById = new Map<number, Record<string, unknown>>(
        fetchedItems.map((item) => [Number(item.id), item] as const)
      )
      const items = itemIds
        .map((id: number) => itemById.get(id))
        .filter((item): item is Record<string, unknown> => item !== undefined)

      return jsonResponse({
        items,
        total,
        page,
        page_size: pageSize,
        total_pages: Math.ceil(total / pageSize),
      })
    }

    if (action === 'get') {
      if (!isPositiveInteger(body.id)) {
        return jsonResponse({ error: 'Invalid inventory item ID.' }, 400)
      }

      const { data, error } = await serviceClient
        .from('inventory_items')
        .select(inventorySelect)
        .eq('id', Number(body.id))
        .eq('lifecycle_status', 'active')
        .maybeSingle()

      if (error) {
        console.error('Inventory get error:', error)
        return jsonResponse({ error: 'Could not load the inventory item.' }, 500)
      }
      if (!data) return jsonResponse({ error: 'Inventory item not found.' }, 404)

      const [item] = await attachActorNames([data as unknown as Record<string, unknown>])
      return jsonResponse({ item })
    }

    if (action === 'get_many') {
      if (!Array.isArray(body.item_ids) || body.item_ids.length === 0 || body.item_ids.length > 500 || !body.item_ids.every(isPositiveInteger)) {
        return jsonResponse({ error: 'Supply between 1 and 500 valid inventory item IDs.' }, 400)
      }
      const ids = [...new Set(body.item_ids.map(Number))]
      const { data, error } = await serviceClient.from('inventory_items').select(inventorySelect).in('id', ids).eq('lifecycle_status', 'active')
      if (error) {
        console.error('Inventory bulk preview error:', error)
        return jsonResponse({ error: 'Could not load the selected inventory items.' }, 500)
      }
      const attached = await attachActorNames((data ?? []) as unknown as Record<string, unknown>[])
      const byId = new Map<number, Record<string, unknown>>(attached.map((item) => [Number(item.id), item] as const))
      const ordered = ids.map((id) => byId.get(id)).filter((item) => item !== undefined)
      if (ordered.length !== ids.length) return jsonResponse({ error: 'One or more selected inventory items no longer exist.' }, 409)
      return jsonResponse({ items: ordered })
    }

    if (action === 'create') {
      if (typeof body.new_location_name === 'string' && body.new_location_name.trim() && !isAdministrator) {
        return jsonResponse({ error: 'Only administrators can create new locations.' }, 403)
      }
      if (!body.item || typeof body.item !== 'object' || Array.isArray(body.item)) {
        return jsonResponse({ error: 'Item details are required.' }, 400)
      }
      const item = { ...(body.item as Record<string, unknown>) }
      const macError = normalizeMacAddress(item)
      if (macError) return jsonResponse({ error: macError }, 400)

      const employeeIds = normalizeEmployeeIds(body.employee_ids ?? [])
      if (employeeIds === null) {
        return jsonResponse({ error: 'Employee IDs must be an array of valid IDs.' }, 400)
      }

      const newEmployeeNames = body.new_employee_names === undefined ? [] : body.new_employee_names
      if (!Array.isArray(newEmployeeNames) || newEmployeeNames.length > 50
          || !newEmployeeNames.every((name) => typeof name === 'string')) {
        return jsonResponse({ error: 'New employee names must be an array of up to 50 names.' }, 400)
      }
      const optionalName = (value: unknown) => typeof value === 'string' ? value.trim() : ''
      const { data, error } = await serviceClient.rpc('inventory_create_item_with_related', {
        p_item: item,
        p_employee_ids: employeeIds,
        p_new_employee_names: newEmployeeNames,
        p_new_item_type_name: optionalName(body.new_item_type_name) || null,
        p_new_brand_name: optionalName(body.new_brand_name) || null,
        p_new_model_name: optionalName(body.new_model_name) || null,
        p_new_location_name: optionalName(body.new_location_name) || null,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })
      if (error) return mapRpcError(error)
      return jsonResponse(data)
    }

    if (action === 'update_with_related') {
      if (typeof body.new_location_name === 'string' && body.new_location_name.trim() && !isAdministrator) {
        return jsonResponse({ error: 'Only administrators can create new locations.' }, 403)
      }
      if (!isPositiveInteger(body.id)) {
        return jsonResponse({ error: 'Invalid inventory item ID.' }, 400)
      }
      if (!body.item || typeof body.item !== 'object' || Array.isArray(body.item)) {
        return jsonResponse({ error: 'Item changes are required.' }, 400)
      }
      const item = { ...(body.item as Record<string, unknown>) }
      const macError = normalizeMacAddress(item)
      if (macError) return jsonResponse({ error: macError }, 400)

      const employeeIds = normalizeEmployeeIds(body.employee_ids ?? [])
      if (employeeIds === null) {
        return jsonResponse({ error: 'Employee IDs must be an array of valid IDs.' }, 400)
      }
      const newEmployeeNames = body.new_employee_names === undefined ? [] : body.new_employee_names
      if (!Array.isArray(newEmployeeNames) || newEmployeeNames.length > 50
          || !newEmployeeNames.every((name) => typeof name === 'string')) {
        return jsonResponse({ error: 'New employee names must be an array of up to 50 names.' }, 400)
      }
      const optionalName = (value: unknown) => typeof value === 'string' ? value.trim() : ''
      const { data, error } = await serviceClient.rpc('inventory_update_item_with_related', {
        p_id: Number(body.id),
        p_item: item,
        p_employee_ids: employeeIds,
        p_new_employee_names: newEmployeeNames,
        p_new_item_type_name: optionalName(body.new_item_type_name) || null,
        p_new_brand_name: optionalName(body.new_brand_name) || null,
        p_new_model_name: optionalName(body.new_model_name) || null,
        p_new_location_name: optionalName(body.new_location_name) || null,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })
      if (error) return mapRpcError(error)
      return jsonResponse(data)
    }

    if (action === 'update') {
      if (!isPositiveInteger(body.id)) {
        return jsonResponse({ error: 'Invalid inventory item ID.' }, 400)
      }
      if (!body.item || typeof body.item !== 'object' || Array.isArray(body.item)) {
        return jsonResponse({ error: 'Item changes are required.' }, 400)
      }
      const item = { ...(body.item as Record<string, unknown>) }
      const macError = normalizeMacAddress(item)
      if (macError) return jsonResponse({ error: macError }, 400)

      let employeeIds: number[] | null = null
      if (body.employee_ids !== undefined && body.employee_ids !== null) {
        employeeIds = normalizeEmployeeIds(body.employee_ids)
        if (employeeIds === null) {
          return jsonResponse({ error: 'Employee IDs must be an array of valid IDs.' }, 400)
        }
      }

      const { data, error } = await serviceClient.rpc('inventory_update_item', {
        p_id: Number(body.id),
        p_item: item,
        p_employee_ids: employeeIds,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })
      if (error) return mapRpcError(error)
      return jsonResponse(data)
    }

    if (action === 'bulk_update') {
      if (!Array.isArray(body.item_ids) || body.item_ids.length === 0) {
        return jsonResponse({ error: 'Select at least one inventory item.' }, 400)
      }
      if (body.item_ids.length > 500) {
        return jsonResponse({ error: 'A maximum of 500 items can be updated at once.' }, 400)
      }
      if (!body.item_ids.every(isPositiveInteger)) {
        return jsonResponse({ error: 'One or more inventory item IDs are invalid.' }, 400)
      }
      if (!body.item || typeof body.item !== 'object' || Array.isArray(body.item)) {
        return jsonResponse({ error: 'Bulk update details are required.' }, 400)
      }
      const allowedBulkFields = ['location_id', 'notes']
      const unsupportedFields = Object.keys(body.item).filter((field) => !allowedBulkFields.includes(field))
      if (unsupportedFields.length > 0) return jsonResponse({ error: `Bulk editing does not support the ${unsupportedFields[0]} field.` }, 400)

      let employeeIds: number[] | null = null
      if (body.employee_ids !== undefined && body.employee_ids !== null) {
        employeeIds = normalizeEmployeeIds(body.employee_ids)
        if (employeeIds === null) return jsonResponse({ error: 'Employee IDs must be an array of valid IDs.' }, 400)
      }
      const newEmployeeNames = body.new_employee_names === undefined ? [] : body.new_employee_names
      if (!Array.isArray(newEmployeeNames) || newEmployeeNames.length > 50 || !newEmployeeNames.every((name) => typeof name === 'string')) {
        return jsonResponse({ error: 'New employee names must be an array of up to 50 names.' }, 400)
      }
      if (newEmployeeNames.length > 0 && employeeIds === null) return jsonResponse({ error: 'Employee assignments must be enabled when creating employees.' }, 400)

      const { data, error } = await serviceClient.rpc('inventory_bulk_update_items_with_employees', {
        p_item_ids: body.item_ids.map(Number),
        p_item: body.item,
        p_employee_ids: employeeIds,
        p_new_employee_names: newEmployeeNames,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })
      if (error) return mapRpcError(error)
      return jsonResponse(data)
    }

    return jsonResponse({ error: 'Invalid action.' }, 400)
  } catch (error) {
    console.error('manage-inventory error:', error)
    return jsonResponse({ error: 'An unexpected error occurred.' }, 500)
  }
})
