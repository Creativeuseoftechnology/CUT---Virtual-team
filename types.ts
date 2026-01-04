export enum AgentRole {
  MANAGER = 'MANAGER',
  RESEARCHER = 'RESEARCHER',
  WRITER = 'WRITER',
  REVIEWER = 'REVIEWER',
  DESIGNER = 'DESIGNER',
  CODER = 'CODER',
  USER = 'USER'
}

export interface Agent {
  id: AgentRole;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model: string; // The specific Gemini model ID to use
  color: string;
  avatar: string; // Emoji or generic initial
  knowledgeBase: string[]; // List of specific facts or guidelines this agent knows
}

export interface Message {
  id: string;
  senderId: AgentRole;
  content: string;
  timestamp: number;
  isThinking?: boolean;
  type: 'plan' | 'result' | 'delegation' | 'final' | 'user';
}

export interface ProjectFile {
  id: string;
  name: string;
  type: string;
  size: number;
  tokens?: number; // Estimated
  timestamp: number;
}

// The structure expected from the Manager Agent's JSON output
export interface ManagerDecision {
  thought_process: string;
  next_action: 'DELEGATE' | 'FINISH' | 'ASK_USER';
  target_agent?: AgentRole; // Required if DELEGATE
  instructions?: string;    // Required if DELEGATE
  final_response?: string;  // Required if FINISH
}

export interface ConversationState {
  messages: Message[];
  isProcessing: boolean;
  currentTurnAgent: AgentRole | null;
  taskGoal: string;
}