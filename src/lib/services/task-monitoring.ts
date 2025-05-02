import { toast } from 'sonner';

// Types
export type TaskStatus = 'queued' | 'running' | 'completed' | 'error' | 'cancelled';

export interface TaskInfo {
  taskId: string;
  status: TaskStatus;
  command?: string;
  output?: string;
  error?: string;
  startTime?: string;
  completedTime?: string;
  retryCount: number;
}

export interface TaskMonitorOptions {
  pollingInterval?: number;
  maxRetries?: number;
  onStatusChange?: (task: TaskInfo) => void;
  onComplete?: (task: TaskInfo) => void;
  onError?: (task: TaskInfo) => void;
}

// Service class
export class TaskMonitoringService {
  private activeTasks: Map<string, TaskInfo> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private options: TaskMonitorOptions;
  
  constructor(options: TaskMonitorOptions = {}) {
    this.options = {
      pollingInterval: 5000,
      maxRetries: 3,
      ...options
    };
  }
  
  // Monitor a task
  public monitorTask(taskId: string, options?: TaskMonitorOptions): void {
    const taskOptions = { ...this.options, ...options };
    
    if (this.activeTasks.has(taskId)) return;
    
    this.activeTasks.set(taskId, { taskId, status: 'queued', retryCount: 0 });
    
    const interval = setInterval(async () => {
      await this.checkTaskStatus(taskId, taskOptions);
    }, taskOptions.pollingInterval);
    
    this.intervals.set(taskId, interval);
  }
  
  // Stop monitoring a task
  public stopMonitoring(taskId: string): void {
    const interval = this.intervals.get(taskId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(taskId);
    }
    this.activeTasks.delete(taskId);
  }
  
  // Get current task info
  public getTaskInfo(taskId: string): TaskInfo | undefined {
    return this.activeTasks.get(taskId);
  }
  
  // Get all active tasks
  public getAllTasks(): TaskInfo[] {
    return Array.from(this.activeTasks.values());
  }
  
  // Private method to check status
  private async checkTaskStatus(taskId: string, options: TaskMonitorOptions): Promise<void> {
    try {
      const response = await fetch(`/api/task-status/${taskId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch task status');
      }
      
      const data = await response.json();
      const prevStatus = this.activeTasks.get(taskId)?.status;
      const currentTask: TaskInfo = {
        taskId,
        status: data.status,
        command: data.command,
        output: data.output,
        error: data.error,
        startTime: data.start_time,
        completedTime: data.completed_time,
        retryCount: this.activeTasks.get(taskId)?.retryCount || 0
      };
      
      this.activeTasks.set(taskId, currentTask);
      
      // Trigger status change callback if status changed
      if (prevStatus !== data.status && options.onStatusChange) {
        options.onStatusChange(currentTask);
      }
      
      // Handle completion
      if (['completed', 'error', 'cancelled'].includes(data.status)) {
        this.stopMonitoring(taskId);
        
        if (data.status === 'completed' && options.onComplete) {
          options.onComplete(currentTask);
        }
        
        if (data.status === 'error' && options.onError) {
          options.onError(currentTask);
        }
      }
    } catch (error) {
      console.error(`Error checking status for task ${taskId}:`, error);
    }
  }
  
  // Retry a failed task
  public async retryTask(taskId: string, command: string): Promise<string | null> {
    const task = this.activeTasks.get(taskId);
    
    if (!task || task.retryCount >= (this.options.maxRetries || 3)) {
      toast.error('Maximum retry attempts reached');
      return null;
    }
    
    try {
      // Increment retry count
      task.retryCount += 1;
      this.activeTasks.set(taskId, task);
      
      // Send command again
      const response = await fetch('/api/run-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      
      if (!response.ok) throw new Error('Failed to retry task');
      
      const data = await response.json();
      return data.task_id;
    } catch (error) {
      console.error('Failed to retry task:', error);
      toast.error('Failed to retry task');
      return null;
    }
  }
}

// Create a singleton instance
export const taskMonitor = new TaskMonitoringService(); 