"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { PlusCircle, Book } from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from '@/app/actions/upload'
import { useRouter } from 'next/navigation';
import { getUserFriendlyError } from '@/lib/error-handler'
import Image from 'next/image';
import { getSignedImageUrls, getProjectStatus } from '@/app/actions/storage'

interface Project {
  id: string;
  project_name: string;
  book_title: string;
  author_name: string;
  description: string;
  epub_file_path?: string;
  cover_file_path?: string;
  status: string;
  user_id: string;
  created_at: string;
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
  Publish_Status: string;
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [coverUrls, setCoverUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedCover, setSelectedCover] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    project_name: '',
    book_title: '',
    author_name: '',
    description: '',
  });
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();
  const [projectStatuses, setProjectStatuses] = useState<Record<string, ProjectStatus>>({});

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching projects:', error);
      toast.error(getUserFriendlyError(error));
    } else {
      setProjects(data || []);

      // Fetch status for each project
      const statuses: Record<string, ProjectStatus> = {};
      for (const project of data || []) {
        try {
          const status = await getProjectStatus({
            userId: session.user.id,
            projectId: project.id
          });
          if (status) {
            statuses[project.id] = status;
          }
        } catch (error) {
          console.error('Error getting project status:', error);
        }
      }
      setProjectStatuses(statuses);

      // Get signed URLs for all cover images
      for (const project of data || []) {
        if (project.cover_file_path) {
          try {
            const signedFiles = await getSignedImageUrls(session.user.id, project.id)
            const coverFile = signedFiles.find(file => 
              file.type === 'image' && file.path === project.cover_file_path
            )
            if (coverFile) {
              setCoverUrls(prev => ({
                ...prev,
                [project.id]: coverFile.url
              }))
            }
          } catch (error) {
            console.error('Error getting signed URL:', error)
          }
        }
      }
    }
    setLoading(false);
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.epub')) {
      toast.error('Please upload an EPUB file');
      return;
    }

    setSelectedFile(file);
  };

  const handleCoverSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a valid image file (JPG, PNG, or WebP)')
      return
    }

    setSelectedCover(file)
  }

  const handleCreateProject = async () => {
    if (!selectedFile?.name.toLowerCase().endsWith('.epub')) {
      toast.error('Please select a valid EPUB file (.epub)')
      return
    }

    if (!selectedFile) {
      toast.error('Please select an EPUB file')
      return
    }

    if (!formData.project_name || !formData.book_title || !formData.author_name) {
      toast.error('Please fill out all required fields')
      return
    }

    if (!selectedCover) {
      toast.error('Please select a cover image')
      return
    }

    setIsCreating(true)
    const loadingToast = toast.loading('Creating your project...')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Create FormData for upload
      const uploadFormData = new FormData()
      uploadFormData.append('file', selectedFile)
      uploadFormData.append('cover', selectedCover)
      uploadFormData.append('project_name', formData.project_name)
      uploadFormData.append('book_title', formData.book_title)
      uploadFormData.append('author_name', formData.author_name || '')
      uploadFormData.append('description', formData.description || '')

      await uploadFile(uploadFormData, session.user.id)
      
      toast.dismiss(loadingToast)
      toast.success('Project created successfully')
      setFormData({ project_name: '', book_title: '', author_name: '', description: '' })
      setSelectedFile(null)
      setSelectedCover(null)
      setShowNewProject(false)
      await fetchProjects()
    } catch (error) {
      console.error('Error:', error)
      toast.dismiss(loadingToast)
      toast.error(getUserFriendlyError(error))
    } finally {
      setIsCreating(false)
    }
  }

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <header className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">My Audiobook Projects</h1>
        <Button onClick={() => setShowNewProject(!showNewProject)}>
          <PlusCircle className="mr-2 h-4 w-4" /> Start New Project
        </Button>
      </header>

      {showNewProject && (
        <Card className="p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
          <form onSubmit={handleCreateProject} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Project Name *</label>
              <Input
                value={formData.project_name}
                onChange={(e) => setFormData({ ...formData, project_name: e.target.value })}
                placeholder="Enter project name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Book Title *</label>
              <Input
                value={formData.book_title}
                onChange={(e) => setFormData({ ...formData, book_title: e.target.value })}
                placeholder="Enter book title"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Author Name *</label>
              <Input
                value={formData.author_name}
                onChange={(e) => setFormData({ ...formData, author_name: e.target.value })}
                placeholder="Enter author name"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter project description"
              />
            </div>
            <div className="grid gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="epub" className="text-sm font-medium">
                  EPUB File
                </label>
                <Input 
                  id="epub"
                  type="file" 
                  accept=".epub"
                  onChange={handleFileSelect}
                  className="h-[40px] text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 
                            file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 
                            hover:file:bg-violet-100"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="cover" className="text-sm font-medium">
                  Cover Image
                </label>
                <Input 
                  id="cover"
                  type="file" 
                  accept="image/*"
                  onChange={handleCoverSelect}
                  className="h-[40px] text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 
                            file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 
                            hover:file:bg-violet-100"
                />
              </div>
            </div>
            <Button 
              onClick={handleCreateProject} 
              disabled={isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Project'}
            </Button>
          </form>
        </Card>
      )}

      <section>
        <h2 className="text-2xl font-semibold mb-4">Existing Projects</h2>
        {projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card key={project.id} className="flex overflow-hidden h-[200px]">
                {project.cover_file_path && coverUrls[project.id] && (
                  <div className="relative w-[120px] h-[200px] flex-shrink-0">
                    <Image
                      src={coverUrls[project.id]}
                      alt={`Cover for ${project.book_title}`}
                      fill
                      className="object-cover"
                      sizes="120px"
                      priority
                    />
                  </div>
                )}
                <div className="flex flex-col flex-1 h-full py-3">
                  <CardHeader className="pb-1 pt-0">
                    <CardTitle className="text-xl text-left">{project.project_name}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 py-1">
                    <div className="space-y-1.5">
                      <p className="text-sm">
                        <span className="font-medium">Book: </span>
                        <span className="text-gray-700">{project.book_title}</span>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Author: </span>
                        <span className="text-gray-700">{project.author_name}</span>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Description: </span>
                        <span className="text-gray-700">{project.description}</span>
                      </p>
                      <p className="text-sm">
                        <span className="font-medium">Project Status: </span>
                        <span className="bg-green-50 text-green-700 px-2 py-1 rounded-md">
                          {projectStatuses[project.id]?.Current_Status || 'Loading...'}
                        </span>
                      </p>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-2 pb-3">
                    <Button 
                      variant="outline" 
                      className="w-full"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <Book className="mr-2 h-4 w-4" /> Open Project
                    </Button>
                  </CardFooter>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center h-40">
              <p className="text-muted-foreground mb-4">Create a new project to get started!</p>
              <Button onClick={() => setShowNewProject(true)}>
                <PlusCircle className="mr-2 h-4 w-4" /> Create Your First Project
              </Button>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
} 