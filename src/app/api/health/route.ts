import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Get API key from environment
    const apiKey = process.env.REMOTE_API_KEY;
    
    // Get the remote server URL from environment
    const remoteServer = process.env.REMOTE_SERVER_URL || 'http://localhost:5000';
    
    try {
      // Call the remote server health endpoint
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${remoteServer}/health`, {
        headers: {
          'X-API-Key': apiKey || '',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Remote server returned ${response.status}`);
      }
      
      const healthData = await response.json();
      
      // Add additional application health metrics if needed
      const enhancedHealthData = {
        ...healthData,
        application_status: 'healthy',
        timestamp: new Date().toISOString()
      };
      
      return NextResponse.json(enhancedHealthData);
    } catch (error) {
      console.error('Error checking remote server health:', error);
      
      // Check for specific error types
      if (error instanceof DOMException && error.name === 'AbortError') {
        return NextResponse.json(
          { 
            status: 'unhealthy', 
            application_status: 'healthy',
            remote_status: 'timeout',
            error: 'Remote server timeout' 
          }, 
          { status: 503 }
        );
      }
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return NextResponse.json(
          { 
            status: 'unhealthy', 
            application_status: 'healthy',
            remote_status: 'unreachable',
            error: 'Cannot connect to remote server' 
          }, 
          { status: 503 }
        );
      }
      
      return NextResponse.json(
        { 
          status: 'unhealthy',
          application_status: 'healthy', 
          remote_status: 'error',
          error: error instanceof Error ? error.message : 'Failed to check health' 
        }, 
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error in health API:', error);
    return NextResponse.json({ 
      status: 'unhealthy',
      application_status: 'error',
      error: 'Internal application error'
    }, { status: 500 });
  }
} 