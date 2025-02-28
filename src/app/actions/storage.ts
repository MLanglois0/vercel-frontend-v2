'use server'

import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client } from '@/lib/r2'
import { getUserFriendlyError } from '@/lib/error-handler'

interface SignedFileResponse {
  url: string
  number: number
  path: string
  type: FileType
  content?: string
}

type FileType = 'image' | 'audio' | 'text' | 'epub' | 'video'

interface UploadResult {
  url: string
  path: string
}

interface ProjectStatus {
  Project: string;
  Book: string;
  notify: string;
  userid: string;
  projectid: string;
  Current_Status: string;
  Ebook_Prep_Status: string;
  Storyboard_Status: string;
  Audiobook_Status: string;
}

export async function listProjectFiles(userId: string, projectId: string) {
  try {
    // console.log(`Listing files for user ${userId} and project ${projectId}`)
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/`
    })

    const { Contents: files } = await r2Client.send(listCommand)
    // console.log('Raw files from R2:', files?.map(f => f.Key))
    if (!files) return []

    const signedFiles = await Promise.all(
      files.map(async (file): Promise<{ path: string } | null> => {
        if (!file.Key) return null
        // console.log('Processing file for deletion:', file.Key)
        return {
          path: file.Key
        }
      })
    )

    const filtered = signedFiles.filter((file): file is NonNullable<typeof file> => file !== null)
    // console.log('Final list of files to process:', filtered.map(f => f.path))
    return filtered
  } catch (error) {
    console.error('Error listing project files:', error)
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

    // Get video files from output directory
    const outputCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: `${userId}/${projectId}/output/`,
      Delimiter: '/' // Only get files directly in output
    })

    const [baseResponse, tempResponse, outputResponse] = await Promise.all([
      r2Client.send(baseCommand),
      r2Client.send(tempCommand),
      r2Client.send(outputCommand)
    ])

    const allFiles = [
      ...(baseResponse.Contents || []),
      ...(tempResponse.Contents || []),
      ...(outputResponse.Contents || [])
    ]

    if (!allFiles.length) return []

    // console.log('Base directory files:', baseResponse.Contents?.map(f => f.Key))
    // console.log('Temp directory files:', tempResponse.Contents?.map(f => f.Key))
    // console.log('Output directory files:', outputResponse.Contents?.map(f => f.Key))

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

        if (/\.(jpg|jpeg|png|webp)$/i.test(fileName) || fileName.endsWith('jpgoldset')) {
          type = 'image'
          if (isInTemp) {
            console.log('Processing temp image file:', fileName)
            
            // First check for oldset files
            if (fileName.endsWith('jpgoldset')) {
              const oldsetMatch = fileName.match(/image(\d+)\.jpgoldset$/)
              if (oldsetMatch) {
                number = parseInt(oldsetMatch[1])
                console.log('🎯 Found jpgoldset file:', {
                  fileName,
                  number,
                  path: file.Key
                })
              }
            }
            // Then check for saved versions
            else if (fileName.match(/image(\d+)_sbsave(?:_\d+)?\.jpg$/)) {
              const saveMatch = fileName.match(/image(\d+)_sbsave(?:_\d+)?\.jpg$/)
              if (saveMatch) {
                number = parseInt(saveMatch[1])
              }
            }
            // Finally check for regular images
            else {
              const mainMatch = fileName.match(/image(\d+)(?:_\d+)?\.jpg$/)
              if (mainMatch) {
                number = parseInt(mainMatch[1])
              }
            }
          }
        } else if (/\.mp3$/.test(fileName)) {
          type = 'audio'
          const mainMatch = fileName.match(/image(\d+)(?:_\d+)?\.mp3$/)
          const sbsaveMatch = fileName.match(/image(\d+)_sbsave(?:_\d+)?\.mp3$/)
          
          if (mainMatch?.[1]) {
            number = parseInt(mainMatch[1])
          } else if (sbsaveMatch?.[1]) {
            number = parseInt(sbsaveMatch[1])
          }
        } else if (/\.mp4$/.test(fileName)) {
          type = 'video'
          const match = fileName.match(/(\d+)\.mp4$/)
          if (match) number = parseInt(match[1])
        } else if (/\.txt$/.test(fileName)) {
          type = 'text'
          const match = fileName.match(/chunk(\d+)\.txt$/)
          if (match) number = parseInt(match[1])
          
          const getCommand = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: file.Key,
          })
          const response = await r2Client.send(getCommand)
          content = await response.Body?.transformToString()
        } else if (/\.epub$/.test(fileName)) {
          type = 'epub'
        } else return null

        // console.log('Processing file:', { fileName, type, number, isInTemp })

        return {
          url: await getSignedUrl(r2Client, new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: file.Key,
          }), { expiresIn: 3600 }),
          number,
          path: file.Key,
          type,
          content,
        }
      })
    )

    const filtered = signedUrls.filter((url): url is SignedFileResponse => url !== null)
    // console.log('Filtered signed URLs:', filtered.map(f => ({ 
    //   type: f.type, 
    //   number: f.number,
    //   path: f.path, 
    //   isInTemp: f.path.includes('/temp/')
    // })))

    // Filter signed files based on file type and path
    filtered.forEach(file => {
      const isMatch = file.type === 'image' &&
        file.path.includes('/temp/') &&
        (file.path.match(/.*?chapter\d+_\d+_image\d+(?:_sbsave\d+)?\.jpg$/) || 
         file.path.match(/.*?chapter\d+_\d+_image\d+\.jpgoldset$/))
      if (isMatch) console.log('Matched storyboard file:', file.path)
    })

    return filtered  // Return all files instead of just storyboard files
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
  // Ensure path starts with userId/projectId
  if (!path.match(/^[^/]+\/[^/]+\//)) {
    console.error('Invalid file path format:', path)
    throw new Error('Invalid file path format. Path must start with userId/projectId/')
  }

  // console.log('Attempting to delete file:', path)
  const command = new DeleteObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: path,
  })

  // console.log('Delete command:', {
  //   bucket: process.env.R2_BUCKET_NAME,
  //   key: path
  // })

  try {
    await r2Client.send(command)
    // console.log('Successfully deleted file:', path)
  } catch (error) {
    console.error('Error deleting file:', path, error)
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

export async function updateProjectStatus({
  userId,
  projectId,
  status
}: {
  userId: string
  projectId: string
  status: ProjectStatus
}): Promise<void> {
  try {
    const statusFilePath = `${userId}/${projectId}/project_status.json`
    const statusContent = JSON.stringify(status, null, 2)
    
    // First try to delete the existing file if it exists
    try {
      await r2Client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: statusFilePath
      }))
    } catch (error) {
      // Ignore error if file doesn't exist
      if (error instanceof Error && 'name' in error && error.name !== 'NoSuchKey') {
        console.error('Error deleting existing status file:', error)
      }
    }

    // Then create new file
    const putCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: statusFilePath,
      Body: statusContent,
      ContentType: 'application/json'
    })

    await r2Client.send(putCommand)
    // console.log('Status file updated:', statusFilePath)
  } catch (error) {
    console.error('Error updating status file:', error)
    throw error
  }
}

export async function getProjectStatus({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<ProjectStatus | null> {
  try {
    const statusFilePath = `${userId}/${projectId}/project_status.json`
    
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: statusFilePath
    })

    try {
      const response = await r2Client.send(getCommand)
      const statusContent = await response.Body?.transformToString()
      
      if (statusContent) {
        return JSON.parse(statusContent) as ProjectStatus
      }
    } catch (error) {
      // Type the error properly
      if (error instanceof Error && 'name' in error && error.name === 'NoSuchKey') {
        return null
      }
      throw error
    }

    return null
  } catch (error) {
    console.error('Error reading status file:', error)
    throw error
  }
}

export async function deleteProjectFolder(userId: string, projectId: string): Promise<void> {
  const prefix = `${userId}/${projectId}/`
  // console.log('Deleting project folder recursively:', prefix)
  let totalDeleted = 0

  try {
    let continuationToken: string | undefined
    
    do {
      // Get batch of objects
      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken
      })

      const { Contents, NextContinuationToken, IsTruncated } = await r2Client.send(listCommand)
      
      if (!Contents || Contents.length === 0) {
        if (totalDeleted === 0) {
          // console.log('No files found in folder:', prefix)
        }
        break
      }

      // Delete batch of objects
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Delete: {
          Objects: Contents.map(({ Key }) => ({ Key })).filter((obj): obj is { Key: string } => obj.Key !== undefined),
          Quiet: true
        }
      })

      await r2Client.send(deleteCommand)
      totalDeleted += Contents.length
      // console.log(`Deleted batch of ${Contents.length} files. Total deleted: ${totalDeleted}`)

      // Set up next batch if there are more files
      continuationToken = IsTruncated ? NextContinuationToken : undefined

    } while (continuationToken)

    // console.log(`Successfully deleted ${totalDeleted} total files from folder:`, prefix)
  } catch (error) {
    console.error('Error deleting project folder:', prefix, error)
    throw error
  }
}

export async function renameImageToOldSet({
  imagePath
}: {
  imagePath: string
}): Promise<{ success: boolean }> {
  if (!imagePath) throw new Error('Image path is required')

  // Verify this is a valid image path with the correct format
  const imageMatch = imagePath.match(/image(\d+)\.jpg$/)
  if (!imageMatch) {
    throw new Error('Invalid image path format')
  }

  // Create the oldset path
  const oldsetPath = `${imagePath}oldset`

  try {
    // Rename by copying then deleting original
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${imagePath}`,
      Key: oldsetPath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: imagePath,
    }))

    return { success: true }
  } catch (error) {
    console.error('Error renaming image to oldset:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

