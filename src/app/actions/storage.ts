'use server'

import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client, R2_BUCKET_NAME } from '@/lib/r2'

interface SignedFileResponse {
  url: string
  number: number
  path: string
  type: FileType
  content?: string
}

type FileType = 'image' | 'audio' | 'text' | 'epub'

interface UploadResult {
  url: string
  path: string
}

export async function listProjectFiles(userId: string, projectId: string) {
  try {
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/`,
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
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/`,
    })

    const { Contents: files } = await r2Client.send(command)
    if (!files) return []

    const signedUrls = await Promise.all(
      files.map(async (file): Promise<SignedFileResponse | null> => {
        if (!file.Key) return null

        const fileName = file.Key.split('/').pop() || ''
        console.log('Processing file:', fileName)
        
        // Determine file type from extension
        let type: FileType
        if (/\.(jpg|jpeg|png|webp)$/i.test(fileName)) type = 'image'
        else if (/\.mp3$/i.test(fileName)) type = 'audio'
        else if (/\.txt$/i.test(fileName)) type = 'text'
        else if (/\.epub$/i.test(fileName)) type = 'epub'
        else return null

        // Extract number based on file type
        let number: number
        if (type === 'image') {
          // For images: badradio_chapter0_4_image4.jpg -> extracts 4
          const match = fileName.match(/chapter0_(\d+)_image/)
          number = match ? parseInt(match[1]) : 0
          console.log('Image number:', number, 'from', fileName)
        } else if (type === 'audio') {
          // For audio: badradio_en_chapter0_4_chunk4.mp3 -> extracts 4
          const match = fileName.match(/chapter0_(\d+)_/)
          number = match ? parseInt(match[1]) : 0
          console.log('Audio number:', number, 'from', fileName)
        } else if (type === 'text') {
          // For text: badradio_en_chapter0_4_chunk4.txt -> extracts 4
          const match = fileName.match(/chapter0_(\d+)_/)
          number = match ? parseInt(match[1]) : 0
          console.log('Text number:', number, 'from', fileName)
        } else {
          number = 0
        }

        const getCommand = new GetObjectCommand({
          Bucket: R2_BUCKET_NAME,
          Key: file.Key,
        })

        const url = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 })

        // Get text content if it's a text file
        let content: string | undefined
        if (type === 'text') {
          const response = await r2Client.send(getCommand)
          content = await response.Body?.transformToString()
        }

        return {
          url,
          number,
          path: file.Key,
          type,
          content
        }
      })
    )

    const filteredUrls = signedUrls.filter((url): url is SignedFileResponse => url !== null)
    console.log('Final grouped files:', filteredUrls.map(u => ({ type: u.type, number: u.number, file: u.path.split('/').pop() })))
    return filteredUrls

  } catch (error) {
    console.error('Error generating signed URLs:', error)
    throw error
  }
}

export async function uploadProjectFile(
  file: File,
  userId: string,
  projectId: string,
): Promise<UploadResult> {
  try {
    const path = `${userId}/${projectId}/${file.name}`

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const uploadCommand = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: path,
      Body: buffer,
      ContentType: file.type,
    })

    await r2Client.send(uploadCommand)

    // Get signed URL immediately after upload
    const getCommand = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
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
      Bucket: R2_BUCKET_NAME,
      Key: path,
    })

    await r2Client.send(command)
  } catch (error) {
    console.error('Error deleting file:', error)
    throw error
  }
} 