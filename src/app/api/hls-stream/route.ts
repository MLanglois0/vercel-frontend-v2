import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { r2Client } from '@/lib/r2'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Readable } from 'stream'
import { SdkStream } from '@aws-sdk/types'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Range, Origin, Accept, Referer',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
      'Access-Control-Max-Age': '86400',
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')

    if (!path) {
      return new NextResponse('Path parameter is required', { status: 400 })
    }

    console.log('Proxying HLS stream file:', path)

    // Get the file from R2
    const getCommand = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: path,
    })

    const response = await r2Client.send(getCommand)
    
    if (!response.Body) {
      console.error('HLS file not found in R2:', path)
      return new NextResponse('File not found', { status: 404 })
    }

    // Convert the readable stream to a buffer
    const bodyStream = response.Body as SdkStream<Readable>
    const chunks: Buffer[] = []
    
    // Use the Node.js stream API
    for await (const chunk of bodyStream) {
      chunks.push(Buffer.from(chunk))
    }
    
    let buffer = Buffer.concat(chunks)

    // Determine content type based on file extension
    const fileExtension = path.split('.').pop()?.toLowerCase()
    let contentType = 'application/octet-stream'
    
    if (fileExtension === 'm3u8') {
      contentType = 'application/vnd.apple.mpegurl'
      
      // For m3u8 files, we need to rewrite TS URLs to use our proxy
      let content = buffer.toString('utf-8')
      
      // Extract the base path (everything up to the last /)
      const basePath = path.substring(0, path.lastIndexOf('/') + 1)
      console.log('Base path for segments:', basePath)
      
      // Process each line to rewrite segment URLs
      const lines = content.split('\n')
      const rewrittenLines = lines.map(line => {
        // Skip comment lines
        if (line.startsWith('#')) {
          return line
        }
        
        // Handle empty lines
        if (line.trim() === '') {
          return line
        }
        
        // Rewrite segment URLs (both .ts and potentially .m3u8 files for adaptive streaming)
        if (line.trim().endsWith('.ts') || line.trim().endsWith('.m3u8')) {
          // Make sure we have the full path
          let segmentPath = line.trim()
          
          // Check if it's an absolute URL (starts with http:// or https://)
          if (segmentPath.startsWith('http://') || segmentPath.startsWith('https://')) {
            try {
              // Handle absolute URLs by extracting just the path
              const urlObj = new URL(segmentPath)
              // Extract just the path part
              segmentPath = urlObj.pathname.startsWith('/') ? 
                urlObj.pathname.substring(1) : urlObj.pathname
              console.log(`Extracted absolute path: ${segmentPath}`)
            } catch (e) {
              console.error(`Error processing URL ${segmentPath}:`, e)
            }
          } else if (!segmentPath.includes('/')) {
            // Handle relative URLs by combining with the base path
            segmentPath = basePath + segmentPath
            console.log(`Combined with base path: ${segmentPath}`)
          }
          
          // Create the proxy URL
          const proxiedUrl = `/api/hls-stream?path=${encodeURIComponent(segmentPath)}`
          console.log(`Rewriting segment: ${line.trim()} -> ${proxiedUrl}`)
          return proxiedUrl
        }
        
        // Pass through other lines
        return line
      })
      
      // Join the lines back together
      content = rewrittenLines.join('\n')
      
      // Replace the buffer with the modified content
      buffer = Buffer.from(content, 'utf-8')
    } else if (fileExtension === 'ts') {
      contentType = 'video/mp2t'
    } else if (fileExtension === 'mp4') {
      contentType = 'video/mp4'
    } else if (fileExtension === 'mp3') {
      contentType = 'audio/mpeg'
    }

    // Set headers for the response with robust CORS support
    const headers = new Headers()

    // Set appropriate content type based on file extension
    if (fileExtension === 'm3u8') {
      headers.set('Cache-Control', 'no-cache') // Ensure manifest is always fresh
      console.log('Sending m3u8 response with content type:', contentType, 'and size:', buffer.length)
    } else if (fileExtension === 'ts') {
      headers.set('Cache-Control', 'public, max-age=604800') // Cache TS segments for 1 week
    } else if (fileExtension === 'mp4') {
      headers.set('Cache-Control', 'public, max-age=604800') // Cache video files for 1 week
    } else if (fileExtension === 'mp3') {
      headers.set('Cache-Control', 'public, max-age=604800') // Cache audio files for 1 week
    } else {
      headers.set('Cache-Control', 'public, max-age=3600') // Cache other files for 1 hour
    }

    headers.set('Content-Type', contentType)
    headers.set('Content-Length', buffer.length.toString())
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Range, Origin, Accept, Referer')
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
    headers.set('Accept-Ranges', 'bytes') // Support Range requests for seeking
    
    return new NextResponse(buffer, {
      status: 200,
      headers
    })
  } catch (error) {
    console.error('Error fetching HLS file from R2:', error)
    const userFriendlyError = getUserFriendlyError(error)
    return new NextResponse(userFriendlyError, { status: 500 })
  }
} 