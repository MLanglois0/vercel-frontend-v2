/**
 * Helper functions for interacting with the Elevenlabs API
 */

// Base URL for Elevenlabs API
export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

// Function to check if the Elevenlabs API is accessible
export async function checkElevenlabsApiAccessibility(): Promise<{
  accessible: boolean;
  error?: string;
  statusCode?: number;
}> {
  try {
    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      return {
        accessible: false,
        error: 'ElevenLabs API key is not configured'
      }
    }

    // Make a simple request to the Elevenlabs API to check if it's accessible
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      // Set a timeout to avoid hanging if the API is not responding
      signal: AbortSignal.timeout(5000) // 5 second timeout
    })

    if (!response.ok) {
      return {
        accessible: false,
        error: `API returned status ${response.status}: ${response.statusText}`,
        statusCode: response.status
      }
    }

    return {
      accessible: true
    }
  } catch (error) {
    console.error('Error checking Elevenlabs API accessibility:', error)
    return {
      accessible: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to validate a PLS dictionary content
export function validatePlsDictionary(plsContent: string): {
  valid: boolean;
  error?: string;
} {
  try {
    // Basic validation - check if it has the required XML structure
    if (!plsContent.includes('<?xml version="1.0" encoding="UTF-8"?>')) {
      return {
        valid: false,
        error: 'Missing XML declaration'
      }
    }

    if (!plsContent.includes('<lexicon')) {
      return {
        valid: false,
        error: 'Missing lexicon element'
      }
    }

    // More detailed validation could be added here if needed

    return {
      valid: true
    }
  } catch (error) {
    console.error('Error validating PLS dictionary:', error)
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to create a PLS dictionary content from pronunciation corrections
export function createPlsDictionaryContent(pronunciationCorrections: Array<{
  originalName: string;
  ipaPronunciation: string;
}>): string {
  // Format exactly as in the example from the documentation, with no indentation
  let plsContent = '<?xml version="1.0" encoding="UTF-8"?>\n';
  plsContent += '<lexicon version="1.0"\n';
  plsContent += 'xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"\n';
  plsContent += 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n';
  plsContent += 'xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon\n';
  plsContent += 'http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"\n';
  plsContent += 'alphabet="ipa" xml:lang="en-US">\n';

  if (pronunciationCorrections && pronunciationCorrections.length > 0) {
    for (const correction of pronunciationCorrections) {
      if (correction.originalName && correction.ipaPronunciation) {
        // Format the IPA phoneme with forward slashes if they're not already present
        let phoneme = correction.ipaPronunciation;
        if (!phoneme.startsWith('/')) {
          phoneme = '/' + phoneme;
        }
        if (!phoneme.endsWith('/')) {
          phoneme = phoneme + '/';
        }
        
        // No indentation for lexeme tags
        plsContent += '<lexeme>\n';
        plsContent += '<grapheme>' + correction.originalName + '</grapheme>\n';
        plsContent += '<phoneme>' + phoneme + '</phoneme>\n';
        plsContent += '</lexeme>\n';
      }
    }
  }

  plsContent += '</lexicon>';
  return plsContent;
}

// Function to test the PLS format with sample data
export function testPlsFormat(): string {
  // This is the exact example from the ElevenLabs documentation
  return `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"
alphabet="ipa" xml:lang="en-US">
<lexeme>
<grapheme>tomato</grapheme>
<phoneme>/tə'meɪtoʊ/</phoneme>
</lexeme>
<lexeme>
<grapheme>Tomato</grapheme>
<phoneme>/tə'meɪtoʊ/</phoneme>
</lexeme>
</lexicon>`;
} 