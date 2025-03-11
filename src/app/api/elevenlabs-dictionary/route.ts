import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'

// Function to create a pronunciation dictionary in Elevenlabs
export async function POST(request: NextRequest) {
  try {
    const { userId, projectId, pronunciationCorrections } = await request.json()

    if (!userId || !projectId) {
      return NextResponse.json(
        { error: 'User ID and Project ID are required' },
        { status: 400 }
      )
    }

    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key is not configured' },
        { status: 500 }
      )
    }

    // Generate dictionary name based on last 4 digits of userId and projectId
    const userIdSuffix = userId.slice(-4)
    const projectIdSuffix = projectId.slice(-4)
    const dictionaryName = `${userIdSuffix}_${projectIdSuffix}_pronunciation_dictionary`
    const dictionaryFileName = `${dictionaryName}.pls`

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections || [])

    // Make request to ElevenLabs API to create/update the pronunciation dictionary
    const response = await fetch(
      'https://api.elevenlabs.io/v1/pronunciation-dictionaries',
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: dictionaryName,
          content: plsContent
        }),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('ElevenLabs API error:', errorData || response.statusText)
      return NextResponse.json(
        { error: 'Failed to create pronunciation dictionary' },
        { status: response.status }
      )
    }

    const data = await response.json()
    console.log('Successfully created pronunciation dictionary:', dictionaryName)

    // Update the project in Supabase with the dictionary information
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        pls_dict_name: dictionaryName,
        pls_dict_file: dictionaryFileName
      })
      .eq('id', projectId)

    if (updateError) {
      console.error('Error updating project with dictionary info:', updateError)
      return NextResponse.json(
        { error: 'Failed to update project with dictionary information' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      dictionaryName, 
      dictionaryFileName,
      dictionaryId: data.pronunciation_dictionary_id || null
    })
  } catch (error) {
    console.error('Error in ElevenLabs dictionary API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Function to get a pronunciation dictionary from Elevenlabs
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const dictionaryName = url.searchParams.get('dictionaryName')

    if (!dictionaryName) {
      return NextResponse.json(
        { error: 'Dictionary name is required' },
        { status: 400 }
      )
    }

    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key is not configured' },
        { status: 500 }
      )
    }

    // Make request to ElevenLabs API to get the pronunciation dictionary
    const response = await fetch(
      `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryName}`,
      {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        }
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('ElevenLabs API error:', errorData || response.statusText)
      return NextResponse.json(
        { error: 'Failed to get pronunciation dictionary' },
        { status: response.status }
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error in ElevenLabs dictionary API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Function to delete a pronunciation dictionary from Elevenlabs
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const dictionaryName = url.searchParams.get('dictionaryName')
    const projectId = url.searchParams.get('projectId')

    if (!dictionaryName || !projectId) {
      return NextResponse.json(
        { error: 'Dictionary name and Project ID are required' },
        { status: 400 }
      )
    }

    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ElevenLabs API key is not configured' },
        { status: 500 }
      )
    }

    // Make request to ElevenLabs API to delete the pronunciation dictionary
    const response = await fetch(
      `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryName}`,
      {
        method: 'DELETE',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        }
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('ElevenLabs API error:', errorData || response.statusText)
      return NextResponse.json(
        { error: 'Failed to delete pronunciation dictionary' },
        { status: response.status }
      )
    }

    // Update the project in Supabase to remove the dictionary information
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        pls_dict_name: null,
        pls_dict_file: null
      })
      .eq('id', projectId)

    if (updateError) {
      console.error('Error updating project to remove dictionary info:', updateError)
      return NextResponse.json(
        { error: 'Failed to update project to remove dictionary information' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in ElevenLabs dictionary API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 