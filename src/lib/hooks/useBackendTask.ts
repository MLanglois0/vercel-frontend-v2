import { useState, useEffect, useCallback } from 'react';
import { commandService } from '../services/command-service';
import { taskMonitor, TaskInfo, TaskStatus } from '../services/task-monitoring';

interface UseBackendTaskOptions {
  onComplete?: (taskInfo: TaskInfo) => void;
  onError?: (taskInfo: TaskInfo) => void;
  automaticRetry?: boolean;
  showToasts?: boolean;
}

export function useBackendTask(options: UseBackendTaskOptions = {}) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskInfo, setTaskInfo] = useState<TaskInfo | null>(null);
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Reset state
  const reset = useCallback(() => {
    setTaskId(null);
    setTaskInfo(null);
    setStatus(null);
    setIsLoading(false);
    setError(null);
  }, []);
  
  // Execute command
  const executeCommand = useCallback(async (command: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const newTaskId = await commandService.sendCommand(command, {
        showToasts: options.showToasts,
        retryOnFailure: options.automaticRetry,
        onComplete: (info) => {
          setTaskInfo(info);
          setStatus('completed');
          setIsLoading(false);
          
          if (options.onComplete) {
            options.onComplete(info);
          }
        },
        onError: (info) => {
          setTaskInfo(info);
          setStatus('error');
          setIsLoading(false);
          setError(info.error || 'Unknown error');
          
          if (options.onError) {
            options.onError(info);
          }
        },
        onStart: () => {
          setStatus('queued');
        }
      });
      
      setTaskId(newTaskId);
      return newTaskId;
    } catch (err) {
      setIsLoading(false);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    }
  }, [options]);
  
  // Retry the command if it failed
  const retry = useCallback(async () => {
    if (!taskId || !taskInfo?.command) {
      setError('No task to retry');
      return null;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      const newTaskId = await taskMonitor.retryTask(taskId, taskInfo.command);
      
      if (newTaskId) {
        setTaskId(newTaskId);
        setStatus('queued');
        return newTaskId;
      } else {
        throw new Error('Failed to retry task');
      }
    } catch (err) {
      setIsLoading(false);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to retry task');
      return null;
    }
  }, [taskId, taskInfo]);
  
  // Cancel the task
  const cancel = useCallback(async () => {
    if (!taskId) {
      return false;
    }
    
    const success = await commandService.cancelCommand(taskId);
    
    if (success) {
      setStatus('cancelled');
      setIsLoading(false);
    }
    
    return success;
  }, [taskId]);
  
  // Get updated task info when taskId changes
  useEffect(() => {
    if (!taskId) return;
    
    const getTaskInfo = () => {
      const info = taskMonitor.getTaskInfo(taskId);
      if (info) {
        setTaskInfo(info);
        setStatus(info.status);
      }
    };
    
    // Get initial task info
    getTaskInfo();
    
    // Poll for updates
    const interval = setInterval(getTaskInfo, 1000);
    
    return () => {
      clearInterval(interval);
    };
  }, [taskId]);
  
  return {
    taskId,
    taskInfo,
    status,
    isLoading,
    error,
    executeCommand,
    retry,
    cancel,
    reset
  };
} 