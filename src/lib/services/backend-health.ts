import { toast } from 'sonner';

// Admin email for notifications
const ADMIN_EMAIL = 'mike@mimetex.co';

export interface BackendHealthOptions {
  checkInterval?: number;
  maxConsecutiveFailures?: number;
  onStatusChange?: (isHealthy: boolean) => void;
  onBackendDown?: () => void;
}

export class BackendHealthMonitor {
  private isHealthy: boolean = true;
  private consecutiveFailures: number = 0;
  private checkInterval: NodeJS.Timeout | null = null;
  private options: BackendHealthOptions;
  
  constructor(options: BackendHealthOptions = {}) {
    this.options = {
      checkInterval: 60000, // 1 minute
      maxConsecutiveFailures: 3,
      ...options
    };
  }
  
  // Start monitoring
  public startMonitoring(options?: BackendHealthOptions): void {
    if (options) {
      this.options = {
        ...this.options,
        ...options
      };
    }
    
    if (this.checkInterval) return;
    
    // Initial check
    this.checkHealth();
    
    this.checkInterval = setInterval(() => {
      this.checkHealth();
    }, this.options.checkInterval);
  }
  
  // Stop monitoring
  public stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  // Check backend health
  public async checkHealth(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('/api/health', { 
        signal: controller.signal 
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error('Health check failed');
      
      // Backend is healthy
      if (!this.isHealthy) {
        this.isHealthy = true;
        this.consecutiveFailures = 0;
        
        if (this.options.onStatusChange) {
          this.options.onStatusChange(true);
        }
        
        toast.success('Backend service is now available');
      }
    } catch (error) {
      console.error('Backend health check failed:', error);
      
      this.consecutiveFailures++;
      
      if (this.consecutiveFailures >= (this.options.maxConsecutiveFailures || 3)) {
        if (this.isHealthy) {
          this.isHealthy = false;
          
          if (this.options.onStatusChange) {
            this.options.onStatusChange(false);
          }
          
          toast.error(`Backend service appears to be down. Admin (${ADMIN_EMAIL}) has been notified.`);
          
          if (this.options.onBackendDown) {
            this.options.onBackendDown();
          }
          
          this.notifyAdminAboutBackendDown();
        }
      }
    }
  }
  
  // Notify admin about backend down
  private async notifyAdminAboutBackendDown(): Promise<void> {
    try {
      await fetch('/api/notify-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issue: 'Backend Down',
          timestamp: new Date().toISOString(),
          consecutiveFailures: this.consecutiveFailures,
          admin_email: ADMIN_EMAIL
        })
      });
    } catch (error) {
      console.error('Failed to notify admin:', error);
    }
  }
  
  // Get current health status
  public getStatus(): boolean {
    return this.isHealthy;
  }
  
  // Set options
  public setOptions(options: BackendHealthOptions): void {
    this.options = {
      ...this.options,
      ...options
    };
  }
}

// Create a singleton instance
export const backendHealth = new BackendHealthMonitor(); 