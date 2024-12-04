'use server'

import { revalidatePath } from 'next/cache'
import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { getUserFriendlyError } from '@/lib/error-handler'
import { uploadProjectFile } from '@/app/actions/storage'

const ALLOWED_EXTENSIONS = ['epub']
const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

interface UploadResult {
  url: string
  path: string
  coverUrl: string
  coverPath: string
}

export async function uploadFile(formData: FormData, userId: string): Promise<UploadResult> {
  try {
    if (!userId) throw new Error('User ID is required')

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
      .single()

    if (projectError) throw projectError
    if (!project) throw new Error('Failed to create project')

    // Handle epub file validation
    const file = formData.get('file') as File
    if (!file || !(file instanceof File)) {
      throw new Error('No valid epub file provided')
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase()
    if (!fileExt || !ALLOWED_EXTENSIONS.includes(fileExt)) {
      throw new Error(`Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`)
    }

    // Handle cover image validation
    const cover = formData.get('cover') as File
    if (!cover || !(cover instanceof File)) {
      throw new Error('No valid cover image provided')
    }

    if (cover.size > MAX_FILE_SIZE) {
      throw new Error(`Cover image size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
    }

    const coverExt = cover.name.split('.').pop()?.toLowerCase()
    if (!coverExt || !['jpg', 'jpeg', 'png', 'webp'].includes(coverExt)) {
      throw new Error('Invalid cover image type. Allowed types: JPG, PNG, WebP')
    }

    // Upload epub file
    const { path: epubPath, url: epubUrl } = await uploadProjectFile(file, userId, project.id)

    // Upload cover image
    const { path: coverPath, url: coverUrl } = await uploadProjectFile(cover, userId, project.id)

    // Update project with both file paths using supabaseAdmin
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({ 
        epub_file_path: epubPath,
        cover_file_path: coverPath,
        status: 'ready' 
      })
      .eq('id', project.id)

    if (updateError) throw updateError

    revalidatePath('/projects')
    return { 
      url: epubUrl, 
      path: epubPath,
      coverUrl: coverUrl,
      coverPath: coverPath
    }

  } catch (error) {
    console.error('Error in uploadFile:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

// Helper functions remain the same
export async function isValidFileType(file: File): Promise<boolean> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext ? ALLOWED_EXTENSIONS.includes(ext) : false
}

export async function formatFileSize(bytes: number): Promise<string> {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}