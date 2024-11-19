'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'

interface SignedFileResponse {
  url: string
  number: number
  path: string
  type: 'image' | 'audio' | 'text'
  content?: string
}

interface FileGroup {
  image?: {
    name: string
  }
  audio?: {
    name: string
  }
  text?: {
    name: string
  }
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

export async function getSignedImageUrls(userId: string, projectId: string): Promise<SignedFileResponse[]> {
  try {
    const files = await listProjectFiles(userId, projectId)
    console.log('All files:', files)

    // Log files by type
    console.log('Images:', files.filter(f => f.name.endsWith('.jpg')))
    console.log('Audio:', files.filter(f => f.name.endsWith('.mp3')))
    console.log('Text:', files.filter(f => f.name.endsWith('.txt')))

    if (!files?.length) return []

    // Group files by their number and type
    const fileGroups = files.reduce((acc, file) => {
      const number = parseInt(file.name.match(/(\d+)\.[^.]+$/)?.[1] || '0')
      const ext = file.name.split('.').pop()?.toLowerCase()
      const type = ext === 'jpg' ? 'image' : ext === 'mp3' ? 'audio' : ext === 'txt' ? 'text' : null
      
      if (type) {
        if (!acc[number]) acc[number] = {}
        acc[number][type] = { name: file.name }
      }
      return acc
    }, {} as Record<number, FileGroup>)

    // Process all file types for each number
    const results = await Promise.all(
      Object.entries(fileGroups).map(async ([number, group]) => {
        const responses: SignedFileResponse[] = []
        const basePath = `${userId}/${projectId}`

        // Handle image
        if (group.image) {
          const { data } = await supabaseAdmin.storage
            .from('audibloom_files')
            .createSignedUrl(`${basePath}/${group.image.name}`, 3600)
          
          if (data?.signedUrl) {
            responses.push({
              url: data.signedUrl,
              number: parseInt(number),
              path: `${basePath}/${group.image.name}`,
              type: 'image'
            })
          }
        }

        // Handle audio
        if (group.audio) {
          const { data } = await supabaseAdmin.storage
            .from('audibloom_files')
            .createSignedUrl(`${basePath}/${group.audio.name}`, 3600)
          
          if (data?.signedUrl) {
            responses.push({
              url: data.signedUrl,
              number: parseInt(number),
              path: `${basePath}/${group.audio.name}`,
              type: 'audio'
            })
          }
        }

        // Handle text
        if (group.text) {
          const { data } = await supabaseAdmin.storage
            .from('audibloom_files')
            .download(`${basePath}/${group.text.name}`)
          
          const content = await data?.text()
          responses.push({
            url: '',
            number: parseInt(number),
            path: `${basePath}/${group.text.name}`,
            type: 'text',
            content
          })
        }

        return responses
      })
    )

    return results.flat().sort((a, b) => a.number - b.number)

  } catch (error) {
    console.error('Error generating signed URLs:', error)
    throw error
  }
} 