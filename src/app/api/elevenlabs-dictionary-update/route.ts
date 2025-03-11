import { NextRequest, NextResponse } from 'next/server'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from '@/app/actions/storage'

// Function to update a pronunciation dictionary in Elevenlabs
export async function POST(request: NextRequest) {
  try {
    const { userId, projectId, dictionaryName, pronunciationCorrections } = await request.json()

    console.log('Updating pronunciation dictionary:', dictionaryName)
    console.log('Pronunciation corrections count:', pronunciationCorrections?.length || 0)

    if (!userId || !projectId || !dictionaryName) {
      console.error('Missing required parameters:', { userId, projectId, dictionaryName })
      return NextResponse.json(
        { error: 'User ID, Project ID, and Dictionary Name are required' },
        { status: 400 }
      )
    }

    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return NextResponse.json(
        { error: 'ElevenLabs API key is not configured' },
        { status: 500 }
      )
    }

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    console.log('==================================================')
    console.log('DEBUG: UPDATING PRONUNCIATION DICTIONARY')
    console.log('==================================================')
    console.log('Dictionary name:', dictionaryName)
    console.log('Generated PLS content length:', plsContent.length)
    console.log('PLS content first 100 chars:', plsContent.substring(0, 100))
    console.log('==================================================')
    
    // Save the PLS content to R2 storage first, regardless of API success
    const dictionaryFileName = `${dictionaryName}.pls`
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
    
    // First, try to check if the API is accessible
    try {
      console.log('Testing API accessibility...')
      const testResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        // Set a timeout to avoid hanging if the API is not responding
        signal: AbortSignal.timeout(5000) // 5 second timeout
      })
      
      if (!testResponse.ok) {
        console.error('ElevenLabs API is not accessible:', testResponse.status, testResponse.statusText)
        return NextResponse.json(
          { error: `ElevenLabs API is not accessible: ${testResponse.status} ${testResponse.statusText}` },
          { status: 503 } // Service Unavailable
        )
      }
      
      console.log('API is accessible, proceeding with dictionary update')
    } catch (testError) {
      console.error('Error testing API accessibility:', testError)
      return NextResponse.json(
        { error: `Error testing API accessibility: ${testError instanceof Error ? testError.message : 'Unknown error'}` },
        { status: 503 } // Service Unavailable
      )
    }

    // Make request to ElevenLabs API to update the pronunciation dictionary
    try {
      console.log('Sending request to update dictionary...')
      
      // Create a FormData object for the multipart/form-data request
      const formData = new FormData()
      
      // Create a File object from the PLS content
      const plsFile = new Blob([plsContent], { type: 'text/plain' })
      formData.append('file', plsFile, `${dictionaryName}.pls`)
      
      console.log('FormData created with file')
      console.log('FormData entries:')
      for (const [key, value] of formData.entries()) {
        if (key === 'file') {
          console.log(`${key}: [File/Blob]`)
        } else {
          console.log(`${key}: ${value}`)
        }
      }
      
      // Send the request to update the dictionary
      const response = await fetch(
        `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryName}/edit`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            // Don't set Content-Type header when using FormData
          },
          body: formData,
          signal: AbortSignal.timeout(30000) // 30 second timeout
        }
      )

      console.log('Response status:', response.status)
      console.log('Response headers:', JSON.stringify(Object.fromEntries([...response.headers.entries()]), null, 2))
      
      if (!response.ok) {
        let errorData
        try {
          errorData = await response.text()
          console.error('API error response text:', errorData)
          try {
            errorData = JSON.parse(errorData)
          } catch {
            console.error('Failed to parse error response as JSON')
          }
        } catch (textError) {
          console.error('Failed to get error response text:', textError)
        }
        
        console.error('API error:', errorData || response.statusText)
        return NextResponse.json(
          { error: 'Failed to update pronunciation dictionary' },
          { status: response.status }
        )
      }

      // Successfully updated dictionary
      let responseData
      try {
        const responseText = await response.text()
        console.log('Response text:', responseText)
        responseData = JSON.parse(responseText)
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError)
        return NextResponse.json(
          { error: 'Failed to parse response from Elevenlabs API' },
          { status: 500 }
        )
      }
      
      console.log('==================================================')
      console.log('DEBUG: DICTIONARY UPDATED SUCCESSFULLY')
      console.log('==================================================')
      console.log('Dictionary name:', dictionaryName)
      console.log('Response data:', JSON.stringify(responseData, null, 2))
      console.log('==================================================')
      
      // For debugging: Get a list of all dictionaries from ElevenLabs
      try {
        console.log('==================================================')
        console.log('DEBUG: FETCHING ELEVENLABS DICTIONARIES LIST')
        console.log('==================================================')
        const dictionariesResponse = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries', {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10000) // 10 second timeout
        })
        
        if (dictionariesResponse.ok) {
          const dictionariesData = await dictionariesResponse.json()
          console.log('DEBUG: ELEVENLABS DICTIONARIES LIST:')
          console.log(JSON.stringify(dictionariesData, null, 2))
          console.log('==================================================')
        } else {
          console.error('DEBUG: FAILED TO FETCH DICTIONARIES LIST:', dictionariesResponse.status, dictionariesResponse.statusText)
        }
      } catch (listError) {
        console.error('DEBUG: ERROR FETCHING DICTIONARIES LIST:', listError)
      }
      
      return NextResponse.json({ 
        success: true
      })
    } catch (fetchError) {
      console.error('Fetch error updating dictionary:', fetchError)
      console.error('Error details:', fetchError instanceof Error ? fetchError.message : 'Unknown error')
      if (fetchError instanceof Error && 'cause' in fetchError) {
        console.error('Error cause:', fetchError.cause)
      }
      
      return NextResponse.json(
        { error: `Fetch error: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Error in ElevenLabs dictionary update API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 