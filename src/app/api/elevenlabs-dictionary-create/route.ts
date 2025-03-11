import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { name, content } = await request.json()

    console.log('Creating pronunciation dictionary:', name)
    console.log('Content length:', content?.length || 0)

    if (!name || !content) {
      console.error('Missing required parameters:', { name, contentProvided: !!content })
      return NextResponse.json(
        { error: 'Name and content are required' },
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
      
      console.log('API is accessible, proceeding with dictionary creation')
    } catch (testError) {
      console.error('Error testing API accessibility:', testError)
      return NextResponse.json(
        { error: `Error testing API accessibility: ${testError instanceof Error ? testError.message : 'Unknown error'}` },
        { status: 503 } // Service Unavailable
      )
    }

    // Make request to ElevenLabs API to create the pronunciation dictionary
    try {
      console.log('Sending request to create dictionary...')
      const dictionaryData = {
        name,
        content
      }
      console.log('Dictionary data being sent:', JSON.stringify(dictionaryData, null, 2))
      
      const response = await fetch(
        'https://api.elevenlabs.io/v1/pronunciation-dictionaries',
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dictionaryData),
          // Set a timeout to avoid hanging if the API is not responding
          signal: AbortSignal.timeout(10000) // 10 second timeout
        }
      )

      console.log('Response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        console.error('ElevenLabs API error:', errorData || response.statusText)
        return NextResponse.json(
          { error: 'Failed to create pronunciation dictionary' },
          { status: response.status }
        )
      }

      // Successfully created dictionary
      const responseData = await response.json()
      console.log('Successfully created pronunciation dictionary:', name)
      console.log('Response data:', JSON.stringify(responseData, null, 2))
      
      return NextResponse.json({ 
        success: true,
        dictionaryName: name,
        dictionaryId: responseData.pronunciation_dictionary_id || null
      })
    } catch (fetchError) {
      console.error('Fetch error creating dictionary:', fetchError)
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
    console.error('Error in ElevenLabs dictionary create API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 