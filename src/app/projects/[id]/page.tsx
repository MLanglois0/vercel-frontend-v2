"use client"

import { useRef, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react"
import { toast } from 'sonner'

interface Project {
  id: string
  project_name: string
  book_title: string
  description: string
  status: string
  epub_file_path: string
}

export default function ProjectDetail() {
  const params = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(0)
  const [storyboardImages] = useState(Array(20).fill("/placeholder.svg")) // Placeholder for now

  useEffect(() => {
    fetchProject()
  }, [])

  async function fetchProject() {
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
    } catch (error) {
      console.error('Error fetching project:', error)
      toast.error('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const handleSliderChange = (value: number[]) => {
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
        <div className="relative">
          <div
            ref={scrollContainerRef}
            className="flex overflow-x-scroll space-x-4 pb-4 scrollbar-hide"
          >
            {storyboardImages.map((image, index) => (
              <Card key={index} className="flex-shrink-0 w-64">
                <CardContent className="p-2">
                  <div className="relative">
                    <img src={image} alt={`Storyboard ${index + 1}`} className="w-full h-40 object-cover rounded" />
                    <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                      {index + 1}
                    </div>
                  </div>
                  <div className="flex justify-between mt-2">
                    <Button variant="outline" size="icon">
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Pause className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="absolute left-0 top-1/2 transform -translate-y-1/2 bg-background"
            onClick={() => scrollContainerRef.current?.scrollBy({ left: -200, behavior: 'smooth' })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="absolute right-0 top-1/2 transform -translate-y-1/2 bg-background"
            onClick={() => scrollContainerRef.current?.scrollBy({ left: 200, behavior: 'smooth' })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Slider
          value={[sliderValue]}
          onValueChange={handleSliderChange}
          max={100}
          step={1}
          className="w-full"
        />
      </div>
    </div>
  )
}
