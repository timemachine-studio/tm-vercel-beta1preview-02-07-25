import { Message } from '../../types/chat';
import { AI_PERSONAS } from '../../config/constants';

interface AIResponse {
  content: string;
  thinking?: string;
}

interface StreamingData {
  content: string;
  thinking?: string;
}

// Custom error class for rate limits
class RateLimitError extends Error {
  type: string;
  
  constructor(message: string) {
    super(message);
    this.type = 'rateLimit';
    this.name = 'RateLimitError';
  }
}

export async function generateAIResponse(
  messages: Message[],
  imageData?: string | string[],
  systemPrompt: string = '', // Not used anymore, kept for compatibility
  currentPersona: keyof typeof AI_PERSONAS = 'default',
  onStream?: (data: StreamingData) => void
): Promise<AIResponse> {
  try {
    // Call the Vercel API route with streaming
    const response = await fetch('/api/ai-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        messages: messages.map(msg => ({
          content: msg.content,
          isAI: msg.isAI
        })),
        persona: currentPersona,
        imageData
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Check for rate limit errors
      if (response.status === 429 || errorData.type === 'rateLimit') {
        throw new RateLimitError('Rate limit exceeded');
      }
      
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    // Check if response is streaming (Server-Sent Events)
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/event-stream')) {
      return await handleStreamingResponse(response, onStream);
    } else {
      // Fallback to non-streaming response
      const result = await response.json();
      
      // If streaming callback is provided, call it with the complete response
      if (onStream) {
        onStream({ 
          content: result.content,
          thinking: result.thinking 
        });
      }

      return result;
    }
  } catch (error) {
    console.error('Error calling AI proxy:', error);
    
    if (error instanceof RateLimitError) {
      throw error; // Re-throw rate limit errors to be handled by the UI
    }
    
    if (error instanceof Error) {
      // Return simplified error message for other errors
      return { 
        content: "I apologize, but I'm having trouble connecting right now. Please try again in a moment." 
      };
    }
    
    return { 
      content: "I apologize, but I'm having trouble connecting right now. Please try again in a moment." 
    };
  }
}

async function handleStreamingResponse(
  response: Response,
  onStream?: (data: StreamingData) => void
): Promise<AIResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body available for streaming');
  }

  const decoder = new TextDecoder();
  let finalContent = '';
  let finalThinking = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          
          if (data === '[DONE]') {
            continue;
          }
          
          try {
            const parsed = JSON.parse(data);
            
            if (parsed.type === 'content') {
              finalContent = parsed.content;
              finalThinking = parsed.thinking || '';
              
              // Call streaming callback with current content
              if (onStream) {
                onStream({
                  content: finalContent,
                  thinking: finalThinking
                });
              }
            } else if (parsed.type === 'done') {
              finalContent = parsed.content;
              finalThinking = parsed.thinking || '';
              
              // Call streaming callback with final content
              if (onStream) {
                onStream({
                  content: finalContent,
                  thinking: finalThinking
                });
              }
              break;
            }
          } catch (parseError) {
            // Skip invalid JSON
            continue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {
    content: finalContent,
    thinking: finalThinking
  };
}
