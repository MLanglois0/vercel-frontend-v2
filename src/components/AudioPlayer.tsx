"use client"

import { useRef, useState, useEffect } from 'react'
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Pause, Play, SkipBack, SkipForward, FileText } from "lucide-react"

interface AudioPlayerProps {
  audioUrl: string
  textContent?: string
  onViewText?: () => void
}

export function AudioPlayer({ audioUrl, textContent, onViewText }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [audioProgress, setAudioProgress] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Effect to reload the audio element when the URL changes
  useEffect(() => {
    if (audioRef.current) {
      // Save the current play state
      const wasPlaying = !audioRef.current.paused
      
      // Reset the audio element
      audioRef.current.pause()
      audioRef.current.load()
      setAudioProgress(0)
      
      // If it was playing before, resume playback
      if (wasPlaying) {
        // Small delay to ensure the audio is loaded
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play()
              .catch(err => console.error("Error playing audio after reload:", err))
          }
        }, 100)
      }
    }
  }, [audioUrl])

  const handlePlayPause = () => {
    if (!audioRef.current) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
  }

  const skipAudio = (seconds: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime += seconds
  }

  const handleSliderChange = (value: number[]) => {
    if (!audioRef.current) return
    const newTime = (value[0] / 100) * audioDuration
    audioRef.current.currentTime = newTime
    setAudioProgress(value[0])
  }

  const handleTimeUpdate = () => {
    if (!audioRef.current) return
    setAudioProgress((audioRef.current.currentTime / audioRef.current.duration) * 100)
  }

  return (
    <div className="space-y-2">
      <audio
        ref={audioRef}
        src={audioUrl}
        className="hidden"
        onEnded={() => setIsPlaying(false)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setAudioDuration(e.currentTarget.duration)}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => skipAudio(-10)}
            title="Skip back 10 seconds"
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handlePlayPause}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => skipAudio(10)}
            title="Skip forward 10 seconds"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>
        
        {textContent && (
          <Button
            variant="outline"
            size="sm"
            onClick={onViewText}
            className="flex items-center gap-2"
          >
            <FileText className="h-4 w-4" />
            View Text
          </Button>
        )}
      </div>
      
      <div className="px-2">
        <Slider
          value={[audioProgress]}
          onValueChange={handleSliderChange}
          max={100}
          step={0.1}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>{formatTime(audioRef.current?.currentTime || 0)}</span>
          <span>{formatTime(audioDuration)}</span>
        </div>
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}