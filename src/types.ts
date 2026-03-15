// ============================================================
// OpenAI-compatible request/response types
// ============================================================

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: {
    type: "json_object" | "text";
  };
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length" | "content_filter";
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage;
}

// ============================================================
// OpenCode internal API types
// ============================================================

export interface OpenCodeSession {
  id: string;
  title?: string;
  created?: number;
}

export interface OpenCodeMessagePart {
  type: "text" | "tool-call" | "tool-result" | "step-start" | "step-finish";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
}

export interface OpenCodeMessageResponse {
  info: {
    id: string;
    role: string;
    sessionID: string;
  };
  parts: OpenCodeMessagePart[];
}
