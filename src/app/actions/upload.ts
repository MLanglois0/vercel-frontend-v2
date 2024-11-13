'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { supabase } from '@/lib/supabase';
import { handleSupabaseError } from '@/lib/error-handler';

export async function uploadFile(formData: FormData, projectId: string) {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      throw new Error('Unauthorized: No session found');
    }

    const userId = session.user.id;
    const file = formData.get('file') as File;
    const fileExt = file.name.split('.').pop();
    const filePath = `uploads/${userId}/${projectId}/book.${fileExt}`;

    const { error } = await supabaseAdmin.storage
      .from('epub-files')
      .upload(filePath, file);

    if (error) throw error;

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('epub-files')
      .getPublicUrl(filePath);

    return publicUrl;
  } catch (error) {
    console.error('Server upload error:', error);
    throw new Error(handleSupabaseError(error));
  }
} 