import { taskMonitor, TaskInfo } from './task-monitoring';
import { toast } from 'sonner';

export interface CommandOptions {
  showToasts?: boolean;
  retryOnFailure?: boolean;
  maxRetries?: number;
  onStart?: () => void;
  onComplete?: (taskInfo: TaskInfo) => void;
  onError?: (taskInfo: TaskInfo) => void;
}

export class CommandService {
  // Send a command to the backend
  public async sendCommand(
    command: string, 
    options: CommandOptions = {}
  ): Promise<string> {
    const opts = {
      showToasts: true,
      retryOnFailure: false,
      maxRetries: 3,
      ...options
    };
    
    if (opts.onStart) {
      opts.onStart();
    }
    
    if (opts.showToasts) {
      toast.loading('Processing command...');
    }
    
    try {
      const response = await fetch('/api/run-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      
      if (!response.ok) throw new Error('Failed to send command');
      
      const data = await response.json();
      const taskId = data.task_id;
      
      if (opts.showToasts) {
        toast.success('Command submitted successfully');
      }
      
      // Set up monitoring
      taskMonitor.monitorTask(taskId, {
        onComplete: (taskInfo) => {
          if (opts.showToasts) {
            toast.success('Command completed successfully');
          }
          
          if (opts.onComplete) {
            opts.onComplete(taskInfo);
          }
        },
        onError: (taskInfo) => {
          if (opts.showToasts) {
            toast.error('Command failed');
          }
          
          if (opts.onError) {
            opts.onError(taskInfo);
          }
          
          if (opts.retryOnFailure) {
            this.handleRetry(taskId, command, opts);
          }
        }
      });
      
      return taskId;
    } catch (error) {
      console.error('Error sending command:', error);
      
      if (opts.showToasts) {
        toast.error('Failed to send command');
      }
      
      throw error;
    }
  }
  
  // Handle command retry
  private async handleRetry(
    taskId: string, 
    command: string, 
    options: CommandOptions
  ): Promise<void> {
    const taskInfo = taskMonitor.getTaskInfo(taskId);
    
    if (!taskInfo || (taskInfo.retryCount || 0) >= (options.maxRetries || 3)) {
      toast.error('Maximum retry attempts reached');
      return;
    }
    
    toast.loading(`Retrying command (attempt ${(taskInfo.retryCount || 0) + 1}/${options.maxRetries})...`);
    
    // Add delay with exponential backoff
    const retryCount = taskInfo.retryCount || 0;
    await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 1000));
    
    try {
      const newTaskId = await taskMonitor.retryTask(taskId, command);
      
      if (newTaskId) {
        // Monitor the new task
        taskMonitor.monitorTask(newTaskId, {
          onComplete: options.onComplete,
          onError: options.onError
        });
      }
    } catch (error) {
      console.error('Error retrying command:', error);
      toast.error('Failed to retry command');
    }
  }
  
  // Cancel a command
  public async cancelCommand(taskId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/cancel-task/${taskId}`, {
        method: 'POST'
      });
      
      if (!response.ok) throw new Error('Failed to cancel task');
      
      toast.success('Task cancelled successfully');
      return true;
    } catch (error) {
      console.error('Error cancelling task:', error);
      toast.error('Failed to cancel task');
      return false;
    }
  }
}

// Create a singleton instance
export const commandService = new CommandService(); 