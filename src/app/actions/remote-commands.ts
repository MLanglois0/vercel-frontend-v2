'use server'

interface CommandResponse {
  output: string
  error: string
  returncode: number
}

export async function sendCommand(command: string): Promise<CommandResponse> {
  try {
    console.log('Starting command:', command)
    
    const response = await fetch('http://3.95.153.86:5000/run-command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Server error response:', errorText)
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    console.log('Command started:', data)
    return data as CommandResponse
  } catch (error: unknown) {
    console.error('Error sending command:', error)
    if (error instanceof Error) {
      throw new Error(`Command failed: ${error.message}`)
    }
    throw new Error('An unknown error occurred')
  }
} 