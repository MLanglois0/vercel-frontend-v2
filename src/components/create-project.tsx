import { Project } from '@/app/projects/page';

type CreateProjectData = Omit<Project, 'id' | 'created_at'>;

const createProject = async (projectData: CreateProjectData): Promise<Project> => {
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(projectData),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message)
    }

    const project: Project = await response.json()
    return project
  } catch (error) {
    console.error('Error:', error)
    throw error
  }
}

export default createProject 