import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET_NAME } from '@/lib/r2'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Readable } from 'stream'
import { SdkStream } from '@aws-sdk/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')

    if (!path) {
      return new NextResponse('Path parameter is required', { status: 400 })
    }

    // Get the file from R2
    const getCommand = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: path,
    })

    const response = await r2Client.send(getCommand)
    
    if (!response.Body) {
      return new NextResponse('File not found', { status: 404 })
    }

    // Convert the readable stream to a buffer
    const bodyStream = response.Body as SdkStream<Readable>
    const chunks: Buffer[] = []
    
    // Use the Node.js stream API
    for await (const chunk of bodyStream) {
      chunks.push(Buffer.from(chunk))
    }
    
    const buffer = Buffer.concat(chunks)

    // Determine content type based on file extension
    const fileExtension = path.split('.').pop()?.toLowerCase()
    let contentType = 'application/octet-stream'
    
    if (fileExtension === 'png') {
      contentType = 'image/png'
    } else if (fileExtension === 'jpg' || fileExtension === 'jpeg') {
      contentType = 'image/jpeg'
    } else if (fileExtension === 'gif') {
      contentType = 'image/gif'
    } else if (fileExtension === 'svg') {
      contentType = 'image/svg+xml'
    } else if (fileExtension === 'webp') {
      contentType = 'image/webp'
    }

    // Set cache control headers for better performance
    const headers = new Headers()
    headers.set('Content-Type', contentType)
    headers.set('Cache-Control', 'public, max-age=31536000') // Cache for 1 year
    
    return new NextResponse(buffer, {
      status: 200,
      headers
    })
  } catch (error) {
    console.error('Error fetching image from R2:', error)
    const userFriendlyError = getUserFriendlyError(error)
    return new NextResponse(userFriendlyError, { status: 500 })
  }
} 