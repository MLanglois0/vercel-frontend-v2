"use client"

import { useRef, useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ChevronLeft, ChevronRight, FileText } from "lucide-react"
import { toast } from 'sonner'
import { getSignedImageUrls, deleteProjectFile, saveAudioHistory, swapStoryboardImage, uploadProjectFile } from '@/app/actions/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { AudioPlayer } from '@/components/AudioPlayer'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Input } from "@/components/ui/input"
import Image from 'next/image'
import { Textarea } from "@/components/ui/textarea"

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
      version: number
    }[]
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
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editFormData, setEditFormData] = useState({
    project_name: '',
    book_title: '',
    description: '',
  })
  const [selectedNewCover, setSelectedNewCover] = useState<File | null>(null)
  const [isEditing, setIsEditing] = useState(false)

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

      // Get signed URLs from R2 through server action
      const signedFiles = await getSignedImageUrls(session.user.id, project.id)
      
      // Separate cover image from storyboard images
      const coverFile = signedFiles.find(file => 
        file.path === project.cover_file_path
      )
      
      // Filter out the cover image from the storyboard items
      const storyboardFiles = signedFiles.filter(file => 
        file.path !== project.cover_file_path
      )

      // Set cover URL if found
      if (coverFile) {
        setCoverUrl(coverFile.url)
      }

      // Continue with existing grouping logic for storyboard items
      const groupedItems = storyboardFiles.reduce((acc, file) => {
        const number = file.number
        if (!acc[number]) {
          acc[number] = { number }
        }
        
        if (file.type === 'image') {
          if (file.version !== undefined) {
            // This is a saved version
            if (!acc[number].image) {
              acc[number].image = { url: '', path: '', savedVersions: [] }
            }
            if (!acc[number].image.savedVersions) {
              acc[number].image.savedVersions = []
            }
            console.log('Adding saved version:', file)
            acc[number].image.savedVersions.push({
              url: file.url,
              path: file.path,
              version: file.version
            })
          } else {
            // This is the main image
            acc[number].image = {
              ...acc[number].image,
              url: file.url,
              path: file.path,
            }
            console.log('Adding main image:', file)
          }
        }
        if (file.type === 'audio') {
          const match = file.path.match(/(\d+)(?:_sbsave)?\.mp3$/)
          if (match) {
            const audioNumber = parseInt(match[1])
            if (file.path.includes('_sbsave')) {
              if (!acc[audioNumber].audio) acc[audioNumber].audio = { url: '', path: '' }
              acc[audioNumber].audio.savedVersion = { url: file.url, path: file.path }
            } else {
              acc[audioNumber].audio = { 
                ...acc[audioNumber].audio,
                url: file.url, 
                path: file.path 
              }
            }
          }
        }
        if (file.type === 'text' && file.content) {
          // Match number before .txt
          const match = file.path.match(/(\d+)\.txt$/)
          if (match) {
            const textNumber = parseInt(match[1])
            acc[textNumber].text = { content: file.content, path: file.path }
            console.log(`Added text to group ${textNumber}:`, file.path)
          }
        }
        
        return acc
      }, {} as Record<number, StoryboardItem>)

      // Log the initial grouping
      console.log('Initial grouping:', groupedItems)

      // Validate the grouped items
      const cleanedGroupedItems = Object.entries(groupedItems).reduce<Record<number, StoryboardItem>>((acc, [key, value]) => {
        const number = parseInt(key)
        
        if (number === 0) {
          acc[number] = value
          return acc
        }

        // Validate that all required files are present
        if (!value.text) {
          throw new Error(`Missing text file for storyboard item ${number}`)
        }
        if (!value.image) {
          throw new Error(`Missing image file for storyboard item ${number}`)
        }
        if (!value.audio) {
          throw new Error(`Missing audio file for storyboard item ${number}`)
        }

        // Only update hasSecondTrack based on file presence
        if (value.audio.savedVersion) {
          setHasSecondTrack(true)
        }

        acc[number] = value
        return acc
      }, {})

      // Log the final grouping
      console.log('Final cleaned grouping:', cleanedGroupedItems)

      // Convert to array and sort
      const items = Object.entries(cleanedGroupedItems)
        .map(([num, item]) => ({
          ...item,
          number: parseInt(num)
        }))
        .sort((a, b) => a.number - b.number)

      console.log('Final sorted items:', items) // Debug log
      setItems(items)
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

  const handleScrollSliderChange = (value: number[]) => {
    setSliderValue(value[0])
    if (scrollContainerRef.current) {
      const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollLeft = (maxScroll * value[0]) / 100
    }
  }

  // Check if there are any image files
  const hasImages = items.some(item => item.image?.url)

  const handleDeleteProject = async () => {
    if (!project || confirmProjectName !== project.project_name) return
    
    setIsDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Delete all files in the project directory
      const projectPath = `${session.user.id}/${project.id}/`
      
      // Get all files in the project directory
      const { data: files } = await supabase
        .storage
        .from('projects')
        .list(projectPath)

      if (files && files.length > 0) {
        // Delete all files in the directory
        await Promise.all(
          files.map(file => deleteProjectFile(`${projectPath}${file.name}`))
        )
      }

      // Delete project from database
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (error) throw error

      toast.success('Project deleted successfully')
      router.push('/projects')
    } catch (error) {
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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // If a new cover is selected, handle the upload
      let newCoverPath = project.cover_file_path;
      if (selectedNewCover) {
        // Upload new cover
        const { path: coverPath } = await uploadProjectFile(
          selectedNewCover,
          session.user.id,
          project.id
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

      toast.success('Project updated successfully');
      setIsEditDialogOpen(false);
      await fetchProject(); // Refresh the project data
    } catch (error) {
      console.error('Error updating project:', error);
      toast.error(getUserFriendlyError(error));
    } finally {
      setIsEditing(false);
    }
  };

  if (loading) return <div>Loading...</div>
  if (!project) return <div>Project not found</div>

  return (
    <div className="container mx-auto p-4 space-y-8">
      <div className="flex gap-6">
        {coverUrl && (
          <div className="relative w-[140px] h-[210px] flex-shrink-0">
            <Image
              src={coverUrl}
              alt={`Cover for ${project?.book_title}`}
              fill
              className="object-cover rounded-md"
              sizes="140px"
              priority
            />
          </div>
        )}
        <div className="flex-1 space-y-4">
          <h1 className="text-3xl font-bold">{project?.project_name}</h1>
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">{project?.book_title}</h2>
            <div className="flex gap-4 items-center">
              <Badge variant={
                project?.status === 'completed' ? 'default' : 
                project?.status === 'in_progress' ? 'secondary' : 
                'outline'
              }>
                {project?.status}
              </Badge>
              <Button 
                variant="destructive" 
                className="bg-black hover:bg-gray-800"
                onClick={() => setIsDeleteDialogOpen(true)}
              >
                Delete Project
              </Button>
              <Button
                variant="outline"
                className="bg-background hover:bg-gray-100"
                onClick={() => {
                  setEditFormData({
                    project_name: project.project_name,
                    book_title: project.book_title,
                    description: project.description || '',
                  });
                  setIsEditDialogOpen(true);
                }}
              >
                Edit Project
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground">{project?.description}</p>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-2xl font-semibold">Storyboard</h3>
        {hasImages ? (
          <div className="relative">
            <div
              ref={scrollContainerRef}
              className="flex overflow-x-scroll space-x-4 pb-4 scrollbar-hide"
            >
              {items.map((item) => (
                item.image?.url && (
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
                            onClick={() => {
                              console.log("Sending request to the backend")
                            }}
                            className="whitespace-nowrap text-sm"
                          >
                            New Image Set
                          </Button>
                        </div>
                        <div className="flex gap-2 flex-1">
                          {item.image?.savedVersions?.map((version) => (
                            <div 
                              key={version.version} 
                              className="relative w-[55px] h-[96px] cursor-pointer hover:opacity-80 transition-opacity"
                              onClick={async () => {
                                // Skip if already swapping this image
                                if (swappingImages.has(version.path)) return

                                try {
                                  // Add both paths to the swapping set
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
                                alt={`Version ${version.version}`}
                                fill
                                className={`object-cover rounded border bg-muted/10 ${
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
                          {Array.from({ length: 3 - (item.image?.savedVersions?.length || 0) }).map((_, i) => (
                            <div 
                              key={i} 
                              className="border rounded bg-muted/10"
                              style={{ width: '55px', height: '96px' }}
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
                              onClick={item.audio?.savedVersion ? () => handleTrackSelection(2, item) : () => handleNewAudio(item)}
                              disabled={generatingAudio.has(item.number) || switchingTrack !== null}
                              className="flex-none text-xs -mt-3 relative"
                              style={{ width: '90px', height: '70px' }}
                            >
                              <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${
                                primaryTrack === 2 ? 'bg-green-500' : 'bg-gray-300'
                              }`} />
                              {switchingTrack === 2 
                                ? 'Waiting...' 
                                : generatingAudio.has(item.number)
                                  ? 'Working...'
                                  : item.audio?.savedVersion 
                                    ? 'Track 2' 
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
      </div>

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
        <DialogContent>
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
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Book Title *</label>
              <Input
                value={editFormData.book_title}
                onChange={(e) => setEditFormData({ ...editFormData, book_title: e.target.value })}
                placeholder="Enter book title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={editFormData.description}
                onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                placeholder="Enter project description"
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
                {isEditing ? 'Updating...' : 'Update Project'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}


