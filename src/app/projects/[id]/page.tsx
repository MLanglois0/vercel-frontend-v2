"use client"

import { useRef, useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from 'sonner'
import { getSignedImageUrls, deleteProjectFile, saveImageHistory } from '@/app/actions/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { AudioPlayer } from '@/components/AudioPlayer'
import { getUserFriendlyError } from '@/lib/error-handler'
import { Input } from "@/components/ui/input"
import Image from 'next/image'

interface Project {
  id: string
  project_name: string
  book_title: string
  description: string
  status: string
  epub_file_path: string
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
  const [generatingImages, setGeneratingImages] = useState<Set<number>>(new Set())

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
      console.log('Signed files:', signedFiles) // Debug log

      // Group files by number
      const groupedItems = signedFiles.reduce((acc, file) => {
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
          // Match number before .mp3
          const match = file.path.match(/(\d+)\.mp3$/)
          if (match) {
            const audioNumber = parseInt(match[1])
            acc[audioNumber].audio = { url: file.url, path: file.path }
            console.log(`Added audio to group ${audioNumber}:`, file.path)
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
        
        // Skip the epub file (number 0)
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

  const handleNewImage = async (item: StoryboardItem) => {
    try {
      // Prevent duplicate generations
      if (generatingImages.has(item.number)) return
      
      console.log('New Image button clicked for item:', item)
      
      if (!item.image?.path) {
        console.error('No image path found in item:', item)
        throw new Error('No image path found')
      }
      
      // Check if we already have 3 saved versions
      const savedVersions = item.image.savedVersions || []
      console.log('Current saved versions:', savedVersions)
      
      if (savedVersions.length >= 3) {
        console.log('Maximum versions reached:', savedVersions.length)
        // Calculate position based on card width (341px) and item number, starting from 0
        const horizontalOffset = item.number * 341 // Multiply by card width
        toast('Maximum versions reached', {
          description: 'Limited to 3 image generations. Please contact support if you need assistance.',
          position: 'bottom-right',
          duration: 4000,
          style: {
            position: 'fixed',
            left: `${horizontalOffset}px`,
            bottom: '50%',
            transform: 'translate(-50%, 50%)',
            marginLeft: '410px' // Full card width to move it right
          }
        })
        return
      }

      // Set loading state for this specific item
      setGeneratingImages(prev => new Set(prev).add(item.number))

      // Save current image as historical version
      const newVersion = savedVersions.length
      console.log('Saving new version:', newVersion, 'for path:', item.image.path)
      
      const result = await saveImageHistory({
        originalPath: item.image.path,
        version: newVersion
      })
      console.log('Save history result:', result)

      // Your backend command for new image generation
      console.log('Backend command to generate replacement image')

      // Refresh the project data
      console.log('Refreshing project data...')
      await fetchProject()
      console.log('Project data refreshed')

    } catch (error) {
      console.error('Error in handleNewImage:', error)
      toast.error(getUserFriendlyError(error))
    } finally {
      // Clear loading state for this item
      setGeneratingImages(prev => {
        const next = new Set(prev)
        next.delete(item.number)
        return next
      })
    }
  }

  if (loading) return <div>Loading...</div>
  if (!project) return <div>Project not found</div>

  return (
    <div className="container mx-auto p-4 space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold">{project.project_name}</h1>
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">{project.book_title}</h2>
          <div className="flex gap-4 items-center">
            <Badge variant={
              project.status === 'completed' ? 'default' : 
              project.status === 'in_progress' ? 'secondary' : 
              'outline'
            }>
              {project.status}
            </Badge>
            <Button 
              variant="destructive" 
              className="bg-black hover:bg-gray-800"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              Delete Project
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground">{project.description}</p>
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
                              className="object-cover rounded" 
                              priority={item.number <= 2}
                              sizes="(max-width: 768px) 100vw, 341px"
                            />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                          {item.number}
                        </div>
                      </div>
                      
                      <div className="flex gap-4 items-center mt-2">
                        <Button 
                          variant="outline" 
                          onClick={() => handleNewImage(item)}
                          className="whitespace-nowrap"
                          disabled={generatingImages.has(item.number)}
                        >
                          {generatingImages.has(item.number) 
                            ? 'Working...' 
                            : item.image?.savedVersions?.length === 3 
                              ? 'Max Versions' 
                              : 'New Image'
                          }
                        </Button>
                        <div className="flex gap-2 flex-1">
                          {item.image?.savedVersions?.map((version) => (
                            <div key={version.version} className="relative w-[55px] h-[96px]">
                              <Image 
                                src={version.url}
                                alt={`Version ${version.version}`}
                                fill
                                className="object-cover rounded border bg-muted/10"
                                sizes="55px"
                              />
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
                      
                      <div className="space-y-2">
                        {item.audio?.url && (
                          <AudioPlayer
                            audioUrl={item.audio.url}
                            textContent={item.text?.content}
                            onViewText={() => {
                              setSelectedText(item.text?.content || null)
                              setIsTextDialogOpen(true)
                            }}
                          />
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
    </div>
  )
}


