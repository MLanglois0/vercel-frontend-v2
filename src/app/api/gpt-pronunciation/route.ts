import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { name } = await request.json()
    
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required and must be a string' },
        { status: 400 }
      )
    }

    const apiKey = process.env.GPT_API_KEY
    
    if (!apiKey) {
      console.error('GPT_API_KEY is not defined in environment variables')
      return NextResponse.json(
        { error: 'API key configuration error' },
        { status: 500 }
      )
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a linguistics expert specializing in phonetic transcription. Provide only the IPA (International Phonetic Alphabet) pronunciation for names without any additional text or explanation.'
          },
          {
            role: 'user',
            content: `Provide the IPA pronunciation for the name: ${name}`
          }
        ],
        temperature: 0.3,
        max_tokens: 100
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('GPT API error:', errorData)
      return NextResponse.json(
        { error: 'Failed to get pronunciation from GPT' },
        { status: response.status }
      )
    }

    const data = await response.json()
    const ipaPronunciation = data.choices[0].message.content.trim()

    return NextResponse.json({ ipaPronunciation })
  } catch (error) {
    console.error('Error in GPT pronunciation API:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 