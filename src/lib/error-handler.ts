import type { PostgrestError } from '@supabase/supabase-js';
import type { StorageError } from '@supabase/storage-js';

// Type guard for Postgrest errors
function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'details' in error
  );
}

// Type guard for Storage errors
function isStorageError(error: unknown): error is StorageError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    'message' in error
  );
}

export function handleSupabaseError(error: unknown): string {
  console.error('Supabase error:', error);

  // Handle Postgrest database errors
  if (isPostgrestError(error)) {
    switch (error.code) {
      case '23505': // unique_violation
        return 'A record with this information already exists.';
      case '23503': // foreign_key_violation
        return 'Referenced record does not exist.';
      case '42501': // insufficient_privilege
        return 'You do not have permission to perform this action.';
      default:
        return error.message || 'Database error occurred.';
    }
  }

  // Handle Storage errors
  if (isStorageError(error)) {
    const message = error.message.toLowerCase();
    if (message.includes('size')) {
      return 'File size is too large.';
    }
    if (message.includes('type')) {
      return 'Invalid file type.';
    }
    if (message.includes('permission')) {
      return 'You do not have permission to upload files.';
    }
    return error.message || 'File upload error occurred.';
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    if (error.message.includes('not found')) {
      return 'The requested resource was not found.';
    }
    if (error.message.includes('network')) {
      return 'Network connection error. Please check your internet connection.';
    }
    return error.message;
  }

  // Handle unknown errors
  return 'An unexpected error occurred. Please try again.';
}

// Helper for project-specific validation errors
export function handleProjectValidation(field: string): string {
  switch (field) {
    case 'project_name':
      return 'Project name is required.';
    case 'book_title':
      return 'Book title is required.';
    case 'epub_file':
      return 'Please upload a valid EPUB file.';
    default:
      return `${field} is invalid.`;
  }
}

// Helper for user-friendly error messages
export function getUserFriendlyError(error: unknown): string {
  const message = handleSupabaseError(error);
  
  // Map technical errors to user-friendly messages
  const errorMap: Record<string, string> = {
    'Database error occurred.': 'Something went wrong. Please try again.',
    'insufficient_privilege': 'You don\'t have permission to perform this action.',
    'Authentication failed.': 'Please sign in again.',
    'Network error': 'Please check your internet connection.',
  };

  return errorMap[message] || message;
} 