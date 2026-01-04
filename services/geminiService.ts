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
        if (m.senderId === AgentRole.REVIEWER) label = "VERITY (EDITOR)";
        if (m.senderId === AgentRole.CODER) label = "CIPHER (TECH LEAD)";
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
      
      IF YOU ARE ATLAS (RESEARCHER):
      Remember to structure your output with "Methodology", "Key Findings", "Counter-Evidence", and "Gap Analysis".

      IF YOU ARE CIPHER (CODER):
      Prioritize clean, well-commented code and structured data analysis.
      --------------------------------------------------
    `;

    // --- CASE 1: IMAGE GENERATION (DESIGNER) ---
    if (agent.model.includes('image')) {
       // For image models, we want a clean prompt describing the visual, 
       // but we append the manager's instruction which usually contains the visual description.
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
    
    // Enable Google Search for Researcher AND Coder (for tech docs)
    if (agent.id === AgentRole.RESEARCHER || agent.id === AgentRole.CODER) {
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
        if (m.senderId === AgentRole.REVIEWER) label = "VERITY (EDITOR)";
        if (m.senderId === AgentRole.CODER) label = "CIPHER (TECH LEAD)";
        
        if (m.content.includes('data:image')) return `[${label}]: [Generated Image]`;
        return `[${label}]: ${m.content}`;
      })
      .join('\n');

    const schema = {
      type: Type.OBJECT,
      properties: {
        thought_process: { type: Type.STRING },
        next_action: { type: Type.STRING, enum: ['DELEGATE', 'FINISH', 'ASK_USER'] },
        target_agent: { type: Type.STRING, enum: ['RESEARCHER', 'WRITER', 'REVIEWER', 'DESIGNER', 'CODER'] },
        instructions: { 
          type: Type.STRING,
          description: "MANDATORY. The specific instruction. If delegating to Atlas, ask for a 'Deep Dive'. If Cipher, ask for 'Technical Architecture' or 'Code'."
        },
        final_response: { type: Type.STRING }
      },
      required: ['thought_process', 'next_action', 'instructions']
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        ${sharedContext}

        The user's original goal is: "${taskGoal}"
        
        PROGRESS LOG:
        ${contextStr}
      `,
      config: {
        systemInstruction: `You are Nexus, the Project Lead.
        
        YOUR PRIORITY: DEPTH & QUALITY.
        
        DECISION TREE:
        1.  **STARTING?** -> If complex, use **ASK_USER** to align on scope.
        2.  **TECHNICAL/DATA?** -> Delegate to **CODER** (Cipher).
        3.  **NEEDS RESEARCH?** -> Delegate to **RESEARCHER** (Atlas).
        4.  **RESEARCH DONE?** -> **ASK_USER** to validate findings.
        5.  **DRAFT DONE?** -> Delegate to **REVIEWER** (Verity).
        6.  **REVIEW DONE?** -> **ASK_USER** for final sign-off.

        Always check the Researcher's "Gap Analysis". If there are big gaps, suggest filling them before moving to writing.
        `,
        responseMimeType: "application/json",
        responseSchema: schema
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