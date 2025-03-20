import { NextRequest, NextResponse } from 'next/server'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client, R2_BUCKET_NAME } from '@/lib/r2'
import { getUserFriendlyError } from '@/lib/error-handler'

export const dynamic = 'force-dynamic'

// Set CORS headers for preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}

// Generate and return a signed URL for accessing R2 objects directly
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const path = searchParams.get('path')
    const expiresIn = parseInt(searchParams.get('expiresIn') || '3600') // Default to 1 hour

    if (!path) {
      return NextResponse.json({ error: 'Path parameter is required' }, { status: 400 })
    }

    console.log('Generating signed URL for R2 file:', path)

    // Create a command to get the object
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: path,
    })

    // Generate the signed URL
    const signedUrl = await getSignedUrl(r2Client, command, { 
      expiresIn: expiresIn 
    })

    // Return the signed URL
    return NextResponse.json({ 
      signedUrl,
      path,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() 
    })
  } catch (error) {
    console.error('Error generating signed URL:', error)
    const userFriendlyError = getUserFriendlyError(error)
    return NextResponse.json(
      { error: userFriendlyError }, 
      { status: 500 }
    )
  }
} 