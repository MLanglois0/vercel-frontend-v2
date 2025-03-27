'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from './storage'

// Master dictionary name that will be used for all projects
const MASTER_DICTIONARY_NAME = 'audibloom_master_dictionary'
// ID of the master dictionary in ElevenLabs
const MASTER_DICTIONARY_ID = 'mNW6Bo13uvgh4AXwio4B'

// Dictionary info type
interface DictionaryInfo {
  name: string
  id: string
}

// Interface for dictionary rule returned by ElevenLabs API
interface DictionaryRule {
  type: string
  phoneme: string
  string_to_replace: string
  alphabet: string
}

// Async function to get the master dictionary name
export async function getMasterDictionaryName(): Promise<string> {
  return MASTER_DICTIONARY_NAME
}

// Async function to get the master dictionary info
export async function getMasterDictionaryInfo(): Promise<DictionaryInfo> {
  return {
    name: MASTER_DICTIONARY_NAME,
    id: MASTER_DICTIONARY_ID
  }
}

// Interface for pronunciation correction
interface PronunciationCorrection {
  originalName: string
  ipaPronunciation: string
}

// Function to add pronunciation rules to the master dictionary table
export async function addToMasterDictionary({
  userId,
  projectId,
  projectName,
  bookName,
  pronunciationCorrections,
  dictionaryId,
  versionId
}: {
  userId: string
  projectId: string
  projectName: string
  bookName: string
  pronunciationCorrections: PronunciationCorrection[]
  dictionaryId?: string
  versionId?: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!pronunciationCorrections || pronunciationCorrections.length === 0) {
      return { success: true }
    }

    // Get the dictionary info if not provided
    let dictId = dictionaryId
    const versnId = versionId
    
    if (!dictId || !versnId) {
      const dictionaryInfo = await getMasterDictionaryInfo()
      dictId = dictId || dictionaryInfo.id
      // version_id will be updated after API call if not provided
    }

    // Prepare the data for insertion
    const entries = pronunciationCorrections.map(correction => ({
      userid: userId,
      projectid: projectId,
      project_name: projectName,
      book_name: bookName,
      grapheme: correction.originalName,
      phoneme: correction.ipaPronunciation,
      dict_id: dictId,
      version_id: versnId
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
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in addToMasterDictionary:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to get all pronunciation rules for a project
export async function getProjectPronunciationRules({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<PronunciationCorrection[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('audibloom_master_dictionary')
      .select('*')
      .match({ userid: userId, projectid: projectId })
    
    if (error) {
      console.error('Error fetching project pronunciation rules:', error)
      return []
    }
    
    return data.map(item => ({
      originalName: item.grapheme,
      ipaPronunciation: item.phoneme
    })) || []
  } catch (error) {
    console.error('Error in getProjectPronunciationRules:', error)
    return []
  }
}

// Function to remove rules from the ElevenLabs dictionary
export async function removeRulesFromElevenLabsDictionary(
  dictionaryId: string,
  rules: { string_to_replace: string }[],
  versionId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return { 
        success: false, 
        error: 'ElevenLabs API key is not configured'
      }
    }

    // If no version ID provided, get the latest version
    if (!versionId) {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}`,
        {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(30000) // 30 second timeout
        }
      )

      if (!response.ok) {
        console.error('Error getting dictionary info:', response.statusText)
        return { 
          success: false, 
          error: `Failed to get dictionary info: ${response.status} ${response.statusText}`
        }
      }

      const dictionaryInfo = await response.json()
      versionId = dictionaryInfo.latest_version_id
    }

    console.log('==================================================')
    console.log('DEBUG: REMOVING RULES FROM DICTIONARY')
    console.log('==================================================')
    console.log('Dictionary ID:', dictionaryId)
    console.log('Version ID:', versionId)
    console.log('Rules to remove:', rules)

    // Format the rules for removal
    const rule_strings = rules.map(rule => rule.string_to_replace)

    const response = await fetch(
      `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/remove-rules`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          rule_strings,
          version_id: versionId // Include the version ID
        }),
        signal: AbortSignal.timeout(30000) // 30 second timeout
      }
    )

    if (!response.ok) {
      let errorData = await response.text()
      try {
        errorData = JSON.parse(errorData)
      } catch {
        // Keep as text if not valid JSON
      }
      console.error('Error removing rules from dictionary:', errorData)
      return { 
        success: false, 
        error: `Failed to remove rules: ${response.status} ${response.statusText}`
      }
    }

    console.log('==================================================')
    console.log('DEBUG: RULES REMOVED SUCCESSFULLY')
    console.log('==================================================')

    return { success: true }
  } catch (error) {
    console.error('Error removing rules from dictionary:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to remove pronunciation rules from the master dictionary table when a project is deleted
export async function removeFromMasterDictionary({
  userId,
  projectId
}: {
  userId: string
  projectId: string
}): Promise<{ success: boolean; error?: string }> {
  try {
    // First, get all the pronunciation rules for this project
    const { data: projectRules, error: fetchError } = await supabaseAdmin
      .from('audibloom_master_dictionary')
      .select('grapheme, phoneme, version_id, dict_id')
      .match({ userid: userId, projectid: projectId })
    
    if (fetchError) {
      console.error('Error fetching project pronunciation rules:', fetchError)
      return { success: false, error: fetchError.message }
    }
    
    // If there are rules for this project, remove them from the ElevenLabs dictionary first
    if (projectRules.length > 0) {
      console.log(`Removing ${projectRules.length} pronunciation rules for project ${projectId}`)
      
      // Format the rules for deletion
      const rulesToRemove = projectRules.map(rule => ({
        string_to_replace: rule.grapheme
      }))
      
      // Get the dictionary ID and version ID
      // First check if there's a dict_id in the rules
      const dictId = projectRules[0]?.dict_id || MASTER_DICTIONARY_ID
      
      // Get the most recent version ID from the rules
      const latestVersionId = projectRules
        .map(rule => rule.version_id)
        .filter(Boolean)[0] || 'latest'
      
      // Remove the rules from the ElevenLabs dictionary
      const elevenlabsResult = await removeRulesFromElevenLabsDictionary(
        dictId, 
        rulesToRemove,
        latestVersionId
      )
      
      if (!elevenlabsResult.success) {
        console.error('Error removing rules from ElevenLabs dictionary:', elevenlabsResult.error)
        // Continue with database deletion even if ElevenLabs API fails
      }
    }
    
    // Delete all entries for this user and project from the Supabase table
    const { error } = await supabaseAdmin
      .from('audibloom_master_dictionary')
      .delete()
      .match({ userid: userId, projectid: projectId })

    if (error) {
      console.error('Error removing from master dictionary table:', error)
      return { success: false, error: error.message }
    }
    
    // If there were rules for this project, we need to update the master dictionary
    // by getting all remaining rules and recreating the dictionary
    if (projectRules.length > 0) {
      console.log(`Removing ${projectRules.length} pronunciation rules for project ${projectId}`)
      
      // Get all remaining rules from all projects
      const { data: remainingRules, error: fetchError } = await supabaseAdmin
        .from('audibloom_master_dictionary')
        .select('grapheme, phoneme')
      
      if (fetchError) {
        console.error('Error fetching remaining pronunciation rules:', fetchError)
        return { success: false, error: fetchError.message }
      }
      
      // Convert to the format expected by createMasterPronunciationDictionary
      const remainingCorrections = remainingRules.map(rule => ({
        originalName: rule.grapheme,
        ipaPronunciation: rule.phoneme
      }))
      
      // Only update the master dictionary if there are remaining rules
      if (remainingCorrections.length > 0) {
        // Update the master dictionary with the remaining rules
        const result = await createMasterPronunciationDictionary(
          userId,
          projectId,
          'All Projects', // Generic name after removal
          'All Books',    // Generic name after removal
          remainingCorrections
        )
        
        if (!result.created) {
          console.error('Error updating master dictionary after removing project rules:', result.reason)
          // We still return success since the database was updated correctly
        }
      } else {
        console.log('No remaining pronunciation rules in any project, master dictionary not updated')
      }
    }

    return { success: true }
  } catch (error) {
    console.error('Error in removeFromMasterDictionary:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to add rules to the existing pronunciation dictionary
export async function addRulesToMasterDictionary(
  pronunciationCorrections: PronunciationCorrection[]
): Promise<{ success: boolean; dictionaryId?: string; versionId?: string; error?: string }> {
  try {
    // Only proceed if there are pronunciation corrections
    if (!pronunciationCorrections || pronunciationCorrections.length === 0) {
      console.log('No pronunciation corrections provided, skipping rule addition')
      return { 
        success: false, 
        error: 'No pronunciation corrections provided'
      }
    }

    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return { 
        success: false, 
        error: 'ElevenLabs API key is not configured'
      }
    }

    // Get the master dictionary info
    const { id: dictionaryId } = await getMasterDictionaryInfo()

    // First, get the latest version of the dictionary
    const response = await fetch(
      `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}`,
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(30000) // 30 second timeout
      }
    )

    if (!response.ok) {
      console.error('Error getting dictionary info:', response.statusText)
      return { 
        success: false, 
        error: `Failed to get dictionary info: ${response.status} ${response.statusText}`
      }
    }

    const dictionaryInfo = await response.json()
    const latestVersionId = dictionaryInfo.latest_version_id

    // Transform corrections to the format expected by the API
    const rules = pronunciationCorrections.map(correction => {
      // Format the IPA phoneme with forward slashes if they're not already present
      let phoneme = correction.ipaPronunciation;
      if (!phoneme.startsWith('/')) {
        phoneme = '/' + phoneme;
      }
      if (!phoneme.endsWith('/')) {
        phoneme = phoneme + '/';
      }
      
      return {
        type: 'phoneme',
        phoneme: phoneme,
        string_to_replace: correction.originalName,
        alphabet: 'ipa'
      }
    })

    console.log('==================================================')
    console.log('DEBUG: ADDING RULES TO MASTER DICTIONARY')
    console.log('==================================================')
    console.log('Dictionary ID:', dictionaryId)
    console.log('Latest Version ID:', latestVersionId)
    console.log('Rules count:', rules.length)

    try {
      // Send the request to add rules to the dictionary with version ID
      const addRulesResponse = await fetch(
        `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/add-rules`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            rules,
            version_id: latestVersionId // Include the latest version ID
          }),
          signal: AbortSignal.timeout(30000) // 30 second timeout
        }
      )

      if (!addRulesResponse.ok) {
        let errorData = await addRulesResponse.text()
        try {
          errorData = JSON.parse(errorData)
        } catch {
          // Keep as text if not valid JSON
        }
        console.error('Error adding rules to dictionary:', errorData)
        return { 
          success: false, 
          error: `Failed to add rules: ${addRulesResponse.status} ${addRulesResponse.statusText}`
        }
      }

      // Parse the response
      const data = await addRulesResponse.json()
      console.log('==================================================')
      console.log('DEBUG: RULES ADDED SUCCESSFULLY')
      console.log('==================================================')
      console.log('Response data:', JSON.stringify(data, null, 2))
      
      return {
        success: true,
        dictionaryId: data.id,
        versionId: data.version_id || latestVersionId // Use the new version ID or fall back to latest
      }
    } catch (error) {
      console.error('Error adding rules to dictionary:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  } catch (error) {
    console.error('Error in addRulesToMasterDictionary:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to create/update the master pronunciation dictionary PLS file
export async function createMasterPronunciationDictionary(
  userId: string,
  projectId: string,
  projectName: string,
  bookName: string,
  pronunciationCorrections: PronunciationCorrection[]
) {
  try {
    // Only proceed if there are pronunciation corrections
    if (!pronunciationCorrections || pronunciationCorrections.length === 0) {
      console.log('No pronunciation corrections provided, skipping dictionary creation')
      const dictionaryInfo = await getMasterDictionaryInfo()
      return {
        dictionaryName: dictionaryInfo.name,
        dictionaryFileName: `${dictionaryInfo.name}.pls`,
        apiAccessible: false,
        created: false,
        reason: 'No pronunciation corrections provided'
      }
    }

    const dictionaryInfo = await getMasterDictionaryInfo()
    const dictionaryName = dictionaryInfo.name
    const dictionaryFileName = `${dictionaryName}.pls`

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    console.log('==================================================')
    console.log('DEBUG: MASTER DICTIONARY ALREADY EXISTS - ADDING RULES')
    console.log('==================================================')
    console.log('Dictionary name:', dictionaryName)
    console.log('Pronunciation corrections count:', pronunciationCorrections.length)
    
    // Save the PLS content to R2 storage as a reference copy for this project
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
    }
    
    const dictId = addRulesResult.dictionaryId || dictionaryInfo.id
    const versionId = addRulesResult.versionId
    
    // Now update the database with the pronunciation corrections
    if (dictId) {
      const dbUpdateResult = await addToMasterDictionary({
        userId,
        projectId,
        projectName,
        bookName,
        pronunciationCorrections,
        dictionaryId: dictId,
        versionId
      })
      
      if (!dbUpdateResult.success) {
        console.error('Failed to update database with pronunciation corrections:', dbUpdateResult.error)
      }
    }
    
    // Return success data
    return {
      dictionaryName,
      dictionaryFileName,
      apiAccessible: addRulesResult.success,
      created: true,
      data: {
        id: dictId,
        name: dictionaryName,
        created_by: userId,
        creation_time_unix: Date.now(),
        version_id: versionId || "unknown",
        description: "Master pronunciation dictionary for all projects"
      }
    }
  } catch (error) {
    console.error('Error creating master pronunciation dictionary:', error)
    const dictionaryInfo = await getMasterDictionaryInfo()
    return {
      dictionaryName: dictionaryInfo.name,
      dictionaryFileName: `${dictionaryInfo.name}.pls`,
      apiAccessible: false,
      created: false,
      reason: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to get all rules for a dictionary
export async function getDictionaryRules(
  dictionaryId: string,
  versionId?: string
): Promise<{ success: boolean; rules?: DictionaryRule[]; error?: string }> {
  try {
    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return { 
        success: false, 
        error: 'ElevenLabs API key is not configured'
      }
    }
    
    // Construct the URL - use version_id as a query parameter if provided
    let url = `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/rules`
    if (versionId) {
      url += `?version_id=${encodeURIComponent(versionId)}`
    }

    console.log('==================================================')
    console.log('DEBUG: FETCHING DICTIONARY RULES')
    console.log('==================================================')
    console.log('Dictionary ID:', dictionaryId)
    console.log('Version ID:', versionId || 'latest')

    // Get the dictionary rules
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000) // 30 second timeout
    })

    if (!response.ok) {
      let errorData = await response.text()
      try {
        errorData = JSON.parse(errorData)
      } catch {
        // Keep as text if not valid JSON
      }
      console.error('Error getting dictionary rules:', errorData)
      return { 
        success: false, 
        error: `Failed to get rules: ${response.status} ${response.statusText}`
      }
    }

    // Parse the response
    const data = await response.json()
    console.log(`Found ${data.rules?.length || 0} rules in dictionary`)
    
    return { 
      success: true,
      rules: data.rules || []
    }
  } catch (error) {
    console.error('Error getting dictionary rules:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// Function to clear all rules from a dictionary
export async function clearAllDictionaryRules(
  dictionaryId: string,
  versionId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // First get all rules from the dictionary
    const rulesResult = await getDictionaryRules(dictionaryId, versionId)
    
    if (!rulesResult.success || !rulesResult.rules) {
      return { 
        success: false, 
        error: rulesResult.error || 'Failed to get dictionary rules'
      }
    }
    
    // If there are no rules, we're done
    if (rulesResult.rules.length === 0) {
      console.log('No rules to clear from dictionary')
      return { success: true }
    }
    
    console.log(`Found ${rulesResult.rules.length} rules to clear from dictionary`)
    
    // Format the rules for deletion - just need the string_to_replace value
    const rulesToRemove = rulesResult.rules.map(rule => ({
      string_to_replace: rule.string_to_replace
    }))
    
    // Remove all rules
    return await removeRulesFromElevenLabsDictionary(
      dictionaryId,
      rulesToRemove,
      versionId || 'latest'
    )
  } catch (error) {
    console.error('Error clearing dictionary rules:', error)
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
} 