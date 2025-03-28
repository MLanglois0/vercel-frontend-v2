'use server'

import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, CopyObjectCommand, DeleteObjectsCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
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

type FileType = 'image' | 'audio' | 'text' | 'epub' | 'video' | 'json'

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
  Proof_Status: string;
  Audiobook_Status: string;
}

// Add a Voice interface
interface VoiceData {
  voices: Array<{
    voice_id: string
    name: string
    labels?: {
      accent?: string
      description?: string
      age?: string
      gender?: string
      use_case?: string
      [key: string]: string | undefined
    }
    preview_url?: string
  }>
}

// Define interface for NER data
interface NerData {
  entities: Array<{
    name: string;
    HTP: boolean; // Hard To Pronounce flag
    phoneme?: string; // IPA phoneme pronunciation
  }>;
}

// Helper function to chunk array into batches
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

interface S3File {
  Key: string;
}

// Add retry helper function at the top with other helpers
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries - 1) {
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        console.log(`Retry attempt ${attempt + 1} after ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Update processFileBatch to use retry logic
async function processFileBatch(
  files: S3File[], 
  userId: string, 
  projectId: string
): Promise<SignedFileResponse[]> {
  try {
    const responses = await Promise.all(
      files.map(async (file): Promise<SignedFileResponse | null> => {
        try {
          // Validate that the file belongs to the correct user and project
          if (!file.Key.startsWith(`${userId}/${projectId}/`)) {
            throw new Error(`Invalid file path: ${file.Key}`)
          }

          const fileName = file.Key.split('/').pop() || ''
          const isInTemp = file.Key.includes('/temp/')

          let number = 0
          let type: FileType
          let content: string | undefined

          if (/\.(jpg|jpeg|png|webp)$/i.test(fileName) || fileName.endsWith('jpgoldset')) {
            type = 'image'
            if (isInTemp) {
              if (fileName.endsWith('jpgoldset')) {
                const oldsetMatch = fileName.match(/image(\d+)\.jpgoldset$/)
                if (oldsetMatch) number = parseInt(oldsetMatch[1])
              } else if (fileName.match(/image(\d+)_sbsave(?:_\d+)?\.jpg$/)) {
                const saveMatch = fileName.match(/image(\d+)_sbsave(?:_\d+)?\.jpg$/)
                if (saveMatch) number = parseInt(saveMatch[1])
              } else {
                const mainMatch = fileName.match(/image(\d+)(?:_\d+)?\.jpg$/)
                if (mainMatch) number = parseInt(mainMatch[1])
              }
            }
          } else if (/\.mp3$/.test(fileName)) {
            type = 'audio'
            const mainMatch = fileName.match(/audio(\d+)(?:_\d+)?\.mp3$/)
            const sbsaveMatch = fileName.match(/audio(\d+)_sbsave(?:_\d+)?\.mp3$/)
            
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
            
            // Add retry for text content
            content = await retryOperation(async () => {
              const getCommand = new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: file.Key,
              })
              const response = await r2Client.send(getCommand)
              return await response.Body?.transformToString()
            }).catch(error => {
              console.error(`Error reading text content for ${file.Key} after retries:`, error)
              return undefined
            })
          } else if (/\.json$/.test(fileName)) {
            type = 'json'
            
            // Add retry for JSON content
            content = await retryOperation(async () => {
              const getCommand = new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: file.Key,
              })
              const response = await r2Client.send(getCommand)
              return await response.Body?.transformToString()
            }).catch(error => {
              console.error(`Error reading JSON content for ${file.Key} after retries:`, error)
              return undefined
            })
          } else if (/\.epub$/.test(fileName)) {
            type = 'epub'
          } else return null

          // Add retry for signed URL generation with stricter error handling
          const url = await retryOperation(async () => {
            const signedUrl = await getSignedUrl(r2Client, new GetObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: file.Key,
            }), { expiresIn: 3600 })
            
            if (!signedUrl) {
              throw new Error(`Failed to generate signed URL for ${file.Key}`)
            }
            
            return signedUrl
          })

          return {
            url,
            number,
            path: file.Key,
            type,
            content,
          }
        } catch (fileError) {
          // Log the error but continue processing other files
          console.error(`Error processing file ${file.Key} after all retries:`, fileError)
          return null
        }
      })
    )

    const validResponses = responses.filter((response): response is SignedFileResponse => response !== null)
    
    // Throw error if batch completely failed
    if (responses.length > 0 && validResponses.length === 0) {
      throw new Error('Failed to process any files in batch')
    }

    return validResponses
  } catch (error) {
    console.error('Error processing file batch:', error)
    throw error // Propagate the error up instead of returning empty array
  }
}

export async function getSignedImageUrls(
  userId: string, 
  projectId: string, 
  batchSize: number = 50,
  maxConcurrentBatches: number = 5
): Promise<SignedFileResponse[]> {
  try {
    console.log('Refreshing project files...')

    // Get all files from different directories in parallel
    const [baseResponse, tempResponse, outputResponse] = await Promise.all([
      r2Client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${userId}/${projectId}/`,
        Delimiter: '/'
      })),
      r2Client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${userId}/${projectId}/temp/`,
        Delimiter: '/'
      })),
      r2Client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${userId}/${projectId}/output/`,
        Delimiter: '/'
      }))
    ]).catch(error => {
      console.error('Failed to list project directories:', error)
      throw new Error('Failed to retrieve project file list. Please try again.')
    })

    // Filter out files without Keys and cast to S3File type
    const allFiles = [
      ...(baseResponse.Contents || []),
      ...(tempResponse.Contents || []),
      ...(outputResponse.Contents || [])
    ].filter((file): file is S3File => file.Key !== undefined)

    // Throw error if we can't get any files when we expect them
    if (!allFiles.length) {
      throw new Error('No files found in project. If this is unexpected, please try refreshing the page.')
    }

    // Split files into batches
    const batches = chunkArray(allFiles, batchSize)
    const results: SignedFileResponse[] = []
    let errorCount = 0
    const totalExpectedFiles = allFiles.length
    let totalProcessedFiles = 0

    // Process batches with controlled concurrency
    for (let i = 0; i < batches.length; i += maxConcurrentBatches) {
      try {
        const currentBatches = batches.slice(i, i + maxConcurrentBatches)
        const batchResults = await Promise.all(
          currentBatches.map(batch => processFileBatch(batch, userId, projectId))
        )

        // Flatten results and count processed files
        const validResults = batchResults.flat()
        results.push(...validResults)
        totalProcessedFiles += validResults.length

        // Log progress
        const progress = Math.min(100, Math.round(((i + maxConcurrentBatches) / batches.length) * 100))
        console.log(`Processing files: ${progress}% complete (${totalProcessedFiles}/${totalExpectedFiles} files)`)
      } catch (batchError) {
        console.error('Error processing batch:', batchError)
        errorCount++
        // Only continue if we haven't hit too many errors
        if (errorCount > Math.ceil(batches.length * 0.25)) { // If more than 25% of batches fail
          throw new Error('Too many errors while processing files. Please try refreshing the page.')
        }
        continue
      }
    }

    // Verify we got enough files
    const successRate = totalProcessedFiles / totalExpectedFiles
    if (successRate < 0.75) { // If we got less than 75% of expected files
      throw new Error(`Failed to process most project files (${totalProcessedFiles}/${totalExpectedFiles} files processed). Please try refreshing the page.`)
    }

    if (errorCount > 0) {
      console.warn(`Completed with ${errorCount} batch errors. ${totalProcessedFiles}/${totalExpectedFiles} files processed.`)
    }

    console.log('Project files refreshed successfully')
    return results
  } catch (error) {
    console.error('Error generating signed URLs:', error)
    // Throw a user-friendly error instead of returning empty array
    throw new Error(getUserFriendlyError(error))
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
  // Create the oldset path by replacing .jpg with .jpgoldset
  const oldsetPath = imagePath.replace(/\.jpg$/, '.jpgoldset')

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

export async function restoreImageFromOldSet({
  imagePath
}: {
  imagePath: string
}): Promise<{ success: boolean }> {
  // Create the oldset path by replacing .jpg with .jpgoldset
  const oldsetPath = imagePath.replace(/\.jpg$/, '.jpgoldset')

  try {
    // Restore by copying oldset to original then deleting oldset
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${oldsetPath}`,
      Key: imagePath,
    }))
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: oldsetPath,
    }))

    return { success: true }
  } catch (error) {
    console.error('Error restoring image from oldset:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

export async function saveAudioToOldSet({
  audioPath,
  trackNumber
}: {
  audioPath: string
  trackNumber: number
}): Promise<{ success: boolean }> {
  // Create the oldset path by replacing .mp3 with .mp3oldset{trackNumber}
  const oldsetPath = audioPath.replace(/\.mp3$/, `.mp3oldset${trackNumber}`)

  try {
    // Save by copying to oldset
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${audioPath}`,
      Key: oldsetPath,
    }))

    return { success: true }
  } catch (error) {
    console.error(`Error saving audio to oldset${trackNumber}:`, error)
    throw new Error(getUserFriendlyError(error))
  }
}

export async function restoreAudioFromOldSet({
  audioPath,
  trackNumber
}: {
  audioPath: string
  trackNumber: number
}): Promise<{ success: boolean }> {
  // Create the oldset path by replacing .mp3 with .mp3oldset{trackNumber}
  const oldsetPath = audioPath.replace(/\.mp3$/, `.mp3oldset${trackNumber}`)

  try {
    // First check if the oldset file exists
    const exists = await checkAudioTrackExists({
      audioPath,
      trackNumber
    });
    
    if (!exists) {
      console.warn(`Audio track ${trackNumber} does not exist for ${audioPath}`);
      return { success: false };
    }
    
    // Restore by copying oldset to original
    await r2Client.send(new CopyObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CopySource: `${process.env.R2_BUCKET_NAME}/${oldsetPath}`,
      Key: audioPath,
    }))
    
    // Delete the oldset file after restoring it
    // This ensures we only have the original file and one oldset file at any time
    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: oldsetPath,
    }))

    return { success: true }
  } catch (error) {
    console.error(`Error restoring audio from oldset${trackNumber}:`, error)
    throw new Error(getUserFriendlyError(error))
  }
}

export async function checkAudioTrackExists({
  audioPath,
  trackNumber
}: {
  audioPath: string
  trackNumber: number
}): Promise<boolean> {
  // Create the oldset path by replacing .mp3 with .mp3oldset{trackNumber}
  const oldsetPath = audioPath.replace(/\.mp3$/, `.mp3oldset${trackNumber}`)

  try {
    // Check if the oldset file exists
    await r2Client.send(new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: oldsetPath,
    }))
    return true
  } catch {
    // If the file doesn't exist, return false
    return false
  }
}

// New function to refresh project files without using Supabase
export async function refreshProjectFiles({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<{
  signedFiles: SignedFileResponse[]
  status: ProjectStatus | null
}> {
  try {
    // Get project status
    const status = await getProjectStatus({
      userId,
      projectId
    })
    
    // Get signed URLs for all files
    const signedFiles = await getSignedImageUrls(userId, projectId)
    
    return {
      signedFiles,
      status
    }
  } catch (error) {
    console.error('Error refreshing project files:', error)
    throw new Error(getUserFriendlyError(error))
  }
}

export async function getVoiceDataFile({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<VoiceData | null> {
  try {
    const voiceDataFilePath = `${userId}/${projectId}/temp/project_voice_data.json`
    
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: voiceDataFilePath
    })

    try {
      const response = await r2Client.send(getCommand)
      const voiceDataContent = await response.Body?.transformToString()
      
      if (voiceDataContent) {
        return JSON.parse(voiceDataContent) as VoiceData
      }
    } catch (error) {
      // If file doesn't exist, return null
      if (error instanceof Error && 'name' in error && error.name === 'NoSuchKey') {
        console.log(`Voice data file not found at ${voiceDataFilePath}`)
        return null
      }
      throw error
    }
    
    return null
  } catch (error) {
    console.error('Error fetching voice data file:', error)
    throw error
  }
}

// Add a cache for NER file paths
const nerFilePathCache = new Map<string, string>();

// Add a new function to get NER data file
export async function getNerDataFile({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<NerData | null> {
  try {
    // Check cache first
    const cacheKey = `${userId}/${projectId}`;
    let nerDataFilePath = nerFilePathCache.get(cacheKey);

    if (!nerDataFilePath) {
      // Only list files if we haven't found the path before
      const listCommand = new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET_NAME,
        Prefix: `${userId}/${projectId}/temp/`,
        Delimiter: '/'
      })

      const { Contents: files } = await r2Client.send(listCommand)
      
      if (!files || files.length === 0) {
        return null
      }

      // Look for a file that ends with _ner.json (language-agnostic)
      const nerFile = files.find(file => 
        file.Key && file.Key.endsWith('_ner.json')
      )

      if (!nerFile || !nerFile.Key) {
        return null
      }

      // Cache the found path
      nerDataFilePath = nerFile.Key;
      nerFilePathCache.set(cacheKey, nerDataFilePath);
    }
    
    // Get the NER data using the cached or found path
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: nerDataFilePath
    })

    try {
      const response = await r2Client.send(getCommand)
      const nerDataContent = await response.Body?.transformToString()
      
      if (nerDataContent) {
        return JSON.parse(nerDataContent) as NerData
      }
    } catch (error) {
      // If file doesn't exist, clear cache and return null
      if (error instanceof Error && 'name' in error && error.name === 'NoSuchKey') {
        nerFilePathCache.delete(cacheKey);
        return null
      }
      throw error
    }
    
    return null
  } catch (error) {
    console.error('Error fetching NER data file:', error)
    throw error
  }
}

export async function saveJsonToR2<T>({
  userId,
  projectId,
  filename,
  data
}: {
  userId: string
  projectId: string
  filename: string
  data: T
}): Promise<{ success: boolean }> {
  try {
    // Create the path for the JSON file in the temp directory
    const path = `${userId}/${projectId}/temp/${filename}`
    
    // Convert the data to a JSON string
    const jsonString = JSON.stringify(data)
    
    // Create a buffer from the JSON string
    const buffer = Buffer.from(jsonString)
    
    // Create the upload command
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
      Body: buffer,
      ContentType: 'application/json',
    })
    
    // Send the upload command
    await r2Client.send(uploadCommand)
    
    return { success: true }
  } catch (error) {
    console.error('Error saving JSON to R2:', error)
    return { success: false }
  }
}

/**
 * Save a text file to R2 storage
 */
export async function saveTextToR2({
  userId,
  projectId,
  filename,
  content,
  contentType = 'text/plain'
}: {
  userId: string
  projectId: string
  filename: string
  content: string
  contentType?: string
}): Promise<{ success: boolean, path?: string }> {
  try {
    // Create the path for the file in the temp directory
    const path = `${userId}/${projectId}/temp/${filename}`
    
    // Create a buffer from the content
    const buffer = Buffer.from(content)
    
    // Create the upload command
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
      Body: buffer,
      ContentType: contentType,
    })
    
    // Send the upload command
    await r2Client.send(uploadCommand)
    
    console.log('Text file saved to R2:', path)
    return { success: true, path }
  } catch (error) {
    console.error('Error saving text file to R2:', error)
    return { success: false }
  }
}

export async function getJsonFromR2<T>({
  userId,
  projectId,
  filename
}: {
  userId: string
  projectId: string
  filename: string
}): Promise<T | null> {
  try {
    // Create the path for the JSON file in the temp directory
    const path = `${userId}/${projectId}/temp/${filename}`
    
    // Create the get command
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
    })
    
    try {
      // Send the get command
      const response = await r2Client.send(getCommand)
      
      // Get the JSON string from the response
      const jsonString = await response.Body?.transformToString()
      
      if (!jsonString) {
        return null
      }
      
      // Parse the JSON string
      return JSON.parse(jsonString) as T
    } catch (error: unknown) {
      // If the file doesn't exist, return null
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'NoSuchKey') {
        return null
      }
      throw error
    }
  } catch (error) {
    console.error('Error getting JSON from R2:', error)
    return null
  }
}

// Add new function to get a signed URL for the HLS stream
export async function getSignedStreamUrl(path: string): Promise<string> {
  try {
    // Create a get command for the object
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
    })
    
    // Generate a signed URL with an expiration of 1 hour
    const url = await getSignedUrl(r2Client, getCommand, { expiresIn: 3600 })
    
    return url
  } catch (error) {
    console.error('Error generating signed URL for stream:', error)
    throw error
  }
}

/**
 * Copy HLS streaming files between validation and production paths
 */
export async function copyHlsStreamingFiles({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    // Define source (validation) and destination (production) paths
    const validationPrefix = `${userId}/${projectId}/streaming/`;
    const productionPrefix = `streaming_assets/${userId}/${projectId}/`;
    
    console.log(`Starting copy from ${validationPrefix} to ${productionPrefix}`);
    
    // List all files in the validation streaming directory
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      Prefix: validationPrefix,
      MaxKeys: 1000
    });
    
    const { Contents } = await r2Client.send(listCommand);
    
    if (!Contents || Contents.length === 0) {
      console.log('No HLS streaming files found in validation path:', validationPrefix);
      return { success: false, error: 'No streaming files found' };
    }
    
    console.log(`Found ${Contents.length} streaming files to copy`);
    
    // Copy each file to the production path
    for (const file of Contents) {
      if (!file.Key) continue;
      
      // Calculate the destination key by replacing the prefix
      const destinationKey = file.Key.replace(validationPrefix, productionPrefix);
      
      console.log(`Copying ${file.Key} to ${destinationKey}`);
      
      // Copy the file
      await r2Client.send(new CopyObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        CopySource: `${process.env.R2_BUCKET_NAME}/${file.Key}`,
        Key: destinationKey,
      }));
    }
    
    console.log(`Successfully copied ${Contents.length} HLS streaming files`);
    return { success: true };
  } catch (error) {
    console.error('Error copying HLS streaming files:', error);
    return { 
      success: false, 
      error: getUserFriendlyError(error)
    };
  }
}

// Add new function to get just the cover image URL
export async function getSignedCoverUrl(
  userId: string,
  projectId: string,
  coverPath: string
): Promise<string> {
  try {
    // Validate that the cover path belongs to the correct user and project
    if (!coverPath.startsWith(`${userId}/${projectId}/`)) {
      throw new Error('Invalid cover path')
    }

    // Get signed URL for just the cover image
    const url = await getSignedUrl(r2Client, new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: coverPath,
    }), { expiresIn: 3600 })

    return url
  } catch (error) {
    console.error('Error getting signed cover URL:', error)
    throw error
  }
}

