"use client"

import { useRef, useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChevronLeft, ChevronRight, FileText } from "lucide-react"
import { toast } from 'sonner'
import { 
  getSignedImageUrls, 
  deleteProjectFile, 
  saveAudioHistory, 
  swapStoryboardImage, 
  uploadProjectFile, 
  updateProjectStatus, 
  getProjectStatus, 
  deleteProjectFolder,
  renameImageToOldSet
} from '@/app/actions/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { AudioPlayer } from '@/components/AudioPlayer'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Input } from "@/components/ui/input"
import Image from 'next/image'
import { Textarea } from "@/components/ui/textarea"
import { sendCommand } from '@/app/actions/remote-commands'

interface Project {
  id: string
  project_name: string
  book_title: string
  description: string
  status: string
  epub_file_path: string
  cover_file_path: string
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
  Audiobook_Status: string;
}

// Helper functions for button states
function getInitialTab(status: ProjectStatus | null) {
  if (!status) return 'intake'

  const isIntakeComplete = status.Ebook_Prep_Status === "Ebook Processing Complete"
  const isStoryboardComplete = status.Storyboard_Status === "Storyboard Complete"
  const isAudiobookComplete = status.Audiobook_Status === "Audiobook Complete"

  if (isIntakeComplete && isStoryboardComplete && isAudiobookComplete) {
    return 'audiobook'
  }

  if (!isIntakeComplete) return 'intake'
  if (!isStoryboardComplete) return 'storyboard'
  if (!isAudiobookComplete) return 'audiobook'

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

function getStoryboardButtonState(status: string | undefined) {
  switch (status) {
    case "Ready to Process Storyboard":
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
      return { enabled: true, label: "Generate Audiobook" }
    case "Waiting for Storyboard Completion":
      return { enabled: false, label: "Generate Audiobook" }
    case "Audiobook Processing, Please Wait":
      return { enabled: false, label: "Audiobook Processing..." }
    case "Audiobook Complete":
      return { enabled: false, label: "Audiobook Complete" }
    default:
      return { enabled: false, label: "Generate Audiobook" }
  }
}

// Define a type for video files
interface VideoFile {
  url: string
  path: string
}

export default function ProjectDetail() {
  const params = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<StoryboardItem[]>([])
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [confirmProjectName, setConfirmProjectName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const router = useRouter()
  const [generatingAudio, setGeneratingAudio] = useState<Set<number>>(new Set())
  const [primaryTrack, setPrimaryTrack] = useState<1 | 2>(1)
  const [hasSecondTrack, setHasSecondTrack] = useState(false)
  const [switchingTrack, setSwitchingTrack] = useState<1 | 2 | null>(null)
  const [swappingImages, setSwappingImages] = useState<Set<string>>(new Set())
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editFormData, setEditFormData] = useState({
    project_name: '',
    book_title: '',
    description: '',
  })
  const [selectedNewCover, setSelectedNewCover] = useState<File | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null)
  const [videos, setVideos] = useState<VideoFile[]>([])
  const [processingNewImageSet, setProcessingNewImageSet] = useState<Set<number>>(new Set())

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

      // Step 1: Get signed URLs for all files
      const signedFiles = await getSignedImageUrls(session.user.id, project.id)
      
      // Log all files first
      // console.log('\n=== All Files ===')
      // console.log('Total files:', signedFiles.length)
      // signedFiles.forEach(file => console.log('File:', file.path))

      // Filter signed files based on file type and path
      const storyboardFiles = signedFiles.filter(file => {
        const isMatch = file.type === 'image' &&
          file.path.includes('/temp/') &&
          (file.path.match(/.*?chapter\d+_\d+_image\d+(?:_sbsave\d+)?\.jpg$/) ||
           file.path.match(/.*?chapter\d+_\d+_image\d+\.jpgoldset$/))
        if (isMatch) {
          console.log('DEBUG: Matched storyboard file:', file.path)
          if (file.path.endsWith('.jpgoldset')) {
            console.log('DEBUG: Found jpgoldset file during filtering:', file.path)
          }
        }
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

      // Log filtered files
      console.log('\n=== Filtered Files ===')
      console.log('Storyboard files:', storyboardFiles.length)
      console.log('Audio files:', audioFiles.length)
      console.log('Text files:', textFiles.length)

      const videoFiles = signedFiles.filter(file => 
        file.path.startsWith(`${session.user.id}/${project.id}/output/`) && file.type === 'video'
      )

      setVideos(videoFiles.map(file => ({ url: file.url, path: file.path })))

      // Handle cover file
      const coverFile = signedFiles.find(file => file.path === project.cover_file_path)
      if (coverFile) {
        setCoverUrl(coverFile.url)
      }

      // First, let's log all storyboard files for debugging
      console.log('\n=== DEBUG: Initial File Load ===')
      console.log('DEBUG: Total files:', signedFiles.length)
      console.log('\n=== DEBUG: Storyboard Files ===')
      storyboardFiles.forEach(file => {
        console.log('DEBUG: File:', file.path)
        if (file.path.endsWith('.jpgoldset')) {
          console.log('🎯 DEBUG: Found jpgoldset file during initial load:', file.path)
        }
      })

      // Group storyboard items
      const groupedItems = storyboardFiles.reduce<Record<number, StoryboardItem>>((acc, file) => {
        // Extract the base name and sequence number from the full path
        const match = file.path.match(/chapter\d+_\d+_image(\d+)(?:_sbsave\d+)?\.jpg$/) ||
                     file.path.match(/chapter\d+_\d+_image(\d+)\.jpgoldset$/)
        if (!match) {
          console.log('DEBUG: Skipping file - no sequence number:', file.path)
          return acc
        }

        const number = parseInt(match[1])
        if (isNaN(number)) {
          console.log('DEBUG: Skipping file - invalid sequence number:', file.path)
          return acc
        }

        // Initialize the item if it doesn't exist
        if (!acc[number]) {
          acc[number] = {
            number,
            image: { 
              url: '', 
              path: '', 
              savedVersions: []
            }
          }

          // Find and add corresponding text file
          const textFile = textFiles.find(tf => 
            tf.path.match(new RegExp(`chapter\\d+_\\d+_chunk${number}\\.txt$`))
          )
          if (textFile?.content) {
            acc[number].text = {
              content: textFile.content,
              path: textFile.path
            }
          }

          // Find and add corresponding audio file
          const audioFile = audioFiles.find(af => 
            af.path.match(new RegExp(`chapter\\d+_\\d+_audio${number}(?:_sbsave)?\\.mp3$`))
          )
          if (audioFile) {
            acc[number].audio = {
              url: audioFile.url,
              path: audioFile.path
            }

            // Check for saved audio version
            const savedAudioFile = audioFiles.find(af => 
              af.path.match(new RegExp(`chapter\\d+_\\d+_audio${number}_sbsave\\.mp3$`))
            )
            if (savedAudioFile) {
              acc[number].audio.savedVersion = {
                url: savedAudioFile.url,
                path: savedAudioFile.path
              }
            }
          }
        }

        const imageData = acc[number]?.image
        if (!imageData) return acc

        // Check if this is a jpgoldset file
        if (file.path.endsWith('.jpgoldset')) {
          console.log('DEBUG: Adding jpgoldset file to item:', {
            number,
            path: file.path
          })
          imageData.oldsetVersion = {
            url: file.url,
            path: file.path
          }
        } 
        // Check if this is a saved version
        else if (file.path.includes('_sbsave')) {
          if (!imageData.savedVersions) {
            imageData.savedVersions = []
          }
          
          imageData.savedVersions.push({
            url: file.url,
            path: file.path
          })
          
          // Sort savedVersions by sbsave number
          imageData.savedVersions.sort((a, b) => {
            const aMatch = a.path.match(/_sbsave(\d+)\.jpg$/)
            const bMatch = b.path.match(/_sbsave(\d+)\.jpg$/)
            const aNum = aMatch ? parseInt(aMatch[1]) : 0
            const bNum = bMatch ? parseInt(bMatch[1]) : 0
            return aNum - bNum
          })
        }
        // This is a main image
        else {
          imageData.url = file.url
          imageData.path = file.path
        }

        return acc
      }, {})

      // Log the grouped items for debugging
      console.log('\n=== DEBUG: Grouped Items ===')
      Object.entries(groupedItems).forEach(([number, item]) => {
        console.log(`\nItem ${number}:`)
        console.log('Main Image:', item.image?.path)
        console.log('Oldset Version:', item.image?.oldsetVersion?.path)
        console.log('Saved Versions:', item.image?.savedVersions?.map(v => v.path))
      })

      // Clean and validate grouped items - only include items that have all required components
      const validItems = Object.values(groupedItems)
        .filter(item => 
          item.image?.url && 
          item.image?.path
        )
        .sort((a, b) => a.number - b.number)

      console.log('\n=== DEBUG: Valid Items ===')
      validItems.forEach(item => {
        console.log(`\nItem ${item.number}:`)
        console.log('Main Image:', item.image?.path)
        console.log('Oldset Version:', item.image?.oldsetVersion?.path)
        console.log('Saved Versions:', item.image?.savedVersions?.map(v => v.path))
      })

      setHasSecondTrack(validItems.some(item => item.audio?.savedVersion))
      setItems(validItems)
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

  // Update polling to start after initial fetch
  useEffect(() => {
    if (!project) return

    let isPolling = true // Add flag to prevent race conditions

    // Start polling every 5 seconds
    const interval = setInterval(async () => {
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
            console.log('🔄 Status changed from processing to complete, checking for jpgoldset files...')
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
      clearInterval(interval)
    }
  }, [project, projectStatus?.Storyboard_Status, fetchProject])

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

  const handleNewAudio = async (item: StoryboardItem) => {
    try {
      if (generatingAudio.has(item.number)) return
      
      if (!item.audio?.path) throw new Error('No audio path found')
      
      setGeneratingAudio(prev => new Set(prev).add(item.number))

      // Call server action to handle all R2 operations
      await saveAudioHistory({
        originalPath: item.audio.path
      })

      setHasSecondTrack(true)
      setPrimaryTrack(2)
      
      await fetchProject()
    } catch (error) {
      console.error('Error in handleNewAudio:', error)
      toast.error(getUserFriendlyError(error))
    } finally {
      setGeneratingAudio(prev => {
        const next = new Set(prev)
        next.delete(item.number)
        return next
      })
    }
  }

  const handleTrackSelection = async (track: 1 | 2, item: StoryboardItem) => {
    try {
      if (!hasSecondTrack || track === primaryTrack) return
      
      if (!item.audio?.path) throw new Error('No audio path found')

      setSwitchingTrack(track)

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Create paths
      const pathParts = item.audio.path.split('.')
      const ext = pathParts.pop()
      const basePath = pathParts.join('.')
      const sbsavePath = `${basePath}_sbsave.${ext}`
      const tempPath = `${basePath}_temp.${ext}`

      // Step 1: Move original to temp
      const { error: moveToTempError } = await supabase.storage
        .from('projects')
        .move(item.audio.path, tempPath)

      if (moveToTempError) throw moveToTempError

      // Step 2: Move sbsave to original
      const { error: moveToOriginalError } = await supabase.storage
        .from('projects')
        .move(sbsavePath, item.audio.path)

      if (moveToOriginalError) throw moveToOriginalError

      // Step 3: Move temp to sbsave
      const { error: moveToSbsaveError } = await supabase.storage
        .from('projects')
        .move(tempPath, sbsavePath)

      if (moveToSbsaveError) throw moveToSbsaveError

      setPrimaryTrack(track)
      await fetchProject()
    } catch (error) {
      console.error('Error in handleTrackSelection:', error)
      toast.error(getUserFriendlyError(error))
    } finally {
      setSwitchingTrack(null)
    }
  }

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
          Audiobook_Status: "Waiting for Storyboard Completion"
        }
      })

      // Force immediate status refresh
      await fetchProject()

      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "Mike Langlois" -ti "Walker" -vn "Abe" -l 2 -si`
      await sendCommand(command)
      toast.success('Processing started')
    } catch (error) {
      console.error('Error processing epub:', error)
      toast.error('Failed to start processing')
    }
  }

  const handleGenerateStoryboard = async () => {
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
          Current_Status: "Storyboard is Processing",
          Ebook_Prep_Status: "Ebook Processing Complete",
          Storyboard_Status: "Processing Storyboard, Please Wait",
          Audiobook_Status: "Waiting for Storyboard Completion"
        }
      })

      await fetchProject()

      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "Mike Langlois" -ti "Walker" -vn "Abe" -l 2 -ss`
      await sendCommand(command)
      toast.success('Generation started')
    } catch (error) {
      console.error('Error generating storyboard:', error)
      toast.error('Failed to start generation')
    }
  }

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
          Audiobook_Status: "Audiobook Processing, Please Wait"
        }
      })

      await fetchProject()

      const command = `python3 b2vp* -f "${epubFilename}" -uid ${session.user.id} -pid ${project.id} -a "Mike Langlois" -ti "Walker" -vn "Abe" -l 2 -sb`
      await sendCommand(command)
      toast.success('Generation started')
    } catch (error) {
      console.error('Error generating audiobook:', error)
      toast.error('Failed to start generation')
    }
  }

  const handleNewImageSet = async (item: StoryboardItem) => {
    if (!item.image?.path || processingNewImageSet.has(item.number)) return
    
    try {
      setProcessingNewImageSet(prev => new Set(prev).add(item.number))

      // Extract the image number from the path to verify we're processing the correct image
      const imageMatch = item.image.path.match(/image(\d+)\.jpg$/)
      if (!imageMatch || parseInt(imageMatch[1]) !== item.number) {
        throw new Error('Image number mismatch')
      }

      // Rename current image to .jpgoldset
      await renameImageToOldSet({
        imagePath: item.image.path
      })

      // Trigger storyboard generation
      await handleGenerateStoryboard()
    } catch (error) {
      console.error('Error handling new image set:', error)
      toast.error(getUserFriendlyError(error))
      setProcessingNewImageSet(prev => {
        const next = new Set(prev)
        next.delete(item.number)
        return next
      })
    }
  }

  const checkForJpgoldset = (itemNumber: number): boolean => {
    console.log(`\n🔍 DEBUG: Checking for jpgoldset files for item ${itemNumber}:`);
    
    // Get the current item's image path
    const currentItem = items.find(i => i.number === itemNumber);
    if (!currentItem?.image?.path) {
      console.log('❌ DEBUG: No image path found for item:', itemNumber);
      return false;
    }

    // First check if the item has an oldsetVersion directly
    if (currentItem.image.oldsetVersion?.path) {
      console.log('✅ DEBUG: Found oldsetVersion directly:', currentItem.image.oldsetVersion.path);
      return true;
    }

    // Get the current image path and extract the base name (everything before .jpg)
    const currentPath = currentItem.image.path;
    const baseFilename = currentPath.replace(/\.jpg$/, '');
    
    console.log('DEBUG: Looking for jpgoldset match:');
    console.log('- Current path:', currentPath);
    console.log('- Base filename:', baseFilename);

    // Look for any file that has the same base name but with .jpgoldset extension
    const hasOldSet = items.some(item => {
      if (!item.image?.path) return false;
      
      const checkPath = item.image.path;
      console.log('\nChecking against file:', checkPath);
      
      // First verify it's a jpgoldset file
      if (!checkPath.endsWith('.jpgoldset')) {
        console.log('- Skipping: Not a jpgoldset file');
        return false;
      }

      // Get base filename of the jpgoldset file
      const checkBaseFilename = checkPath.replace(/\.jpgoldset$/, '');
      
      console.log('- Base filename comparison:');
      console.log('  Original:', baseFilename);
      console.log('  Checking:', checkBaseFilename);
      console.log('  Equal?:', checkBaseFilename === baseFilename);

      return checkBaseFilename === baseFilename;
    });

    console.log('\nFinal result:', hasOldSet ? '✅ Found match' : '❌ No match found');
    return hasOldSet;
  };

  const getButtonText = (item: StoryboardItem): string => {
    console.log('\n=== DEBUG: getButtonText called ===')
    console.log('DEBUG: For item number:', item.number)
    
    if (processingNewImageSet.has(item.number)) {
      console.log('DEBUG: Item is processing:', item.number)
      return 'Processing'
    }
    
    const hasJpgoldset = checkForJpgoldset(item.number)
    console.log('DEBUG: Final button text:', hasJpgoldset ? 'Revert Image Set' : 'New Image Set')
    return hasJpgoldset ? 'Revert Image Set' : 'New Image Set'
  }

  if (loading) return <div>Loading...</div>
  if (!project) return <div>Project not found</div>

  return (
    <div className="container mx-auto p-4 space-y-8">
      <div className="flex items-start gap-6">
        {/* Cover Image - reduced to 50% size */}
        {coverUrl && (
          <div className="relative w-[70px] h-[105px] flex-shrink-0">
            <Image
              src={coverUrl}
              alt={`Cover for ${project?.book_title}`}
              fill
              className="object-cover rounded-md"
              sizes="70px"
              priority
            />
          </div>
        )}

        {/* Project Info and Actions */}
        <div className="flex flex-1 justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{project?.project_name}</h1>
            <p className="text-sm">
              <span className="font-medium">Book: </span>
              <span className="text-gray-700">{project?.book_title}</span>
            </p>
            <p className="text-sm">
              <span className="font-medium">Description: </span>
              <span className="text-gray-700">{project?.description}</span>
            </p>
            {projectStatus && (
              <p className="text-sm">
                <span className="font-medium">Project Status: </span>
                <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md">
                  {projectStatus.Current_Status}
                </span>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsEditDialogOpen(true)}>
              Edit Project
            </Button>
            <Button variant="destructive" onClick={() => setIsDeleteDialogOpen(true)}>
              Delete Project
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue={getInitialTab(projectStatus)} className="w-full">
        <TabsList className="flex w-full bg-gray-100 p-1 rounded-lg">
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
            value="audiobook"
            className={`flex-1 rounded-md px-6 py-2.5 font-medium text-sm transition-all data-[state=active]:bg-white data-[state=active]:text-green-600 data-[state=active]:shadow-sm ${
              projectStatus?.Audiobook_Status === "Audiobook Complete" ? 'bg-green-50' : ''
            }`}
          >
            Audiobook
          </TabsTrigger>
        </TabsList>

        <div className="mt-0.5 bg-white rounded-lg p-6 shadow-sm">
          <TabsContent value="intake">
            <Card className="p-6 border-0 shadow-none">
              {projectStatus && (
                <div className="mb-3">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md inline-block text-sm">
                    Status: {projectStatus.Ebook_Prep_Status}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center mb-6">
                <p className="text-3xl font-bold">Intake Tab Here</p>
                <Button 
                  variant="outline"
                  onClick={handleProcessEpub}
                  disabled={!getIntakeButtonState(projectStatus?.Ebook_Prep_Status).enabled}
                >
                  {getIntakeButtonState(projectStatus?.Ebook_Prep_Status).label}
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="storyboard">
            <Card className="p-6 border-0 shadow-none">
              {projectStatus && (
                <div className="mb-3">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md inline-block text-sm">
                    Status: {projectStatus.Storyboard_Status}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-semibold">Storyboard</h3>
                <Button 
                  variant="outline"
                  onClick={handleGenerateStoryboard}
                  disabled={!getStoryboardButtonState(projectStatus?.Storyboard_Status).enabled}
                >
                  {getStoryboardButtonState(projectStatus?.Storyboard_Status).label}
                </Button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center min-h-[200px]">
                  <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent"></div>
                </div>
              ) : items.length > 0 ? (
                <div className="relative">
                  <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto pb-4 scroll-smooth"
                  >
                    {items.map((item) => {
                      if (!item.image?.url) return null
                      return (
                        <Card key={item.number} className="flex-shrink-0 w-[341px]">
                          <CardContent className="p-2 space-y-2">
                            <div className="relative">
                              {item.image?.url && (
                                <div className="relative w-full h-[597px]">
                                  <Image 
                                    src={item.image.url} 
                                    alt={`Storyboard ${item.number}`}
                                    fill
                                    className={`object-cover rounded ${
                                      swappingImages.has(item.image.path) ? 'opacity-50' : ''
                                    }`}
                                    priority={item.number <= 2}
                                    sizes="(max-width: 768px) 100vw, 341px"
                                  />
                                  {swappingImages.has(item.image.path) && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <div className="animate-spin h-8 w-8 border-4 border-primary rounded-full border-t-transparent" />
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                                {item.number}
                              </div>
                            </div>
                            
                            <div className="flex gap-4 items-center mt-2">
                              <div className="flex flex-col gap-2">
                                {item.text?.content && (
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedText(item.text?.content || null)
                                      setIsTextDialogOpen(true)
                                    }}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <FileText className="h-4 w-4" />
                                    View Text
                                  </Button>
                                )}
                                <Button 
                                  variant="outline" 
                                  onClick={() => handleNewImageSet(item)}
                                  disabled={processingNewImageSet.has(item.number)}
                                  className="whitespace-nowrap text-sm"
                                >
                                  {getButtonText(item)}
                                </Button>
                              </div>
                              <div className="flex gap-2 flex-1 justify-end">
                                {item.image?.savedVersions?.map((version, idx) => (
                                  <div 
                                    key={`${version.path}-${idx}`}
                                    className="relative w-[55px] h-[96px] cursor-pointer hover:opacity-80 transition-opacity"
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
                                      sizes="55px"
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
                                    className="relative w-[55px] h-[96px] border border-gray-200 rounded-sm bg-gray-50"
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
                                  />
                                  <Button
                                    variant="outline"
                                    onClick={() => handleTrackSelection(1, item)}
                                    disabled={switchingTrack !== null}
                                    className="flex-none text-xs -mt-3 relative"
                                    style={{ width: '90px', height: '70px' }}
                                  >
                                    <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${
                                      primaryTrack === 1 ? 'bg-green-500' : 'bg-gray-300'
                                    }`} />
                                    {switchingTrack === 1 ? 'Waiting...' : 'Track 1'}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => handleNewAudio(item)}
                                    disabled={generatingAudio.has(item.number) || switchingTrack !== null}
                                    className="flex-none text-xs -mt-3 relative"
                                    style={{ width: '90px', height: '70px' }}
                                  >
                                    {generatingAudio.has(item.number)
                                      ? 'Working...'
                                      : 'New Audio'
                                    }
                                  </Button>
                                </div>
                              ) : (
                                <div className="h-[70px] flex items-center justify-center">
                                  <p className="text-sm text-muted-foreground">Audio file not found</p>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
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

          <TabsContent value="audiobook">
            <Card className="p-6 border-0 shadow-none">
              {projectStatus && (
                <div className="mb-3">
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md inline-block text-sm">
                    Status: {projectStatus.Audiobook_Status}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-semibold">Audiobook</h3>
                <Button 
                  variant="outline"
                  onClick={handleGenerateAudiobook}
                  disabled={!getAudiobookButtonState(projectStatus?.Audiobook_Status).enabled}
                >
                  {getAudiobookButtonState(projectStatus?.Audiobook_Status).label}
                </Button>
              </div>
              {videos.length > 0 ? (
                <div className="relative">
                  <div
                    ref={scrollContainerRef}
                    className="flex gap-4 overflow-x-auto pb-4 scroll-smooth"
                  >
                    {videos.map((video, index) => (
                      <Card key={index} className="flex-shrink-0 w-[270px]">
                        <CardContent className="p-2 space-y-2">
                          <div className="relative w-full h-[480px]">
                            <video controls className="w-full h-full object-cover rounded">
                              <source src={video.url} type="video/mp4" />
                              Your browser does not support the video tag.
                            </video>
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
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: -270, behavior: 'smooth' })}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-background"
                        onClick={() => scrollContainerRef.current?.scrollBy({ left: 270, behavior: 'smooth' })}
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
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                placeholder="Enter project description"
                disabled={isEditing}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Update Cover Image</label>
              <p className="text-sm text-gray-500 mb-2">Optional. JPG, PNG, or WebP files supported</p>
              <div className="mt-1 flex items-center">
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
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
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
    </div>
  )
}


