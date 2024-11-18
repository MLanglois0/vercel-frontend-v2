'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'

interface UserData {
  email: string
  first_name: string
  last_name: string
  phone_number?: string | null
  date_of_birth: string
}

interface ActionResponse {
  success: boolean
  error?: string
}

export async function createUserProfile(userId: string, userData: UserData): Promise<ActionResponse> {
  try {
    const { error } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        email: userData.email,
        first_name: userData.first_name,
        last_name: userData.last_name,
        phone_number: userData.phone_number || null,
        date_of_birth: userData.date_of_birth,
        created_at: new Date().toISOString()
      })

    if (error) throw error

    return { success: true }

  } catch (error) {
    console.error('Error creating user:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to create user'
    }
  }
} 