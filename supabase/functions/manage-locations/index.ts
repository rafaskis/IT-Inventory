
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

    if (
      profileError ||
      !profile ||
      !profile.is_active ||
      !['administrator', 'inventory_manager', 'viewer'].includes(profile.role)
    ) {
      return jsonResponse({ error: 'You are not authorized to view locations.' }, 403)
    }

    const body = await req.json()
    const { action } = body

    if (!['list', 'create', 'update', 'delete'].includes(action)) {
      return jsonResponse({ error: 'Invalid action.' }, 400)
    }

    if (action === 'list') {
      const { data, error } = await serviceClient
        .from('locations')
        .select('id, name, notes, created_at, updated_at, inventory_items(id)')
        .order('name', { ascending: true })

      if (error) {
        return jsonResponse({ error: 'Could not load locations.' }, 500)
      }

      const locations = (data ?? []).map((location) => {
        const { inventory_items, ...rest } = location

        return {
          ...rest,
          inventory_count: inventory_items?.length ?? 0,
          employee_count: 0,
        }
      })

      // Employee counts are loaded separately below.
      const { data: assignments, error: assignmentError } = await serviceClient
        .from('inventory_item_employees')
        .select('employee_id, inventory_items!inner(location_id)')

      if (assignmentError) {
        return jsonResponse({ error: 'Could not load location employee counts.' }, 500)
      }

      const employeeCounts = new Map<string, Set<string>>()

      for (const assignment of assignments ?? []) {
        const locationId = String(
          (assignment.inventory_items as { location_id: number | string }).location_id,
        )
        const employeeId = String(assignment.employee_id)

        if (!employeeCounts.has(locationId)) {
          employeeCounts.set(locationId, new Set())
        }

        employeeCounts.get(locationId)!.add(employeeId)
      }

      return jsonResponse({
        locations: locations.map((location) => ({
          ...location,
          employee_count: employeeCounts.get(String(location.id))?.size ?? 0,
        })),
      })
    }

    const actorId = user.id
    const actorUsername = profile.username

    if (action !== 'list' && profile.role !== 'administrator') {
      return jsonResponse({ error: 'Only administrators can create, modify or delete locations.' }, 403)
    }

    if (action === 'create') {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const notes = typeof body.notes === 'string' ? body.notes.trim() : null

      if (!name) {
        return jsonResponse({ error: 'Location name is required.' }, 400)
      }

      if (name.length > 200) {
        return jsonResponse({ error: 'Location name cannot exceed 200 characters.' }, 400)
      }

      const { data, error } = await serviceClient.rpc('location_create', {
        p_name: name,
        p_notes: notes || null,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })

      if (error) {
        if (error.code === '23505') {
          return jsonResponse({ error: 'A location with this name already exists.' }, 409)
        }

        return jsonResponse({ error: error.message }, 400)
      }

      return jsonResponse({ success: true, id: data })
    }

    if (action === 'update') {
      const id = String(body.id ?? '')
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const notes = typeof body.notes === 'string' ? body.notes.trim() : null

      if (!/^\d+$/.test(id)) {
        return jsonResponse({ error: 'Invalid location ID.' }, 400)
      }

      if (!name) {
        return jsonResponse({ error: 'Location name is required.' }, 400)
      }

      if (name.length > 200) {
        return jsonResponse({ error: 'Location name cannot exceed 200 characters.' }, 400)
      }

      const { error } = await serviceClient.rpc('location_update', {
        p_id: id,
        p_name: name,
        p_notes: notes || null,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })

      if (error) {
        if (error.code === '23505') {
          return jsonResponse({ error: 'A location with this name already exists.' }, 409)
        }

        if (error.message.includes('Location not found')) {
          return jsonResponse({ error: error.message }, 404)
        }

        return jsonResponse({ error: error.message }, 400)
      }

      return jsonResponse({ success: true })
    }

    if (action === 'delete') {
      const id = String(body.id ?? '')

      if (!/^\d+$/.test(id)) {
        return jsonResponse({ error: 'Invalid location ID.' }, 400)
      }

      const { error } = await serviceClient.rpc('location_delete', {
        p_id: id,
        p_actor_id: actorId,
        p_actor_username: actorUsername,
      })

      if (error) {
        if (error.code === '23503') {
          return jsonResponse({
            error: 'This location is still being used by inventory items and cannot be deleted.',
          }, 409)
        }

        if (error.message.includes('Location not found')) {
          return jsonResponse({ error: error.message }, 404)
        }

        return jsonResponse({ error: error.message }, 400)
      }

      return jsonResponse({ success: true })
    }

    return jsonResponse({ error: 'Invalid action.' }, 400)
  } catch (error) {
    console.error('manage-locations error:', error)
    return jsonResponse({ error: 'An unexpected error occurred.' }, 500)
  }
})
