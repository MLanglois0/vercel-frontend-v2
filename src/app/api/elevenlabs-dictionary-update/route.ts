import { NextRequest, NextResponse } from 'next/server'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from '@/app/actions/storage'
import { addRulesToMasterDictionary, addToMasterDictionary } from '@/app/actions/pronunciation-dictionary'
import { supabaseAdmin } from '@/lib/server/supabase-admin'

// Function to update a pronunciation dictionary in Elevenlabs
export async function POST(request: NextRequest) {
  try {
    const { userId, projectId, dictionaryName, pronunciationCorrections } = await request.json()

    console.log('Dictionary update requested for:', dictionaryName)
    console.log('Pronunciation corrections count:', pronunciationCorrections?.length || 0)

    if (!pronunciationCorrections || pronunciationCorrections.length === 0) {
      return NextResponse.json({ 
        success: true,
        message: 'No pronunciation corrections provided, nothing to update'
      })
    }

    // Get project details from database
    const { data: projectData, error: projectError } = await supabaseAdmin
      .from('projects')
      .select('project_name, book_title')
      .eq('id', projectId)
      .single()
      
    if (projectError) {
      console.error('Error retrieving project details:', projectError)
      return NextResponse.json(
        { error: 'Failed to retrieve project details' },
        { status: 500 }
      )
    }
    
    const projectName = projectData?.project_name || 'Unknown Project'
    const bookName = projectData?.book_title || 'Unknown Book'

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    
    // Save the PLS content to R2 storage as a reference copy
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

    // Add rules to the existing master dictionary
    const addRulesResult = await addRulesToMasterDictionary(pronunciationCorrections)
    
    if (!addRulesResult.success) {
      console.error('Failed to add rules to master dictionary:', addRulesResult.error)
      // We still return success because the PLS file was saved and the database entries
      // were updated - the rules just weren't added to the ElevenLabs dictionary
    } else {
      // Update the database entries
      const dbUpdateResult = await addToMasterDictionary({
        userId,
        projectId,
        projectName,
        bookName,
        pronunciationCorrections,
        dictionaryId: addRulesResult.dictionaryId,
        versionId: addRulesResult.versionId
      })
      
      if (!dbUpdateResult.success) {
        console.error('Failed to update database with pronunciation corrections:', dbUpdateResult.error)
      }
    }

    // Return success with details
    return NextResponse.json({ 
      success: true,
      dictionaryId: addRulesResult.dictionaryId,
      versionId: addRulesResult.versionId,
      rulesAdded: addRulesResult.success
    })
  } catch (error) {
    console.error('Error in ElevenLabs dictionary update API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 