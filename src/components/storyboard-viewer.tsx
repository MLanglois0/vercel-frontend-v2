import React, { useRef, useState } from 'react'
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Slider } from "@/components/ui/slider"
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from "lucide-react"

interface StoryboardViewerProps {
  storyboardImages: string[]
}

export function StoryboardViewer({ 
  storyboardImages = [
    "https://h245f0zpl5ltanyh.public.blob.vercel-storage.com/audibloom_upload_logo-FqZYZEID9HtVHZpwcWVCxCgwmOv6Cl.png"
  ] 
}: StoryboardViewerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [sliderValue, setSliderValue] = useState(0)

  const handleSliderChange = (value: number[]) => {
    setSliderValue(value[0])
    if (scrollContainerRef.current) {
      const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth
      scrollContainerRef.current.scrollLeft = (maxScroll * value[0]) / 100
    }
  }

  return (
    <div className="space-y-4">
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
  )
} 