"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Book } from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from '@/app/actions/upload';

interface Project {
  id: string;
  project_name: string;
  book_title: string;
  description: string;
  epub_file_path?: string;
  status: string;
  user_id: string;
  created_at: string;
}

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    project_name: '',
    book_title: '',
    description: '',
  });

  useEffect(() => {
    fetchProjects();
  }, []);

  async function fetchProjects() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching projects:', error);
      toast.error('Failed to load projects');
    } else {
      setProjects(data || []);
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

  const handleCreateProject = async () => {
    if (!selectedFile?.name.toLowerCase().endsWith('.epub')) {
      toast.error('Please select a valid EPUB file (.epub)')
      return
    }

    if (!formData.project_name || !formData.book_title) {
      toast.error('Please fill out all required fields')
      return
    }

    setUploading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('No session')

      // Create FormData
      const uploadFormData = new FormData()
      uploadFormData.append('file', selectedFile)
      uploadFormData.append('project_name', formData.project_name)
      uploadFormData.append('book_title', formData.book_title)
      uploadFormData.append('description', formData.description)

      // Pass userId to server action
      await uploadFile(uploadFormData, session.user.id)

      toast.success('Project created successfully')
      setFormData({ project_name: '', book_title: '', description: '' })
      setSelectedFile(null)
      setShowNewProject(false)
      await fetchProjects()
    } catch (error) {
      console.error('Error:', error)
      toast.error('Failed to create project')
    } finally {
      setUploading(false)
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
              <label className="block text-sm font-medium mb-1">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter project description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Upload EPUB File *</label>
              <p className="text-sm text-gray-500 mb-2">Only .epub files are supported</p>
              <div className="mt-1 flex items-center">
                <Input
                  type="file"
                  accept=".epub"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  required
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-violet-50 file:text-violet-700 hover:file:bg-violet-100"
                />
              </div>
              {selectedFile && (
                <p className="text-sm text-green-600 mt-2">
                  Selected file: {selectedFile.name}
                </p>
              )}
              {uploading && <p className="text-sm text-gray-500 mt-2">Creating project...</p>}
            </div>
            <Button 
              type="submit" 
              disabled={uploading || !selectedFile || !formData.project_name || !formData.book_title}
              className={`w-full ${
                uploading || !selectedFile || !formData.project_name || !formData.book_title
                  ? ''  // default button color
                  : 'bg-green-600 hover:bg-green-700'  // green when ready
              }`}
            >
              {uploading ? 'Creating Project...' : 'Create Project'}
            </Button>
          </form>
        </Card>
      )}

      <section>
        <h2 className="text-2xl font-semibold mb-4">Existing Projects</h2>
        {projects.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardHeader>
                  <CardTitle>{project.project_name}</CardTitle>
                  <CardDescription>{project.book_title}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500">{project.description}</p>
                  <div className="mt-2 flex items-center">
                    <span className="text-sm text-gray-500">{project.status}</span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" className="w-full">
                    <Book className="mr-2 h-4 w-4" /> Open Project
                  </Button>
                </CardFooter>
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