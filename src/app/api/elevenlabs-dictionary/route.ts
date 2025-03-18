import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from '@/app/actions/storage'
import { getMasterDictionaryName } from '@/app/actions/pronunciation-dictionary'
import { addRulesToMasterDictionary } from '@/app/actions/pronunciation-dictionary'

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

    const dictionaryName = await getMasterDictionaryName()
    const dictionaryFileName = `${dictionaryName}.pls`

    if (!pronunciationCorrections || !Array.isArray(pronunciationCorrections) || pronunciationCorrections.length === 0) {
      console.log('No pronunciation corrections provided, skipping rule addition')
      return NextResponse.json({ 
        success: true, 
        dictionaryName, 
        dictionaryFileName,
        dictionaryId: null,
        message: 'No pronunciation corrections provided'
      })
    }

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    
    // Save the PLS content to R2 storage for reference
    const saveResult = await saveTextToR2({
      userId,
      projectId,
      filename: dictionaryFileName,
      content: plsContent,
      contentType: 'application/xml'
    })
    
    if (!saveResult.success) {
      console.error('Failed to save PLS file to R2')
    }

    // Add rules to the existing master dictionary
    const addRulesResult = await addRulesToMasterDictionary(pronunciationCorrections)
    
    if (!addRulesResult.success) {
      console.error('Failed to add rules to master dictionary:', addRulesResult.error)
      return NextResponse.json(
        { error: `Failed to add rules to master dictionary: ${addRulesResult.error}` },
        { status: 500 }
      )
    }

    console.log('Successfully added pronunciation rules to dictionary:', dictionaryName)

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
      dictionaryId: addRulesResult.dictionaryId || null
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