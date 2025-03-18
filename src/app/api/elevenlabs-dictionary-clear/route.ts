import { NextRequest, NextResponse } from 'next/server'
import { clearAllDictionaryRules, getMasterDictionaryInfo } from '@/app/actions/pronunciation-dictionary'

// Function to clear all rules from a dictionary
export async function POST(request: NextRequest) {
  try {
    const { dictionaryId, versionId } = await request.json()
    
    let dictId = dictionaryId
    
    // If no dictionary ID provided, use the master dictionary
    if (!dictId) {
      const dictionaryInfo = await getMasterDictionaryInfo()
      dictId = dictionaryInfo.id
    }
    
    if (!dictId) {
      return NextResponse.json(
        { error: 'Dictionary ID is required' },
        { status: 400 }
      )
    }
    
    // Clear all rules from the dictionary - versionId is now optional
    const result = await clearAllDictionaryRules(dictId, versionId)
    
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to clear dictionary rules' },
        { status: 500 }
      )
    }
    
    return NextResponse.json({ 
      success: true,
      message: 'All dictionary rules cleared successfully' 
    })
  } catch (error) {
    console.error('Error in dictionary clear API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 