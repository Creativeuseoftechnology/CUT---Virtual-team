import { GoogleGenAI, Type, Tool } from "@google/genai";
import { Agent, ManagerDecision, Message, AgentRole, ProjectFile } from '../types';
import { getFileContentFromDB } from './knowledgeService';

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Generic function to generate content from a specific agent's persona
export const generateAgentResponse = async (
  agent: Agent,
  prompt: string,
  history: Message[],
  sharedFiles: ProjectFile[] = []
): Promise<string> => {
  try {
    // 1. Resolve Shared File Content
    // NOTE: sharedFiles passed here should already be FILTERED by the Manager/App logic
    let sharedContext = "";
    if (sharedFiles.length > 0) {
        const fileContents = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                // Agents get larger context of relevant files
                return content ? `[FILE_ID: "${f.id}" | NAME: "${f.name}"]\n${content.substring(0, 100000)}` : null; 
            })
        );
        const validContents = fileContents.filter(Boolean);
        if (validContents.length > 0) {
            sharedContext = `
            SELECTED RELEVANT PROJECT FILES:
            ${validContents.join('\n\n')}
            `;
        }
    }

    // Format history for context - Enhanced for better agent awareness
    const contextStr = history
      .map(m => {
        let label: string = m.senderId;
        // Add Role labels to help the AI understand the expertise of the previous speaker
        if (m.senderId === AgentRole.RESEARCHER) label = "ATLAS (LEAD RESEARCHER)";
        if (m.senderId === AgentRole.WRITER) label = "SCRIBE (WRITER)";
        if (m.senderId === AgentRole.REVIEWER) label = "VERITY (QA OFFICER)";
        if (m.senderId === AgentRole.CODER) label = "CIPHER (CHIEF ARCHITECT)";
        if (m.senderId === AgentRole.CRITIC) label = "SOCRATES (CHIEF SKEPTIC)";
        if (m.senderId === AgentRole.MANAGER) label = "NEXUS (MANAGER)";
        
        if (m.content.includes('data:image')) {
            return `[${label}]: [Generated an Image]`;
        }
        return `[${label}]: ${m.content}`;
      })
      .join('\n\n');

    // Inject Agent Specific Knowledge
    const agentKnowledge = agent.knowledgeBase && agent.knowledgeBase.length > 0
      ? `
      MY SPECIFIC KNOWLEDGE/RULES:
      ${agent.knowledgeBase.map((k, i) => `${i+1}. ${k}`).join('\n')}
      `
      : "";

    // IMPORTANT: Structure the prompt to prioritize the Manager's specific instruction
    const fullPrompt = `
      ${sharedContext}

      === CONTEXT HISTORY (READ THIS TO UNDERSTAND PROJECT STATE) ===
      ${contextStr}
      =============================================================

      ${agentKnowledge}

      --------------------------------------------------
      *** SPECIFIC MISSION OBJECTIVE FROM MANAGER ***
      The Team Lead has assigned you this specific task:
      
      "${prompt}"
      
      Execute this task. Adhere strictly to your System Prompt persona.
      
      IF YOU ARE CIPHER: You must output the COMPLETE HTML ARTIFACT. Wrap it in <ARTIFACT> tags.
      IF YOU ARE A CRITIC (Socrates/Pixel/Verity): Review the previous Artifact. Suggest improvements.
      --------------------------------------------------
    `;

    // --- CASE 1: IMAGE GENERATION (DESIGNER) ---
    if (agent.model.includes('image')) {
       const response = await ai.models.generateContent({
         model: agent.model,
         contents: prompt, 
         config: {}
       });

       let textOutput = "";
       let imageOutput = "";

       if (response.candidates?.[0]?.content?.parts) {
         for (const part of response.candidates[0].content.parts) {
             if (part.inlineData) {
                 const mimeType = part.inlineData.mimeType || 'image/png';
                 imageOutput = `\n\n![Generated Image](data:${mimeType};base64,${part.inlineData.data})`;
             } else if (part.text) {
                 textOutput += part.text;
             }
         }
       }
       
       return (textOutput + imageOutput) || "I created an image for you.";
    }

    // --- CASE 2: TEXT GENERATION & RESEARCH (OTHERS) ---
    
    const tools: Tool[] = [];
    
    // Enable Google Search for Manager, Researcher, Coder, and Critic
    if (agent.id === AgentRole.MANAGER || agent.id === AgentRole.RESEARCHER || agent.id === AgentRole.CODER || agent.id === AgentRole.CRITIC) {
        tools.push({ googleSearch: {} });
    }

    const response = await ai.models.generateContent({
      model: agent.model, 
      contents: fullPrompt,
      config: {
        systemInstruction: agent.systemPrompt,
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined
      }
    });

    let finalResponse = response.text || "";

    if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
        const chunks = response.candidates[0].groundingMetadata.groundingChunks;
        const sources = chunks
            .map(chunk => chunk.web ? `[${chunk.web.title}](${chunk.web.uri})` : null)
            .filter(Boolean);
        
        if (sources.length > 0) {
            finalResponse += "\n\n**Sources:**\n" + sources.join('\n');
        }
    }

    return finalResponse || "I apologize, I could not generate a response.";

  } catch (error) {
    console.error(`Error generating response for ${agent.name}:`, error);
    throw error; // Rethrow so the orchestration loop knows it failed
  }
};

// Specialized function for the Manager to decide the next step using JSON Schema
export const getManagerDecision = async (
  history: Message[],
  taskGoal: string,
  sharedFiles: ProjectFile[] = [],
  critiqueLoopCount: number = 0, // NEW PARAMETER
  retryCount: number = 0,
  previousError: string = ""
): Promise<ManagerDecision> => {
  try {
     // OPTIMIZATION: Create a "Catalog" of files instead of sending full content.
     let fileCatalog = "";
     if (sharedFiles.length > 0) {
        const fileSummaries = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                // Only take the first 500 chars as a "Preview/Summary" for the Manager
                const preview = content ? content.substring(0, 500).replace(/\n/g, ' ') : "No content";
                return `FILE_ID: "${f.id}"\nNAME: "${f.name}" (${f.type})\nPREVIEW: ${preview}...\n`; 
            })
        );
        fileCatalog = `
        AVAILABLE PROJECT FILES (CATALOG):
        ----------------------------------
        ${fileSummaries.join('\n----------------------------------\n')}
        `;
    }

    const contextStr = history
      .map(m => {
        let label: string = m.senderId;
        if (m.senderId === AgentRole.RESEARCHER) label = "ATLAS (LEAD RESEARCHER)";
        if (m.senderId === AgentRole.WRITER) label = "SCRIBE (WRITER)";
        if (m.senderId === AgentRole.REVIEWER) label = "VERITY (QA OFFICER)";
        if (m.senderId === AgentRole.CODER) label = "CIPHER (CHIEF ARCHITECT)";
        if (m.senderId === AgentRole.CRITIC) label = "SOCRATES (CHIEF SKEPTIC)";
        if (m.senderId === AgentRole.DESIGNER) label = "PIXEL (DESIGNER)";
        
        if (m.content.includes('data:image')) return `[${label}]: [Generated Image]`;
        if (m.content.includes('<ARTIFACT>')) return `[${label}]: [CREATED/UPDATED ARTIFACT IN CANVAS]`;
        return `[${label}]: ${m.content}`;
      })
      .join('\n');

    // STRICT JSON SCHEMA based on feedback + File Selection
    const schema = {
      type: Type.OBJECT,
      properties: {
        thought_process: { 
            type: Type.STRING, 
            description: "Explanation of the chosen strategy and why." 
        },
        next_action: { 
            type: Type.STRING, 
            enum: ['DELEGATE', 'FINISH', 'ASK_USER'] 
        },
        target_agent: { 
            type: Type.STRING, 
            enum: ['RESEARCHER', 'WRITER', 'REVIEWER', 'DESIGNER', 'CODER', 'CRITIC'] 
        },
        instructions: { 
            type: Type.STRING, 
            description: "The specific order for the agent OR the question for the user." 
        },
        relevant_file_ids: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Array of FILE_IDs from the catalog that are strictly relevant to this task. Leave empty if none needed."
        },
        final_response: { 
            type: Type.STRING, 
            description: "Only fill this if FINISH is selected." 
        }
      },
      required: ['thought_process', 'next_action', 'instructions']
    };

    // ENABLE SEARCH FOR THE MANAGER'S DECISION PROCESS
    const tools: Tool[] = [{ googleSearch: {} }];

    // SELF-CORRECTION INJECTION
    let errorContext = "";
    if (previousError) {
        errorContext = `
        !!! SYSTEM WARNING - PREVIOUS OUTPUT WAS INVALID !!!
        Your previous attempt resulted in this error: "${previousError}".
        
        YOU MUST FIX THE JSON STRUCTURE. 
        - Ensure all required fields (thought_process, next_action, instructions) are present.
        - Ensure output is valid JSON.
        `;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        ${fileCatalog}

        The user's original goal is: "${taskGoal}"
        
        PROGRESS LOG:
        ${contextStr}

        === SYSTEM STATUS ===
        Current Refinement Loop Count: ${critiqueLoopCount} / 2.
        (If count < 2 and specific feedback exists, favor fixing it internally. If count >= 2, favor ASK_USER).

        ${errorContext}
      `,
      config: {
        systemInstruction: `You are Nexus, the Strategic Director. Your ONLY goal is to deliver a perfect interactive dashboard in the Canvas.

        STRICT WORKFLOW:

        1.  **ANALYSIS:** 
            -   ALWAYS check 'AVAILABLE PROJECT FILES (CATALOG)' first.
            -   If specific files are needed for the next step, ADD their FILE_IDs to the 'relevant_file_ids' array in the JSON response.
            -   Be precise. Do not send irrelevant files to agents.

        2.  **DELEGATION CHAIN:**
            -   **Atlas:** For extracting data/facts.
            -   **Scribe:** For writing the narrative.
            -   **Cipher:** For building the HTML Artifact.

        3.  **INTERNAL REVIEW (CRITICAL):**
            -   As soon as Cipher creates an <ARTIFACT>, you **MUST NOT** finish.
            -   You **MUST** delegate to **Socrates** (Logic) or **Pixel** (Design) for feedback.

        4.  **THE SOCRATIC LOOP (AUTONOMOUS REFINEMENT):**
            -   If Socrates or Pixel provides negative feedback:
            -   CHECK: Is the "Refinement Loop Count" < 2?
            -   YES: Delegate IMMEDIATELY back to **Cipher** with instructions to fix the issues. DO NOT ASK THE USER.
            -   NO (Count >= 2): Stop the loop. Present the current result to the User and ask for their decision.

        5.  **OUTPUT FORMAT:**
            -   Answer exclusively in JSON format according to the agreed schema.
        `,
        responseMimeType: "application/json",
        responseSchema: schema,
        tools: tools 
      }
    });

    if (!response.text) throw new Error("Empty response from Manager");
    
    return JSON.parse(response.text) as ManagerDecision;

  } catch (error: any) {
    console.error(`Manager decision error (Attempt ${retryCount}):`, error);
    
    // RECURSIVE RETRY LOGIC (Max 2 retries)
    if (retryCount < 2) {
        console.log("Retrying Manager Decision due to JSON/Generation error...");
        return getManagerDecision(history, taskGoal, sharedFiles, critiqueLoopCount, retryCount + 1, error.message || "Invalid JSON");
    }

    // Fallback if retries fail
    return {
      thought_process: "Critical System Failure. I tried to plan the next step multiple times but failed.",
      next_action: 'FINISH',
      final_response: `I apologize. I encountered a persistent system error: ${error.message || "Unknown Error"}. Please try again.`
    };
  }
};

// NEW: Function to compress history
export const summarizeConversation = async (history: Message[]): Promise<Message[]> => {
    // Keep last 5 messages intact to preserve immediate context/flow
    if (history.length <= 5) return history;

    const messagesToSummarize = history.slice(0, history.length - 5);
    const recentMessages = history.slice(history.length - 5);

    const transcript = messagesToSummarize
        .map(m => `[${m.senderId}]: ${m.content}`)
        .join('\n\n');

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `
            You are the Team Archivist. Compress the following chat transcript into a single summary.
            
            RULES:
            1. Retain the User's original specific goal/request.
            2. Retain the most recent strategic decisions by Nexus (Manager).
            3. Retain the *latest* status of the HTML Artifact (what features are built?).
            4. DISCARD raw data dumps from Atlas/Researcher (summarize findings briefly).
            5. DISCARD repetitive loops.
            
            TRANSCRIPT:
            ${transcript}
            `,
            config: {
                systemInstruction: "You are an efficient archivist. Output a concise summary paragraph.",
            }
        });

        const summaryText = response.text || "Previous conversation summarized.";

        const summaryMessage: Message = {
            id: 'summary-' + Date.now(),
            senderId: AgentRole.MANAGER, // System/Manager owns the memory
            content: `**🗄️ System Archive (Compressed Memory):**\n\n${summaryText}`,
            timestamp: Date.now(),
            type: 'plan' // Treat as a planning/context node
        };

        return [summaryMessage, ...recentMessages];

    } catch (error) {
        console.error("Summarization failed:", error);
        return history; // Fail safe: return original
    }
};