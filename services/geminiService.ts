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
    let sharedContext = "";
    if (sharedFiles.length > 0) {
        const fileContents = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                return content ? `[FILE: ${f.name}]\n${content.substring(0, 100000)}` : null; 
            })
        );
        const validContents = fileContents.filter(Boolean);
        if (validContents.length > 0) {
            sharedContext = `
            SHARED PROJECT FILES (CONTEXT FOR EVERYONE):
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
    return `[System Error] ${agent.name} encountered an issue connecting to the AI service (${agent.model}).`;
  }
};

// Specialized function for the Manager to decide the next step using JSON Schema
export const getManagerDecision = async (
  history: Message[],
  taskGoal: string,
  sharedFiles: ProjectFile[] = []
): Promise<ManagerDecision> => {
  try {
     let sharedContext = "";
     if (sharedFiles.length > 0) {
        const fileContents = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                // Manager only gets summary/start of files to save tokens
                return content ? `[FILE: ${f.name}]\n${content.substring(0, 5000)}... (truncated)` : null; 
            })
        );
        const validContents = fileContents.filter(Boolean);
        if (validContents.length > 0) {
            sharedContext = `SHARED PROJECT FILES:\n${validContents.join('\n\n')}`;
        }
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

    // STRICT JSON SCHEMA based on feedback
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
        final_response: { 
            type: Type.STRING, 
            description: "Only fill this if FINISH is selected." 
        }
      },
      required: ['thought_process', 'next_action', 'instructions']
    };

    // ENABLE SEARCH FOR THE MANAGER'S DECISION PROCESS
    const tools: Tool[] = [{ googleSearch: {} }];

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        ${sharedContext}

        The user's original goal is: "${taskGoal}"
        
        PROGRESS LOG:
        ${contextStr}
      `,
      config: {
        systemInstruction: `You are Nexus, the Strategic Director. Your ONLY goal is to deliver a perfect interactive dashboard in the Canvas.

        STRICT WORKFLOW:

        1.  **ANALYSIS:** 
            -   ALWAYS check 'SHARED PROJECT FILES' first for context.
            -   If data is provided in a file, you MUST use it.

        2.  **DELEGATION CHAIN:**
            -   **Atlas:** For extracting data/facts.
            -   **Scribe:** For writing the narrative.
            -   **Cipher:** For building the HTML Artifact.

        3.  **INTERNAL REVIEW (CRITICAL):**
            -   As soon as Cipher creates an <ARTIFACT>, you **MUST NOT** finish.
            -   You **MUST** delegate to **Socrates** (Logic) or **Pixel** (Design) for feedback.

        4.  **USER CONSENSUS:**
            -   Use 'ASK_USER' to present expert suggestions: "Socrates suggests X, Pixel suggests Y. Shall we implement these for V2?"

        5.  **OUTPUT FORMAT:**
            -   Answer exclusively in JSON format according to the agreed schema.
        `,
        responseMimeType: "application/json",
        responseSchema: schema,
        tools: tools // Enable search for the decision brain
      }
    });

    if (!response.text) throw new Error("Empty response from Manager");
    return JSON.parse(response.text) as ManagerDecision;

  } catch (error) {
    console.error("Manager decision error:", error);
    return {
      thought_process: "Error.",
      next_action: 'FINISH',
      final_response: "System error in orchestration."
    };
  }
};