"use client";

import { useEffect, useState } from 'react'
import { notFound, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Book, Edit2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { StoryboardViewer } from "@/components/storyboard-viewer"
import { Badge } from "@/components/ui/badge"

interface Project {
  id: string
  project_name: string
  book_title: string
  description: string
  has_storyboard: boolean
  // ... other fields
}

export default function ProjectPage() {
  const params = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editedProject, setEditedProject] = useState<Partial<Project>>({})

  useEffect(() => {
    async function fetchProject() {
      try {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .eq('id', params.id)
          .single()

        if (error) throw error
        setProject(data)
        setEditedProject({
          project_name: data.project_name,
          description: data.description
        })
      } catch (error) {
        console.error('Error fetching project:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchProject()
  }, [params.id])

  const handleSave = async () => {
    try {
      const { error } = await supabase
        .from('projects')
        .update({
          project_name: editedProject.project_name,
          description: editedProject.description
        })
        .eq('id', project?.id)

      if (error) throw error

      // Update local state
      setProject(prev => prev ? {
        ...prev,
        ...editedProject
      } : null)
      setIsEditing(false)
    } catch (error) {
      console.error('Error updating project:', error)
    }
  }

  if (loading) {
    return <div>Loading...</div>
  }

  if (!project) {
    return notFound()
  }

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        {/* Project Header */}
        <div className="flex justify-between items-center mb-8">
          {isEditing ? (
            <Input
              value={editedProject.project_name}
              onChange={(e) => setEditedProject(prev => ({
                ...prev,
                project_name: e.target.value
              }))}
              className="text-3xl font-bold"
            />
          ) : (
            <div className="flex justify-between items-center w-full">
              <h1 className="text-3xl font-bold">{project.project_name}</h1>
              <Badge variant="secondary">In Progress</Badge>
            </div>
          )}
          
          <Button
            variant={isEditing ? "default" : "outline"}
            onClick={() => {
              if (isEditing) {
                handleSave()
              } else {
                setIsEditing(true)
              }
            }}
          >
            {isEditing ? (
              "Save Changes"
            ) : (
              <>
                <Edit2 className="mr-2 h-4 w-4" />
                Edit Project
              </>
            )}
          </Button>
        </div>

        {/* Book Title and Description Section */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          {/* Book Title Section */}
          <div>
            <div className="flex items-center text-muted-foreground mb-2">
              <Book className="mr-2 h-5 w-5" />
              <h2 className="text-xl font-semibold">Book Title</h2>
            </div>
            <p className="text-lg ml-7">{project.book_title}</p>
          </div>

          {/* Description Section */}
          <div>
            <h2 className="text-xl font-semibold mb-2">Description</h2>
            {isEditing ? (
              <Textarea
                value={editedProject.description}
                onChange={(e) => setEditedProject(prev => ({
                  ...prev,
                  description: e.target.value
                }))}
                className="min-h-[100px]"
              />
            ) : (
              <p className="text-gray-700">{project.description}</p>
            )}
          </div>
        </div>

        {/* Storyboard Section */}
        <div className="mt-12 border-t pt-8">
          <h2 className="text-2xl font-semibold mb-4">Storyboard</h2>
          
          {true ? (
            <StoryboardViewer 
              storyboardImages={Array(20).fill(
                "https://h245f0zpl5ltanyh.public.blob.vercel-storage.com/audibloom_upload_logo-FqZYZEID9HtVHZpwcWVCxCgwmOv6Cl.png"
              )} 
            />
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="lg">
                  Create Storyboard
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Important Notice</AlertDialogTitle>
                  <AlertDialogDescription>
                    Please ensure that this is the correct epub file and version before continuing. 
                    This process will take a day or so to complete and you will be notified via email 
                    when your storyboard is ready.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogAction>
                    I understand, proceed
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Cancel Button when editing */}
        {isEditing && (
          <Button
            variant="outline"
            onClick={() => {
              setIsEditing(false)
              setEditedProject({
                project_name: project.project_name,
                description: project.description
              })
            }}
            className="mt-4"
          >
            Cancel
          </Button>
        )}
      </div>
    </main>
  )
} 