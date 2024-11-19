"use client"

import { useRef, useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from 'sonner'
import { getSignedImageUrls } from '@/app/actions/storage'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AudioPlayer } from '@/components/AudioPlayer'

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
      await fetchStoryboardImages(project.id)
    } catch (error) {
      console.error('Error fetching project:', error)
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [params.id])

  useEffect(() => {
    fetchProject()
  }, [fetchProject])

  async function fetchStoryboardImages(projectId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Get signed URLs from server action
      const signedFiles = await getSignedImageUrls(session.user.id, projectId)
      console.log('Signed files:', signedFiles)

      // Group files by number
      const groupedItems = signedFiles.reduce((acc, file) => {
        const number = file.number
        if (!acc[number]) acc[number] = { number }
        
        if (file.type === 'image') acc[number].image = { url: file.url, path: file.path }
        if (file.type === 'audio') acc[number].audio = { url: file.url, path: file.path }
        if (file.type === 'text' && file.content) acc[number].text = { content: file.content, path: file.path }
        
        return acc
      }, {} as Record<number, StoryboardItem>)

      console.log('Grouped items:', groupedItems)

      // Convert to array and sort by number
      const items = Object.entries(groupedItems)
        .map(([num, item]) => ({
          ...item,
          number: parseInt(num)
        }))
        .sort((a, b) => a.number - b.number)

      console.log('Final items array:', items)
      setItems(items)
    } catch (error) {
      console.error('Error fetching storyboard images:', error)
      toast.error('Failed to load storyboard images')
    }
  }

  const handleScrollSliderChange = (value: number[]) => {
    setSliderValue(value[0])
    if (scrollContainerRef.current) {
      const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollLeft = (maxScroll * value[0]) / 100
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
          <Badge variant={
            project.status === 'completed' ? 'default' : 
            project.status === 'in_progress' ? 'secondary' : 
            'outline'
          }>
            {project.status}
          </Badge>
        </div>
        <p className="text-muted-foreground">{project.description}</p>
      </div>

      <div className="space-y-4">
        <h3 className="text-2xl font-semibold">Storyboard</h3>
        {items.length > 0 ? (
          <div className="relative">
            <div
              ref={scrollContainerRef}
              className="flex overflow-x-scroll space-x-4 pb-4 scrollbar-hide"
            >
              {items.map((item) => (
                <Card key={item.number} className="flex-shrink-0 w-[341px]">
                  <CardContent className="p-2 space-y-2">
                    <div className="relative">
                      {item.image?.url && (
                        <img 
                          src={item.image.url} 
                          alt={`Storyboard ${item.number}`} 
                          className="w-full h-[597px] object-cover rounded" 
                          loading="lazy"
                        />
                      )}
                      <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                        {item.number}
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
    </div>
  )
}


