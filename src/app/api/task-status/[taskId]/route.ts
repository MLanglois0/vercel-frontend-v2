import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Extract taskId from URL path
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const taskId = pathParts[pathParts.length - 1];
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    // Get API key from environment
    const apiKey = process.env.REMOTE_API_KEY;
    
    // Get the remote server URL from environment
    const remoteServer = process.env.REMOTE_SERVER_URL || 'http://localhost:5000';
    
    try {
      // Call the remote server to check status
      const response = await fetch(`${remoteServer}/task-status/${taskId}`, {
        headers: {
          'X-API-Key': apiKey || '',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Remote server returned ${response.status}`);
      }
      
      const taskData = await response.json();
      return NextResponse.json(taskData);
    } catch (error) {
      console.error('Error getting task status from remote server:', error);
      
      // Check for specific error types
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return NextResponse.json(
          { status: 'error', error: 'Cannot connect to task server' }, 
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { status: 'error', error: 'Failed to get task status' }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in task-status API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 