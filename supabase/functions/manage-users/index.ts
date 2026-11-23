
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
  username?: string
  password?: string
  currentPassword?: string
  role?: UserRole
  userId?: string
  isActive?: boolean
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

const validRoles: UserRole[] = [
  'administrator',
  'inventory_manager',
  'viewer',
]

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

  // Verify the authenticated caller.
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

  // Privileged client: used only inside this server-side function.
  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // Verify that the caller has an active application account.
  const { data: actor, error: actorError } = await supabaseAdmin
    .from('profiles')
    .select('id, username, role, is_active')
    .eq('id', authData.user.id)
    .single()

  if (actorError || !actor || !actor.is_active) {
    return response({ error: 'An active application account is required.' }, 403)
  }

  let body: RequestBody

  try {
    body = await req.json()
  } catch {
    return response({ error: 'Invalid request body.' }, 400)
  }

  // SELF-SERVICE PASSWORD CHANGE
  // The current password is verified server-side. The caller cannot supply
  // another user's ID or actor details, and the audit record is written here.
  if (body.action === 'change_own_password') {
    const currentPassword = body.currentPassword
    const newPassword = body.password

    if (
      typeof currentPassword !== 'string' ||
      currentPassword.length === 0 ||
      typeof newPassword !== 'string' ||
      newPassword.length < 8 ||
      newPassword.length > 32
    ) {
      return response({
        error: 'Enter your current password and a new password between 8 and 32 characters.',
      }, 400)
    }

    if (currentPassword === newPassword) {
      return response({
        error: 'The new password must be different from your current password.',
      }, 400)
    }

    const verificationClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    const { data: verificationData, error: verificationError } =
      await verificationClient.auth.signInWithPassword({
        email: `${actor.username}@users.it-inventory.invalid`,
        password: currentPassword,
      })

    if (
      verificationError ||
      !verificationData.user ||
      verificationData.user.id !== actor.id
    ) {
      return response({ error: 'The current password is incorrect.' }, 400)
    }

    const { error: passwordError } =
      await supabaseAdmin.auth.admin.updateUserById(actor.id, {
        password: newPassword,
      })

    if (passwordError) {
      console.error('Self-service password change failed:', passwordError.message)
      return response({ error: 'Unable to change your password.' }, 400)
    }

    const { error: auditError } = await supabaseAdmin
      .from('audit_events')
      .insert({
        entity_type: 'security',
        entity_id: actor.id,
        action: 'password_changed',
        actor_user_id: actor.id,
        actor_username: actor.username,
        details: {
          target_username: actor.username,
          change_type: 'self_service',
        },
      })

    if (auditError) {
      console.error('Self-service password change audit failed:', auditError.message)
      return response({
        success: true,
        warning: 'Your password was changed, but its security audit record could not be saved. Please notify the system administrator.',
      })
    }

    return response({ success: true })
  }

  // All remaining account-management operations are Administrator-only.
  if (actor.role !== 'administrator') {
    return response({ error: 'Administrator access required.' }, 403)
  }

  // LIST USERS
  if (body.action === 'list') {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, is_active, created_at')
      .order('username')

    if (error) {
      console.error('List users failed:', error.message)
      return response({ error: 'Unable to retrieve accounts.' }, 500)
    }

    return response({ users: data })
  }

  // CREATE USER
  if (body.action === 'create') {
    const username = body.username?.trim().toLowerCase()
    const password = body.password
    const role = body.role

    if (
      !username ||
      username.length < 3 ||
      username.length > 40 ||
      !/^[a-z0-9._-]+$/.test(username)
    ) {
      return response({ error: 'Invalid username.' }, 400)
    }

    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 32
    ) {
      return response({
        error: 'Password must contain between 8 and 32 characters.',
      }, 400)
    }

    if (!role || !validRoles.includes(role)) {
      return response({ error: 'Invalid account role.' }, 400)
    }

    const { data: existing } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .ilike('username', username)
      .maybeSingle()

    if (existing) {
      return response({ error: 'This username is already in use.' }, 409)
    }

    const syntheticEmail =
      `${username}@users.it-inventory.invalid`

    const { data: newAuth, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        password,
        email_confirm: true,
        user_metadata: { username },
      })

    if (createError || !newAuth.user) {
      console.error('Account creation failed:', createError?.message)
      return response({ error: 'Unable to create account.' }, 400)
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: newAuth.user.id,
        username,
        role,
        is_active: true,
      })

    if (profileError) {
      console.error('Profile creation failed:', profileError.message)

      await supabaseAdmin.auth.admin.deleteUser(newAuth.user.id)

      return response({ error: 'Unable to create account profile.' }, 500)
    }

    const { error: auditError } = await supabaseAdmin
      .from('audit_events')
      .insert({
        entity_type: 'security',
        entity_id: newAuth.user.id,
        action: 'account_created',
        actor_user_id: actor.id,
        actor_username: actor.username,
        details: { username, role },
      })

    if (auditError) {
      console.error('Account creation audit failed:', auditError.message)

      // Do not leave an account that was created without its required audit entry.
      const { error: rollbackError } =
        await supabaseAdmin.auth.admin.deleteUser(newAuth.user.id)

      if (rollbackError) {
        console.error('Account creation rollback failed:', rollbackError.message)
      }

      return response({
        error: rollbackError
          ? 'Account creation could not be fully completed. Contact an administrator.'
          : 'Account creation was cancelled because its audit record could not be saved.',
      }, 500)
    }

    return response({
      success: true,
      user: {
        id: newAuth.user.id,
        username,
        role,
        is_active: true,
      },
    }, 201)
  }

  // CHANGE ROLE / ACTIVATE / DEACTIVATE ACCOUNT
  if (body.action === 'update_profile') {
    const userId = body.userId
    const role = body.role
    const isActive = body.isActive

    if (!userId) {
      return response({ error: 'User ID is required.' }, 400)
    }

    if (!role || !validRoles.includes(role)) {
      return response({ error: 'Invalid account role.' }, 400)
    }

    if (typeof isActive !== 'boolean') {
      return response({ error: 'Account status is required.' }, 400)
    }

    // Retrieve the target account before changing anything.
    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, username, role, is_active')
      .eq('id', userId)
      .single()

    if (targetError || !target) {
      return response({ error: 'Account not found.' }, 404)
    }

    // Prevent accidental self-demotion or self-deactivation.
    if (
      userId === actor.id &&
      (role !== 'administrator' || !isActive)
    ) {
      return response({
        error: 'You cannot remove your own administrator access.',
      }, 400)
    }

    // When reactivating an account, remove its Auth ban first.
    // The profile remains inactive until the database operation succeeds.
    if (!target.is_active && isActive) {
      const { error: unbanError } =
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        })

      if (unbanError) {
        console.error('Account reactivation preparation failed:', unbanError.message)
        return response({ error: 'Unable to reactivate account.' }, 500)
      }
    }

    // Perform the protected database update and audit insertion.
    const { data: updateResult, error: updateError } =
      await supabaseAdmin.rpc('admin_update_profile', {
        p_target_id: userId,
        p_new_role: role,
        p_is_active: isActive,
        p_actor_id: actor.id,
        p_actor_username: actor.username,
      })

    if (updateError) {
      console.error('Account update failed:', updateError.message)

      // If reactivation failed, restore the Auth ban.
      if (!target.is_active && isActive) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })
      }

      return response({
        error: updateError.message.includes('last active administrator')
          ? 'The last active Administrator cannot be deactivated or demoted.'
          : 'Unable to update account.',
      }, 400)
    }

    // Ban disabled accounts to prevent future password sign-ins.
    // Their database access is also denied by the active-user RLS policy.
    if (!isActive && target.is_active) {
      const { error: banError } =
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })

      if (banError) {
        console.error('Account ban failed:', banError.message)

        return response({
          success: true,
          warning: 'The account is disabled in the application, but the Auth ban could not be applied.',
          user: updateResult,
        })
      }
    }

    return response({
      success: true,
      user: updateResult,
    })
  }

  // RESET USER PASSWORD
  if (body.action === 'reset_password') {
    const userId = body.userId
    const password = body.password

    if (!userId) {
      return response({ error: 'User ID is required.' }, 400)
    }

    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 32
    ) {
      return response({
        error: 'Password must contain between 8 and 32 characters.',
      }, 400)
    }

    if (userId === actor.id) {
      return response({
        error: 'Use the personal password-change feature for your own account.',
      }, 400)
    }

    const { data: target, error: targetError } = await supabaseAdmin
      .from('profiles')
      .select('id, username')
      .eq('id', userId)
      .single()

    if (targetError || !target) {
      return response({ error: 'Account not found.' }, 404)
    }

    const { error: passwordError } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
      })

    if (passwordError) {
      console.error('Password reset failed:', passwordError.message)
      return response({ error: 'Unable to reset password.' }, 400)
    }

    const { error: auditError } = await supabaseAdmin
      .from('audit_events')
      .insert({
        entity_type: 'security',
        entity_id: userId,
        action: 'password_reset',
        actor_user_id: actor.id,
        actor_username: actor.username,
        details: { target_username: target.username },
      })

    if (auditError) {
      console.error('Password reset audit failed:', auditError.message)
      return response({
        success: true,
        warning: 'The password was reset, but its security audit record could not be saved. Please notify the system administrator.',
      })
    }

    return response({ success: true })
  }

  return response({ error: 'Unknown account-management action.' }, 400)
})
