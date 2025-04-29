'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { createPlsDictionaryContent } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from './storage'

// Master dictionary name that will be used for all projects
const MASTER_DICTIONARY_NAME = 'audibloom_master_dictionary'
// Remove hardcoded ID - we'll always look it up dynamically

// Dictionary info type
interface DictionaryInfo {
  name: string
  id: string
  version_id?: string
}

// Interface for dictionary rule returned by ElevenLabs API
interface DictionaryRule {
  type: string
  phoneme: string
  string_to_replace: string
  alphabet: string
}

// Add interface for ElevenLabs dictionary response
interface ElevenLabsDictionary {
  id: string
  name: string
  description?: string
  creation_time_unix_ms?: number
  latest_version_id?: string
  rules_count?: number
  languages: string[]
}

interface ElevenLabsDictionariesResponse {
  dictionaries: ElevenLabsDictionary[]
}

// Async function to get the master dictionary name
export async function getMasterDictionaryName(): Promise<string> {
  return MASTER_DICTIONARY_NAME
}

// Fetches all dictionaries from ElevenLabs
async function getAllDictionaries(): Promise<ElevenLabsDictionary[] | null> {
  try {
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return null
    }

    // This implementation is based on the pattern from the Python code that works
    console.log('Attempting to fetch dictionaries using direct API pattern from Python')
    try {
      // Important: Use trailing slash exactly as in Python, and no additional options
      const response = await fetch(
        'https://api.elevenlabs.io/v1/pronunciation-dictionaries/',
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Accept': 'application/json'
          }
        }
      )
      
      if (response.ok) {
        const responseText = await response.text()
        console.log('Raw API response:', responseText.substring(0, 200) + '...')
        
        // Parse the response text explicitly
        try {
          const data = JSON.parse(responseText)
          
          // Handle different response formats
          let dictionaries: ElevenLabsDictionary[] = []
          
          if (data.pronunciation_dictionaries && Array.isArray(data.pronunciation_dictionaries)) {
            console.log(`Found ${data.pronunciation_dictionaries.length} dictionaries in 'pronunciation_dictionaries' field`)
            dictionaries = data.pronunciation_dictionaries
          } else if (data.dictionaries && Array.isArray(data.dictionaries)) {
            console.log(`Found ${data.dictionaries.length} dictionaries in 'dictionaries' field`)
            dictionaries = data.dictionaries
          } else if (Array.isArray(data)) {
            console.log(`Found ${data.length} dictionaries in array format`)
            dictionaries = data
          } else {
            console.log('Unexpected response format. Response keys:', Object.keys(data).join(', '))
            return null
          }
          
          if (dictionaries.length > 0) {
            dictionaries.forEach(dict => {
              console.log(`Dictionary: ${dict.name}, ID: ${dict.id}, Version: ${dict.latest_version_id || 'N/A'}`)
            })
            return dictionaries
          }
        } catch (parseError) {
          console.error('Error parsing response as JSON:', parseError)
          console.log('Raw response text:', responseText)
        }
      } else {
        console.log(`Direct method failed with status: ${response.status}`)
      }
    } catch (error) {
      console.log(`Direct method error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    
    // As a fallback, try the alternative endpoint format without trailing slash
    console.log('Trying alternative endpoint format without trailing slash')
    try {
      const response = await fetch(
        'https://api.elevenlabs.io/v1/pronunciation-dictionaries',
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Accept': 'application/json'
          }
        }
      )
      
      if (response.ok) {
        const data = await response.json() as ElevenLabsDictionariesResponse
        console.log(`Found ${data.dictionaries?.length || 0} dictionaries with alternative endpoint`)
        
        if (data.dictionaries?.length) {
          data.dictionaries.forEach(dict => {
            console.log(`Dictionary: ${dict.name}, ID: ${dict.id}, Version: ${dict.latest_version_id || 'N/A'}`)
          })
          return data.dictionaries
        }
      } else {
        console.log(`Alternative endpoint failed with status: ${response.status}`)
      }
    } catch (error) {
      console.log(`Alternative endpoint error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
    
    // Final fallback - check if API is accessible at all
    console.log('Both endpoints failed, checking if API is accessible at all')
    try {
      const response = await fetch(
        'https://api.elevenlabs.io/v1/user/subscription',
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Accept': 'application/json'
          }
        }
      )
      
      if (response.ok) {
        console.log('Successfully connected to ElevenLabs API, but dictionaries not found')
        console.log('No existing dictionary found - please ensure the master dictionary exists on ElevenLabs')
        
        // Last attempt - try a hard-coded direct URL from the Python code
        try {
          const response = await fetch(
            'https://api.elevenlabs.io/v1/pronunciation-dictionaries/audibloom_master_dictionary',
            {
              method: 'GET',
              headers: {
                'xi-api-key': apiKey,
                'Accept': 'application/json'
              }
            }
          )
          
          if (response.ok) {
            console.log('Successfully found dictionary by direct name lookup')
            const data = await response.json()
            
            // Return a single-item array with the dictionary
            return [{
              id: data.id,
              name: data.name,
              latest_version_id: data.latest_version_id,
              languages: data.languages || []
            }]
          } else {
            console.log(`Direct name lookup failed with status: ${response.status}`)
          }
        } catch (error) {
          console.log(`Direct name lookup error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
        
        // All attempts failed
        return null
      }
    } catch (error) {
      console.log(`Connectivity check error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }

    // All attempts failed
    console.error('All dictionary endpoints failed - please ensure that ElevenLabs API is accessible')
    return null
  } catch (error) {
    console.error('Error fetching dictionaries:', error)
    return null
  }
}

// Async function to get the master dictionary info
export async function getMasterDictionaryInfo(): Promise<DictionaryInfo> {
  try {
    // First, get all dictionaries
    const dictionaries = await getAllDictionaries()
    
    if (!dictionaries) {
      console.error('Failed to fetch dictionaries list')
      throw new Error('Failed to fetch dictionaries list')
    }
    
    // Find our master dictionary
    const masterDict = dictionaries.find(dict => dict.name === MASTER_DICTIONARY_NAME)
    
    if (masterDict) {
      console.log(`Found master dictionary: ${masterDict.name}`)
      console.log(`Dictionary ID: ${masterDict.id}`)
      console.log(`Latest version ID: ${masterDict.latest_version_id || 'none'}`)
      
      return {
        name: masterDict.name,
        id: masterDict.id,
        version_id: masterDict.latest_version_id
      }
    }
    
    // Master dictionary not found - don't try to create it
    console.error(`Master dictionary "${MASTER_DICTIONARY_NAME}" not found`)
    console.error('Please ensure the master dictionary has been created on ElevenLabs')
    throw new Error(`Master dictionary "${MASTER_DICTIONARY_NAME}" not found`)
  } catch (error) {
    console.error('Error in getMasterDictionaryInfo:', error)
    throw error
  }
}

// Get additional dictionary details if needed (for retrieving version ID)
async function getDictionaryDetails(dictionaryId: string): Promise<{ version_id?: string } | null> {
  try {
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return null
    }
    
    console.log(`Fetching details for dictionary ID: ${dictionaryId}`)
    
    // Use the plural endpoint format that works
    const apiUrl = `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}`
    console.log('Using API URL:', apiUrl)
    
    try {
      const response = await fetch(
        apiUrl,
        {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey,
            'Accept': 'application/json'
          }
        }
      )
      
      if (response.ok) {
        const data = await response.json()
        console.log(`Dictionary details: ${JSON.stringify(data, null, 2)}`)
        return {
          version_id: data.latest_version_id
        }
      } else {
        console.log(`Dictionary details request failed with status: ${response.status}`)
        
        // Try to get the version ID from content endpoint as fallback
        console.log('Trying content endpoint for version info')
        const contentResponse = await fetch(
          `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/content`,
          {
            method: 'GET',
            headers: {
              'xi-api-key': apiKey,
              'Accept': 'application/json'
            }
          }
        )
        
        if (contentResponse.ok) {
          const data = await contentResponse.json()
          console.log(`Dictionary content data: ${JSON.stringify(data, null, 2)}`)
          if (data.version_id) {
            return {
              version_id: data.version_id
            }
          }
        } else {
          console.log(`Content endpoint failed with status: ${contentResponse.status}`)
        }
      }
      
      console.error(`Failed to get details for dictionary ID: ${dictionaryId}`)
      return null
    } catch (error) {
      console.error('Network error getting dictionary details:', error)
      return null
    }
  } catch (error) {
    console.error('Error in getDictionaryDetails:', error)
    return null
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
      const details = await getDictionaryDetails(dictionaryId)
      versionId = details?.version_id
      
      if (!versionId) {
        console.error('Failed to get version ID for dictionary')
        return { 
          success: false, 
          error: 'Failed to get version ID for dictionary'
        }
      }
    }

    console.log('==================================================')
    console.log('DEBUG: REMOVING RULES FROM DICTIONARY')
    console.log('==================================================')
    console.log('Dictionary ID:', dictionaryId)
    console.log('Version ID:', versionId)
    console.log('Rules to remove:', rules)

    // Format the rules for removal
    const rule_strings = rules.map(rule => rule.string_to_replace)
    
    // Use the plural endpoint format that works
    const apiUrl = `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/remove-rules`
    console.log('Using API URL:', apiUrl)
    
    try {
      // Send the request using the working endpoint format
      const response = await fetch(
        apiUrl,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ 
            rule_strings,
            version_id: versionId // Include the version ID
          })
        }
      )
      
      console.log('Response status:', response.status)
      console.log('Response statusText:', response.statusText)
      
      if (response.ok) {
        console.log('==================================================')
        console.log('DEBUG: RULES REMOVED SUCCESSFULLY')
        console.log('==================================================')
        return { success: true }
      }
      
      // If something went wrong, log the error
      let errorData
      try {
        errorData = await response.text()
        try {
          // Try to parse as JSON for better error information
          const parsedError = JSON.parse(errorData)
          console.error('Error data:', parsedError)
          errorData = parsedError
        } catch {
          // Keep as text if not valid JSON
        }
      } catch {
        errorData = `Status: ${response.status} ${response.statusText}`
      }
      
      console.error('Error removing rules from dictionary:', errorData)
      return { 
        success: false, 
        error: `Failed to remove rules: ${response.status} ${response.statusText}`
      }
    } catch (error) {
      console.error('Network error removing rules:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  } catch (error) {
    console.error('Error in removeRulesFromElevenLabsDictionary:', error)
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
      
      // Get the dictionary info to get the current ID
      let dictId: string
      let versionId: string | undefined
      
      try {
        // First, try to use the dict_id from the rules
        if (projectRules[0]?.dict_id) {
          dictId = projectRules[0].dict_id
          
          // Get the most recent version ID from the rules
          versionId = projectRules
            .map(rule => rule.version_id)
            .filter(Boolean)[0]
            
          if (!versionId) {
            // If no version ID in rules, get the current dictionary info
            const dictionaryInfo = await getMasterDictionaryInfo()
            versionId = dictionaryInfo.version_id
          }
        } else {
          // Otherwise get the current dictionary info
          const dictionaryInfo = await getMasterDictionaryInfo()
          dictId = dictionaryInfo.id
          versionId = dictionaryInfo.version_id
        }
      } catch (error) {
        console.error('Error getting dictionary info:', error)
        // Can't continue without dictionary ID
        return { success: false, error: 'Failed to get dictionary ID' }
      }
      
      // Make sure we have a version ID
      if (!versionId) {
        console.warn('No version ID found, trying to get dictionary details')
        const details = await getDictionaryDetails(dictId)
        versionId = details?.version_id
      }
      
      if (!versionId) {
        console.error('Could not determine version ID, cannot remove rules')
        return { success: false, error: 'Could not determine version ID' }
      }
      
      console.log(`Using dictionary ID: ${dictId}`)
      console.log(`Using version ID: ${versionId}`)
      
      // Remove the rules from the ElevenLabs dictionary
      const elevenlabsResult = await removeRulesFromElevenLabsDictionary(
        dictId, 
        rulesToRemove,
        versionId
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
        
        if (!result.updated) {
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

    // Get the master dictionary info with version ID
    const dictionaryInfo = await getMasterDictionaryInfo()
    
    if (!dictionaryInfo || !dictionaryInfo.id) {
      return {
        success: false,
        error: 'Could not get dictionary information'
      }
    }
    
    const dictionaryId = dictionaryInfo.id
    
    // Make sure we have a version ID
    let versionId = dictionaryInfo.version_id
    
    // If no version ID in dictionary info, try to get it directly
    if (!versionId) {
      console.log('No version ID in dictionary info, fetching details')
      
      const details = await getDictionaryDetails(dictionaryId)
      versionId = details?.version_id
      
      if (!versionId) {
        console.error('Could not determine version ID, cannot add rules')
        return {
          success: false,
          error: 'Could not determine version ID'
        }
      }
    }
    
    console.log('==================================================')
    console.log('DEBUG: ADDING RULES TO MASTER DICTIONARY')
    console.log('==================================================')
    console.log('Using dictionary:', dictionaryInfo.name)
    console.log('Dictionary ID:', dictionaryId)
    console.log('Version ID:', versionId)

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

    console.log('Rules count:', rules.length)

    try {
      // Use the plural endpoint format that works
      const apiUrl = `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${dictionaryId}/add-rules`
      console.log('==================================================')
      console.log('DEBUG: SENDING ADD RULES REQUEST')
      console.log('==================================================')
      console.log('API URL:', apiUrl)
      console.log('Dictionary ID:', dictionaryId)
      console.log('Version ID:', versionId)
      console.log('Rules count:', rules.length)
      
      // Only log a sample of rules to avoid excessive logging
      if (rules.length > 0) {
        console.log('Sample rule:', JSON.stringify(rules[0], null, 2))
      }
      
      // Send the request using the working endpoint format
      const response = await fetch(
        apiUrl,
        {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ 
            rules,
            version_id: versionId // Always include a specific version ID
          })
        }
      )
      
      console.log('Response status:', response.status)
      console.log('Response statusText:', response.statusText)
      
      if (response.ok) {
        // Parse the response
        const data = await response.json()
        console.log('==================================================')
        console.log('DEBUG: RULES ADDED SUCCESSFULLY')
        console.log('==================================================')
        console.log('Response data:', JSON.stringify(data, null, 2))
        
        return {
          success: true,
          dictionaryId: data.id,
          versionId: data.version_id || versionId
        }
      }
      
      // If something went wrong, log the error
      let errorData
      try {
        errorData = await response.text()
        
        // Try to parse as JSON for better error information
        try {
          const parsedError = JSON.parse(errorData)
          console.error('Error data:', parsedError)
          errorData = parsedError
        } catch {
          // Keep as text if not valid JSON
        }
      } catch {
        errorData = `Status: ${response.status} ${response.statusText}`
      }
      
      console.error('Error adding rules to dictionary:', errorData)
      return { 
        success: false, 
        error: `Failed to add rules: ${response.status} ${response.statusText}`
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
      console.log('No pronunciation corrections provided, skipping dictionary update')
      const dictionaryInfo = await getMasterDictionaryInfo()
      return {
        dictionaryName: dictionaryInfo.name,
        dictionaryFileName: `${dictionaryInfo.name}.pls`,
        apiAccessible: false,
        created: false, // Always false since we never create dictionaries
        updated: true,
        data: {
          id: dictionaryInfo.id,
          name: dictionaryInfo.name,
          updated_by: userId,
          update_time_unix: Date.now(),
          version_id: dictionaryInfo.version_id || "unknown",
          description: "Master pronunciation dictionary for all projects"
        }
      }
    }

    const dictionaryInfo = await getMasterDictionaryInfo()
    const dictionaryName = dictionaryInfo.name
    const dictionaryFileName = `${dictionaryName}.pls`

    // Check if the dictionary exists - if not, log an error but don't try to create it
    if (!dictionaryInfo.id) {
      console.error('Master dictionary does not exist - dictionary creation is not supported in this function')
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false,
        created: false, // Always false
        updated: false,
        reason: 'Dictionary does not exist and creation is not supported'
      }
    }
    
    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    console.log('==================================================')
    console.log('DEBUG: UPDATING MASTER DICTIONARY RULES')
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
      created: false, // We never create dictionaries
      updated: true,
      data: {
        id: dictId,
        name: dictionaryName,
        updated_by: userId,
        update_time_unix: Date.now(),
        version_id: versionId || "unknown",
        description: "Master pronunciation dictionary for all projects"
      }
    }
  } catch (error) {
    console.error('Error updating master pronunciation dictionary:', error)
    const dictionaryInfo = await getMasterDictionaryInfo().catch(() => ({ 
      name: MASTER_DICTIONARY_NAME, 
      id: 'unknown' 
    }))
    
    return {
      dictionaryName: dictionaryInfo.name,
      dictionaryFileName: `${dictionaryInfo.name}.pls`,
      apiAccessible: false,
      created: false,
      updated: false,
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
    let url = `https://api.elevenlabs.io/v1/pronunciation-dictionary/${dictionaryId}/rules`
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