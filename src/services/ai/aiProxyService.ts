import { Message } from '../../types/chat';
import { AI_PERSONAS } from '../../config/constants';

interface AIResponse {
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
  currentPersona: keyof typeof AI_PERSONAS = 'default'
): Promise<AIResponse> {
  try {
    // Call the Vercel API route without streaming
    const response = await fetch('/api/ai-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

    // Get the complete JSON response
    const result = await response.json();
    return result;

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
