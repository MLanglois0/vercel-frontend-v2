import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/server/supabase-admin'

// Function to delete entries from the master dictionary table for a specific project
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const userId = url.searchParams.get('userId')
    const projectId = url.searchParams.get('projectId')
    const grapheme = url.searchParams.get('grapheme')

    if (!userId || !projectId) {
      return NextResponse.json(
        { error: 'User ID and Project ID are required' },
        { status: 400 }
      )
    }

    // Import needed modules
    const { 
      removeFromMasterDictionary, 
      getMasterDictionaryInfo,
      removeRulesFromElevenLabsDictionary 
    } = await import('@/app/actions/pronunciation-dictionary')

    // If grapheme is provided, we need to handle it differently
    if (grapheme) {
      console.log(`Deleting pronunciation rule for '${grapheme}' from project ${projectId}`)
      
      // First get the rule details including version_id
      const { data: ruleDetails, error: fetchError } = await supabaseAdmin
        .from('audibloom_master_dictionary')
        .select('version_id, dict_id')
        .match({ 
          userid: userId, 
          projectid: projectId,
          grapheme: grapheme
        })
        .single()
      
      if (fetchError) {
        console.error('Error fetching rule details:', fetchError)
        // Continue with deletion even if we can't get the version_id
      }
      
      // Get version ID and dictionary ID, use defaults if not found
      const versionId = ruleDetails?.version_id || "latest"
      const dictId = ruleDetails?.dict_id || (await getMasterDictionaryInfo()).id
      
      // First remove from ElevenLabs dictionary
      const elevenlabsResult = await removeRulesFromElevenLabsDictionary(
        dictId, 
        [{ string_to_replace: grapheme }],
        versionId
      )
      
      if (!elevenlabsResult.success) {
        console.warn(`Failed to remove rule for '${grapheme}' from ElevenLabs dictionary: ${elevenlabsResult.error}`)
        // Continue with database deletion even if ElevenLabs API fails
      }

      // Delete the specific entry from database
      const { error } = await supabaseAdmin
        .from('audibloom_master_dictionary')
        .delete()
        .match({ 
          userid: userId, 
          projectid: projectId 
        })
        .eq('grapheme', grapheme)

      if (error) {
        console.error('Error deleting from master dictionary:', error)
        return NextResponse.json(
          { error: 'Failed to delete entry from master dictionary' },
          { status: 500 }
        )
      }
    } else {
      // Delete all entries for this project using the server action
      // This will also update the master dictionary with the remaining rules
      const result = await removeFromMasterDictionary({
        userId,
        projectId
      })

      if (!result.success) {
        console.error('Error removing from master dictionary:', result.error)
        return NextResponse.json(
          { error: 'Failed to delete entries from master dictionary' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in master dictionary API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Function to add entries to the master dictionary table
export async function POST(request: NextRequest) {
  try {
    const { 
      userId, 
      projectId, 
      projectName, 
      bookName, 
      pronunciationCorrections 
    } = await request.json()

    if (!userId || !projectId || !projectName || !bookName || !pronunciationCorrections) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    // Import the getMasterDictionaryInfo function
    const { getMasterDictionaryInfo } = await import('@/app/actions/pronunciation-dictionary')
    
    // Get the dictionary info for dict_id
    const dictionaryInfo = await getMasterDictionaryInfo()
    const dictId = dictionaryInfo.id
    
    // Prepare the data for insertion
    const entries = pronunciationCorrections.map((correction: { originalName: string; ipaPronunciation: string }) => ({
      userid: userId,
      projectid: projectId,
      project_name: projectName,
      book_name: bookName,
      grapheme: correction.originalName,
      phoneme: correction.ipaPronunciation,
      dict_id: dictId,
      version_id: null // This will be updated after API call if not provided
    }))

    // Insert the entries into the master dictionary table
    // First, delete any existing entries for this user, project, and graphemes
    for (const entry of entries) {
      await supabaseAdmin
        .from('audibloom_master_dictionary')
        .delete()
        .match({ 
          userid: entry.userid, 
          projectid: entry.projectid,
          grapheme: entry.grapheme
        })
    }

    // Then insert the new entries
    const { error } = await supabaseAdmin
      .from('audibloom_master_dictionary')
      .insert(entries)

    if (error) {
      console.error('Error adding to master dictionary:', error)
      return NextResponse.json(
        { error: 'Failed to add entries to master dictionary' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in master dictionary API route:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
} 