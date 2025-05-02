import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
  request: Request
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { command } = body;

    if (!command) {
      return NextResponse.json({ error: 'Command is required' }, { status: 400 });
    }

    // Get API key from environment
    const apiKey = process.env.REMOTE_API_KEY;
    
    // Get the remote server URL from environment
    const remoteServer = process.env.REMOTE_SERVER_URL || 'http://localhost:5000';
    
    try {
      // Call the remote server to run the command
      const response = await fetch(`${remoteServer}/run-command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey || '',
        },
        body: JSON.stringify({ command }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `Remote server returned ${response.status}`
        );
      }
      
      const taskData = await response.json();
      
      // Log command execution
      try {
        await supabase
          .from('command_logs')
          .insert({
            user_id: session.user.id,
            command,
            task_id: taskData.task_id,
            status: taskData.status,
          });
      } catch (err: unknown) {
        console.error('Failed to log command execution:', err);
        // Continue even if logging fails
      }
      
      return NextResponse.json(taskData);
    } catch (error) {
      console.error('Error running command on remote server:', error);
      
      // Check for specific error types
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return NextResponse.json(
          { error: 'Cannot connect to command server' }, 
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to run command' }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in run-command API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 