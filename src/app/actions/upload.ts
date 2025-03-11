'use server'

import { supabaseAdmin } from '@/lib/server/supabase-admin'
import { uploadProjectFile } from './storage'
import { getUserFriendlyError } from '@/lib/error-handler'
import { updateProjectStatus } from './storage'
import { createPlsDictionaryContent, testPlsFormat } from '@/lib/elevenlabs-helper'
import { saveTextToR2 } from './storage'

// Debug function to test the PLS format
export async function debugPlsFormat() {
  // Get the example PLS content from the helper
  const plsContent = testPlsFormat();
  console.log('==================================================');
  console.log('DEBUG: TEST PLS FORMAT');
  console.log('==================================================');
  console.log(plsContent);
  console.log('==================================================');
  
  // Try creating a dictionary with this exact example
  try {
    // Generate a simple dictionary name
    const dictionaryName = `test_dictionary_${Date.now()}`;
    const dictionaryFileName = `${dictionaryName}.pls`;
    
    console.log('Creating test dictionary with name:', dictionaryName);
    
    // Create a FormData object
    const formData = new FormData();
    formData.append('name', dictionaryName);
    
    // Create a Blob from the PLS content
    const plsFile = new Blob([plsContent], { type: 'text/plain' });
    formData.append('file', plsFile, dictionaryFileName);
    
    // Add a description
    formData.append('description', 'Test dictionary with tomato example');
    
    // Get the API key
    const apiKey = process.env.ELEVEN_API_KEY;
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured');
      return { success: false, error: 'API key not configured' };
    }
    
    // Send the request
    const response = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: formData,
      signal: AbortSignal.timeout(30000)
    });
    
    console.log('Test dictionary response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('Test dictionary created successfully:', data);
      return { success: true, plsContent, testResult: data };
    } else {
      const errorText = await response.text();
      console.error('Failed to create test dictionary:', errorText);
      return { success: false, plsContent, error: errorText };
    }
  } catch (error) {
    console.error('Error in test dictionary creation:', error);
    return { success: false, plsContent, error };
  }
}

// Debug function to test the PLS format with actual pronunciation corrections
export async function debugPlsFormatWithCorrections(
  pronunciationCorrections: Array<{
    originalName: string;
    ipaPronunciation: string;
  }>
) {
  const plsContent = createPlsDictionaryContent(pronunciationCorrections);
  console.log('==================================================');
  console.log('DEBUG: TEST PLS FORMAT WITH CORRECTIONS');
  console.log('==================================================');
  console.log(plsContent);
  console.log('==================================================');
  
  // Compare with the example format
  const exampleFormat = testPlsFormat();
  console.log('==================================================');
  console.log('DEBUG: EXAMPLE FORMAT');
  console.log('==================================================');
  console.log(exampleFormat);
  console.log('==================================================');
  
  return { success: true, plsContent };
}

// Function to create an empty pronunciation dictionary for a project
// This function is no longer used - dictionary creation happens in createPronunciationDictionary
// when there are actual pronunciation corrections to include
/*
async function createEmptyPronunciationDictionary(userId: string, projectId: string) {
  try {
    // Generate dictionary name based on last 4 digits of userId and projectId
    const userIdSuffix = userId.slice(-4)
    const projectIdSuffix = projectId.slice(-4)
    const dictionaryName = `${userIdSuffix}_${projectIdSuffix}_pronunciation_dictionary`
    const dictionaryFileName = `${dictionaryName}.pls`

    // Create empty PLS content - using the exact format from the documentation
    const plsContent = `<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" 
      xmlns="http://www.w3.org/2005/01/pronunciation-lexicon" 
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
      xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon 
        http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd" 
      alphabet="ipa" xml:lang="en-US">
</lexicon>`

    console.log('Creating pronunciation dictionary:', dictionaryName)
    console.log('PLS content length:', plsContent.length)
    console.log('PLS content first 100 chars:', plsContent.substring(0, 100))
    
    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false
      }
    } else {
      console.log('API key is configured (length:', apiKey.length, ')')
    }
    
    // Test network connectivity
    try {
      console.log('Testing network connectivity...')
      const testResponse = await fetch('https://www.google.com', {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      })
      
      if (!testResponse.ok) {
        console.error('Network connectivity test failed:', testResponse.status, testResponse.statusText)
        return {
          dictionaryName,
          dictionaryFileName,
          apiAccessible: false
        }
      }
      
      console.log('Network connectivity test successful')
    } catch (networkError) {
      console.error('Network connectivity test error:', networkError)
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false
      }
    }
    
    console.log('Sending request to create dictionary...')
    
    // Create a FormData object for the multipart/form-data request
    const formData = new FormData()
    formData.append('name', dictionaryName)
    
    // Create a Blob from the PLS content and append it as a file
    const plsBlob = new Blob([plsContent], { type: 'application/xml' })
    formData.append('file', plsBlob, dictionaryFileName)
    
    console.log('FormData created with name, file, and description')
    
    // Send the request to create the dictionary
    const response = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        // Don't set Content-Type header when using FormData
      },
      body: formData,
      signal: AbortSignal.timeout(30000) // 30 second timeout
    })
    
    console.log('Response status:', response.status)
    console.log('Response headers:', JSON.stringify(Object.fromEntries([...response.headers.entries()]), null, 2));
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.text();
        console.error('API error response text:', errorData);
        try {
          errorData = JSON.parse(errorData);
        } catch {
          console.error('Failed to parse error response as JSON');
        }
      } catch (textError) {
        console.error('Failed to get error response text:', textError);
      }
      
      console.error('API error:', JSON.stringify(errorData, null, 2));
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false
      }
    }
    
    // Parse the response
    const data = await response.json()
    console.log('==================================================')
    console.log('DEBUG: DICTIONARY CREATED SUCCESSFULLY')
    console.log('==================================================')
    console.log(JSON.stringify(data, null, 2))
    console.log('==================================================')
    
    return {
      dictionaryName,
      dictionaryFileName,
      apiAccessible: true
    }
  } catch (error) {
    console.error('Error creating pronunciation dictionary:', error)
    return {
      dictionaryName: null,
      dictionaryFileName: null,
      apiAccessible: false
    }
  }
}
*/

// Function to create a pronunciation dictionary with content for a project
export async function createPronunciationDictionary(
  userId: string, 
  projectId: string, 
  pronunciationCorrections: Array<{
    originalName: string;
    ipaPronunciation: string;
  }>
) {
  try {
    // Only proceed if there are pronunciation corrections
    if (!pronunciationCorrections || pronunciationCorrections.length === 0) {
      console.log('No pronunciation corrections provided, skipping dictionary creation')
      return {
        dictionaryName: null,
        dictionaryFileName: null,
        apiAccessible: false,
        created: false,
        reason: 'No pronunciation corrections provided'
      }
    }

    // Generate dictionary name based on last 4 digits of userId and projectId
    const userIdSuffix = userId.slice(-4)
    const projectIdSuffix = projectId.slice(-4)
    const dictionaryName = `${userIdSuffix}_${projectIdSuffix}_pronunciation_dictionary`
    const dictionaryFileName = `${dictionaryName}.pls`

    // Create PLS content from pronunciation corrections
    const plsContent = createPlsDictionaryContent(pronunciationCorrections)
    console.log('==================================================')
    console.log('DEBUG: CREATING PRONUNCIATION DICTIONARY')
    console.log('==================================================')
    console.log('Dictionary name:', dictionaryName)
    console.log('Pronunciation corrections count:', pronunciationCorrections.length)
    console.log('PLS content length:', plsContent.length)
    console.log('PLS content first 100 chars:', plsContent.substring(0, 100))
    console.log('Full PLS content:')
    console.log(plsContent)
    
    // Save the PLS content to R2 storage first, regardless of API success
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
    
    // Use the API key from environment variables
    const apiKey = process.env.ELEVEN_API_KEY
    if (!apiKey) {
      console.error('ElevenLabs API key is not configured')
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false,
        created: false,
        reason: 'API key not configured'
      }
    } else {
      console.log('API key is configured (length:', apiKey.length, ')')
    }
    
    // Test network connectivity
    try {
      console.log('Testing network connectivity...')
      const testResponse = await fetch('https://www.google.com', {
        method: 'GET',
        signal: AbortSignal.timeout(5000) // 5 second timeout
      })
      
      if (!testResponse.ok) {
        console.error('Network connectivity test failed:', testResponse.status, testResponse.statusText)
        return {
          dictionaryName,
          dictionaryFileName,
          apiAccessible: false,
          created: false,
          reason: 'Network connectivity test failed'
        }
      }
      
      console.log('Network connectivity test successful')
    } catch (networkError) {
      console.error('Network connectivity test error:', networkError)
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false,
        created: false,
        reason: 'Network connectivity test error'
      }
    }
    
    console.log('Sending request to create dictionary...')
    
    // Create a FormData object for the multipart/form-data request
    const formData = new FormData()
    formData.append('name', dictionaryName)
    
    // Save the PLS content to R2 storage first
    await saveTextToR2({
      userId,
      projectId,
      filename: dictionaryFileName,
      content: plsContent,
      contentType: 'application/xml'
    });
    
    // Create a File object from the PLS content
    // Note: In Node.js environments, we need to use a Blob instead of File
    const plsFile = new Blob([plsContent], { type: 'text/plain' });
    
    // Append the file to the FormData with the correct field name
    formData.append('file', plsFile, dictionaryFileName);
    
    // Add an optional description
    formData.append('description', `Pronunciation dictionary for project ${projectId}`);
    
    console.log('FormData created with name, file, and description')
    console.log('FormData entries:')
    for (const [key, value] of formData.entries()) {
      if (key === 'file') {
        console.log(`${key}: [File/Blob]`);
      } else {
        console.log(`${key}: ${value}`);
      }
    }
    
    // Send the request to create the dictionary
    const response = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        // Don't set Content-Type header when using FormData
      },
      body: formData,
      signal: AbortSignal.timeout(30000) // 30 second timeout
    })
    
    console.log('Response status:', response.status)
    console.log('Response headers:', JSON.stringify(Object.fromEntries([...response.headers.entries()]), null, 2));
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.text();
        console.error('API error response text:', errorData);
        try {
          errorData = JSON.parse(errorData);
        } catch {
          console.error('Failed to parse error response as JSON');
        }
      } catch (textError) {
        console.error('Failed to get error response text:', textError);
      }
      
      console.error('API error:', JSON.stringify(errorData, null, 2));
      return {
        dictionaryName,
        dictionaryFileName,
        apiAccessible: false,
        created: false,
        reason: `API error: ${response.status} ${response.statusText}`
      }
    }
    
    // Parse the response
    const data = await response.json()
    console.log('==================================================')
    console.log('DEBUG: DICTIONARY CREATED SUCCESSFULLY')
    console.log('==================================================')
    console.log(JSON.stringify(data, null, 2))
    console.log('==================================================')
    
    // For debugging: Get a list of all dictionaries from ElevenLabs
    try {
      console.log('==================================================')
      console.log('DEBUG: FETCHING ELEVENLABS DICTIONARIES LIST')
      console.log('==================================================')
      const dictionariesResponse = await fetch('https://api.elevenlabs.io/v1/pronunciation-dictionaries', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000) // 10 second timeout
      })
      
      if (dictionariesResponse.ok) {
        const dictionariesData = await dictionariesResponse.json()
        console.log('DEBUG: ELEVENLABS DICTIONARIES LIST:')
        console.log(JSON.stringify(dictionariesData, null, 2))
        console.log('==================================================')
      } else {
        console.error('DEBUG: FAILED TO FETCH DICTIONARIES LIST:', dictionariesResponse.status, dictionariesResponse.statusText)
      }
    } catch (listError) {
      console.error('DEBUG: ERROR FETCHING DICTIONARIES LIST:', listError)
    }
    
    // We already saved the PLS content to R2 storage at the beginning
    
    return {
      dictionaryName,
      dictionaryFileName,
      apiAccessible: true,
      created: true,
      data
    }
  } catch (error) {
    console.error('Error creating pronunciation dictionary:', error)
    return {
      dictionaryName: null,
      dictionaryFileName: null,
      apiAccessible: false,
      created: false,
      reason: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function uploadFile(formData: FormData, userId: string) {
  try {
    const projectName = formData.get('project_name') as string
    const bookTitle = formData.get('book_title') as string
    const authorName = formData.get('author_name') as string
    const description = formData.get('description') as string
    const file = formData.get('file') as Blob & { name?: string }
    const cover = formData.get('cover') as Blob & { name?: string }

    if (!file || !cover) throw new Error('Missing required files')
    if (!file.name || !cover.name) throw new Error('File names are required')

    // Get user email for notifications
    const { data: { user } } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (!user?.email) throw new Error('User email not found')

    // Create project using supabaseAdmin
    const { data: project, error: projectError } = await supabaseAdmin
      .from('projects')
      .insert([
        {
          project_name: projectName,
          book_title: bookTitle,
          author_name: authorName,
          description: description,
          user_id: userId,
          status: 'pending'
        }
      ])
      .select()
      .single()

    if (projectError) throw projectError

    // Create initial status file
    await updateProjectStatus({
      userId,
      projectId: project.id,
      status: {
        Project: projectName,
        Book: bookTitle,
        notify: user.email,
        userid: userId,
        projectid: project.id,
        Current_Status: "Ready to Process Ebook",
        Ebook_Prep_Status: "Ready to process ebook",
        Storyboard_Status: "Waiting for Ebook Processing Completion",
        Audiobook_Status: "Waiting for Storyboard Completion"
      }
    })

    // Upload files to R2
    const { path: epubPath } = await uploadProjectFile(
      file,
      userId,
      project.id,
      file.name,
      'application/epub+zip'
    )

    const { path: coverPath } = await uploadProjectFile(
      cover,
      userId,
      project.id,
      cover.name,
      cover.type
    )

    // No longer creating pronunciation dictionaries during project creation
    // Dictionary will be created when needed in the Generate Audiobook step
    const dictionaryInfo = {
      dictionaryName: null,
      dictionaryFileName: null
    }

    // Update project with file paths and dictionary info
    const { error: updateError } = await supabaseAdmin
      .from('projects')
      .update({
        epub_file_path: epubPath,
        cover_file_path: coverPath,
        status: 'ready',
        pls_dict_name: dictionaryInfo?.dictionaryName || null,
        pls_dict_file: dictionaryInfo?.dictionaryFileName || null
      })
      .eq('id', project.id)

    if (updateError) throw updateError

    return project
  } catch (error) {
    console.error('Error in uploadFile:', error)
    throw new Error(getUserFriendlyError(error))
  }
}