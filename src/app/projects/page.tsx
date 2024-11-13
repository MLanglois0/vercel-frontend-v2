"use client";

import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Book, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from 'next/navigation';
import { uploadFile } from "@/app/actions/upload";
import { useSupabaseSession } from '@/hooks/useSupabaseSession';

export interface Project {
  id: string;
  created_at: string;
  user_id: string;
  project_name: string;
  book_title: string;
  description: string | null;
  epub_file_path: string | null;
  status: string;
}

export default function ProjectsPage() {
  const { session, loading } = useSupabaseSession();
  const router = useRouter();
  const { toast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !session) {
      router.push('/login');
    }
  }, [session, loading, router]);

  useEffect(() => {
    async function fetchProjects() {
      try {
        if (!session) return;
        const response = await fetch('/api/projects', {
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.details || 'Failed to fetch projects');
        }
        
        const data = await response.json();
        setProjects(data);
      } catch (error) {
        console.error('Error fetching projects:', error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to load projects",
          variant: "destructive",
        });
      }
    }

    fetchProjects();
  }, [session, toast]);

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const formData = new FormData(event.currentTarget);
      const file = formData.get('epub') as File;
      
      // First, create project without file path
      const initialProjectData = {
        project_name: formData.get('project_name'),
        book_title: formData.get('book_title'),
        description: formData.get('description') || null,
        status: 'NEW'  // Assuming this matches your enum/status options in DB
      };

      // Create initial project
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(initialProjectData),
      });

      const projectResponse = await response.json();
      
      if (!response.ok) {
        throw new Error(projectResponse.details || projectResponse.message || 'Failed to create project');
      }

      // Now handle file upload with project ID
      if (file) {
        const uploadFormData = new FormData();
        uploadFormData.append('file', file);
        
        try {
          // Construct file path: userId/projectId/filename.epub
          const filePath = await uploadFile(uploadFormData, projectResponse.id);
          
          // Update project with file path
          const updateResponse = await fetch(`/api/projects/${projectResponse.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ epub_file_path: filePath }),
          });

          if (!updateResponse.ok) {
            throw new Error('Failed to update project with file path');
          }

          const updatedProject = await updateResponse.json();
          setProjects(prev => prev.map(p => 
            p.id === updatedProject.id ? updatedProject : p
          ));
        } catch (uploadError) {
          console.error('Upload failed:', uploadError);
          // Project was created but file upload failed
          toast({
            title: "Partial Success",
            description: "Project created but file upload failed. You can upload the file later.",
            variant: "default",
          });
          setProjects(prev => [projectResponse, ...prev]);
          return;
        }
      }

      setProjects(prev => [projectResponse, ...prev]);
      toast({
        title: "Success",
        description: "Project created successfully",
      });
    } catch (error) {
      console.error('Detailed error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create project",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const handleProjectClick = (projectId: string) => {
    router.push(`/projects/${projectId}`);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">My Projects</h1>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="project_name">Project Name</Label>
                <Input 
                  id="project_name" 
                  name="project_name" 
                  required 
                  placeholder="Enter project name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="book_title">Book Title</Label>
                <Input 
                  id="book_title" 
                  name="book_title" 
                  required 
                  placeholder="Enter book title"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea 
                  id="description" 
                  name="description" 
                  placeholder="Enter project description"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="epub">Upload EPUB</Label>
                <Input 
                  id="epub" 
                  name="epub" 
                  type="file" 
                  accept=".epub"
                  required
                />
              </div>

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {projects.length === 0 ? (
        <div className="text-center text-muted-foreground">
          No projects found. Create a new project to get started!
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((project) => (
            <Card 
              key={project.id} 
              className="flex flex-col cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => handleProjectClick(project.id)}
            >
              <CardHeader>
                <CardTitle>{project.project_name}</CardTitle>
              </CardHeader>
              <CardContent className="flex-grow">
                <p className="text-muted-foreground">{project.book_title}</p>
                {project.description && (
                  <p className="text-sm text-muted-foreground mt-2">{project.description}</p>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <div className="flex items-center text-muted-foreground">
                  <Book className="mr-2 h-4 w-4" />
                  <span>{project.status}</span>
                </div>
                <div className="flex items-center text-muted-foreground">
                  <Clock className="mr-2 h-4 w-4" />
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
} 