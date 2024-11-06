'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'

export async function createUserProfile(userId: string, userData: {
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  date_of_birth: string;
}) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      ...userData
    })
    .select()

  if (error) throw error
  return data
} 