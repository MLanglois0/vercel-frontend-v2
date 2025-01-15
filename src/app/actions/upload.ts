'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { uploadProjectFile } from './storage'
import { getUserFriendlyError } from '@/lib/error-handler'

export async function uploadFile(formData: FormData, userId: string) {
  try {
    const projectName = formData.get('project_name') as string
    const bookTitle = formData.get('book_title') as string
    const description = formData.get('description') as string
    const file = formData.get('file') as Blob & { name?: string }
    const cover = formData.get('cover') as Blob & { name?: string }

    if (!file || !cover) throw new Error('Missing required files')
    if (!file.name || !cover.name) throw new Error('File names are required')

    // Create project using supabaseAdmin
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert([
        {
          project_name: projectName,
          book_title: bookTitle,
          description: description,
          user_id: userId,
          status: 'pending'
        }
      ])
      .select()
      .single()

    if (projectError) throw projectError

    // Upload files to R2 - pass blobs directly with original filenames
    const { path: epubPath } = await uploadProjectFile(
      file,
      userId,
      project.id,
      file.name,
      'application/epub+zip'
    )

    const { path: coverPath } = await uploadProjectFile(
      cover,
      userId,
      project.id,
      cover.name,
      cover.type
    )

    // Update project with file paths using supabaseAdmin
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        epub_file_path: epubPath,
        cover_file_path: coverPath,
        status: 'ready'
      })
      .eq('id', project.id)

    if (updateError) throw updateError

    return project
  } catch (error) {
    console.error('Error in uploadFile:', error)
    throw new Error(getUserFriendlyError(error))
  }
}