'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'

interface SignedImageResponse {
  url: string
  number: number
  path: string
}

export async function listProjectFiles(userId: string, projectId: string) {
  try {
    const { data: files, error } = await supabaseAdmin.storage
      .from('audibloom_files')
      .list(`${userId}/${projectId}`)

    if (error) throw error
    return files
  } catch (error) {
    console.error('Error listing files:', error)
    throw error
  }
}

export async function getSignedImageUrls(userId: string, projectId: string): Promise<SignedImageResponse[]> {
  try {
    const files = await listProjectFiles(userId, projectId)
    if (!files?.length) return []

    // Filter for jpg files and extract numbers
    const imageFiles = files
      .filter(file => file.name.endsWith('.jpg'))
      .map(file => {
        const number = parseInt(file.name.match(/(\d+)\.jpg$/)?.[1] || '0')
        return {
          name: file.name,
          number
        }
      })
      .sort((a, b) => a.number - b.number)

    // Generate signed URLs server-side
    const signedUrls = await Promise.all(
      imageFiles.map(async (file) => {
        const path = `${userId}/${projectId}/${file.name}`
        const { data, error } = await supabaseAdmin.storage
          .from('audibloom_files')
          .createSignedUrl(path, 24 * 60 * 60) // 24 hours

        if (error || !data?.signedUrl) throw error

        return {
          url: data.signedUrl,
          number: file.number,
          path
        }
      })
    )

    return signedUrls

  } catch (error) {
    console.error('Error generating signed URLs:', error)
    throw error
  }
} 