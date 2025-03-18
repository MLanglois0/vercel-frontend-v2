import { NextRequest, NextResponse } from 'next/server'
import { addRulesToMasterDictionary } from '@/app/actions/pronunciation-dictionary'

// Define types for the rule objects
interface PronunciationRule {
  type: string
  phoneme?: string
  string_to_replace?: string
  alphabet?: string
  originalName?: string
  ipaPronunciation?: string
  alias?: string
}

export async function POST(request: NextRequest) {
  try {
    const { rules } = await request.json()

    console.log('Dictionary rule addition requested')
    console.log('Rules count:', rules?.length || 0)

    if (!rules || rules.length === 0) {
      return NextResponse.json({ 
        success: true,
        message: 'No pronunciation rules provided, nothing to add'
      })
    }

    // Map the rules to PronunciationCorrection format if needed
    const pronunciationCorrections = rules.map((rule: PronunciationRule) => {
      if (rule.type === 'phoneme' && rule.alphabet === 'ipa') {
        return {
          originalName: rule.string_to_replace || '',
          ipaPronunciation: rule.phoneme || ''
        }
      } else if (rule.originalName && rule.ipaPronunciation) {
        // Already in the correct format
        return rule
      } else {
        console.warn('Unsupported rule format:', rule)
        return null
      }
    }).filter(Boolean)

    if (pronunciationCorrections.length === 0) {
      return NextResponse.json({ 
        success: false,
        error: 'No valid pronunciation rules provided' 
      }, { status: 400 })
    }

    // Add rules to the existing master dictionary
    const addRulesResult = await addRulesToMasterDictionary(pronunciationCorrections)
    
    return NextResponse.json({ 
      success: addRulesResult.success,
      dictionaryId: addRulesResult.dictionaryId,
      versionId: addRulesResult.versionId,
      error: addRulesResult.error
    })
  } catch (error) {
    console.error('Error in ElevenLabs dictionary create API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 