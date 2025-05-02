import { useState, useEffect, useCallback } from 'react';
import { backendHealth } from '../services/backend-health';

interface UseBackendHealthOptions {
  onStatusChange?: (isHealthy: boolean) => void;
  checkOnMount?: boolean;
}

export function useBackendHealth(options: UseBackendHealthOptions = {}) {
  const [isHealthy, setIsHealthy] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  
  // Define checkHealth as a callback to avoid ESLint dependency warnings
  const checkHealth = useCallback(async () => {
    // Trigger a manual health check
    await backendHealth.checkHealth();
    setLastChecked(new Date());
  }, []);
  
  useEffect(() => {
    // Configure backend health monitor
    backendHealth.startMonitoring({
      onStatusChange: (healthy: boolean) => {
        setIsHealthy(healthy);
        setLastChecked(new Date());
        
        if (options.onStatusChange) {
          options.onStatusChange(healthy);
        }
      }
    });
    
    // Initial check if requested
    if (options.checkOnMount) {
      checkHealth();
    }
    
    // Clean up
    return () => {
      backendHealth.stopMonitoring();
    };
  }, [options, checkHealth]);
  
  return {
    isHealthy,
    lastChecked,
    checkHealth
  };
} 