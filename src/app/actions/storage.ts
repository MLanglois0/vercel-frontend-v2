'use server'

import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client } from '@/lib/r2'
import { getUserFriendlyError } from '@/lib/error-handler'

interface SignedFileResponse {
  url: string
  number: number
  path: string
  type: FileType
  content?: string
  version?: number
}

type FileType = 'image' | 'audio' | 'text' | 'epub'

interface UploadResult {
  url: string
  path: string
}

export async function listProjectFiles(userId: string, projectId: string) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/temp/`,
    })

    const { Contents: files } = await r2Client.send(command)
    return files?.map(file => ({
      name: file.Key?.split('/').pop() || '',
      size: file.Size,
      lastModified: file.LastModified,
    })) || []
  } catch (error) {
    console.error('Error listing files:', error)
    throw error
  }
}

export async function getSignedImageUrls(userId: string, projectId: string): Promise<SignedFileResponse[]> {
  try {
    // Get all files from base path (for cover and epub)
    const baseCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/`,
      Delimiter: '/' // Only get files in base directory
    })

    // Get storyboard files from temp directory
    const tempCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/temp/`,
      Delimiter: '/' // Only get files directly in temp
    })

    const [baseResponse, tempResponse] = await Promise.all([
      r2Client.send(baseCommand),
      r2Client.send(tempCommand)
    ])

    const allFiles = [
      ...(baseResponse.Contents || []),
      ...(tempResponse.Contents || [])
    ]

    if (!allFiles.length) return []

    console.log('Base directory files:', baseResponse.Contents?.map(f => f.Key))
    console.log('Temp directory files:', tempResponse.Contents?.map(f => f.Key))

    const signedUrls = await Promise.all(
      allFiles.map(async (file): Promise<SignedFileResponse | null> => {
        if (!file.Key) return null

        const fileName = file.Key.split('/').pop() || ''
        
        // Handle files based on their location
        const isInTemp = file.Key.includes('/temp/')

        // For storyboard files (in temp), extract number from filename
        let number = 0
        let type: FileType
        let content: string | undefined
        let version: number | undefined

        if (/\.(jpg|jpeg|png|webp)$/i.test(fileName)) {
          type = 'image'
          if (isInTemp) {
            // Updated pattern to match _sbsaveX.jpg
            const saveMatch = fileName.match(/image(\d+)_sbsave(\d+)\.jpg$/)
            if (saveMatch) {
              // The image number is in saveMatch[1]
              // The sbsave version is in saveMatch[2]
              number = parseInt(saveMatch[1])  // This matches the main image number
              version = parseInt(saveMatch[2]) // This is the sbsave version number
            } else {
              // For main images, just get the number
              const mainMatch = fileName.match(/image(\d+)\.jpg$/)
              if (mainMatch) number = parseInt(mainMatch[1])
            }
          }
        }
        else if (/\.mp3$/.test(fileName)) {
          type = 'audio'
          const match = fileName.match(/(\d+)\.mp3$/)
          if (match) number = parseInt(match[1])
        }
        else if (/\.txt$/.test(fileName)) {
          type = 'text'
          const match = fileName.match(/chunk(\d+)\.txt$/)
          if (match) number = parseInt(match[1])
          
          const getCommand = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: file.Key,
          })
          const response = await r2Client.send(getCommand)
          content = await response.Body?.transformToString()
          console.log('Text file found:', { fileName, number, content })
        }
        else if (/\.epub$/.test(fileName)) {
          type = 'epub'
        }
        else return null

        console.log('Processing file:', { fileName, type, number, version, isInTemp })

        return {
          url: await getSignedUrl(r2Client, new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: file.Key,
          }), { expiresIn: 3600 }),
          number,
          path: file.Key,
          type,
          content,
          version
        }
      })
    )

    const filtered = signedUrls.filter((url): url is SignedFileResponse => url !== null)
    console.log('Filtered signed URLs:', filtered.map(f => ({ 
      type: f.type, 
      number: f.number,
      version: f.version,
      path: f.path, 
      hasContent: !!f.content,
      isInTemp: f.path.includes('/temp/')
    })))

    return filtered
  } catch (error) {
    console.error('Error generating signed URLs:', error)
    throw error
  }
}

export async function uploadProjectFile(
  file: Blob,
  userId: string,
  projectId: string,
  filename: string,
  contentType: string
): Promise<UploadResult> {
  try {
    const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB in bytes
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File size must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB`)
    }

    const path = `${userId}/${projectId}/${filename}`

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'application/epub+zip',
      'text/plain'
    ]
    if (!allowedTypes.includes(contentType)) {
      throw new Error('Invalid file type. Only JPG, PNG, WebP, MP3, EPUB, and TXT files are allowed.')
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
      Body: buffer,
      ContentType: contentType,
    })

    await r2Client.send(uploadCommand)

    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
    })

    const url = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 })

    return { url, path }
  } catch (error) {
    console.error('Error uploading file:', error)
    throw error
  }
}

export async function deleteProjectFile(path: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
    })

    await r2Client.send(command)
  } catch (error) {
    console.error('Error deleting file:', error)
    throw error
  }
}

export async function saveAudioHistory({
  originalPath
}: {
  originalPath: string
}): Promise<{ success: boolean }> {
  if (!originalPath) throw new Error('Original path is required')

  // Create the sbsave path
  const pathParts = originalPath.split('.')
  const ext = pathParts.pop()
  const basePath = pathParts.join('.')
  const sbsavePath = `${basePath}_sbsave.${ext}`

  try {
    // 1. First RENAME (not copy) the original file to include _sbsave
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${originalPath}`,
      Key: sbsavePath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: originalPath,
    }))

    // 2. Then COPY the sbsave version back to the original name
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${sbsavePath}`,
      Key: originalPath,
    }))

    return { success: true }
  } catch (error) {
    console.error('Error saving audio history:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

export async function swapStoryboardImage({
  originalPath,
  thumbnailPath
}: {
  originalPath: string
  thumbnailPath: string
}): Promise<{ success: boolean }> {
  if (!originalPath || !thumbnailPath) throw new Error('Both original and thumbnail paths are required')

  // Create the temporary original path
  const tempOriginalPath = originalPath.replace(/(\.\w+)$/, '_temporiginal$1')

  try {
    // Step 1: Rename the original file to a temporary name
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${originalPath}`,
      Key: tempOriginalPath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: originalPath,
    }))

    // Step 2: Rename the thumbnail to the original name
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${thumbnailPath}`,
      Key: originalPath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: thumbnailPath,
    }))

    // Step 3: Rename the temporary original to the thumbnail slot
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${tempOriginalPath}`,
      Key: thumbnailPath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: tempOriginalPath,
    }))

    return { success: true }
  } catch (error) {
    console.error('Error swapping storyboard images:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

