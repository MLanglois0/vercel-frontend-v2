'use server'

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/server/supabase-admin';
import { getUserFriendlyError } from '@/lib/error-handler';

const STORAGE_BUCKET = 'audibloom_files';
const ALLOWED_EXTENSIONS = ['epub'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

interface UploadResult {
  url: string;
  path: string;
}

export async function uploadFile(formData: FormData, userId: string): Promise<UploadResult> {
  try {
    if (!userId) throw new Error('User ID is required');

    // Create project using supabaseAdmin
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert({
        project_name: formData.get('project_name'),
        book_title: formData.get('book_title'),
        description: formData.get('description'),
        user_id: userId,
        status: 'pending'
      })
      .select()
      .single();

    if (projectError) throw projectError;
    if (!project) throw new Error('Failed to create project');

    // Handle file validation
    const file = formData.get('file') as File;
    if (!file || !(file instanceof File)) {
      throw new Error('No valid file provided');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    if (!fileExt || !ALLOWED_EXTENSIONS.includes(fileExt)) {
      throw new Error(`Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }

    // Create file path
    const timestamp = new Date().getTime();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const filePath = `uploads/${userId}/${project.id}/${timestamp}_${sanitizedFileName}`;

    // Upload file using supabaseAdmin
    const { error: uploadError } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get URL using supabaseAdmin
    const { data: urlData } = await supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      throw new Error('Failed to get public URL');
    }

    // Update project using supabaseAdmin
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ 
        epub_file_path: filePath,
        status: 'ready' 
      })
      .eq('id', project.id);

    if (updateError) throw updateError;

    revalidatePath('/projects');
    return {
      url: urlData.publicUrl,
      path: filePath
    };

  } catch (error) {
    console.error('Server upload error:', error);
    throw new Error(getUserFriendlyError(error));
  }
}

// Make helper functions async since they're in a server action file
export async function isValidFileType(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ext ? ALLOWED_EXTENSIONS.includes(ext) : false;
}

export async function formatFileSize(bytes: number): Promise<string> {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}