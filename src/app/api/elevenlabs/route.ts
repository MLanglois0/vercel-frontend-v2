import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { text, voiceId } = await request.json()

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
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

    // Default voice ID if not provided
    const finalVoiceId = voiceId || 'pNInz6obpgDQGcFmaJgB' // Default ElevenLabs voice

    // Make request to ElevenLabs API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${finalVoiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.5,
          },
          text_format: "ssml"
        }),
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => null)
      console.error('ElevenLabs API error:', errorData || response.statusText)
      return NextResponse.json(
        { error: 'Failed to generate speech' },
        { status: response.status }
      )
    }

    // Get the audio data as ArrayBuffer
    const audioArrayBuffer = await response.arrayBuffer()
    
    // Convert ArrayBuffer to base64
    const audioBase64 = Buffer.from(audioArrayBuffer).toString('base64')

    return NextResponse.json({ audio: audioBase64 })
  } catch (error) {
    console.error('Error in ElevenLabs API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 