import { GoogleGenAI, Type, Tool, FunctionDeclaration } from "@google/genai";
import { Agent, ManagerDecision, Message, AgentRole, ProjectFile } from '../types';
import { getFileContentFromDB, searchFiles } from './knowledgeService';

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Tool Definition for Semantic Search (RAG)
const searchToolDeclaration: FunctionDeclaration = {
  name: 'search_knowledge_base',
  description: 'Search through the project files for specific keywords, facts, or data blocks. Use this to find information without reading every entire file.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The specific topic, keyword, or question to search for in the knowledge base.',
      },
    },
    required: ['query'],
  },
};

// Generic function to generate content from a specific agent's persona
export const generateAgentResponse = async (
  agent: Agent,
  prompt: string,
  history: Message[],
  sharedFiles: ProjectFile[] = []
): Promise<string> => {
  try {
    // 1. GENERATE FILE CATALOG (The "Nexus Master Index" approach)
    // Instead of dumping 100k tokens of content, we give a "Menu".
    let sharedContext = "";
    if (sharedFiles.length > 0) {
        const fileSummaries = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                // Preview first 200 chars to give a taste of the file
                const preview = content ? content.substring(0, 200).replace(/\n/g, ' ') : "No content";
                return `FILE_ID: "${f.id}" | NAME: "${f.name}" (${f.type}) | START: ${preview}...`; 
            })
        );
        sharedContext = `
        === MASTER FILE INDEX (CATALOG) ===
        The following files are available in the Knowledge Base:
        ${fileSummaries.join('\n')}
        ===================================
        
        NOTE: You do NOT have the full content of these files loaded.
        ${agent.id === AgentRole.RESEARCHER ? "**YOU HAVE A TOOL 'search_knowledge_base' to read specific parts of these files.**" : "If you need details from these files, ask the Manager to delegate to the Researcher."}
        `;
    }

    // Format history
    const contextStr = history
      .map(m => {
        let label: string = m.senderId;
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

    const fullPrompt = `
      ${sharedContext}

      === CONTEXT HISTORY ===
      ${contextStr}
      =======================

      ${agentKnowledge}

      --------------------------------------------------
      *** MISSION OBJECTIVE ***
      "${prompt}"
      
      Execute this task adhering to your Persona.
      --------------------------------------------------
    `;

    // --- CASE 1: IMAGE GENERATION ---
    if (agent.model.includes('image')) {
       // ... existing image logic ...
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

    // --- CASE 2: TEXT & TOOLS (RAG IMPLEMENTATION) ---
    
    const tools: Tool[] = [];
    
    // Default Google Search for specific roles
    if ([AgentRole.MANAGER, AgentRole.RESEARCHER, AgentRole.CODER, AgentRole.CRITIC].includes(agent.id)) {
        tools.push({ googleSearch: {} });
    }

    // ATLAS EXCLUSIVE: Knowledge Base Search
    if (agent.id === AgentRole.RESEARCHER) {
        tools.push({ functionDeclarations: [searchToolDeclaration] });
    }

    // STEP 1: Initial Call
    const response = await ai.models.generateContent({
      model: agent.model, 
      contents: fullPrompt,
      config: {
        systemInstruction: agent.systemPrompt,
        temperature: 0.7,
        tools: tools.length > 0 ? tools : undefined
      }
    });

    // STEP 2: Handle Tool Calls (The RAG Loop)
    const functionCalls = response.functionCalls;
    
    if (functionCalls && functionCalls.length > 0) {
        const toolOutputs = [];
        
        // Execute all requested tools
        for (const call of functionCalls) {
            if (call.name === 'search_knowledge_base') {
                const query = call.args['query'] as string;
                // Execute Client-Side Search
                const searchResult = await searchFiles(query, sharedFiles);
                
                toolOutputs.push({
                    functionResponse: {
                        name: 'search_knowledge_base',
                        response: { result: searchResult }
                    }
                });
            }
        }

        if (toolOutputs.length > 0) {
            // Send the search results back to the model
            const response2 = await ai.models.generateContent({
                model: agent.model,
                contents: [
                    { role: 'user', parts: [{ text: fullPrompt }] },
                    { role: 'model', parts: response.candidates![0].content.parts }, // Model asked for tool
                    { role: 'user', parts: toolOutputs } // We provide the search result
                ],
                config: {
                    systemInstruction: agent.systemPrompt,
                    tools: tools // Keep tools enabled (though usually not needed for final turn)
                }
            });
            return response2.text || "Analyzed knowledge base.";
        }
    }

    // Standard Response handling
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
    throw error;
  }
};

// Manager Decision Function (Updated to see the Catalog)
export const getManagerDecision = async (
  history: Message[],
  taskGoal: string,
  sharedFiles: ProjectFile[] = [],
  critiqueLoopCount: number = 0,
  retryCount: number = 0,
  previousError: string = ""
): Promise<ManagerDecision> => {
  try {
     // Manager sees the Index/Catalog to know what to delegate to Atlas
     let fileCatalog = "";
     if (sharedFiles.length > 0) {
        const fileSummaries = await Promise.all(
            sharedFiles.map(async (f) => {
                const content = await getFileContentFromDB(f.id);
                const preview = content ? content.substring(0, 500).replace(/\n/g, ' ') : "No content";
                return `FILE_ID: "${f.id}" | NAME: "${f.name}" (${f.type}) | PREVIEW: ${preview}...`; 
            })
        );
        fileCatalog = `
        AVAILABLE PROJECT FILES (CATALOG):
        ----------------------------------
        ${fileSummaries.join('\n')}
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

    const schema = {
      type: Type.OBJECT,
      properties: {
        thought_process: { type: Type.STRING, description: "Strategy explanation." },
        next_action: { type: Type.STRING, enum: ['DELEGATE', 'FINISH', 'ASK_USER'] },
        target_agent: { type: Type.STRING, enum: ['RESEARCHER', 'WRITER', 'REVIEWER', 'DESIGNER', 'CODER', 'CRITIC'] },
        instructions: { type: Type.STRING, description: "Specific instructions. If files are relevant, tell Atlas to search them." },
        relevant_file_ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Relevant file IDs." },
        final_response: { type: Type.STRING }
      },
      required: ['thought_process', 'next_action', 'instructions']
    };

    const tools: Tool[] = [{ googleSearch: {} }];

    let errorContext = "";
    if (previousError) {
        errorContext = `\n!!! ERROR IN PREVIOUS ATTEMPT: ${previousError}. FIX JSON !!!\n`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        ${fileCatalog}
        User Goal: "${taskGoal}"
        PROGRESS:
        ${contextStr}
        Loop Count: ${critiqueLoopCount}
        ${errorContext}
      `,
      config: {
        systemInstruction: `You are Nexus, the Strategic Director. 
        
        KEY CHANGE: You now have a 'Master Index' of files. 
        - You cannot read full files yourself.
        - If you see relevant files in the Catalog, you MUST delegate to **Atlas (Researcher)** and instruct him to "Search the knowledge base for X".
        
        Standard Logic:
        1. Analyze Catalog & History.
        2. Delegate to Agents (Atlas -> Scribe -> Cipher -> Reviewers).
        3. Finish when Artifact is perfect.
        `,
        responseMimeType: "application/json",
        responseSchema: schema,
        tools: tools 
      }
    });

    if (!response.text) throw new Error("Empty response from Manager");
    return JSON.parse(response.text) as ManagerDecision;

  } catch (error: any) {
    if (retryCount < 2) {
        return getManagerDecision(history, taskGoal, sharedFiles, critiqueLoopCount, retryCount + 1, error.message || "Invalid JSON");
    }
    return {
      thought_process: "Failed",
      next_action: 'FINISH',
      final_response: `System Error: ${error.message}`
    };
  }
};

export const summarizeConversation = async (history: Message[]): Promise<Message[]> => {
    if (history.length <= 5) return history;

    const messagesToSummarize = history.slice(0, history.length - 5);
    const recentMessages = history.slice(history.length - 5);
    const transcript = messagesToSummarize.map(m => `[${m.senderId}]: ${m.content}`).join('\n\n');

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Summarize this chat history. Retain key decisions and artifact status. \n\n${transcript}`,
            config: { systemInstruction: "Archivist." }
        });

        const summaryMessage: Message = {
            id: 'summary-' + Date.now(),
            senderId: AgentRole.MANAGER,
            content: `**🗄️ System Archive:**\n\n${response.text}`,
            timestamp: Date.now(),
            type: 'plan'
        };
        return [summaryMessage, ...recentMessages];
    } catch (error) {
        return history;
    }
};