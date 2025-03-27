"use client"

import { useRef, useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChevronLeft, ChevronRight, FileText, Play, Pause, Volume2, VolumeX } from "lucide-react"
import { toast } from 'sonner'
import { 
  getSignedImageUrls, 
  getProjectStatus, 
  deleteProjectFolder,
  renameImageToOldSet,
  restoreImageFromOldSet,
  swapStoryboardImage,
  uploadProjectFile,
  updateProjectStatus,
  deleteProjectFile,
  saveAudioToOldSet,
  restoreAudioFromOldSet,
  checkAudioTrackExists,
  getVoiceDataFile,
  getNerDataFile,
  saveJsonToR2,
  getJsonFromR2
} from '@/app/actions/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { AudioPlayer } from '@/components/AudioPlayer'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Input } from "@/components/ui/input"
import Image from 'next/image'
import { Textarea } from "@/components/ui/textarea"
import { sendCommand } from '@/app/actions/remote-commands'
import { 
  getMasterDictionaryName, 
  addToMasterDictionary, 
  createMasterPronunciationDictionary
} from '@/app/actions/pronunciation-dictionary'
import Hls from 'hls.js'
import { getHlsStreamUrl } from '@/lib/hls-helpers'

interface Project {
  id: string
  project_name: string
  book_title: string
  author_name: string
  description: string
  status: string
  epub_file_path: string
  cover_file_path: string
  voice_id?: string
  voice_name?: string
  pls_dict_name?: string
  pls_dict_file?: string
}

interface Voice {
  voice_id: string
  name: string
  labels?: {
    accent?: string
    description?: string
    age?: string
    gender?: string
    use_case?: string
    [key: string]: string | undefined
  }
  preview_url?: string
}

interface StoryboardItem {
  number: number
  image?: {
    url: string
    path: string
    savedVersions?: {
      url: string
      path: string
    }[]
    oldsetVersion?: {
      url: string
      path: string
    }
    loadError?: boolean // Add this property to track load errors
  }
  audio?: {
    url: string
    path: string
    savedVersion?: {
      url: string
      path: string
    }
  }
  text?: {
    content: string
    path: string
  }
  isProcessing?: boolean
}

interface ProjectStatus {
  Project: string;
  Book: string;
  notify: string;
  userid: string;
  projectid: string;
  Current_Status: string;
  Ebook_Prep_Status: string;
  Storyboard_Status: string;
  Proof_Status: string;
  Audiobook_Status: string;
}

// Add interfaces for NER data
interface EntityItem {
  name: string;
  IPA: string;
  HTP: boolean;
}

interface NerDataSummary {
  total_chapters: number;
  person_count: number;
  location_count: number;
  organization_count: number;
  person_entities_common: EntityItem[];
  person_entities_unusual: EntityItem[];
  location_entities_common: EntityItem[];
  location_entities_unusual: EntityItem[];
  organization_entities_common: EntityItem[];
  organization_entities_unusual: EntityItem[];
}

// Update the NerData interface to match the actual structure
interface NerData {
  book_summary: NerDataSummary;
  chapters: string[];
}

// Define the interface for the data returned by getNerDataFile
interface NerDataFromApi {
  entities?: Array<{
    name: string;
    HTP: boolean;
    phoneme?: string;
  }>;
  book_summary?: NerDataSummary;
  chapters?: string[];
}

// Helper functions for button states
function getInitialTab(status: ProjectStatus | null) {
  if (!status) return 'intake'

  const isIntakeComplete = status.Ebook_Prep_Status === "Ebook Processing Complete"
  const isStoryboardComplete = status.Storyboard_Status === "Storyboard Complete"
  const isProofsComplete = status.Proof_Status === "Proofs Complete"

  // New behavior: Land on the tab that has a complete status, in this order: Intake, Storyboard, Proofs
  // If all are complete, prioritize Audiobook
  if (isIntakeComplete && isStoryboardComplete && isProofsComplete) {
    return 'audiobook'  // Return the audiobook tab (previously publish)
  }
  
  // If only ebook and storyboard are complete, land on storyboard
  if (isIntakeComplete && isStoryboardComplete) {
    return 'storyboard'
  }
  
  // If only ebook is complete, land on intake
  if (isIntakeComplete) {
    return 'intake'
  }

  // If no tab is complete, default to intake
  return 'intake'
}

function getIntakeButtonState(status: string | undefined) {
  switch (status) {
    case "Ready to process ebook":
      return { enabled: true, label: "Process Ebook File" }
    case "Processing Ebook File, Please Wait":
      return { enabled: false, label: "Processing Ebook..." }
    case "Ebook Processing Complete":
      return { enabled: false, label: "Intake Complete" }
    default:
      return { enabled: false, label: "Process Ebook File" }
  }
}

function getStoryboardButtonState(status: string | undefined, hasVoiceSelected: boolean | null = null) {
  switch (status) {
    case "Ready to Process Storyboard":
      // Only check for voice selection if the button would be enabled
      if (hasVoiceSelected === false) {
        return { enabled: false, label: "Voice Not Chosen" }
      }
      return { enabled: true, label: "Generate Storyboard" }
    case "Processing Storyboard, Please Wait":
      return { enabled: false, label: "Processing Storyboard..." }
    case "Waiting for Ebook Processing Completion":
      return { enabled: false, label: "Generate Audiobook" }
    case "Storyboard Complete":
      return { enabled: false, label: "Storyboard Complete" }
    default:
      return { enabled: false, label: "Generate Storyboard" }
  }
}

function getAudiobookButtonState(status: string | undefined) {
  switch (status) {
    case "Ready to Process Audiobook":
      return { enabled: true, label: "Generate Proofs" }
    case "Ready to Process Proofs":
      return { enabled: true, label: "Generate Proofs" }
    case "Waiting for Storyboard Completion":
      return { enabled: false, label: "Generate Proofs" }
    case "Audiobook Processing, Please Wait":
      return { enabled: false, label: "Processing Proofs..." }
    case "Proofs Complete":
      return { enabled: false, label: "Proofs Complete" }
    default:
      return { enabled: false, label: "Generate Proofs" }
  }
}

// Define a type for video files
interface VideoFile {
  url: string
  path: string
}

// Define interface for pronunciation corrections
interface PronunciationCorrection {
  originalName: string;
  correctedPronunciation: string;
  ipaPronunciation: string;
}

// Add this helper function for diagnosing image loading issues
const diagnoseImageLoadingError = (error: Error | unknown, imageUrl: string, itemNumber: number) => {
  console.error(`Error loading image for item ${itemNumber}:`, error);
  
  // Check if it's a timeout error
  const isTimeout = error instanceof Error && 
    (error.name === 'TimeoutError' || 
     error.message?.includes('timeout') ||
     error.message?.includes('timed out'));
  
  if (isTimeout) {
    console.warn(`Image timeout for item ${itemNumber}. Possible large file or network issues.`);
    return 'Image load timed out';
  }
  
  // Check for general network errors
  const isNetworkError = !navigator.onLine || 
    (error instanceof Error && error.message?.includes('network'));
  
  if (isNetworkError) {
    console.warn(`Network error loading image for item ${itemNumber}.`);
    return 'Network error';
  }
  
  // Check for CORS issues
  const isCors = error instanceof Error && error.message?.includes('CORS');
  if (isCors) {
    console.warn(`CORS error loading image for item ${itemNumber}.`);
    return 'CORS error';
  }
  
  // If no specific diagnosis, return general error
  return 'Failed to load image';
};

export default function ProjectDetail() {
  const params = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<StoryboardItem[]>([])
  // Add state for tracking the current mode
  const [mode, setMode] = useState<"validation" | "production">("validation")
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [confirmProjectName, setConfirmProjectName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const [primaryTrack, setPrimaryTrack] = useState<number>(1)
  const [hasTrack2, setHasTrack2] = useState<Set<number>>(new Set())
  const forcedTrack2ItemsRef = useRef<Set<number>>(new Set())
  const [swappingImages, setSwappingImages] = useState<Set<string>>(new Set())
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editFormData, setEditFormData] = useState<Partial<Project>>({})
  const [selectedNewCover, setSelectedNewCover] = useState<File | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null)
  const [videos, setVideos] = useState<VideoFile[]>([])
  const [processingNewImageSet, setProcessingNewImageSet] = useState<Set<number>>(new Set())
  const [processingItems, setProcessingItems] = useState<Set<number>>(new Set())
  const [isReplaceImagesInProgress, setIsReplaceImagesInProgress] = useState(false)
  const [confirmReplaceItem, setConfirmReplaceItem] = useState<StoryboardItem | null>(null)
  const [processingNewAudio, setProcessingNewAudio] = useState<Set<number>>(new Set())
  // Add a state to track audio remount keys
  const [audioRemountKeys, setAudioRemountKeys] = useState<Record<number, number>>({});
  
  // Add voice-related state
  const [voices, setVoices] = useState<Voice[]>([])
  const [selectedVoice, setSelectedVoice] = useState<string>("")
  const [isPlayingPreview, setIsPlayingPreview] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Add state for name audio playback
  const [isPlayingNameAudio, setIsPlayingNameAudio] = useState(false)
  const nameAudioRef = useRef<HTMLAudioElement>(null)

  // Add NER data state
  const [nerData, setNerData] = useState<NerData | null>(null)
  const [selectedNameEntity, setSelectedNameEntity] = useState<string>("")

  // Add error state for voice data
  const [voiceDataError, setVoiceDataError] = useState<string | null>(null)

  // Add state for voice selection confirmation dialog
  const [isVoiceConfirmOpen, setIsVoiceConfirmOpen] = useState(false)
  const [isUpdatingVoice, setIsUpdatingVoice] = useState(false)

  // Add state to track if voice is selected
  const [isVoiceSelected, setIsVoiceSelected] = useState<boolean | null>(null)

  // Add state for GPT IPA pronunciation
  const [gptIpaPronunciation, setGptIpaPronunciation] = useState<string | null>(null)
  const [isLoadingIpa, setIsLoadingIpa] = useState(false)
  const [isConfirmedForAudiobook, setIsConfirmedForAudiobook] = useState(false)
  const [isUseIpaButtonDisabled, setIsUseIpaButtonDisabled] = useState(true)

  // Add state for new name pronunciation
  const [newNameIpaPronunciation, setNewNameIpaPronunciation] = useState<string | null>(null)
  const [isLoadingNewNameIpa, setIsLoadingNewNameIpa] = useState(false)
  const [isNewNameConfirmedForAudiobook, setIsNewNameConfirmedForAudiobook] = useState(false)
  const [isNewNameUseIpaButtonDisabled, setIsNewNameUseIpaButtonDisabled] = useState(true)
  // Add state for pronunciation corrections
  const [pronunciationCorrections, setPronunciationCorrections] = useState<PronunciationCorrection[]>([])
  const [isViewCorrectionsOpen, setIsViewCorrectionsOpen] = useState(false)
  // Add state for storyboard confirmation dialog
  const [isStoryboardConfirmOpen, setIsStoryboardConfirmOpen] = useState(false)
  
  const [masterDictionaryName, setMasterDictionaryName] = useState<string>('audibloom_master_dictionary')
  
  // Add state for tracking if we should update the dictionary
  const [shouldUpdateDictionary, setShouldUpdateDictionary] = useState<boolean>(false);
  
  // Add a state to store the HLS path
  const [hlsPath, setHlsPath] = useState<string | null>(null);
  
  // Add a state to track HLS loading errors
  const [hlsLoadError, setHlsLoadError] = useState<string | null>(null);
  
  // Add a state to track when HLS URL is being prepared
  const [isPreparingHls, setIsPreparingHls] = useState<boolean>(false);

  // Add a state to track HLS video playing status
  const [isHlsPlaying, setIsHlsPlaying] = useState(false);
  const [isHlsMuted, setIsHlsMuted] = useState(false);
  const [hlsProgress, setHlsProgress] = useState(0);

  // Log mode changes
  useEffect(() => {
    console.log(`Mode changed to: ${mode}`)
  }, [mode])

  // Update fetchHlsPath to use our proxy endpoint for HLS streaming
  const fetchHlsPath = useCallback(async () => {
    if (!project) return
    
    // If we already have an HLS path and it's working, don't fetch again
    if (hlsPath && !hlsLoadError) {
      return
    }
    
    try {
      // Set loading state
      setIsPreparingHls(true);
      setHlsLoadError(null);
      
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      
      // Determine HLS path based on mode
      // In validation mode: <userid>/<projectid>/streaming
      // In production mode: streaming_assets/<userid>/<projectid>
      let hlsBasePath = "";
      if (mode === "validation") {
        hlsBasePath = `${session.user.id}/${project.id}/streaming`;
      } else {
        hlsBasePath = `streaming_assets/${session.user.id}/${project.id}`;
      }
      
      console.log(`Looking for HLS in path: ${hlsBasePath}`)
      
      // Query published_audiobooks table to get hls_path
      console.log(`Querying published_audiobooks for userid=${session.user.id} and projectid=${project.id}`)
      
      // Use maybeSingle() instead of single() to prevent 406 errors when no rows match
      const { data, error } = await supabase
        .from('published_audiobooks')
        .select('hls_path')
        .eq('userid', session.user.id)
        .eq('projectid', project.id)
        .maybeSingle()
      
      if (error) {
        console.error('Error fetching HLS path:', error)
        setHlsLoadError(`Could not retrieve streaming information: ${error.message}`)
        setIsPreparingHls(false);
        return
      }
      
      console.log('Query result:', data)
      
      if (data?.hls_path) {
        console.log('HLS path retrieved from database:', data.hls_path)
        
        // Check if the path matches our expected path for the current mode
        // If not, we may need to update our path based on the current mode
        const storedPath = data.hls_path;
        const adjustedPath = storedPath.includes(hlsBasePath) ? 
                            storedPath : 
                            `${hlsBasePath}/${storedPath.split('/').pop()}`;
        
        console.log(`Using HLS path: ${adjustedPath}`);
        
        // Reset error state
        setHlsLoadError(null)
        
        try {
          // Use our new helper to get a playable HLS URL with signed URLs
          console.log('Generating signed URLs for HLS path')
          
          // Clear any existing URL first
          setHlsPath(null);
          
          // Generate the new stream URL
          const streamUrl = await getHlsStreamUrl(adjustedPath)
          console.log('HLS stream URL generated successfully')
          
          // Only set the URL after it's fully prepared
          setHlsPath(streamUrl)
        } catch (signedUrlError) {
          console.error('Failed to generate signed URLs:', signedUrlError)
          setHlsLoadError('Failed to generate streaming URL')
        }
      } else {
        setHlsLoadError('No streaming file found')
        console.log('No HLS path found in database, but Audiobook_Status is Complete')
      }
    } catch (error) {
      console.error('Error in fetchHlsPath:', error)
      setHlsLoadError('Failed to load streaming data')
    } finally {
      setIsPreparingHls(false);
    }
  }, [project, hlsPath, hlsLoadError, mode])

  // Update handleProcessEpub to use the mode
  const handleProcessEpub = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      if (!project) throw new Error('Project not found')

      // Extract filename from epub_file_path
      const epubFilename = project.epub_file_path.split('/').pop()
      if (!epubFilename) throw new Error('EPUB filename not found')

      await updateProjectStatus({
        userId: session.user.id,
        projectId: project.id,
        status: {
          Project: project.project_name,
          Book: project.book_title,
          notify: session.user.email || '',
          userid: session.user.id,
          projectid: project.id,
          Current_Status: "Ebook is Processing",
          Ebook_Prep_Status: "Processing Ebook File, Please Wait",
          Storyboard_Status: "Waiting for Ebook Processing Completion",
          Proof_Status: "Waiting for Storyboard Completion",
          Audiobook_Status: "Not Started"
        }
      })

      // Force immediate status refresh
      await fetchProject()

      // Use the author_name and book_title from the project
      const authorName = project.author_name || "Mike Langlois"; // Default if not set
      const bookTitle = project.book_title || "Walker"; // Use project book_title or default

      // Get the selected voice name instead of ID
      const selectedVoiceData = voices.find(voice => voice.voice_id === selectedVoice);
      const voiceName = selectedVoiceData?.name || "Abe"; // Default to "Abe" if no voice selected or found

      // Set mode-specific parameters
      const modeParam = mode === "validation" ? "validation" : "production"
      
      // In validation mode, use -l 5, in production mode, omit -l parameter entirely
      const limitParam = mode === "validation" ? " -l 2" : "-l 5"
      
      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "${authorName}" -ti "${bookTitle}" -vn "${voiceName}"${limitParam} -si -m ${modeParam}`
      await sendCommand(command)
      toast.success('Processing started')
    } catch (error) {
      console.error('Error processing epub:', error)
      toast.error('Failed to start processing')
    }
  }

  // Add function to play voice preview
  const playVoicePreview = () => {
    if (!audioRef.current) return
    
    const selectedVoiceData = voices.find(voice => voice.voice_id === selectedVoice)
    if (!selectedVoiceData?.preview_url) return
    
    audioRef.current.src = selectedVoiceData.preview_url
    audioRef.current.play()
    setIsPlayingPreview(true)
    
    audioRef.current.onended = () => {
      setIsPlayingPreview(false)
    }
  }

  // Add function to play name audio using ElevenLabs API
  const playNameAudio = async (name: string) => {
    if (!nameAudioRef.current || isPlayingNameAudio) return
    
    try {
      setIsPlayingNameAudio(true)
      
      // Always use the currently selected voice from the dropdown
      const voiceId = selectedVoice
      
      if (!voiceId) {
        toast.error('Please select a voice first')
        setIsPlayingNameAudio(false)
        return
      }
      
      // Call the ElevenLabs API
      const response = await fetch('/api/elevenlabs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: name,
          voiceId: voiceId,
        }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to generate speech')
      }
      
      const data = await response.json()
      
      // Play the audio
      nameAudioRef.current.src = `data:audio/mpeg;base64,${data.audio}`
      nameAudioRef.current.play()
      
      nameAudioRef.current.onended = () => {
        setIsPlayingNameAudio(false)
      }
    } catch (error) {
      console.error('Error playing name audio:', error)
      toast.error('Failed to play name audio')
      setIsPlayingNameAudio(false)
    }
  }

  const handleGenerateStoryboard = async () => {
    // Check if voice is selected
    if (!project?.voice_id) {
      toast.error('Please select a voice first')
      return
    }
    
    // Set flag to update dictionary when generating storyboard
    // This ensures dictionary updates happen only when explicitly requested
    setShouldUpdateDictionary(true)
    
    // Show the confirmation dialog
    setIsStoryboardConfirmOpen(true)
  }
  
  // Create a helper function for mapping pronunciation corrections to the format needed by the API
  const mapPronunciationCorrections = (corrections: PronunciationCorrection[]): Array<{
    originalName: string;
    ipaPronunciation: string;
  }> => {
    return corrections.map(correction => ({
      originalName: correction.originalName,
      ipaPronunciation: correction.ipaPronunciation
    }))
  }
  
  // Update processStoryboardGeneration to use the mode
  const processStoryboardGeneration = async () => {
    try {
      // Close the confirmation dialog immediately
      setIsStoryboardConfirmOpen(false)
      
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      if (!project) throw new Error('Project not found')
      if (!project.voice_id) throw new Error('Voice not selected')
      
      // Set flag to update dictionary when generating storyboard
      setShouldUpdateDictionary(true)
      
      // Extract filename from epub_file_path
      const epubFilename = project.epub_file_path.split('/').pop()
      if (!epubFilename) throw new Error('EPUB filename not found')

      await updateProjectStatus({
        userId: session.user.id,
        projectId: project.id,
        status: {
          Project: project.project_name,
          Book: project.book_title,
          notify: session.user.email || '',
          userid: session.user.id,
          projectid: project.id,
          Current_Status: "Storyboard is Processing",
          Ebook_Prep_Status: "Ebook Processing Complete",
          Storyboard_Status: "Processing Storyboard, Please Wait",
          Proof_Status: "Waiting for Storyboard Completion",
          Audiobook_Status: "Not Started"
        }
      })

      await fetchProject()

      // Use the author_name and book_title from the project
      const authorName = project.author_name || "Mike Langlois";
      const bookTitle = project.book_title || "Walker";
      
      // Use the voice name from the project
      const voiceName = project.voice_name || "Abe";
      
      // Set the dictionary parameter to use the master dictionary
      let dictionaryParam = ""
      
      // If there are pronunciation corrections, create/update the master dictionary first
      if (pronunciationCorrections.length > 0) {
        try {
          // First, create/update the master pronunciation dictionary in ElevenLabs
          const mappedCorrections = mapPronunciationCorrections(pronunciationCorrections)
          const result = await createMasterPronunciationDictionary(
            session.user.id,
            project.id,
            project.project_name,
            project.book_title,
            mappedCorrections
          )
          
          if (result.created) {
            console.log('Master pronunciation dictionary created/updated successfully')
            
            // Update the project with the dictionary name (for reference)
            const { error: updateError } = await supabase
              .from('projects')
              .update({
                pls_dict_name: masterDictionaryName,
                pls_dict_file: `${masterDictionaryName}.pls`
              })
              .eq('id', project.id)
            
            if (updateError) {
              console.error('Error updating project with dictionary info:', updateError)
            }
            
            // Then, add the corrections to the Supabase master dictionary table
            const addResult = await addToMasterDictionary({
              userId: session.user.id,
              projectId: project.id,
              projectName: project.project_name,
              bookName: project.book_title,
              pronunciationCorrections: mappedCorrections
            })
            
            if (!addResult.success) {
              console.error('Error adding to master dictionary table:', addResult.error)
              toast.error('Failed to add pronunciation corrections to master dictionary')
            }
            
            // Set the dictionary parameter for the command
            dictionaryParam = ` -pd "${masterDictionaryName}"`
          } else {
            console.error('Error creating master pronunciation dictionary:', result.reason)
            toast.error('Failed to create master pronunciation dictionary')
          }
        } catch (error) {
          console.error('Error creating pronunciation dictionary:', error)
          toast.error('Failed to create pronunciation dictionary')
        }
      } else if (project.pls_dict_name) {
        // If no new corrections but project has a dictionary name, use the master dictionary
        dictionaryParam = ` -pd "${masterDictionaryName}"`
      }
      
      // Set mode-specific parameters
      const modeParam = mode === "validation" ? "validation" : "production"
      
      // In validation mode, use -l 2, in production mode, omit -l parameter entirely
      const limitParam = mode === "validation" ? " -l 2" : "-l 5"
      
      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "${authorName}" -ti "${bookTitle}" -vn "${voiceName}"${dictionaryParam}${limitParam} -ss -m ${modeParam}`
      await sendCommand(command)
      
      toast.success('Storyboard generation started. This may take a few minutes.')
    } catch (error) {
      console.error('Error generating storyboard:', error)
      toast.error('Failed to generate storyboard')
    }
  }

  // Update handleGenerateAudiobook to use the mode
  const handleGenerateAudiobook = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      if (!project) throw new Error('Project not found')

      // Extract filename from epub_file_path
      const epubFilename = project.epub_file_path.split('/').pop()
      if (!epubFilename) throw new Error('EPUB filename not found')

      await updateProjectStatus({
        userId: session.user.id,
        projectId: project.id,
        status: {
          Project: project.project_name,
          Book: project.book_title,
          notify: session.user.email || '',
          userid: session.user.id,
          projectid: project.id,
          Current_Status: "Audiobook is Processing",
          Ebook_Prep_Status: "Ebook Processing Complete",
          Storyboard_Status: "Storyboard Complete",
          Proof_Status: "Audiobook Processing, Please Wait",
          Audiobook_Status: "Not Started"
        }
      })

      await fetchProject()

      // Use the author_name and book_title from the project
      const authorName = project.author_name || "Mike Langlois"; // Default if not set
      const bookTitle = project.book_title || "Walker"; // Use project book_title or default
      
      // Use the voice name from the project instead of hardcoded "Abe"
      const voiceName = project.voice_name || "Abe";

      // Use the master pronunciation dictionary
      let dictionaryParam = ""
      if (project.pls_dict_name) {
        dictionaryParam = ` -pd "${masterDictionaryName}"`
      }

      // Log the dictionary parameter for debugging
      console.log(`Sending audiobook command with dictionary parameter: ${dictionaryParam || 'none'}`)

      // Set mode-specific parameters
      const modeParam = mode === "validation" ? "validation" : "production"
      
      // In validation mode, use -l 2, in production mode, omit -l parameter entirely
      const limitParam = mode === "validation" ? " -l 2" : "-l 5"
      
      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "${authorName}" -ti "${bookTitle}" -vn "${voiceName}"${dictionaryParam}${limitParam} -sb -m ${modeParam}`
      await sendCommand(command)
      toast.success('Generation started')
    } catch (error) {
      console.error('Error generating audiobook:', error)
      toast.error('Failed to start generation')
    }
  }

  const fetchProject = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      const { data: project, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', params.id)
        .single()

      if (error) throw error
      if (!project) throw new Error('Project not found')

      setProject(project)

      // Get initial project status
      const status = await getProjectStatus({
        userId: session.user.id,
        projectId: project.id
      })

      if (status) {
        setProjectStatus(status)
      }

      // Load voice data if it exists
      try {
        const voiceData = await getVoiceDataFile({
          userId: session.user.id,
          projectId: project.id
        })
        
        console.log('Voice data loaded directly from R2:', voiceData)
        
        if (voiceData?.voices && Array.isArray(voiceData.voices) && voiceData.voices.length > 0) {
          console.log('Setting voices array:', voiceData.voices.length)
          setVoices(voiceData.voices)
          // Set default selected voice if available
          if (project.voice_id && voiceData.voices.some(v => v.voice_id === project.voice_id)) {
            // If project has a saved voice_id and it exists in the available voices, use it
            setSelectedVoice(project.voice_id)
          } else {
            // Otherwise use the first voice
            setSelectedVoice(voiceData.voices[0].voice_id)
          }
          setVoiceDataError(null)
        } else {
          console.log('No voice data found or invalid format')
          // Don't set default voices anymore, just leave the dropdown empty
          setVoices([])
          setSelectedVoice("")
          setVoiceDataError('No voices available. Please process the ebook first.')
        }
      } catch (error) {
        console.error('Error loading voice data:', error)
        setVoiceDataError('Error loading voice data')
      }
      
      // Load NER data if it exists
      try {
        const nerData = await getNerDataFile({
          userId: session.user.id,
          projectId: project.id
        })
        
        console.log('NER data loaded from R2:', nerData)
        
        if (nerData) {
          console.log('NER data:', nerData)
          // Cast to the correct type and check if it has the expected structure
          const typedNerData = nerData as unknown as NerDataFromApi;
          if (typedNerData.book_summary) {
            setNerData({
              book_summary: typedNerData.book_summary,
              chapters: typedNerData.chapters || []
            });
          } else if (typedNerData.entities) {
            // Handle legacy format
            console.log('Legacy NER data format detected')
          } else {
            console.log('NER data has unexpected format:', nerData)
          }
        } else {
          console.log('No NER data found')
          setNerData(null)
        }
      } catch (error) {
        console.error('Error loading NER data:', error)
      }

      // Step 1: Get signed URLs for all files with retry logic
      let signedFiles: Array<{
        type: string;
        path: string;
        url: string;
        content?: string;
      }> = [];
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          signedFiles = await getSignedImageUrls(session.user.id, project.id);
          break; // If successful, exit the loop
        } catch (fetchError) {
          attempts++;
          if (fetchError instanceof Error && fetchError.name === 'TimeoutError') {
            console.warn(`Attempt ${attempts}/${maxAttempts}: Timeout when fetching signed URLs. Retrying...`);
            // Short delay before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // If it's not a timeout error, rethrow
            throw fetchError;
          }
        }
      }
      
      if (attempts === maxAttempts) {
        console.error('Maximum retry attempts reached when fetching signed URLs');
        toast.error('Some images could not be loaded. Try refreshing the page.');
      }
      
      // Filter signed files based on file type and path
      const storyboardFiles = signedFiles.filter(file => {
        const isMatch = file.type === 'image' &&
          file.path.includes('/temp/') &&
          (file.path.match(/.*?chapter\d+_\d+_image\d+(?:_sbsave\d+)?\.jpg$/) ||
           file.path.match(/.*?chapter\d+_\d+_image\d+\.jpgoldset$/))
        
        // Remove debug logs for individual matched files
        return isMatch
      })

      const audioFiles = signedFiles.filter(file => {
        const isMatch = file.type === 'audio' &&
          file.path.includes('/temp/') &&
          file.path.match(/.*?chapter\d+_\d+_audio\d+(?:_sbsave)?\.mp3$/)
        return isMatch
      })

      const textFiles = signedFiles.filter(file => {
        const isMatch = file.type === 'text' &&
          file.path.includes('/temp/') &&
          file.path.match(/.*?chapter\d+_\d+_chunk\d+\.txt$/)
        return isMatch
      })

      // Simplified file logging - just log the counts
      console.log('Project files refreshed successfully')

      const videoFiles = signedFiles.filter(file => 
        file.path.startsWith(`${session.user.id}/${project.id}/output/`) && file.type === 'video'
      )

      setVideos(videoFiles.map(file => ({ url: file.url, path: file.path })))

      // Handle cover file
      const coverFile = signedFiles.find(file => file.path === project.cover_file_path)
      if (coverFile) {
        setCoverUrl(coverFile.url)
      }

      // Extract all unique item numbers from files
      const itemNumbers = new Set<number>()
      storyboardFiles.forEach(file => {
        const match = file.path.match(/chapter\d+_\d+_image(\d+)/)
        if (match) {
          itemNumbers.add(parseInt(match[1]))
        }
      })
      textFiles.forEach(file => {
        const match = file.path.match(/chapter\d+_\d+_chunk(\d+)/)
        if (match) {
          itemNumbers.add(parseInt(match[1]))
        }
      })
      audioFiles.forEach(file => {
        const match = file.path.match(/chapter\d+_\d+_audio(\d+)/)
        if (match) {
          itemNumbers.add(parseInt(match[1]))
        }
      })

      // Create items array with all numbers, even if they don't have images
      const groupedItems = Array.from(itemNumbers).sort((a, b) => a - b).map(number => {
        const item: StoryboardItem = { number }

        // Find image files for this number
        const imageFiles = storyboardFiles.filter(file => 
          file.path.match(new RegExp(`chapter\\d+_\\d+_image${number}(?:_sbsave\\d+)?\\.jpg$`)) ||
          file.path.match(new RegExp(`chapter\\d+_\\d+_image${number}\\.jpgoldset$`))
        )

        if (imageFiles.length > 0) {
          const mainImage = imageFiles.find(f => !f.path.includes('_sbsave') && !f.path.endsWith('.jpgoldset'))
          const savedVersions = imageFiles.filter(f => f.path.includes('_sbsave'))
          const oldsetVersion = imageFiles.find(f => f.path.endsWith('.jpgoldset'))

          if (mainImage) {
            item.image = {
              url: mainImage.url,
              path: mainImage.path,
              savedVersions: savedVersions.map(v => ({ url: v.url, path: v.path })),
              oldsetVersion: oldsetVersion ? { url: oldsetVersion.url, path: oldsetVersion.path } : undefined
            }
          }
        }

        // Find text file for this number
        const textFile = textFiles.find(file => 
          file.path.match(new RegExp(`chapter\\d+_\\d+_chunk${number}\\.txt$`))
        )
        if (textFile?.content) {
          item.text = {
            content: textFile.content,
            path: textFile.path
          }
        }

        // Find audio files for this number
        const audioFile = audioFiles.find(file => 
          file.path.match(new RegExp(`chapter\\d+_\\d+_audio${number}(?:_sbsave)?\\.mp3$`))
        )
        if (audioFile) {
          const savedAudioFile = audioFiles.find(file => 
            file.path.match(new RegExp(`chapter\\d+_\\d+_audio${number}_sbsave\\.mp3$`))
          )
          item.audio = {
            url: audioFile.url,
            path: audioFile.path,
            savedVersion: savedAudioFile ? { url: savedAudioFile.url, path: savedAudioFile.path } : undefined
          }
        }

        return item
      })

      setItems(groupedItems)
    } catch (error) {
      console.error('Error fetching project:', error)
      toast.error(getUserFriendlyError(error))
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  // Update polling to start after initial fetch with proper cleanup
  useEffect(() => {
    if (!project) return

    let isPolling = true // Add flag to prevent race conditions
    let pollingInterval: NodeJS.Timeout | null = null

    // Start polling every 5 seconds
    pollingInterval = setInterval(async () => {
      if (!isPolling) return

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return

        const status = await getProjectStatus({
          userId: session.user.id,
          projectId: project.id
        })
        
        if (status && isPolling) {
          const wasProcessing = projectStatus?.Storyboard_Status === "Processing Storyboard, Please Wait"
          const isComplete = status.Storyboard_Status === "Storyboard Complete"
          
          setProjectStatus(status)
          
          // Only refresh if we were processing and now we're complete
          if (wasProcessing && isComplete) {
            setProcessingNewImageSet(new Set())
            await fetchProject()
          }
        }
      } catch (error) {
        console.error('Error polling status:', error)
      }
    }, 5000)

    // Cleanup on unmount or when project changes
    return () => {
      isPolling = false
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [project, projectStatus?.Storyboard_Status, fetchProject])

  // Add a useEffect to monitor project status changes
  useEffect(() => {
    if (projectStatus) {
      console.log('Project Status Updated:', projectStatus.Current_Status)
      
      // Check if audiobook is complete and fetch HLS path
      if (projectStatus.Audiobook_Status === "Audiobook Complete" && !hlsPath) {
        fetchHlsPath()
      }
    }
  }, [projectStatus, hlsPath, project, fetchHlsPath])
  
  // Helper function to handle voice and NER data loading
  const loadVoiceAndNerData = useCallback(async (userId: string, projectId: string) => {
    try {
      setVoiceDataError(null)
      
      // Load voice data
      const voiceData = await getVoiceDataFile({
        userId,
        projectId
      })
      
      if (voiceData?.voices && Array.isArray(voiceData.voices) && voiceData.voices.length > 0) {
        setVoices(voiceData.voices)
        // Set default selected voice if available
        if (project?.voice_id && voiceData.voices.some(v => v.voice_id === project.voice_id)) {
          // If project has a saved voice_id and it exists in the available voices, use it
          setSelectedVoice(project.voice_id)
        } else {
          // Otherwise use the first voice
          setSelectedVoice(voiceData.voices[0].voice_id)
        }
        setVoiceDataError(null)
      } else {
        console.log('No voice data found or invalid format')
        setVoices([])
        setSelectedVoice("")
        setVoiceDataError('No voices available. Please process the ebook first.')
      }
      
      // Load NER data
      try {
        const nerData = await getNerDataFile({
          userId,
          projectId
        })
        
        if (nerData) {
          // Cast to the correct type and check if it has the expected structure
          const typedNerData = nerData as unknown as NerDataFromApi;
          if (typedNerData.book_summary) {
            setNerData({
              book_summary: typedNerData.book_summary,
              chapters: typedNerData.chapters || []
            });
          } else if (typedNerData.entities) {
            console.log('Legacy NER data format detected')
          } else {
            console.log('NER data has unexpected format')
          }
        } else {
          setNerData(null)
        }
      } catch (nerError) {
        console.error('Error loading NER data:', nerError)
      }
      
      // Load pronunciation corrections
      try {
        const corrections = await getJsonFromR2<PronunciationCorrection[]>({
          userId,
          projectId,
          filename: 'pronunciation-corrections.json'
        })
        
        if (corrections) {
          setPronunciationCorrections(corrections)
        }
      } catch (correctionsError) {
        console.error('Error loading pronunciation corrections:', correctionsError)
      }
      
    } catch (error) {
      console.error('Error loading voice and NER data:', error)
      setVoiceDataError('Failed to load voice data. Please try again later.')
    }
  }, [project?.voice_id]);

  // Add a useEffect to reset the replace images flag when storyboard is complete
  useEffect(() => {
    if (projectStatus?.Storyboard_Status === "Storyboard Complete") {
      setIsReplaceImagesInProgress(false)
    }
  }, [projectStatus?.Storyboard_Status])

  // Check for the cookie on component mount
  useEffect(() => {
    // Check if the cookie exists but don't assign to a variable
    // This will avoid the ESLint unused variable warning
    document.cookie
      .split('; ')
      .find(row => row.startsWith('skipReplaceConfirmation='));
  }, []);

  // Replace the useEffect that checks for voice data after intake
  useEffect(() => {
    if (projectStatus?.Ebook_Prep_Status === 'Complete' && project) {
      const loadData = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          await loadVoiceAndNerData(session.user.id, project.id)
        } catch (error) {
          console.error('Error checking for voice and NER data:', error)
        }
      }
      
      loadData()
    }
  }, [projectStatus?.Ebook_Prep_Status, project, loadVoiceAndNerData])

  // Refactor the useEffect for voice data refresh after ebook completion
  useEffect(() => {
    if (projectStatus?.Ebook_Prep_Status === "Ebook Processing Complete" && project) {
      const refreshData = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          await loadVoiceAndNerData(session.user.id, project.id)
          
          // Optional retry if no voices are found
          if (voices.length === 0) {
            setTimeout(() => loadVoiceAndNerData(session.user.id, project.id), 5000)
          }
        } catch (error) {
          console.error('Error refreshing data:', error)
        }
      }
      
      refreshData()
    }
  }, [projectStatus?.Ebook_Prep_Status, project, loadVoiceAndNerData, voices.length])

  const handleScrollSliderChange = (value: number[]) => {
    setSliderValue(value[0])
    if (scrollContainerRef.current) {
      const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollLeft = (maxScroll * value[0]) / 100
    }
  }

  const handleDeleteProject = async () => {
    if (!project || confirmProjectName !== project.project_name) return
    
    setIsDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // First, get all pronunciation rules for this project to update the master dictionary
      const response = await fetch(`/api/master-dictionary?userId=${session.user.id}&projectId=${project.id}`, {
        method: 'DELETE'
      })
      
      if (!response.ok) {
        console.error('Error removing entries from master dictionary table')
        // Continue with deletion even if this fails
      } else {
        console.log('Successfully removed pronunciation rules for project from master dictionary')
      }

      // Delete entire project folder
      await deleteProjectFolder(session.user.id, project.id)

      // Delete project from database
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (error) throw error

      toast.success('Project deleted successfully')
      router.push('/projects')
    } catch (error) {
      console.error('Error deleting project:', error)
      toast.error(getUserFriendlyError(error))
      setIsDeleting(false)
    }
  }

  // Add a function to check for track 2 existence
  const checkForTrack2 = useCallback(async () => {
    if (!items.length) return;
    
    const newHasTrack2 = new Set<number>();
    
    // First add all items from the forcedTrack2ItemsRef
    forcedTrack2ItemsRef.current.forEach(itemNumber => {
      newHasTrack2.add(itemNumber);
    });
    
    // Then check for actual track files
    for (const item of items) {
      if (item.audio?.path) {
        // Check if track 2 exists
        const track2Exists = await checkAudioTrackExists({
          audioPath: item.audio.path,
          trackNumber: 2
        });
        
        // Check if track 1 exists
        const track1Exists = await checkAudioTrackExists({
          audioPath: item.audio.path,
          trackNumber: 1
        });
        
        // If either track exists, we should show both Track 1 and Track 2 buttons
        if (track2Exists || track1Exists) {
          newHasTrack2.add(item.number);
        }
      }
    }
    
    setHasTrack2(newHasTrack2);
  }, [items]);

  // Check for track 2 when items change
  useEffect(() => {
    checkForTrack2();
  }, [items, checkForTrack2]);

  // Modify the handleNewAudio function with better cleanup pattern
  const handleNewAudio = async (item: StoryboardItem) => {
    if (!item.audio?.path || processingNewAudio.has(item.number)) return;
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');
      if (!project) throw new Error('No project');
      
      // Store the item number to preserve track2 status
      const itemNumber = item.number;
      
      setProcessingNewAudio(prev => new Set(prev).add(itemNumber));
      
      // Save the current audio (Track 1) to oldset1
      await saveAudioToOldSet({
        audioPath: item.audio.path,
        trackNumber: 1
      });
      
      // Update hasTrack2 state to show Track 2 button immediately
      setHasTrack2(prev => {
        const newSet = new Set(prev);
        newSet.add(itemNumber);
        return newSet;
      });
      
      // Trigger storyboard generation to create new audio
      await handleGenerateStoryboard();
      
      // Add a delay before starting to check for completion
      let checkInterval: NodeJS.Timeout | null = null;
      let cleanupTimeout: NodeJS.Timeout | null = null;
      let initialDelayTimeout: NodeJS.Timeout | null = null;
      
      // Initial delay before starting to check
      initialDelayTimeout = setTimeout(() => {
        checkInterval = setInterval(async () => {
          try {
            const status = await getProjectStatus({
              userId: session.user.id,
              projectId: project.id
            });
            
            if (status?.Storyboard_Status === "Storyboard Complete") {
              if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
              if (checkInterval) clearInterval(checkInterval);
              if (cleanupTimeout) clearTimeout(cleanupTimeout);
              
              setProcessingNewAudio(prev => {
                const next = new Set(prev);
                next.delete(itemNumber);
                return next;
              });
              
              // Set track 2 as primary since the new audio is now the original file
              setPrimaryTrack(2);
              
              // Fetch the updated project data
              await fetchProject();
              
              // Force remount of the audio player by updating its key
              setAudioRemountKeys(prev => ({
                ...prev,
                [itemNumber]: Date.now()
              }));
              
              // Force update hasTrack2 after fetchProject
              setHasTrack2(prev => {
                const newSet = new Set(prev);
                newSet.add(itemNumber);
                return newSet;
              });
            }
          } catch (error) {
            console.error('Error checking storyboard status:', error);
            if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
            if (checkInterval) clearInterval(checkInterval);
          }
        }, 5000); // Check every 5 seconds
        
        // Cleanup interval after 10 minutes to prevent infinite checking
        cleanupTimeout = setTimeout(() => {
          if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
          if (checkInterval) clearInterval(checkInterval);
          setProcessingNewAudio(prev => {
            const next = new Set(prev);
            next.delete(itemNumber);
            return next;
          });
        }, 600000);
      }, 6000); // Initial 6 second delay
      
    } catch (error) {
      console.error('Error generating new audio:', error);
      toast.error(getUserFriendlyError(error));
      setProcessingNewAudio(prev => {
        const next = new Set(prev);
        next.delete(item.number);
        return next;
      });
    }
  };

  // Modify the handleTrackSelection function
  const handleTrackSelection = async (track: 1 | 2, item: StoryboardItem) => {
    if (!item.audio?.path || processingNewAudio.has(item.number)) return;
    
    // If this track is already primary, do nothing
    if (primaryTrack === track) return;
    
    try {
      // First check if the track exists
      const trackExists = await checkAudioTrackExists({
        audioPath: item.audio.path,
        trackNumber: track
      });
      
      if (!trackExists) {
        toast.error(`Track ${track} does not exist for this audio`);
        return;
      }
      
      setProcessingNewAudio(prev => new Set(prev).add(item.number));
      
      // Save the current audio (original) to the appropriate oldset
      // If Track 1 is active and we're switching to Track 2, save to oldset1
      // If Track 2 is active and we're switching to Track 1, save to oldset2
      await saveAudioToOldSet({
        audioPath: item.audio.path,
        trackNumber: primaryTrack
      });
      
      // Restore from the selected track's oldset to become the new original
      const result = await restoreAudioFromOldSet({
        audioPath: item.audio.path,
        trackNumber: track
      });
      
      if (!result.success) {
        throw new Error(`Failed to restore audio from track ${track}`);
      }
      
      // Update the primary track
      setPrimaryTrack(track);
      
      // Force remount of the audio player by updating its key
      setAudioRemountKeys(prev => ({
        ...prev,
        [item.number]: Date.now()
      }));
      
    } catch (error) {
      console.error('Error switching audio track:', error);
      toast.error(getUserFriendlyError(error));
    } finally {
      setProcessingNewAudio(prev => {
        const next = new Set(prev);
        next.delete(item.number);
        return next;
      });
    }
  };

  const handleEditProject = async () => {
    if (!project) return;
    
    setIsEditing(true);
    const loadingToast = toast.loading('Updating your project...');
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // If a new cover is selected, handle the upload
      let newCoverPath = project.cover_file_path;
      if (selectedNewCover) {
        // Upload new cover with original filename
        const { path: coverPath } = await uploadProjectFile(
          selectedNewCover,
          session.user.id,
          project.id,
          selectedNewCover.name,  // Use original filename
          selectedNewCover.type
        );

        // Delete old cover if it exists
        if (project.cover_file_path) {
          await deleteProjectFile(project.cover_file_path);
        }

        newCoverPath = coverPath;
      }

      // Update project in database
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          project_name: editFormData.project_name,
          book_title: editFormData.book_title,
          author_name: editFormData.author_name,
          description: editFormData.description,
          cover_file_path: newCoverPath,
        })
        .eq('id', project.id);

      if (updateError) throw updateError;

      toast.dismiss(loadingToast);
      toast.success('Project updated successfully');
      setIsEditDialogOpen(false);
      setSelectedNewCover(null);
      await fetchProject(); // Refresh the project data
    } catch (error) {
      console.error('Error updating project:', error);
      toast.dismiss(loadingToast);
      toast.error(getUserFriendlyError(error));
    } finally {
      setIsEditing(false);
    }
  };

  const handleNewImageSet = async (item: StoryboardItem) => {
    if (!item.image?.path || processingNewImageSet.has(item.number)) return
    
    const isRestoreAction = checkForJpgoldset(item.number)
    
    // If this is a replace action (not restore), check if we should show confirmation
    if (!isRestoreAction) {
      // Check for the cookie
      const skipReplaceConfirmation = document.cookie
        .split('; ')
        .find(row => row.startsWith('skipReplaceConfirmation='))
        ?.split('=')[1];
      
      if (skipReplaceConfirmation === 'true') {
        // Skip confirmation and proceed directly
        await processImageAction(item);
      } else {
        // Show confirmation dialog
        setConfirmReplaceItem(item);
      }
      return;
    }
    
    // Otherwise, proceed with the restore action
    await processImageAction(item);
  }
  
  // Function to save the preference to a cookie
  const savePreferenceToCookie = () => {
    // Set cookie to expire in 1 year
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    
    document.cookie = `skipReplaceConfirmation=true; expires=${expiryDate.toUTCString()}; path=/`;
    console.log('Saved preference to cookie');
  }
  
  // New function to handle the actual image processing with better cleanup
  const processImageAction = async (item: StoryboardItem) => {
    if (!item.image?.path) return
    
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      if (!project) throw new Error('No project')

      const isRestoreAction = checkForJpgoldset(item.number)
      const itemNumber = item.number

      setProcessingNewImageSet(prev => new Set(prev).add(itemNumber))
      setProcessingItems(prev => new Set(prev).add(itemNumber))
      
      // Set the replace images flag if this is not a restore action
      if (!isRestoreAction) {
        setIsReplaceImagesInProgress(true)
      }

      // Extract the image number from the path to verify we're processing the correct image
      const imageMatch = item.image.path.match(/image(\d+)\.jpg$/)
      if (!imageMatch || parseInt(imageMatch[1]) !== itemNumber) {
        throw new Error('Image number mismatch')
      }

      if (isRestoreAction) {
        // Restore the image from jpgoldset
        await restoreImageFromOldSet({
          imagePath: item.image.path
        })
        
        // Refresh the project to show the restored image
        await fetchProject()
      } else {
        // Original "Replace Images" functionality
        await renameImageToOldSet({
          imagePath: item.image.path
        })

        // Trigger storyboard generation
        await handleGenerateStoryboard()

        // Add a delay before starting to check for completion
        let checkInterval: NodeJS.Timeout | null = null;
        let cleanupTimeout: NodeJS.Timeout | null = null;
        let initialDelayTimeout: NodeJS.Timeout | null = null;
        
        initialDelayTimeout = setTimeout(() => {
          checkInterval = setInterval(async () => {
            try {
              const status = await getProjectStatus({
                userId: session.user.id,
                projectId: project.id
              })

              if (status?.Storyboard_Status === "Storyboard Complete") {
                if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
                if (checkInterval) clearInterval(checkInterval);
                if (cleanupTimeout) clearTimeout(cleanupTimeout);
                
                setProcessingItems(prev => {
                  const next = new Set(prev)
                  next.delete(itemNumber)
                  return next
                })
                
                await fetchProject()
              }
            } catch (error) {
              console.error('Error checking storyboard status:', error);
              if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
              if (checkInterval) clearInterval(checkInterval);
            }
          }, 5000) // Check every 5 seconds

          // Cleanup interval after 10 minutes to prevent infinite checking
          cleanupTimeout = setTimeout(() => {
            if (initialDelayTimeout) clearTimeout(initialDelayTimeout);
            if (checkInterval) clearInterval(checkInterval);
            setProcessingItems(prev => {
              const next = new Set(prev)
              next.delete(itemNumber)
              return next
            })
          }, 600000)
        }, 6000) // Initial 6 second delay
      }
    } catch (error) {
      console.error('Error handling new image set:', error)
      toast.error(getUserFriendlyError(error))
      // Reset the replace images flag on error
      setIsReplaceImagesInProgress(false)
    } finally {
      setProcessingNewImageSet(prev => {
        const next = new Set(prev)
        next.delete(item.number)
        return next
      })
      setProcessingItems(prev => {
        const next = new Set(prev)
        next.delete(item.number)
        return next
      })
    }
  }

  const checkForJpgoldset = (itemNumber: number): boolean => {
    // Get the current item's image path
    const currentItem = items.find(i => i.number === itemNumber);
    if (!currentItem?.image?.path) {
      return false;
    }

    // First check if the item has an oldsetVersion directly
    if (currentItem.image.oldsetVersion?.path) {
      return true;
    }

    // Get the current image path and extract the base name (everything before .jpg)
    const currentPath = currentItem.image.path;
    const baseFilename = currentPath.replace(/\.jpg$/, '');
    
    // Look for any file that has the same base name but with .jpgoldset extension
    const hasOldSet = items.some(item => {
      if (!item.image?.path) return false;
      
      const checkPath = item.image.path;
      
      // First verify it's a jpgoldset file
      if (!checkPath.endsWith('.jpgoldset')) {
        return false;
      }

      // Get base filename of the jpgoldset file
      const checkBaseFilename = checkPath.replace(/\.jpgoldset$/, '');
      
      return checkBaseFilename === baseFilename;
    });

    return hasOldSet;
  };

  const getButtonText = (item: StoryboardItem): string => {
    if (processingNewImageSet.has(item.number)) {
      return 'Processing';
    }
    
    const hasJpgoldset = checkForJpgoldset(item.number);
    return hasJpgoldset ? 'Restore Image' : 'Replace Images';
  }

  // Add a function to determine which track is active
  const determineActiveTrack = useCallback(async () => {
    // For each item with audio, check which track exists as an oldset
    for (const item of items) {
      if (item.audio?.path) {
        // Check if track1 exists as an oldset
        const track1Exists = await checkAudioTrackExists({
          audioPath: item.audio.path,
          trackNumber: 1
        });
        
        // Check if track2 exists as an oldset
        const track2Exists = await checkAudioTrackExists({
          audioPath: item.audio.path,
          trackNumber: 2
        });
        
        // If track1 exists as an oldset, then track2 is active (in the original slot)
        if (track1Exists && !track2Exists) {
          setPrimaryTrack(2);
          return;
        }
        
        // If track2 exists as an oldset, then track1 is active (in the original slot)
        if (track2Exists && !track1Exists) {
          setPrimaryTrack(1);
          return;
        }
        
        // If both exist or neither exist, default to track1
        setPrimaryTrack(1);
        return;
      }
    }
  }, [items]);
  
  // Call determineActiveTrack when items change
  useEffect(() => {
    if (items.length > 0) {
      determineActiveTrack();
    }
  }, [items, determineActiveTrack]);

  // Add a useEffect to debug the voices state
  useEffect(() => {
    // Remove excessive debug logging
  }, [voices, selectedVoice])

  // Add function to save selected voice to the project
  const saveSelectedVoice = async () => {
    if (!project || !selectedVoice) return
    
    setIsUpdatingVoice(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      
      const selectedVoiceData = voices.find(v => v.voice_id === selectedVoice)
      if (!selectedVoiceData) throw new Error('Selected voice not found')
      
      // Update project in database
      const { error } = await supabase
        .from('projects')
        .update({
          voice_id: selectedVoiceData.voice_id,
          voice_name: selectedVoiceData.name
        })
        .eq('id', project.id)
      
      if (error) throw error
      
      toast.success(`Voice "${selectedVoiceData.name}" has been selected for this project`)
      setIsVoiceConfirmOpen(false)
      
      // Update local project data
      setProject({
        ...project,
        voice_id: selectedVoiceData.voice_id,
        voice_name: selectedVoiceData.name
      })
    } catch (error) {
      console.error('Error saving voice selection:', error)
      toast.error('Failed to save voice selection')
    } finally {
      setIsUpdatingVoice(false)
    }
  }

  // Add a function to check if voice is selected
  const checkVoiceSelection = useCallback(async () => {
    if (!project) return
    
    // Only check if the storyboard status would enable the button
    if (projectStatus?.Storyboard_Status === "Ready to Process Storyboard") {
      // Check if voice_id is set in the project
      if (project.voice_id) {
        setIsVoiceSelected(true)
      } else {
        // If not in the local state, check the database
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          const { data, error } = await supabase
            .from('projects')
            .select('voice_id')
            .eq('id', project.id)
            .single()
          
          if (error) throw error
          
          setIsVoiceSelected(!!data.voice_id)
        } catch (error) {
          console.error('Error checking voice selection:', error)
          setIsVoiceSelected(false)
        }
      }
    }
  }, [project, projectStatus?.Storyboard_Status])

  // Add useEffect to check voice selection when project status changes
  useEffect(() => {
    checkVoiceSelection()
  }, [projectStatus, checkVoiceSelection])

  // Load pronunciation corrections from R2 when component mounts
  useEffect(() => {
    const loadPronunciationCorrections = async () => {
      if (project?.id) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          const corrections = await getJsonFromR2<PronunciationCorrection[]>({
            userId: session.user.id,
            projectId: project.id,
            filename: 'pronunciation-corrections.json'
          })
          
          if (corrections) {
            setPronunciationCorrections(corrections)
          }
        } catch (error) {
          console.error('Error loading pronunciation corrections from R2:', error)
        }
      }
    }
    
    loadPronunciationCorrections()
  }, [project?.id])

  // Save pronunciation corrections to R2 when they change
  useEffect(() => {
    const savePronunciationCorrections = async () => {
      if (project?.id && pronunciationCorrections.length > 0) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          // Save to R2
          await saveJsonToR2<PronunciationCorrection[]>({
            userId: session.user.id,
            projectId: project.id,
            filename: 'pronunciation-corrections.json',
            data: pronunciationCorrections
          })
          
          // Only update the pronunciation dictionary in Elevenlabs if explicitly requested
          // This prevents the update from happening when just viewing the project
          if (shouldUpdateDictionary && project.pls_dict_name) {
            try {
              console.log('Updating dictionary in Elevenlabs')
              const response = await fetch('/api/elevenlabs-dictionary-update', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  userId: session.user.id,
                  projectId: project.id,
                  dictionaryName: project.pls_dict_name,
                  pronunciationCorrections
                }),
              })
              
              if (!response.ok) {
                console.error('Failed to update pronunciation dictionary in Elevenlabs')
              } else {
                // Reset the flag after successful update
                setShouldUpdateDictionary(false)
              }
            } catch (dictError) {
              console.error('Error updating pronunciation dictionary in Elevenlabs:', dictError)
              // Reset the flag even if there's an error
              setShouldUpdateDictionary(false)
            }
          }
        } catch (error) {
          console.error('Error saving pronunciation corrections to R2:', error)
        }
      }
    }
    
    savePronunciationCorrections()
  }, [project?.id, project?.pls_dict_name, pronunciationCorrections, shouldUpdateDictionary])

  // Add function to delete a pronunciation correction
  const deletePronunciationCorrection = async (originalName: string) => {
    try {
      // Remove the correction from the state
      setPronunciationCorrections(prev => prev.filter(c => c.originalName !== originalName))
      
      // If the project has a pronunciation dictionary, update it
      if (project?.id) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session) return
          
          // Get the updated corrections (after removing the one to delete)
          const updatedCorrections = pronunciationCorrections.filter(c => c.originalName !== originalName)
          
          // Remove the entry from the master dictionary table in Supabase using the API
          const response = await fetch(`/api/master-dictionary?userId=${session.user.id}&projectId=${project.id}&grapheme=${encodeURIComponent(originalName)}`, {
            method: 'DELETE'
          })
          
          if (!response.ok) {
            console.error('Error removing entry from master dictionary table')
            return
          }
          
          // Update the master dictionary with the remaining rules
          console.log('Updating master dictionary after removing rule for:', originalName)
          
          // Set the flag to update the dictionary
          setShouldUpdateDictionary(true)
          
          // Call the server action to update the master dictionary
          await createMasterPronunciationDictionary(
            session.user.id,
            project.id,
            project.project_name,
            project.book_title,
            mapPronunciationCorrections(updatedCorrections)
          )
        } catch (dictError) {
          console.error('Error updating pronunciation dictionary after deletion:', dictError)
        }
      }
      
      // Show a toast notification
      toast.success(`Pronunciation correction for "${originalName}" deleted`)
    } catch (error) {
      console.error('Error deleting pronunciation correction:', error)
      toast.error('Failed to delete pronunciation correction')
    }
  }

  // Add function to get IPA pronunciation from GPT
  const getIpaPronunciation = async (name: string, controlType: 'corrected' | 'newName' = 'corrected') => {
    if (!name.trim()) return
    
    try {
      if (controlType === 'corrected') {
        setIsLoadingIpa(true)
        setGptIpaPronunciation(null)
        // Reset confirmation status and enable the Use this IPA button
        setIsConfirmedForAudiobook(false)
        setIsUseIpaButtonDisabled(false)
      } else {
        setIsLoadingNewNameIpa(true)
        setNewNameIpaPronunciation(null)
        // Reset confirmation status and enable the Use this IPA button
        setIsNewNameConfirmedForAudiobook(false)
        setIsNewNameUseIpaButtonDisabled(false)
      }
      
      // Make API request to get pronunciation
      const response = await fetch('/api/gpt-pronunciation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      })
      
      if (!response.ok) {
        throw new Error('Failed to get pronunciation')
      }
      
      const data = await response.json()
      if (controlType === 'corrected') {
        setGptIpaPronunciation(data.ipaPronunciation)
      } else {
        setNewNameIpaPronunciation(data.ipaPronunciation)
      }
    } catch (error) {
      console.error('Error getting IPA pronunciation:', error)
      toast.error('Failed to get IPA pronunciation')
    } finally {
      if (controlType === 'corrected') {
        setIsLoadingIpa(false)
      } else {
        setIsLoadingNewNameIpa(false)
      }
    }
  }
  // Add function to confirm IPA for audiobook
  const confirmIpaForAudiobook = (controlType: 'corrected' | 'newName' = 'corrected') => {
    if (controlType === 'corrected' && gptIpaPronunciation) {
      setIsConfirmedForAudiobook(true)
      // Disable the Use this IPA button after it's pressed
      setIsUseIpaButtonDisabled(true)
      
      // Get the name from the input field
      const nameInput = document.getElementById('test-name-input') as HTMLInputElement
      if (nameInput && nameInput.value.trim()) {
        // Get the original name from the dropdown if selected
        let originalName = nameInput.value.trim();
        
        // If a name is selected in the dropdown, use that as the original name
        if (selectedNameEntity) {
          // Parse the selected value to get category and name
          const [category, ...nameParts] = selectedNameEntity.split('-');
          
          // Find the selected entity
          let selectedEntity: EntityItem | null = null;
          
          if (category === 'person' && nameParts[0] === 'common') {
            selectedEntity = nerData?.book_summary.person_entities_common.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          } else if (category === 'person' && nameParts[0] === 'unusual') {
            selectedEntity = nerData?.book_summary.person_entities_unusual.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          } else if (category === 'location' && nameParts[0] === 'common') {
            selectedEntity = nerData?.book_summary.location_entities_common.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          } else if (category === 'location' && nameParts[0] === 'unusual') {
            selectedEntity = nerData?.book_summary.location_entities_unusual.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          } else if (category === 'org' && nameParts[0] === 'common') {
            selectedEntity = nerData?.book_summary.organization_entities_common.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          } else if (category === 'org' && nameParts[0] === 'unusual') {
            selectedEntity = nerData?.book_summary.organization_entities_unusual.find(
              (e: EntityItem) => e.name === nameParts.slice(1).join('-')
            ) || null;
          }
          
          if (selectedEntity) {
            originalName = selectedEntity.name;
          }
        }
        
        // Save the pronunciation correction
        const newCorrection: PronunciationCorrection = {
          originalName: originalName,
          correctedPronunciation: nameInput.value.trim(),
          ipaPronunciation: gptIpaPronunciation
        }
        
        // Update the corrections array, replacing any existing correction for the same name
        setPronunciationCorrections(prev => {
          const filtered = prev.filter(c => c.originalName !== newCorrection.originalName)
          return [...filtered, newCorrection]
        })
        
        // Note: We don't set shouldUpdateDictionary flag here because we want 
        // dictionary updates to only happen when Generate Storyboard is clicked
      }
      
      toast.success('IPA pronunciation confirmed for audiobook')
    } else if (controlType === 'newName' && newNameIpaPronunciation) {
      setIsNewNameConfirmedForAudiobook(true)
      // Disable the Use this IPA button after it's pressed
      setIsNewNameUseIpaButtonDisabled(true)
      
      // Get the original name and corrected pronunciation from input fields
      const originalNameInput = document.getElementById('book-name-input') as HTMLInputElement
      const correctedNameInput = document.getElementById('new-name-input') as HTMLInputElement
      
      if (originalNameInput && originalNameInput.value.trim() && 
          correctedNameInput && correctedNameInput.value.trim()) {
        // Save the pronunciation correction
        const newCorrection: PronunciationCorrection = {
          originalName: originalNameInput.value.trim(),
          correctedPronunciation: correctedNameInput.value.trim(),
          ipaPronunciation: newNameIpaPronunciation
        }
        
        // Update the corrections array, replacing any existing correction for the same name
        setPronunciationCorrections(prev => {
          const filtered = prev.filter(c => c.originalName !== newCorrection.originalName)
          return [...filtered, newCorrection]
        })
        
        // Note: We don't set shouldUpdateDictionary flag here because we want 
        // dictionary updates to only happen when Generate Storyboard is clicked
      }
      
      toast.success('New name IPA pronunciation confirmed for audiobook')
    }
  }

  // Fetch the master dictionary name when component mounts
  useEffect(() => {
    const fetchMasterDictionaryName = async () => {
      try {
        const name = await getMasterDictionaryName()
        setMasterDictionaryName(name)
      } catch (error) {
        console.error('Error fetching master dictionary name:', error)
      }
    }
    
    fetchMasterDictionaryName()
  }, [])

  // Add a useEffect to fetch HLS path when component mounts and when projectStatus changes
  useEffect(() => {
    // Only fetch HLS path when the project is published
    if (projectStatus?.Audiobook_Status === "Audiobook Complete") {
      fetchHlsPath()
    }
  }, [projectStatus, project, fetchHlsPath])
  
  // Add cleanup for blob URLs when component unmounts
  useEffect(() => {
    // Cleanup function
    return () => {
      if (hlsPath && typeof hlsPath === 'string' && hlsPath.startsWith('blob:')) {
        console.log('Cleaning up HLS blob URL');
        URL.revokeObjectURL(hlsPath);
      }
    };
  }, [hlsPath]);

  // Create a ref for the HLS video element
  const hlsVideoRef = useRef<HTMLVideoElement>(null)

  // Add effect to handle HLS video playback with our proxy solution
  useEffect(() => {
    // Don't initialize if hlsPath is not set or still preparing
    if (!hlsPath || !hlsVideoRef.current || isPreparingHls) return;

    console.log('Setting up HLS player');
    
    // Reset error state when trying a new path
    setHlsLoadError(null);
    
    let hls: Hls | null = null;
    const videoElement = hlsVideoRef.current;
    
    // For browsers with native HLS support (Safari/iOS), use native playback
    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      console.log('Browser supports native HLS - using native playback');
      videoElement.src = hlsPath;
      
      // Add error handler for Safari
      const errorHandler = () => {
        console.error('Native HLS playback error');
        setHlsLoadError('Error playing video. Please try refreshing the page.');
      };
      
      videoElement.addEventListener('error', errorHandler);
      
      // Clean up event handler
      return () => {
        videoElement.removeEventListener('error', errorHandler);
      };
    }
    // For other browsers, use HLS.js if supported
    else if (Hls.isSupported()) {
      console.log('Using HLS.js');
      
      try {
        // Create a new HLS instance with Cloudflare-recommended settings
        hls = new Hls({ 
          enableWorker: true,
          // Progressive loading is important for large streams
          progressive: true,
          // Better buffering settings
          lowLatencyMode: false,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          // Use reliable timeouts
          manifestLoadingTimeOut: 20000,
          manifestLoadingMaxRetry: 4,
          levelLoadingTimeOut: 20000,
          fragLoadingTimeOut: 20000,
          // Debug only in development
          debug: process.env.NODE_ENV === 'development',
          // Use max quality by default
          capLevelToPlayerSize: false,
          // Capture detailed error data
          xhrSetup: function(xhr) {
            xhr.addEventListener('error', function(e) {
              console.error('XHR error:', e);
            });
          }
        });
        
        // Add more detailed error handling
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.warn('HLS error:', data);
          
          if (data.fatal) {
            console.error('Fatal HLS error:', data.type, data.details);
            
            // Try to recover from media and network errors before giving up
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              console.log('Network error, trying to recover...');
              hls?.startLoad();
              return;
            }
            
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              console.log('Media error, trying to recover...');
              hls?.recoverMediaError();
              return;
            }
            
            // Provide more specific error messages based on error details
            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
              setHlsLoadError('Unable to load video stream - the stream may be unavailable.');
            } else if (String(data.details).includes('NETWORK')) {
              setHlsLoadError('Network error - check your internet connection and try again.');
            } else if (String(data.details).includes('KEY_LOAD_ERROR')) {
              setHlsLoadError('Content protection error - please contact support.');
            } else {
              setHlsLoadError('Playback error - the stream may not be available.');
            }
            
            // Clean up
            if (hls) {
              hls.destroy();
            }
            // Set hls to null after destroying it
            hls = null;
          }
        });
        
        // Add logging for debugging
        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          console.log('HLS manifest loaded successfully');
        });
        
        // First attach the media
        hls.attachMedia(videoElement);
        
        // When media attached, load the source
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          console.log('HLS.js media attached, loading source');
          if (hls) {
            hls.loadSource(hlsPath);
            
            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
              console.log(`HLS manifest parsed, ${data.levels.length} quality levels available`);
              // Remove autoplay
            });
          }
        });
      } catch (e) {
        console.error('Error initializing HLS.js:', e);
        setHlsLoadError('Error initializing video player');
      }
    }
    // Fallback for browsers without HLS support
    else {
      console.warn('HLS not supported by this browser');
      videoElement.src = hlsPath;
      setHlsLoadError('This browser may not support streaming playback. Please try Safari, Chrome, or Firefox.');
    }
    
    // Cleanup function
    return () => {
      if (hls) {
        console.log('Cleaning up HLS instance');
        hls.destroy();
      }
    };
  }, [hlsPath, isPreparingHls]);

  // Add event listeners to the video to sync play/pause state
  useEffect(() => {
    const videoElement = hlsVideoRef.current;
    if (!videoElement) return;
    
    // Add basic logging for events when needed
    const handlePlay = () => {};
    const handlePause = () => {};
    const handleEnded = () => {};
    
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('ended', handleEnded);
    
    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Update handleGenerateFinalAudiobook to use the mode
  const handleGenerateFinalAudiobook = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')
      if (!project) throw new Error('Project not found')

      // Extract filename from epub_file_path
      const epubFilename = project.epub_file_path.split('/').pop()
      if (!epubFilename) throw new Error('EPUB filename not found')

      await updateProjectStatus({
        userId: session.user.id,
        projectId: project.id,
        status: {
          Project: project.project_name,
          Book: project.book_title,
          notify: session.user.email || '',
          userid: session.user.id,
          projectid: project.id,
          Current_Status: "Final Audiobook is Processing",
          Ebook_Prep_Status: "Ebook Processing Complete",
          Storyboard_Status: "Storyboard Complete",
          Proof_Status: "Proofs Complete",
          Audiobook_Status: "Processing Audiobook, Please Wait"
        }
      })

      await fetchProject()

      // Use the author_name and book_title from the project
      const authorName = project.author_name || "Mike Langlois"
      const bookTitle = project.book_title || "Walker"
      
      // Use the voice name from the project
      const voiceName = project.voice_name || "Abe"

      // Use the master pronunciation dictionary
      let dictionaryParam = ""
      if (project.pls_dict_name) {
        dictionaryParam = ` -pd "${masterDictionaryName}"`
      }

      // Log the dictionary parameter for debugging
      console.log(`Sending final audiobook command with dictionary parameter: ${dictionaryParam || 'none'}`)

      // Set mode-specific parameters
      const modeParam = mode === "validation" ? "validation" : "production"
      
      // In validation mode, use -l 2, in production mode, omit -l parameter entirely
      const limitParam = mode === "validation" ? " -l 2" : "-l 5"
      
      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "${authorName}" -ti "${bookTitle}" -vn "${voiceName}"${dictionaryParam}${limitParam} -sp -m ${modeParam}`
      await sendCommand(command)
      toast.success('Final audiobook generation started')
    } catch (error) {
      console.error('Error generating final audiobook:', error)
      toast.error('Failed to start final audiobook generation')
    }
  }

  // Add effect to update progress bar for HLS playback
  useEffect(() => {
    const videoElement = hlsVideoRef.current;
    if (!videoElement) return;

    const updateProgress = () => {
      if (videoElement.duration) {
        setHlsProgress((videoElement.currentTime / videoElement.duration) * 100);
      }
    };

    const handlePlay = () => setIsHlsPlaying(true);
    const handlePause = () => setIsHlsPlaying(false);
    const handleTimeUpdate = updateProgress;
    const handleVolumeChange = () => setIsHlsMuted(videoElement.muted);

    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('volumechange', handleVolumeChange);

    return () => {
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('volumechange', handleVolumeChange);
    };
  }, [hlsVideoRef]);

  if (loading) return <div>Loading...</div>
  if (!project) return <div>Project not found</div>

  return (
    <div className="container mx-auto px-4 py-4">
      {/* Hidden audio element for voice preview */}
      <audio ref={audioRef} className="hidden" />
      
      <div className="flex items-start gap-6 p-4 bg-gray-100 rounded-lg mb-4 shadow-sm">
        {/* Cover Image - sized to match content height */}
        {coverUrl && (
          <div className="relative w-[100px] h-[150px] flex-shrink-0">
            <Image
              src={coverUrl}
              alt={`Cover for ${project?.book_title}`}
              fill
              className="object-cover rounded-md"
              sizes="100px"
              priority
            />
          </div>
        )}

        {/* Project Info and Actions in a more compact layout */}
        <div className="flex-1">
          {/* Project Title and Action Buttons - more compact */}
          <div className="flex justify-between items-center mb-3">
            <h1 className="text-2xl font-bold">{project?.project_name}</h1>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => {
                // Populate the form with current project data
                if (project) {
                  setEditFormData({
                    project_name: project.project_name,
                    book_title: project.book_title,
                    author_name: project.author_name,
                    description: project.description
                  });
                }
                setIsEditDialogOpen(true);
              }}>
                Edit Project
              </Button>
              <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
                Delete Project
              </Button>
            </div>
          </div>
          
          {/* Project Details Section - more compact grid */}
          <div className="grid grid-cols-[120px_1fr] gap-y-2">
            <p className="text-sm font-medium">Book:</p>
            <div className="flex items-center">
              <p className="text-sm text-gray-700 w-[200px]">{project?.book_title || ''}</p>
              
              {/* Remove the old mode toggle buttons from here */}
            </div>
            
            <p className="text-sm font-medium">Author:</p>
            <p className="text-sm text-gray-700">{project?.author_name || ''}</p>
            
            <p className="text-sm font-medium self-start">Description:</p>
            <p className="text-sm text-gray-700 max-w-[500px] whitespace-normal break-words">{project?.description || ''}</p>
            
            {projectStatus && (
              <>
                <p className="text-sm font-medium">Project Status:</p>
                <p className="text-sm">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md">
                    {projectStatus.Current_Status}
                  </span>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      
      {/* Mode Toggle Buttons moved between project summary and tabs */}
      <div className="flex justify-center gap-4 mb-2">
        {/* Validation Mode Button */}
        <button
          onClick={() => setMode("validation")}
          className={`relative w-40 h-14 rounded-md flex flex-col overflow-hidden transition-all duration-300 ${
            mode === "validation" 
              ? "shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
              : "shadow-md hover:shadow-lg"
          }`}
        >
          {/* Button Background with Gradient */}
          <div className={`absolute inset-0 ${
            mode === "validation"
              ? "bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-400"
              : "bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-300 hover:border-gray-400"
          } rounded-md transition-all duration-300`}></div>
          
          {/* LED Indicator Container */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-gray-200 rounded-t-sm overflow-hidden">
            {/* LED Light Effect */}
            <div 
              className={`h-full w-full transition-all duration-300 ${
                mode === "validation" 
                  ? "bg-gradient-to-r from-green-400 to-green-500 shadow-[0_0_10px_rgba(74,222,128,0.8)]" 
                  : "bg-gray-300"
              }`}
            ></div>
          </div>
          
          {/* Button Content */}
          <div className={`absolute inset-0 pt-3 flex flex-col items-center justify-center transition-all duration-300`}>
            <span className={`font-semibold text-sm ${
              mode === "validation" ? "text-blue-700" : "text-gray-500"
            }`}>VALIDATION</span>
            <span className={`text-xs mt-0.5 ${
              mode === "validation" ? "text-blue-500" : "text-gray-400"
            }`}>Limited Run</span>
          </div>
        </button>
        
        {/* Production Mode Button */}
        <button
          onClick={() => setMode("production")}
          className={`relative w-40 h-14 rounded-md flex flex-col overflow-hidden transition-all duration-300 ${
            mode === "production" 
              ? "shadow-[0_0_15px_rgba(34,197,94,0.5)]" 
              : "shadow-md hover:shadow-lg"
          }`}
        >
          {/* Button Background with Gradient */}
          <div className={`absolute inset-0 ${
            mode === "production"
              ? "bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-400"
              : "bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-300 hover:border-gray-400"
          } rounded-md transition-all duration-300`}></div>
          
          {/* LED Indicator Container */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-gray-200 rounded-t-sm overflow-hidden">
            {/* LED Light Effect */}
            <div 
              className={`h-full w-full transition-all duration-300 ${
                mode === "production" 
                  ? "bg-gradient-to-r from-green-400 to-green-500 shadow-[0_0_10px_rgba(74,222,128,0.8)]" 
                  : "bg-gray-300"
              }`}
            ></div>
          </div>
          
          {/* Button Content */}
          <div className={`absolute inset-0 pt-3 flex flex-col items-center justify-center transition-all duration-300`}>
            <span className={`font-semibold text-sm ${
              mode === "production" ? "text-green-700" : "text-gray-500"
            }`}>PRODUCTION</span>
            <span className={`text-xs mt-0.5 ${
              mode === "production" ? "text-green-500" : "text-gray-400"
            }`}>Full Book</span>
          </div>
        </button>
      </div>

      <Tabs defaultValue={getInitialTab(projectStatus)} className="w-full">
        <TabsList className="flex w-full bg-gray-100 p-1 rounded-lg shadow-md">
          <TabsTrigger
            value="intake"
            className={`flex-1 rounded-md px-6 py-2.5 font-medium text-sm transition-all data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm ${
              projectStatus?.Ebook_Prep_Status === "Ebook Processing Complete" ? 'bg-green-50' : ''
            }`}
          >
            Intake
          </TabsTrigger>
          <TabsTrigger
            value="storyboard"
            className={`flex-1 rounded-md px-6 py-2.5 font-medium text-sm transition-all data-[state=active]:bg-white data-[state=active]:text-orange-600 data-[state=active]:shadow-sm ${
              projectStatus?.Storyboard_Status === "Storyboard Complete" ? 'bg-green-50' : ''
            }`}
          >
            Storyboard
          </TabsTrigger>
          <TabsTrigger
            value="proofs"
            className={`flex-1 rounded-md px-6 py-2.5 font-medium text-sm transition-all data-[state=active]:bg-white data-[state=active]:text-green-600 data-[state=active]:shadow-sm ${
              projectStatus?.Proof_Status === "Proofs Complete" ? 'bg-green-50' : ''
            }`}
          >
            Proofs
          </TabsTrigger>
          <TabsTrigger
            value="audiobook"
            className={`flex-1 rounded-md px-6 py-2.5 font-medium text-sm transition-all data-[state=active]:bg-white data-[state=active]:text-purple-600 data-[state=active]:shadow-sm ${
              projectStatus?.Audiobook_Status === "Audiobook Complete" ? 'bg-green-50' : ''
            }`}
          >
            Audiobook
          </TabsTrigger>
        </TabsList>

        <div className="mt-0 bg-white rounded-lg p-3 shadow-sm">
          <TabsContent value="intake">
            <Card className="p-2 border-0 shadow-none">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Audiobook Preparation</h2>
                <div className="flex gap-3">
                  <Button 
                    variant="outline"
                    onClick={handleProcessEpub}
                    disabled={!getIntakeButtonState(projectStatus?.Ebook_Prep_Status).enabled}
                    className={getIntakeButtonState(projectStatus?.Ebook_Prep_Status).label === "Intake Complete" ? "bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 border-green-200" : ""}
                  >
                    {getIntakeButtonState(projectStatus?.Ebook_Prep_Status).label}
                  </Button>
                  
                  {/* Storyboard button moved from storyboard tab */}
                  <Button 
                    variant="outline"
                    onClick={handleGenerateStoryboard}
                    disabled={!getStoryboardButtonState(projectStatus?.Storyboard_Status, isVoiceSelected).enabled || projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete"}
                    className={getStoryboardButtonState(projectStatus?.Storyboard_Status, isVoiceSelected).label === "Storyboard Complete" ? "bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 border-green-200" : ""}
                  >
                    {getStoryboardButtonState(projectStatus?.Storyboard_Status, isVoiceSelected).label}
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                  {/* Book and Author Information Section */}
                  <div className="space-y-4 border p-4 rounded-md">
                    <h3 className="text-md font-medium">Audiobook Label Information</h3>
                    <p className="text-sm text-gray-600">
                      These values will be used when generating the audiobook. They can be changed at any time before the audiobook is created.
                    </p>
                    
                    <div>
                      <label className="block text-sm font-medium mb-1">Book Title</label>
                      <div className="flex gap-2">
                        <Input
                          value={project?.book_title || ''}
                          readOnly
                          className="bg-gray-50"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium mb-1">Author Name</label>
                      <div className="flex gap-2">
                        <Input
                          value={project?.author_name || ''}
                          readOnly
                          className="bg-gray-50"
                        />
                      </div>
                    </div>
                    
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        // Populate the form with current project data
                        if (project) {
                          setEditFormData({
                            project_name: project.project_name,
                            book_title: project.book_title,
                            author_name: project.author_name,
                            description: project.description
                          });
                        }
                        setIsEditDialogOpen(true);
                      }}
                    >
                      Edit Information
                    </Button>
                  </div>
                  
                  {/* Voice Selection Section - Conditionally enabled */}
                  <div className={`space-y-4 border p-4 rounded-md ${projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete" ? 'opacity-50' : ''}`}>
                    <h3 className="text-md font-medium">Voice Selection</h3>
                    <p className="text-sm text-gray-600">
                      Select a voice that will be used to create the storyboard files.
                    </p>
                    
                    {/* Show currently selected voice if one is saved */}
                    {project?.voice_name && project?.voice_id && (
                      <div className="mb-4 p-3 bg-green-50 text-green-800 rounded-md flex items-center justify-between">
                        <div>
                          <span className="font-medium">Currently selected voice: </span>
                          {project.voice_name}
                        </div>
                        <button
                          onClick={() => setIsVoiceConfirmOpen(true)}
                          className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                          disabled={projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete"}
                        >
                          Change
                        </button>
                      </div>
                    )}
                    
                    {voiceDataError && (
                      <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md">
                        {voiceDataError}
                      </div>
                    )}
                    
                    <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                      <div className="w-full sm:w-64">
                        <select
                          value={selectedVoice}
                          onChange={(e) => setSelectedVoice(e.target.value)}
                          className="w-full p-2 border rounded"
                          disabled={projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete"}
                        >
                          {voices.length === 0 ? (
                            <option value="">No voices available</option>
                          ) : (
                            voices.map((voice) => (
                              <option key={voice.voice_id} value={voice.voice_id}>
                                {voice.name}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      
                      <button
                        onClick={playVoicePreview}
                        disabled={!selectedVoice || voices.length === 0 || isPlayingPreview || !voices.find(v => v.voice_id === selectedVoice)?.preview_url || projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete"}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                      >
                        {isPlayingPreview ? 'Playing...' : 'Play Preview'}
                      </button>
                      
                      <audio ref={audioRef} className="hidden" controls />
                    </div>
                    
                    {/* Voice Labels Display */}
                    {selectedVoice && voices.length > 0 && projectStatus?.Ebook_Prep_Status === "Ebook Processing Complete" && (
                      <div className="mt-4">
                        <h4 className="text-sm font-medium mb-2">Voice Characteristics</h4>
                        <div className="grid grid-cols-2 gap-3">
                          {/* Display standard labels if available */}
                          {voices.find(v => v.voice_id === selectedVoice)?.labels && 
                          Object.keys(voices.find(v => v.voice_id === selectedVoice)?.labels || {}).length > 0 ? 
                            Object.entries(voices.find(v => v.voice_id === selectedVoice)?.labels || {}).map(([key, value]) => (
                              <div key={key} className="flex flex-col">
                                <span className="text-xs font-medium text-gray-500 capitalize">{key}</span>
                                <span className="text-sm">{value}</span>
                              </div>
                            ))
                            : 
                            <div className="col-span-2 text-sm text-gray-500">
                              No characteristics available for this voice.
                            </div>
                          }
                          
                          {/* Always show Preview availability */}
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-gray-500">Preview</span>
                            <span className="text-sm">
                              {voices.find(v => v.voice_id === selectedVoice)?.preview_url ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </div>
                        
                        {/* Add Select This Voice button */}
                        <div className="mt-4">
                          <button
                            onClick={() => setIsVoiceConfirmOpen(true)}
                            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                            disabled={
                              projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete" || 
                              projectStatus?.Storyboard_Status === "Processing Storyboard, Please Wait" ||
                              projectStatus?.Storyboard_Status === "Storyboard Complete"
                            }
                          >
                            {projectStatus?.Storyboard_Status === "Processing Storyboard, Please Wait" || 
                            projectStatus?.Storyboard_Status === "Storyboard Complete" 
                              ? "Voice Selected" 
                              : "Select This Voice"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Right Column */}
                <div>
                  {/* Name Pronunciation Section - Conditionally enabled */}
                  <div className={`space-y-4 border p-4 rounded-md ${projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete" ? 'opacity-50' : ''}`}>
                    <div className="flex justify-between items-center">
                      <h3 className="text-md font-medium">Name Pronunciation</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsViewCorrectionsOpen(true)}
                        disabled={pronunciationCorrections.length === 0}
                        className={pronunciationCorrections.length > 0 ? 
                          "bg-green-600 text-white hover:bg-green-700 border-green-500" : 
                          ""}
                      >
                        View Corrections
                      </Button>
                    </div>
                    <p className="text-sm text-gray-600">
                      View pronunciation guides for names and entities in your book. Only correct the pronunciation if needed, otherwise simply check to ensure unusual names sound as you intended.
                    </p>
                    
                    {nerData ? (
                      <>
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                          <div className="w-full sm:w-64">
                            <select
                              value={selectedNameEntity}
                              onChange={(e) => setSelectedNameEntity(e.target.value)}
                              className="w-full p-2 border rounded"
                              disabled={projectStatus?.Ebook_Prep_Status !== "Ebook Processing Complete"}
                            >
                              <option value="">Select a name or entity</option>
                              
                              {/* Person - Common */}
                              {nerData.book_summary?.person_entities_common?.length > 0 && (
                                <optgroup label="Person - Common">
                                  {nerData.book_summary.person_entities_common.map((entity: EntityItem) => (
                                    <option key={`person-common-${entity.name}`} value={`person-common-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              {/* Person - Unusual */}
                              {nerData.book_summary?.person_entities_unusual?.length > 0 && (
                                <optgroup label="Person - Unusual">
                                  {nerData.book_summary.person_entities_unusual.map((entity: EntityItem) => (
                                    <option key={`person-unusual-${entity.name}`} value={`person-unusual-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              {/* Location - Common */}
                              {nerData.book_summary?.location_entities_common?.length > 0 && (
                                <optgroup label="Location - Common">
                                  {nerData.book_summary.location_entities_common.map((entity: EntityItem) => (
                                    <option key={`location-common-${entity.name}`} value={`location-common-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              {/* Location - Unusual */}
                              {nerData.book_summary?.location_entities_unusual?.length > 0 && (
                                <optgroup label="Location - Unusual">
                                  {nerData.book_summary.location_entities_unusual.map((entity: EntityItem) => (
                                    <option key={`location-unusual-${entity.name}`} value={`location-unusual-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              {/* Organization - Common */}
                              {nerData.book_summary?.organization_entities_common?.length > 0 && (
                                <optgroup label="Organization - Common">
                                  {nerData.book_summary.organization_entities_common.map((entity: EntityItem) => (
                                    <option key={`org-common-${entity.name}`} value={`org-common-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              
                              {/* Organization - Unusual */}
                              {nerData.book_summary?.organization_entities_unusual?.length > 0 && (
                                <optgroup label="Organization - Unusual">
                                  {nerData.book_summary.organization_entities_unusual.map((entity: EntityItem) => (
                                    <option key={`org-unusual-${entity.name}`} value={`org-unusual-${entity.name}`}>
                                      {entity.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          </div>
                          
                          {/* Add Hear Name button next to dropdown */}
                          <button
                            onClick={() => {
                              // Parse the selected value to get category and name
                              const [category, ...nameParts] = selectedNameEntity.split('-')
                              // Find the selected entity
                              let selectedEntity: EntityItem | null = null
                              
                              if (category === 'person' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.person_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'person' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.person_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'location' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.location_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'location' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.location_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'org' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.organization_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'org' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.organization_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              }
                              
                              if (selectedEntity) {
                                playNameAudio(selectedEntity.name)
                              }
                            }}
                            disabled={isPlayingNameAudio || !selectedNameEntity || !selectedVoice}
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                          >
                            {isPlayingNameAudio ? 'Playing...' : 'Hear Name'}
                          </button>
                        </div>
                        
                        {/* Display pronunciation details if an entity is selected - MOVED HERE */}
                        <div className="mt-4 p-3 bg-blue-50 rounded-md">
                          {selectedNameEntity ? (
                            (() => {
                              // Parse the selected value to get category and name
                              const [category, ...nameParts] = selectedNameEntity.split('-')
                              
                              // Find the selected entity
                              let selectedEntity: EntityItem | null = null
                              
                              if (category === 'person' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.person_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'person' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.person_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'location' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.location_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'location' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.location_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'org' && nameParts[0] === 'common') {
                                selectedEntity = nerData.book_summary.organization_entities_common.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              } else if (category === 'org' && nameParts[0] === 'unusual') {
                                selectedEntity = nerData.book_summary.organization_entities_unusual.find(
                                  (e: EntityItem) => e.name === nameParts.slice(1).join('-')
                                ) || null
                              }
                              
                              if (selectedEntity) {
                                return (
                                  <div className="space-y-2">
                                    <div>
                                      <span className="font-medium">Name: </span>
                                      {selectedEntity.name}
                                    </div>
                                    <div>
                                      <span className="font-medium">IPA Pronunciation: </span>
                                      <code className="bg-gray-100 px-1 py-0.5 rounded">{selectedEntity.IPA}</code>
                                    </div>
                                  </div>
                                )
                              }
                              
                              return <div>Entity details not found</div>
                            })()
                          ) : (
                            <div className="space-y-2">
                              <div>
                                <span className="font-medium">Name: </span>
                              </div>
                              <div>
                                <span className="font-medium">IPA Pronunciation: </span>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {/* Add Corrected Pronunciation section */}
                        <div className="mt-6">
                          <h4 className="text-sm font-medium mb-2">Corrected Pronunciation</h4>
                          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                            <div className="w-full sm:w-64">
                              <input
                                type="text"
                                placeholder="Enter a phonetic spelling"
                                id="test-name-input"
                                className="w-full p-2 border rounded"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  const nameInput = document.getElementById('test-name-input') as HTMLInputElement
                                  if (nameInput && nameInput.value.trim()) {
                                    playNameAudio(nameInput.value.trim())
                                  } else {
                                    toast.error('Please enter a name')
                                  }
                                }}
                                disabled={isPlayingNameAudio || !selectedVoice}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                              >
                                {isPlayingNameAudio ? 'Playing...' : 'Hear Name'}
                              </button>
                              <button
                                onClick={() => {
                                  const nameInput = document.getElementById('test-name-input') as HTMLInputElement
                                  if (nameInput && nameInput.value.trim()) {
                                    getIpaPronunciation(nameInput.value.trim(), 'corrected')
                                  } else {
                                    toast.error('Please enter a name')
                                  }
                                }}
                                disabled={isLoadingIpa}
                                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                              >
                                {isLoadingIpa ? 'Loading...' : 'Get IPA'}
                              </button>
                              <button
                                onClick={() => confirmIpaForAudiobook('corrected')}
                                disabled={!gptIpaPronunciation || isUseIpaButtonDisabled}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                              >
                                Use this IPA
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Display Corrected Pronunciation IPA */}
                        <div className="mt-4 p-3 bg-purple-50 rounded-md">
                          <div className="space-y-2">
                            <div>
                              <span className="font-medium">IPA Pronunciation: </span>
                              {gptIpaPronunciation ? (
                                <code className="bg-gray-100 px-1 py-0.5 rounded">{gptIpaPronunciation}</code>
                              ) : (
                                <span className="text-gray-500">No pronunciation generated yet</span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium">Confirmed Pronunciation for Audiobook: </span>
                              <span className={isConfirmedForAudiobook ? "text-green-600" : "text-gray-500"}>
                                {isConfirmedForAudiobook ? "Yes" : "No"}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Divider */}
                        <div className="my-6 border-t-2 border-gray-400"></div>
                        
                        {/* Add Enter a New Name section */}
                        <div>
                          <h4 className="text-md font-medium mb-2">Enter a New Name</h4>
                          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center mb-3">
                            <div className="w-full sm:w-64">
                              <label className="block text-sm font-medium mb-1">Name As Spelled in the Book</label>
                              <input
                                type="text"
                                placeholder="Enter Name"
                                id="book-name-input"
                                className="w-full p-2 border rounded"
                              />
                            </div>
                            <div className="flex gap-2 mt-6">
                              <button
                                onClick={() => {
                                  const nameInput = document.getElementById('book-name-input') as HTMLInputElement
                                  if (nameInput && nameInput.value.trim()) {
                                    playNameAudio(nameInput.value.trim())
                                  } else {
                                    toast.error('Please enter a name')
                                  }
                                }}
                                disabled={isPlayingNameAudio || !selectedVoice}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                              >
                                {isPlayingNameAudio ? 'Playing...' : 'Hear Name'}
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                            <div className="w-full sm:w-64">
                              <label className="block text-sm font-medium mb-1">Corrected Pronunciation</label>
                              <input
                                type="text"
                                placeholder="Add Pronunciation if Needed"
                                id="new-name-input"
                                className="w-full p-2 border rounded"
                              />
                            </div>
                            <div className="flex gap-2 mt-6">
                              <button
                                onClick={() => {
                                  const nameInput = document.getElementById('new-name-input') as HTMLInputElement
                                  if (nameInput && nameInput.value.trim()) {
                                    playNameAudio(nameInput.value.trim())
                                  } else {
                                    toast.error('Please enter a name')
                                  }
                                }}
                                disabled={isPlayingNameAudio || !selectedVoice}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                              >
                                {isPlayingNameAudio ? 'Playing...' : 'Hear Name'}
                              </button>
                              <button
                                onClick={() => {
                                  const nameInput = document.getElementById('new-name-input') as HTMLInputElement
                                  if (nameInput && nameInput.value.trim()) {
                                    getIpaPronunciation(nameInput.value.trim(), 'newName')
                                  } else {
                                    toast.error('Please enter a name')
                                  }
                                }}
                                disabled={isLoadingNewNameIpa}
                                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:bg-gray-400"
                              >
                                {isLoadingNewNameIpa ? 'Loading...' : 'Get IPA'}
                              </button>
                              <button
                                onClick={() => confirmIpaForAudiobook('newName')}
                                disabled={!newNameIpaPronunciation || isNewNameUseIpaButtonDisabled}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
                              >
                                Use this IPA
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Display New Name IPA pronunciation */}
                        <div className="mt-4 p-3 bg-purple-50 rounded-md">
                          <div className="space-y-2">
                            <div>
                              <span className="font-medium">IPA Pronunciation: </span>
                              {newNameIpaPronunciation ? (
                                <code className="bg-gray-100 px-1 py-0.5 rounded">{newNameIpaPronunciation}</code>
                              ) : (
                                <span className="text-gray-500">No pronunciation generated yet</span>
                              )}
                            </div>
                            <div>
                              <span className="font-medium">Confirmed Pronunciation for Audiobook: </span>
                              <span className={isNewNameConfirmedForAudiobook ? "text-green-600" : "text-gray-500"}>
                                {isNewNameConfirmedForAudiobook ? "Yes" : "No"}
                              </span>
                            </div>
                          </div>
                        </div>
                        
                        {/* Audio element for name playback */}
                        <audio ref={nameAudioRef} className="hidden" controls />
                      </>
                    ) : (
                      <div className="p-3 bg-yellow-50 text-yellow-800 rounded-md">
                        No pronunciation data available. Please process the ebook first.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="storyboard">
            <Card className="p-2 border-0 shadow-none">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-semibold">Storyboard</h3>
                {/* Audiobook button moved from audiobook tab */}
                <Button 
                  variant="outline"
                  onClick={handleGenerateAudiobook}
                  disabled={!getAudiobookButtonState(projectStatus?.Proof_Status).enabled}
                  className={getAudiobookButtonState(projectStatus?.Proof_Status).label === "Proofs Complete" ? "bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 border-green-200" : ""}
                >
                  {getAudiobookButtonState(projectStatus?.Proof_Status).label}
                </Button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center min-h-[200px]">
                  <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent"></div>
                </div>
              ) : projectStatus?.Storyboard_Status !== "Storyboard Complete" ? (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No storyboard available yet.</p>
                  {projectStatus?.Storyboard_Status === "Processing Storyboard, Please Wait" && (
                    <div className="mt-4 flex justify-center">
                      <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent"></div>
                    </div>
                  )}
                </Card>
              ) : items.length > 0 ? (
                <div className="relative">
                  <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto pb-4 scroll-smooth"
                  >
                    {items.map((item) => (
                      <Card key={item.number} className="flex-shrink-0 w-[341px]">
                        <CardContent className="p-2 space-y-2">
                          <div className="relative">
                            {processingItems.has(item.number) ? (
                              <div className="relative w-full h-[597px] bg-gray-100 flex items-center justify-center">
                                <div className="flex flex-col items-center gap-4">
                                  <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent"></div>
                                  <p className="text-lg font-medium text-gray-600">Processing...</p>
                                </div>
                              </div>
                            ) : item.image?.url ? (
                              <div className="relative w-full h-[597px]">
                                {item.image?.loadError ? (
                                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-100">
                                    <p className="text-red-500 mb-2">Error: {diagnoseImageLoadingError(null, item.image?.url || '', item.number)}</p>
                                    <p className="text-xs text-gray-500 mb-2">The image might be too large or corrupted</p>
                                    <Button 
                                      variant="outline" 
                                      onClick={() => {
                                        // Clear the error flag and force a re-render
                                        const updatedItems = [...items];
                                        const itemIndex = updatedItems.findIndex(i => i.number === item.number);
                                        if (itemIndex !== -1 && updatedItems[itemIndex].image) {
                                          updatedItems[itemIndex].image!.loadError = false;
                                          setItems(updatedItems);
                                        }
                                      }}
                                      size="sm"
                                    >
                                      Retry
                                    </Button>
                                  </div>
                                ) : null}
                                <Image 
                                  src={item.image.url} 
                                  alt={`Storyboard ${item.number}`}
                                  fill
                                  className={`object-cover rounded ${
                                    item.image.path && swappingImages.has(item.image.path) ? 'opacity-50' : ''
                                  }${item.image.loadError ? ' hidden' : ''}`}
                                  priority={item.number <= 2}
                                  sizes="(max-width: 768px) 100vw, 341px"
                                  onError={(e) => {
                                    // Get error message but don't assign to variable since we use it directly
                                    diagnoseImageLoadingError(e, item.image?.url || '', item.number);
                                    
                                    // Mark this item as having a load error
                                    const updatedItems = [...items];
                                    const itemIndex = updatedItems.findIndex(i => i.number === item.number);
                                    if (itemIndex !== -1 && updatedItems[itemIndex].image) {
                                      updatedItems[itemIndex].image!.loadError = true;
                                      setItems(updatedItems);
                                    }

                                    // Try to reload the image by updating its URL with a cache-busting query param
                                    const target = e.target as HTMLImageElement;
                                    if (target && target.src) {
                                      const newSrc = target.src.includes('?') 
                                        ? `${target.src}&retry=${Date.now()}` 
                                        : `${target.src}?retry=${Date.now()}`;
                                      target.src = newSrc;
                                    }
                                  }}
                                />
                                {item.image.path && swappingImages.has(item.image.path) && (
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent" />
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="relative w-full h-[597px] bg-gray-100 flex items-center justify-center">
                                <p className="text-gray-500">No image available</p>
                              </div>
                            )}
                            <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                              {item.number}
                            </div>
                          </div>
                          
                          <div className="flex gap-2 items-center mt-2">
                            <div className="flex flex-col gap-2 flex-1">
                              {item.text?.content && (
                                <Button
                                  variant="outline"
                                  onClick={() => {
                                    setSelectedText(item.text?.content || null)
                                    setIsTextDialogOpen(true)
                                  }}
                                  className="flex items-center gap-2 text-sm w-full justify-center"
                                  size="sm"
                                >
                                  <FileText className="h-4 w-4" />
                                  View Text
                                </Button>
                              )}
                              <Button 
                                variant="outline" 
                                onClick={() => handleNewImageSet(item)}
                                disabled={
                                  processingNewImageSet.has(item.number) || 
                                  (isReplaceImagesInProgress && checkForJpgoldset(item.number) === false)
                                }
                                className="whitespace-nowrap text-sm w-full justify-center"
                                size="sm"
                              >
                                {getButtonText(item)}
                              </Button>
                            </div>
                            <div className="flex gap-1 justify-end">
                              {item.image?.savedVersions?.map((version, idx) => (
                                <div 
                                  key={`${version.path}-${idx}`}
                                  className="relative w-[48px] h-[85px] cursor-pointer hover:opacity-80 transition-opacity"
                                  onClick={async () => {
                                    if (swappingImages.has(version.path)) return
                                    try {
                                      setSwappingImages(prev => new Set([...prev, version.path, item.image!.path]))
                                      await swapStoryboardImage({
                                        originalPath: item.image!.path,
                                        thumbnailPath: version.path
                                      })
                                      await fetchProject()
                                    } catch (error) {
                                      console.error('Error swapping images:', error)
                                      toast.error(getUserFriendlyError(error))
                                    } finally {
                                      setSwappingImages(prev => {
                                        const next = new Set(prev)
                                        next.delete(version.path)
                                        next.delete(item.image!.path)
                                        return next
                                      })
                                    }
                                  }}
                                >
                                  <Image 
                                    src={version.url}
                                    alt={`Version ${idx + 1}`}
                                    fill
                                    className={`object-cover rounded-sm border border-gray-200 ${
                                      swappingImages.has(version.path) ? 'opacity-50' : ''
                                    }`}
                                    sizes="48px"
                                  />
                                  {swappingImages.has(version.path) && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="animate-spin h-4 w-4 border-2 border-primary rounded-full border-t-transparent" />
                                    </div>
                                  )}
                                </div>
                              ))}
                              {Array.from({ length: Math.max(0, 3 - (item.image?.savedVersions?.length || 0)) }).map((_, i) => (
                                <div 
                                  key={i} 
                                  className="relative w-[48px] h-[85px] border border-gray-200 rounded-sm bg-gray-50"
                                />
                              ))}
                            </div>
                          </div>
                          
                          <div className="border-t my-2" />
                          
                          <div className="space-y-2">
                            {item.audio?.url ? (
                              <div className="flex items-center gap-2">
                                <AudioPlayer
                                  audioUrl={item.audio.url}
                                  remountKey={audioRemountKeys[item.number]}
                                />
                                
                                {/* Always show Track 1 button */}
                                <Button
                                  variant="outline"
                                  onClick={() => handleTrackSelection(1, item)}
                                  disabled={processingNewAudio.has(item.number)}
                                  className="flex-none text-xs -mt-3 relative"
                                  style={{ width: '90px', height: '70px' }}
                                >
                                  <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${
                                    primaryTrack === 1 ? 'bg-green-500' : 'bg-gray-300'
                                  }`} />
                                  Track 1
                                </Button>
                                
                                {hasTrack2.has(item.number) ? (
                                  <Button
                                    variant="outline"
                                    onClick={() => handleTrackSelection(2, item)}
                                    disabled={processingNewAudio.has(item.number)}
                                    className="flex-none text-xs -mt-3 relative"
                                    style={{ width: '90px', height: '70px' }}
                                  >
                                    <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${
                                      primaryTrack === 2 ? 'bg-green-500' : 'bg-gray-300'
                                    }`} />
                                    Track 2
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    onClick={() => handleNewAudio(item)}
                                    disabled={processingNewAudio.has(item.number) || isReplaceImagesInProgress}
                                    className="flex-none text-xs -mt-3 relative"
                                    style={{ width: '90px', height: '70px' }}
                                  >
                                    {processingNewAudio.has(item.number) ? (
                                      <div className="flex flex-col items-center">
                                        <div className="animate-spin h-4 w-4 border-2 border-primary rounded-full border-t-transparent mb-1" />
                                        <span>Processing</span>
                                      </div>
                                    ) : (
                                      "New Audio"
                                    )}
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <div className="h-[70px] flex items-center justify-center">
                                <p className="text-sm text-muted-foreground">Audio file not found</p>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {items.length > 1 && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-background"
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: -341, behavior: 'smooth' })}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-background"
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: 341, behavior: 'smooth' })}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Slider
                        value={[sliderValue]}
                        onValueChange={handleScrollSliderChange}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                    </>
                  )}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No storyboard images available yet.</p>
                </Card>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="proofs">
            <Card className="p-2 border-0 shadow-none">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-semibold">Proofs</h3>
                {projectStatus?.Proof_Status === "Proofs Complete" && projectStatus?.Audiobook_Status === "Ready to Process Audiobook" ? (
                  <Button 
                    variant="outline"
                    onClick={handleGenerateFinalAudiobook}
                    className="bg-blue-100 text-blue-700 hover:bg-blue-200 hover:text-blue-800 border-blue-200"
                  >
                    Generate Audiobook
                  </Button>
                ) : projectStatus?.Audiobook_Status === "Audiobook Complete" && (
                  <Button 
                    variant="outline"
                    disabled
                    className="bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 border-green-200"
                  >
                    Audiobook Ready
                  </Button>
                )}
              </div>
              {videos.length > 0 ? (
                <div className="relative">
                  <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto pb-4 scroll-smooth"
                  >
                    {videos.map((video, index) => (
                      <Card key={index} className="flex-shrink-0 w-[341px]">
                        <CardContent className="p-2 space-y-2">
                          <div className="flex flex-col space-y-2">
                            <div className="relative w-full h-[597px] overflow-hidden rounded">
                              <video 
                                className="w-full h-full object-cover" 
                                controlsList="nodownload" 
                                disablePictureInPicture
                                id={`video-${index}`}
                              >
                                <source src={video.url} type="video/mp4" />
                                Your browser does not support the video tag.
                              </video>
                            </div>
                            <div className="flex justify-center">
                              <div className="flex items-center space-x-2 bg-gray-100 p-2 rounded-md w-full">
                                <Button 
                                  variant="outline" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => {
                                    const video = document.getElementById(`video-${index}`) as HTMLVideoElement;
                                    if (video.paused) {
                                      video.play();
                                    } else {
                                      video.pause();
                                    }
                                  }}
                                >
                                  <Play className="h-4 w-4" />
                                </Button>
                                <div className="flex-1">
                                  <input 
                                    type="range" 
                                    className="w-full" 
                                    min="0" 
                                    max="100" 
                                    defaultValue="0"
                                    onChange={(e) => {
                                      const video = document.getElementById(`video-${index}`) as HTMLVideoElement;
                                      if (video) {
                                        const time = (parseInt(e.target.value) / 100) * video.duration;
                                        video.currentTime = time;
                                      }
                                    }}
                                    onMouseDown={() => {
                                      const video = document.getElementById(`video-${index}`) as HTMLVideoElement;
                                      if (video) video.pause();
                                    }}
                                    onMouseUp={() => {
                                      const video = document.getElementById(`video-${index}`) as HTMLVideoElement;
                                      if (video && !video.paused) video.play();
                                    }}
                                  />
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => {
                                    const video = document.getElementById(`video-${index}`) as HTMLVideoElement;
                                    if (video) {
                                      video.muted = !video.muted;
                                    }
                                  }}
                                >
                                  <Volume2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {videos.length > 1 && (
                    <>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-background"
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: -341, behavior: 'smooth' })}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-background"
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: 341, behavior: 'smooth' })}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Slider
                        value={[sliderValue]}
                        onValueChange={handleScrollSliderChange}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                    </>
                  )}
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No audiobook videos available yet.</p>
                </Card>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="audiobook">
            <Card className="p-2 border-0 shadow-none">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-2xl font-semibold">Audiobook Stream</h3>
                {projectStatus?.Audiobook_Status === "Audiobook Complete" && (
                  <Button
                    variant="outline"
                    disabled
                    className="bg-green-100 text-green-700 hover:bg-green-200 hover:text-green-800 border-green-200"
                  >
                    {hlsPath ? "Stream Available" : "Stream Processing"}
                  </Button>
                )}
              </div>
              {projectStatus?.Audiobook_Status === "Audiobook Complete" ? (
                <div className="relative">
                  <div className="flex gap-4 overflow-x-auto pb-4 scroll-smooth">
                    <Card className="flex-shrink-0 w-[341px]">
                      <CardContent className="p-2 space-y-2">
                        <div className="flex flex-col space-y-2">
                          <div className="relative w-full h-[597px] overflow-hidden rounded">
                            {hlsPath && !isPreparingHls ? (
                              <div className="relative w-full h-full">
                                <video 
                                  ref={hlsVideoRef}
                                  className="w-full h-full object-cover" 
                                  playsInline
                                  onError={(e) => {
                                    console.error('Video element error:', e);
                                    // Check specific error code
                                    const videoElement = e.target as HTMLVideoElement;
                                    const errorCode = videoElement.error?.code;
                                    const errorMessage = videoElement.error?.message;
                                    
                                    console.error(`Video error code: ${errorCode}, message: ${errorMessage}`);
                                    
                                    // Provide more specific error messages based on the error code
                                    switch(errorCode) {
                                      case 1: // MEDIA_ERR_ABORTED
                                        setHlsLoadError('Playback was aborted. Please try again.');
                                        break;
                                      case 2: // MEDIA_ERR_NETWORK
                                        setHlsLoadError('A network error occurred. Please check your connection and try again.');
                                        break;
                                      case 3: // MEDIA_ERR_DECODE
                                        setHlsLoadError('The video cannot be decoded. This may be due to a corrupted file.');
                                        break;
                                      case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
                                        setHlsLoadError('The video format is not supported by your browser or the stream is unavailable.');
                                        break;
                                      default:
                                        setHlsLoadError('Error loading video stream. Please try refreshing the page.');
                                    }
                                  }}
                                  onCanPlay={() => {
                                    // Reset error state when video can play
                                    setHlsLoadError(null);
                                    console.log('Video can now play');
                                  }}
                                >
                                  <source src={hlsPath} type="application/vnd.apple.mpegurl" />
                                  Your browser doesn&apos;t support HLS playback.
                                </video>
                                {/* Add diagnostic information for developers */}
                                {process.env.NODE_ENV === 'development' && (
                                  <div className="absolute top-0 right-0 bg-black bg-opacity-75 text-white text-xs p-1 rounded">
                                    HLS Path: {hlsPath.substring(0, 30)}...
                                  </div>
                                )}
                                <div className="absolute bottom-0 left-0 right-0 p-2 text-center text-xs text-white bg-black bg-opacity-50">
                                  {hlsLoadError && (
                                    <span className="text-yellow-300">{hlsLoadError}</span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center h-full bg-gray-200">
                                <div className="text-center">
                                  <div className="animate-spin h-8 w-8 border-4 border-blue-500 rounded-full border-t-transparent mx-auto mb-4"></div>
                                  <p className="text-gray-500 max-w-xs">
                                    {hlsLoadError ? hlsLoadError : (isPreparingHls ? "Preparing video stream..." : "Loading stream... This may take a moment.")}
                                  </p>
                                  {/* Added refresh button for when stream fails to load */}
                                  {hlsLoadError && (
                                    <Button 
                                      variant="outline" 
                                      className="mt-4"
                                      onClick={() => {
                                        setHlsLoadError(null);
                                        setHlsPath(null);
                                        fetchHlsPath();
                                      }}
                                    >
                                      Try Again
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Custom player controls - similar to Proofs tab */}
                          {hlsPath && !isPreparingHls && !hlsLoadError && (
                            <div className="flex justify-center">
                              <div className="flex items-center space-x-2 bg-gray-100 p-2 rounded-md w-full">
                                <Button 
                                  variant="outline" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => {
                                    const video = hlsVideoRef.current;
                                    if (!video) return;
                                    
                                    if (video.paused) {
                                      video.play();
                                    } else {
                                      video.pause();
                                    }
                                  }}
                                >
                                  {isHlsPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                </Button>
                                <div className="flex-1">
                                  <input 
                                    type="range" 
                                    className="w-full" 
                                    min="0" 
                                    max="100" 
                                    value={hlsProgress}
                                    onChange={(e) => {
                                      const video = hlsVideoRef.current;
                                      if (!video) return;
                                      
                                      const time = (parseInt(e.target.value) / 100) * video.duration;
                                      video.currentTime = time;
                                      setHlsProgress(parseInt(e.target.value));
                                    }}
                                    onMouseDown={() => {
                                      const video = hlsVideoRef.current;
                                      if (video) video.pause();
                                    }}
                                    onMouseUp={() => {
                                      const video = hlsVideoRef.current;
                                      if (video && isHlsPlaying) video.play();
                                    }}
                                  />
                                </div>
                                <Button 
                                  variant="outline" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={() => {
                                    const video = hlsVideoRef.current;
                                    if (!video) return;
                                    
                                    video.muted = !video.muted;
                                    setIsHlsMuted(!isHlsMuted);
                                  }}
                                >
                                  {isHlsMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                <Card className="p-8 text-center">
                  <p className="text-muted-foreground">No published stream available yet.</p>
                </Card>
              )}
            </Card>
          </TabsContent>
        </div>
      </Tabs>

      <Dialog open={isTextDialogOpen} onOpenChange={setIsTextDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Storyboard Text</DialogTitle>
          </DialogHeader>
          <div className="p-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
            {selectedText}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Please type <strong>{project?.project_name}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Type project name to confirm"
              value={confirmProjectName}
              onChange={(e) => setConfirmProjectName(e.target.value)}
            />
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={confirmProjectName !== project?.project_name || isDeleting}
                onClick={handleDeleteProject}
              >
                {isDeleting ? 'Deleting...' : 'Delete Project'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Update your project details. The EPUB file cannot be changed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Project Name *</label>
              <Input
                value={editFormData.project_name}
                onChange={(e) => setEditFormData({ ...editFormData, project_name: e.target.value })}
                placeholder="Enter project name"
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Book Title *</label>
              <Input
                value={editFormData.book_title}
                onChange={(e) => setEditFormData({ ...editFormData, book_title: e.target.value })}
                placeholder="Enter book title"
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Author *</label>
              <Input
                value={editFormData.author_name}
                onChange={(e) => setEditFormData({ ...editFormData, author_name: e.target.value })}
                placeholder="Enter author name"
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value.slice(0, 120) })}
                placeholder="Enter project description (max 120 characters)"
                maxLength={120}
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Update Cover Image</label>
              <p className="text-sm text-gray-500 mb-2">Optional. JPG, PNG, or WebP files supported</p>
              <div className="flex flex-col gap-2">
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    
                    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
                    if (!validTypes.includes(file.type)) {
                      toast.error('Please upload a valid image file (JPG, PNG, or WebP)');
                      return;
                    }
                    
                    setSelectedNewCover(file);
                  }}
                  disabled={isEditing}
                  className="h-[40px] text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 
                            file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 
                            hover:file:bg-violet-100"
                />
              </div>
              {selectedNewCover && (
                <p className="text-sm text-green-600 mt-2">
                  Selected new cover: {selectedNewCover.name}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={handleEditProject}
                disabled={isEditing || !editFormData.project_name || !editFormData.book_title}
              >
                {isEditing ? 'Updating Project...' : 'Update Project'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add the confirmation dialog */}
      <Dialog open={confirmReplaceItem !== null} onOpenChange={(open) => !open && setConfirmReplaceItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace Images</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>
              The Replace Images button will save a copy of the primary image, delete all of the thumbnails, 
              and generate a new set of 4 images to view. The only file that can be recovered is the original 
              primary image. Are you sure you want to proceed?
            </p>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmReplaceItem(null);
              }}
            >
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  savePreferenceToCookie();
                  const item = confirmReplaceItem;
                  setConfirmReplaceItem(null);
                  if (item) processImageAction(item);
                }}
              >
                Proceed & Don&apos;t Show Again
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const item = confirmReplaceItem;
                  setConfirmReplaceItem(null);
                  if (item) processImageAction(item);
                }}
              >
                Proceed
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Voice Selection Confirmation Dialog */}
      <Dialog open={isVoiceConfirmOpen} onOpenChange={setIsVoiceConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Voice Selection</DialogTitle>
            <DialogDescription>
              Are you sure you want to use this voice for your audiobook? This will be used for all narration.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-500">
              Selected Voice: <span className="font-medium">{selectedVoice ? voices.find(v => v.voice_id === selectedVoice)?.name : 'None'}</span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVoiceConfirmOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={saveSelectedVoice} 
              disabled={isUpdatingVoice}
            >
              {isUpdatingVoice ? 'Saving...' : "I'm Sure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pronunciation Corrections Dialog */}
      <Dialog open={isViewCorrectionsOpen} onOpenChange={setIsViewCorrectionsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Name Pronunciation Corrections</DialogTitle>
            <DialogDescription>
              These corrections will be used when generating the audiobook.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 max-h-[60vh] overflow-y-auto">
            {pronunciationCorrections.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-4 font-medium text-sm border-b pb-2">
                  <div>Original Name</div>
                  <div>Corrected Pronunciation</div>
                  <div>IPA Pronunciation</div>
                  <div></div>
                </div>
                {pronunciationCorrections.map((correction, index) => (
                  <div key={index} className="grid grid-cols-4 gap-4 text-sm border-b pb-2">
                    <div>{correction.originalName}</div>
                    <div>{correction.correctedPronunciation}</div>
                    <div><code className="bg-gray-100 px-1 py-0.5 rounded">{correction.ipaPronunciation}</code></div>
                    <div className="flex justify-end">
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => deletePronunciationCorrection(correction.originalName)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-500">No pronunciation corrections have been saved yet.</p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setIsViewCorrectionsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Storyboard Generation Confirmation Dialog */}
      <Dialog open={isStoryboardConfirmOpen} onOpenChange={setIsStoryboardConfirmOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Confirm Storyboard Generation</DialogTitle>
            <DialogDescription>
              Please review the voice and pronunciation corrections that will be used for your storyboard.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-6">
            {/* Voice Information */}
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Selected Voice</h3>
              <div className="p-3 bg-blue-50 rounded-md">
                <p className="font-medium">{project?.voice_name || 'No voice selected'}</p>
                {project?.voice_id && voices.find(v => v.voice_id === project.voice_id)?.labels && (
                  <div className="mt-2 text-sm text-gray-600">
                    {Object.entries(voices.find(v => v.voice_id === project.voice_id)?.labels || {}).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="capitalize">{key}:</span>
                        <span>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            {/* Pronunciation Corrections */}
            <div className="space-y-2">
              <h3 className="text-lg font-medium">Pronunciation Corrections</h3>
              <div className="p-3 bg-blue-50 rounded-md max-h-[30vh] overflow-y-auto">
                {pronunciationCorrections.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4 font-medium text-sm border-b pb-2">
                      <div>Original Name</div>
                      <div>Corrected Pronunciation</div>
                      <div>IPA Pronunciation</div>
                    </div>
                    {pronunciationCorrections.map((correction, index) => (
                      <div key={index} className="grid grid-cols-3 gap-4 text-sm border-b pb-2">
                        <div>{correction.originalName}</div>
                        <div>{correction.correctedPronunciation}</div>
                        <div><code className="bg-gray-100 px-1 py-0.5 rounded">{correction.ipaPronunciation}</code></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-gray-500">No pronunciation corrections have been saved.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setIsStoryboardConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={processStoryboardGeneration}>
              Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}




