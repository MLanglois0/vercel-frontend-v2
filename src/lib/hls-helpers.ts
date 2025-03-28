/**
 * Helper functions for working with HLS streaming
 */

// URL cache to avoid duplicate requests
const urlCache = new Map<string, { url: string, expiresAt: number }>();

// Fetches a signed URL from our API endpoint
export async function getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
  // Check cache first
  const cacheKey = `${path}-${expiresIn}`;
  const cachedItem = urlCache.get(cacheKey);
  
  // If we have a cached URL that's not expired, use it
  if (cachedItem && cachedItem.expiresAt > Date.now()) {
    console.log('Using cached signed URL for:', path);
    return cachedItem.url;
  }
  
  try {
    console.log('Generating signed URL for R2 file:', path);
    const response = await fetch(`/api/signed-url?path=${encodeURIComponent(path)}&expiresIn=${expiresIn}`);
    
    if (!response.ok) {
      throw new Error(`Failed to get signed URL: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Store in cache
    urlCache.set(cacheKey, {
      url: data.signedUrl,
      expiresAt: Date.now() + (expiresIn * 1000 * 0.9) // Expire slightly earlier to be safe
    });
    
    return data.signedUrl;
  } catch (error) {
    console.error('Error getting signed URL:', error);
    throw error;
  }
}

// Track processed manifests to avoid duplicate processing
const processedManifests = new Map<string, string>();

// Special handling for HLS manifests to ensure segments are also signed
export async function processHlsManifest(manifestUrl: string): Promise<string> {
  // Check if we already processed this manifest
  if (processedManifests.has(manifestUrl)) {
    return processedManifests.get(manifestUrl)!;
  }
  
  console.log('Processing HLS manifest:', manifestUrl);
  
  try {
    // First, fetch the manifest using the signed URL
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch HLS manifest: ${response.statusText}`);
    }
    
    // Get the manifest content
    const manifestContent = await response.text();
    
    // Extract the base URL (everything up to the last slash)
    const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/') + 1);
    
    // We can't use async functions directly with replace, so we'll process the content differently
    const contentLines = manifestContent.split('\n');
    const processedLines = await Promise.all(
      contentLines.map(async (line) => {
        // If line starts with # or is empty, keep it as is
        if (line.startsWith('#') || line.trim() === '') {
          return line;
        }
        
        // If line ends with .ts, it's a segment that needs signing
        if (line.trim().endsWith('.ts')) {
          try {
            // For each segment, create a signed URL
            const segmentPath = new URL(line.trim(), baseUrl).pathname;
            // Extract key from pathname (removing any leading slash)
            const key = segmentPath.startsWith('/') ? segmentPath.substring(1) : segmentPath;
            // Create a signed URL for this segment
            return await getSignedUrl(key);
          } catch (e) {
            console.error(`Error signing segment URL ${line}:`, e);
            return line; // Return original on error
          }
        }
        
        // For other lines, keep them unchanged
        return line;
      })
    );
    
    // Join the processed lines back into a single string
    const processedContent = processedLines.join('\n');
    
    // Create a blob URL from the processed content
    const blob = new Blob([processedContent], { type: 'application/vnd.apple.mpegurl' });
    const blobUrl = URL.createObjectURL(blob);
    
    // Cache the result
    processedManifests.set(manifestUrl, blobUrl);
    
    return blobUrl;
  } catch (error) {
    console.error('Error processing HLS manifest:', error);
    throw error;
  }
}

// Cache for stream URLs
const streamUrlCache = new Map<string, string>();

// Main function to get a ready-to-use HLS URL
export async function getHlsStreamUrl(path: string): Promise<string> {
  // Check if we already have this stream URL
  if (streamUrlCache.has(path)) {
    console.log('Using cached HLS stream URL for:', path);
    return streamUrlCache.get(path)!;
  }
  
  try {
    console.log('Preparing HLS stream URL for:', path);
    
    // Create the proxy URL with the full path
    const proxyUrl = `/api/hls-stream?path=${encodeURIComponent(path)}`;
    
    // Verify the proxy endpoint is accessible before returning
    try {
      // Make a HEAD request to verify the proxy endpoint without downloading the entire file
      const testResponse = await fetch(proxyUrl, { method: 'HEAD' });
      if (!testResponse.ok) {
        console.error(`HLS proxy endpoint not accessible: ${testResponse.status} ${testResponse.statusText}`);
        throw new Error(`HLS proxy endpoint returned status ${testResponse.status}`);
      }
      console.log('HLS proxy endpoint is accessible');
    } catch (error) {
      console.error('Error testing HLS proxy endpoint:', error);
      throw new Error('Failed to verify HLS proxy endpoint');
    }
    
    // Cache the result
    streamUrlCache.set(path, proxyUrl);
    
    console.log('HLS stream URL ready (using proxy):', path);
    return proxyUrl;
  } catch (error) {
    console.error('Error preparing HLS stream URL:', error);
    throw error;
  }
}

// Helper to clean up blob URLs when they're no longer needed
export function cleanupStreamUrl(path: string): void {
  // Get the stream URL from cache
  const streamUrl = streamUrlCache.get(path);
  
  // Only revoke the URL if it's a blob URL (our proxy URLs don't need revoking)
  if (streamUrl && streamUrl.startsWith('blob:')) {
    // Revoke the blob URL to free up memory
    URL.revokeObjectURL(streamUrl);
    console.log('Cleaned up blob URL for:', path);
  }
  
  // Remove from caches
  streamUrlCache.delete(path);
  processedManifests.forEach((url, key) => {
    if (url === streamUrl) {
      processedManifests.delete(key);
    }
  });
} 