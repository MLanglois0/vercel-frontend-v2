interface SupabaseError {
  message?: string;
  status?: number;
  code?: string;
}

export function handleSupabaseError(error: unknown): string {
  // Type guard to ensure error is an object
  if (!error || typeof error !== 'object') {
    return 'An unexpected error occurred';
  }

  const supaError = error as SupabaseError;
  
  if (typeof supaError.message === 'string') {
    if (supaError.message.includes('JWT')) {
      return 'Your session has expired. Please login again.';
    }
    
    if (supaError.message.includes('permission denied')) {
      return 'You don\'t have permission to perform this action.';
    }
    
    return supaError.message;
  }

  return 'An unexpected error occurred';
} 