import { toast } from 'sonner';

// Admin email for notifications
const ADMIN_EMAIL = 'mike@mimetex.co';

export interface NotificationData {
  issue: string;
  details?: string;
  user?: string;
  projectId?: string;
  timestamp?: string;
}

export class AdminNotificationService {
  // Send notification to admin
  public async notifyAdmin(data: NotificationData): Promise<boolean> {
    try {
      const payload = {
        ...data,
        timestamp: data.timestamp || new Date().toISOString(),
        admin_email: ADMIN_EMAIL
      };
      
      const response = await fetch('/api/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('Failed to send notification');
      
      return true;
    } catch (error) {
      console.error('Failed to notify admin:', error);
      return false;
    }
  }
  
  // Notify about backend down
  public async notifyBackendDown(details?: string): Promise<boolean> {
    toast.error(`Backend service appears to be down. ${ADMIN_EMAIL} has been notified.`);
    
    return this.notifyAdmin({
      issue: 'Backend Down',
      details: details || 'Backend health check failed'
    });
  }
  
  // Notify about failed task
  public async notifyTaskFailure(taskId: string, command: string, error: string): Promise<boolean> {
    return this.notifyAdmin({
      issue: 'Task Failure',
      details: `Task ${taskId} failed with error: ${error}`,
      timestamp: new Date().toISOString()
    });
  }
}

// Create a singleton instance
export const adminNotification = new AdminNotificationService(); 