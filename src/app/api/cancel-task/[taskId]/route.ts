import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
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
      // Call the remote server to cancel the task
      const response = await fetch(`${remoteServer}/cancel-task/${taskId}`, {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey || '',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Remote server returned ${response.status}`);
      }
      
      const taskData = await response.json();
      
      // Log task cancellation
      try {
        await supabase
          .from('command_logs')
          .update({
            status: 'cancelled',
            ended_at: new Date().toISOString()
          })
          .eq('task_id', taskId)
          .eq('user_id', session.user.id);
      } catch (err: unknown) {
        console.error('Failed to log task cancellation:', err);
        // Continue even if logging fails
      }
      
      return NextResponse.json(taskData);
    } catch (error) {
      console.error('Error cancelling task on remote server:', error);
      
      // Check for specific error types
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return NextResponse.json(
          { error: 'Cannot connect to command server' }, 
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to cancel task' }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in cancel-task API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 