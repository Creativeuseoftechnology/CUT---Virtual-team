import React, { useState, useRef, useEffect } from 'react';
import { AgentRole, ConversationState, Message, Agent, ProjectFile } from './types';
import { AGENTS as INITIAL_AGENTS } from './constants';
import { AgentCard } from './components/AgentCard';
import { MessageBubble } from './components/MessageBubble';
import { Canvas } from './components/Canvas';
import { getManagerDecision, generateAgentResponse } from './services/geminiService';
import { processFile, saveFileToDB, deleteFileFromDB, clearDB } from './services/knowledgeService';
import { StopCircle, RefreshCw, Send, Sparkles, Trash2, Download, RotateCcw, FolderOpen, FileText, Plus, X, Loader2, PanelRight, Paperclip, PanelLeft, Menu } from 'lucide-react';

const INITIAL_STATE: ConversationState = {
  messages: [],
  isProcessing: false,
  currentTurnAgent: null,
  taskGoal: ''
};

// Helper for ID generation
const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

export default function App() {
  // Load agents from LocalStorage
  const [agents, setAgents] = useState<Record<AgentRole, Agent>>(() => {
    const saved = localStorage.getItem('cut_virtual_team_agents');
    if (saved) {
        try {
            const parsedAgents = JSON.parse(saved);
            const mergedAgents = { ...INITIAL_AGENTS };
            (Object.keys(parsedAgents) as AgentRole[]).forEach(role => {
                if (mergedAgents[role]) {
                    mergedAgents[role].knowledgeBase = parsedAgents[role].knowledgeBase;
                }
            });
            return mergedAgents;
        } catch (e) {
            return INITIAL_AGENTS;
        }
    }
    return INITIAL_AGENTS;
  });

  // Shared Files Metadata (Content is in IndexedDB)
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>(() => {
    const saved = localStorage.getItem('cut_virtual_team_files');
    return saved ? JSON.parse(saved) : [];
  });

  const [state, setState] = useState<ConversationState>(INITIAL_STATE);
  const [inputText, setInputText] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  // Layout State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Chat Input File State
  const [chatFile, setChatFile] = useState<File | null>(null);
  
  // Canvas State
  const [showCanvas, setShowCanvas] = useState(false);
  const [canvasContent, setCanvasContent] = useState(() => {
    return localStorage.getItem('cut_virtual_team_canvas') || '';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  // Persistence
  useEffect(() => {
    localStorage.setItem('cut_virtual_team_agents', JSON.stringify(agents));
  }, [agents]);

  useEffect(() => {
    localStorage.setItem('cut_virtual_team_files', JSON.stringify(projectFiles));
  }, [projectFiles]);

  useEffect(() => {
    localStorage.setItem('cut_virtual_team_canvas', canvasContent);
  }, [canvasContent]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  const addMessage = (message: Message) => {
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, message]
    }));
  };

  // Agent Specific Handlers
  const handleAddAgentKnowledge = (agentId: AgentRole, knowledge: string) => {
    setAgents(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        knowledgeBase: [...prev[agentId].knowledgeBase, knowledge]
      }
    }));
  };

  const handleUpdateSystemPrompt = (agentId: AgentRole, newPrompt: string) => {
    setAgents(prev => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        systemPrompt: newPrompt
      }
    }));
  };

  // --- Central Knowledge Handlers ---

  const handleUploadSharedFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
        const { content, type } = await processFile(file);
        const newFile: ProjectFile = {
            id: generateId(),
            name: file.name,
            size: file.size,
            type: type,
            timestamp: Date.now()
        };
        await saveFileToDB(newFile, content);
        setProjectFiles(prev => [...prev, newFile]);

    } catch (error) {
        console.error("Upload failed", error);
        alert("Failed to process file. Ensure it is a valid format.");
    } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = async (id: string) => {
    await deleteFileFromDB(id);
    setProjectFiles(prev => prev.filter(f => f.id !== id));
  };

  // --- Chat File Input Handler ---
  const handleChatFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          setChatFile(file);
      }
      // Reset input so same file can be selected again if needed
      if (chatFileInputRef.current) chatFileInputRef.current.value = '';
  };

  // --- Canvas Logic ---

  const handleAddToCanvas = (content: string) => {
      setCanvasContent(prev => prev ? `${prev}\n\n${content}` : content);
      setShowCanvas(true);
  };

  const handleSaveCanvasAsFile = async (content: string) => {
      if (!content.trim()) return;
      
      const fileName = `Canvas-Export-${new Date().toLocaleTimeString()}.md`;
      const newFile: ProjectFile = {
        id: generateId(),
        name: fileName,
        size: content.length,
        type: 'md',
        timestamp: Date.now()
      };

      try {
        await saveFileToDB(newFile, content);
        setProjectFiles(prev => [...prev, newFile]);
      } catch (e) {
        console.error("Failed to save canvas as file", e);
        alert("Could not save canvas to project files.");
      }
  };

  // --- Session Management Tools ---

  const handleNewSession = () => {
    if (confirm("Start a new session? Chat history will be cleared.")) {
        setState(INITIAL_STATE);
    }
  };

  const handleResetAgents = async () => {
    if (confirm("Reset everything? Agents, Files, and Canvas will be cleared.")) {
        setAgents(INITIAL_AGENTS);
        setProjectFiles([]);
        setCanvasContent('');
        await clearDB();
        localStorage.removeItem('cut_virtual_team_agents');
        localStorage.removeItem('cut_virtual_team_files');
        localStorage.removeItem('cut_virtual_team_canvas');
    }
  };

  const handleExportChat = () => {
    const text = state.messages.map(m => `[${m.senderId} - ${new Date(m.timestamp).toLocaleTimeString()}]:\n${m.content}\n\n`).join('--- \n\n');
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-export-${new Date().toISOString().slice(0,10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Core Logic ---

  const runOrchestrationLoop = async (currentHistory: Message[], task: string) => {
    setState(prev => ({ ...prev, currentTurnAgent: AgentRole.MANAGER }));
    
    await new Promise(r => setTimeout(r, 800));

    const decision = await getManagerDecision(currentHistory, task, projectFiles);

    if (decision.next_action === 'FINISH') {
      addMessage({
        id: generateId(),
        senderId: AgentRole.MANAGER,
        content: decision.final_response || "Task complete.",
        timestamp: Date.now(),
        type: 'final'
      });
      setState(prev => ({ ...prev, isProcessing: false, currentTurnAgent: null }));
      return;
    }

    if (decision.next_action === 'ASK_USER') {
      addMessage({
        id: generateId(),
        senderId: AgentRole.MANAGER,
        content: decision.instructions || decision.final_response || "I need some input from you.",
        timestamp: Date.now(),
        type: 'final' // We treat questions as 'final' for styling purposes (orange border)
      });
      // STOP PROCESSING HERE to wait for user input
      setState(prev => ({ ...prev, isProcessing: false, currentTurnAgent: null }));
      return;
    }

    if (decision.next_action === 'DELEGATE' && decision.target_agent) {
      
      // Fallback if instructions are undefined
      const safeInstructions = decision.instructions || `Proceed with your specialty to help with: "${task}". Use the context provided.`;

      const delegationMsg: Message = {
        id: generateId(),
        senderId: AgentRole.MANAGER,
        content: `**Thought:** ${decision.thought_process}\n\n**Order:** @${agents[decision.target_agent].name}, ${safeInstructions}`,
        timestamp: Date.now(),
        type: 'delegation'
      };
      
      setState(prev => ({
        ...prev,
        messages: [...prev.messages, delegationMsg]
      }));

      setState(prev => ({ ...prev, currentTurnAgent: decision.target_agent! }));
      
      const targetAgent = agents[decision.target_agent];
      if (!targetAgent) {
        setState(prev => ({ ...prev, isProcessing: false, currentTurnAgent: null }));
        return;
      }

      const agentResponse = await generateAgentResponse(
        targetAgent, 
        safeInstructions, // Pass the safe instructions to the agent
        [...currentHistory, delegationMsg],
        projectFiles
      );

      // --- ARTIFACT DETECTION LOGIC ---
      const ARTIFACT_REGEX = /<ARTIFACT>([\s\S]*?)<\/ARTIFACT>/;
      const artifactMatch = agentResponse.match(ARTIFACT_REGEX);
      
      if (artifactMatch) {
          const artifactContent = artifactMatch[1].trim();
          // Update Canvas Content immediately
          setCanvasContent(artifactContent);
          // Auto-open Canvas
          setShowCanvas(true);
      }

      const resultMsg: Message = {
        id: generateId(),
        senderId: targetAgent.id,
        content: agentResponse,
        timestamp: Date.now(),
        type: 'result'
      };

      setState(prev => ({
        ...prev,
        messages: [...prev.messages, resultMsg]
      }));

      setTimeout(() => {
        runOrchestrationLoop([...currentHistory, delegationMsg, resultMsg], task);
      }, 500);
    } else {
       setState(prev => ({ ...prev, isProcessing: false, currentTurnAgent: null }));
    }
  };

  const handleStartTask = async () => {
    if (!inputText.trim() && !chatFile) return;

    let initialTask = inputText;
    let newFilesList = [...projectFiles];

    setState(prev => ({ ...prev, isProcessing: true }));

    // 1. Process Attachment if exists
    if (chatFile) {
        setIsUploading(true);
        try {
            const { content, type } = await processFile(chatFile);
            const newFile: ProjectFile = {
                id: generateId(),
                name: chatFile.name,
                size: chatFile.size,
                type: type,
                timestamp: Date.now()
            };
            
            await saveFileToDB(newFile, content);
            newFilesList = [...newFilesList, newFile];
            setProjectFiles(newFilesList);
            
            // Append context to the user message
            initialTask += `\n\n[System Note: User uploaded file '${chatFile.name}' with this request.]`;
            
        } catch (error) {
            console.error("Chat file upload failed", error);
            alert("Failed to upload the attached file.");
        } finally {
            setIsUploading(false);
            setChatFile(null); // Clear selection
        }
    }

    const userMsg: Message = {
      id: generateId(),
      senderId: AgentRole.USER,
      content: initialTask,
      timestamp: Date.now(),
      type: 'user'
    };

    const newMessages = [...state.messages, userMsg];

    setState(prev => ({
      ...prev,
      messages: newMessages,
      taskGoal: prev.taskGoal || initialTask, // Keep original goal if just answering a question
      isProcessing: true 
    }));

    setInputText('');
    
    // IMPORTANT: Pass the accumulated goal or the new context. 
    // Ideally, we pass the full history and let the Manager figure out if it's a new task or a reply.
    // We use the original 'taskGoal' if it exists, otherwise the new input is the goal.
    const effectiveGoal = state.taskGoal || initialTask;

    await runOrchestrationLoop(newMessages, effectiveGoal);
  };

  const handleStop = () => {
    setState(prev => ({ ...prev, isProcessing: false, currentTurnAgent: null }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStartTask();
    }
  };

  return (
    <div className="flex h-screen bg-[#f8fafc] text-[#575756] overflow-hidden">
      
      {/* Sidebar - Collapsible */}
      <div 
        className={`
            hidden md:flex flex-col border-r border-slate-200 bg-white shrink-0 transition-all duration-300 ease-in-out
            ${isSidebarOpen ? 'w-80 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-full overflow-hidden'}
        `}
      >
        <div className="p-8 pb-4 min-w-[320px]">
            <div className="flex flex-col gap-1 mb-6">
                <div className="flex items-center gap-2">
                     <span className="text-[#ec7b5d]">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L14.5 9L22 9L16 13.5L18.5 21L12 16.5L5.5 21L8 13.5L2 9L9.5 9L12 2Z" />
                        </svg>
                     </span>
                     <div className="leading-none">
                         <h1 className="font-display font-bold text-xl text-[#575756]">Creative</h1>
                         <p className="font-display font-light text-sm text-[#575756]">use of Technology</p>
                     </div>
                </div>
            </div>
            
            <div className="flex items-center justify-between mb-2 pr-6">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Virtual Team</h2>
                <div className="flex gap-1">
                    <button onClick={handleResetAgents} title="Factory Reset" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">
                        <RotateCcw size={14} />
                    </button>
                    <button onClick={handleNewSession} title="Clear Chat" className="p-1.5 text-slate-400 hover:text-[#ec7b5d] hover:bg-orange-50 rounded transition-colors">
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>
        </div>

        {/* Project Files Section */}
        <div className="px-6 mb-4 min-w-[320px]">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 mr-8">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <FolderOpen size={12} /> Project Files
                    </h3>
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        className="hidden"
                        accept=".txt,.md,.json,.csv,.xlsx,.docx,.pdf"
                        onChange={handleUploadSharedFile}
                    />
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1 text-[#ec7b5d] hover:bg-orange-50 rounded disabled:opacity-50"
                        title="Upload Project File (Max 20MB)"
                        disabled={isUploading}
                    >
                        {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    </button>
                </div>
                
                <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
                    {projectFiles.length === 0 && (
                        <p className="text-[10px] text-slate-400 italic">No project files uploaded.</p>
                    )}
                    {projectFiles.map((file) => (
                        <div key={file.id} className="flex items-center justify-between group bg-white p-1.5 rounded border border-slate-100">
                            <div className="flex items-center gap-1.5 overflow-hidden">
                                <FileText size={10} className="text-[#ec7b5d] flex-shrink-0" />
                                <div className="flex flex-col min-w-0">
                                    <span className="text-[10px] text-slate-600 truncate font-medium">
                                        {file.name}
                                    </span>
                                    <span className="text-[8px] text-slate-400">
                                        {(file.size / 1024).toFixed(0)}kb
                                    </span>
                                </div>
                            </div>
                            <button 
                                onClick={() => handleRemoveFile(file.id)}
                                className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-4 scrollbar-thin min-w-[320px]">
          <div className="mr-8">
            {Object.values(agents).map((agent: Agent) => (
                <AgentCard 
                key={agent.id} 
                agent={agent} 
                isActive={state.currentTurnAgent === agent.id}
                isWorking={state.isProcessing && state.currentTurnAgent === agent.id}
                onAddKnowledge={handleAddAgentKnowledge}
                onUpdatePrompt={handleUpdateSystemPrompt}
                />
            ))}
          </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-slate-50 min-w-[320px]">
           <div className="flex items-center justify-between mr-8">
               <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <p className="text-xs font-medium text-slate-500">System Ready</p>
               </div>
               <button onClick={handleExportChat} title="Export Chat" className="text-slate-400 hover:text-[#ec7b5d] transition-colors">
                  <Download size={16} />
               </button>
           </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative bg-[#f8fafc] min-w-0">
        
        {/* Header */}
        <div className="h-20 flex items-center justify-between px-8 bg-white/80 backdrop-blur-sm z-10 sticky top-0 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 -ml-2 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
            >
                {isSidebarOpen ? <PanelLeft size={20} /> : <Menu size={20} />}
            </button>
            <div>
                <h2 className="font-display font-bold text-2xl text-[#575756]">Dashboard</h2>
                <p className="text-sm text-slate-400 font-light">Collaborative AI Workflow</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
              {state.isProcessing && (
                 <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-full border border-slate-100">
                   <RefreshCw size={14} className="animate-spin text-[#ec7b5d]" />
                   <span className="text-xs font-bold text-[#575756] tracking-wide">PROCESSING</span>
                 </div>
              )}
              
              <button 
                 onClick={() => setShowCanvas(!showCanvas)}
                 className={`p-2 rounded-lg transition-colors ${showCanvas ? 'bg-[#ec7b5d] text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                 title="Toggle Canvas"
              >
                 <PanelRight size={20} />
              </button>
          </div>
        </div>

        {/* Chat Stream */}
        <div className="flex-1 overflow-y-auto p-6 md:p-12 space-y-2 scroll-smooth">
            {state.messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 opacity-80">
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-md mb-6 text-[#ec7b5d]">
                        <Sparkles size={32} />
                    </div>
                    <h3 className="font-display text-2xl font-bold text-[#575756] mb-2">How can we help?</h3>
                    <p className="text-base font-light max-w-md text-center">
                        Our virtual team is ready to research, write, and review your projects autonomously.
                    </p>
                </div>
            )}
            
            {state.messages.map(msg => (
                <MessageBubble 
                    key={msg.id} 
                    message={msg} 
                    agents={agents} 
                    onAddToCanvas={handleAddToCanvas} 
                />
            ))}
            
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-6 md:p-8 bg-white/50 border-t border-slate-100">
          <div className="max-w-4xl mx-auto relative shadow-2xl shadow-slate-200/50 rounded-3xl bg-white">
            
            {/* File Preview Chip */}
            {chatFile && (
                <div className="absolute top-[-16px] left-6 flex">
                    <div className="bg-[#ec7b5d] text-white text-xs px-3 py-1.5 rounded-full shadow-md flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                        <FileText size={12} />
                        <span className="max-w-[150px] truncate">{chatFile.name}</span>
                        <button 
                            onClick={() => setChatFile(null)}
                            className="hover:bg-white/20 rounded-full p-0.5"
                        >
                            <X size={12} />
                        </button>
                    </div>
                </div>
            )}

            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={state.isProcessing ? "Team is working..." : "Describe a task or answer the team..."}
              disabled={state.isProcessing}
              className="w-full bg-transparent text-[#575756] rounded-3xl border-0 p-5 pr-32 focus:outline-none focus:ring-2 focus:ring-[#ec7b5d]/20 transition-all resize-none h-24 placeholder:text-slate-300 font-light text-lg"
            />
            
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {/* Attachment Button */}
              <input 
                 type="file"
                 ref={chatFileInputRef}
                 onChange={handleChatFileSelect}
                 className="hidden"
                 accept=".txt,.md,.json,.csv,.xlsx,.docx,.pdf"
              />
              <button
                 onClick={() => chatFileInputRef.current?.click()}
                 disabled={state.isProcessing || !!chatFile} 
                 className="p-3 rounded-xl text-slate-400 hover:text-[#ec7b5d] hover:bg-slate-50 transition-colors disabled:opacity-50"
                 title="Attach File"
              >
                 <Paperclip size={20} />
              </button>

              {state.isProcessing ? (
                <button 
                  onClick={handleStop}
                  className="bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-500 px-5 py-3 rounded-2xl text-sm font-bold transition-colors flex items-center gap-2"
                >
                  <StopCircle size={18} />
                  Stop
                </button>
              ) : (
                <button 
                  onClick={handleStartTask}
                  disabled={!inputText.trim() && !chatFile}
                  className="bg-[#ec7b5d] hover:bg-[#d96a4c] text-white px-6 py-3 rounded-2xl text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-orange-500/30 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
                >
                  <span className="hidden md:inline">Start Mission</span>
                  <Send size={18} fill="currentColor" />
                </button>
              )}
            </div>
          </div>
          <div className="max-w-4xl mx-auto mt-3 flex justify-between px-2">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
               Powered by Google Gemini
            </p>
             <p className="text-[10px] text-slate-400">
              Shift + Enter for new line
            </p>
          </div>
        </div>

      </div>

      {/* Canvas Sidebar */}
      {showCanvas && (
          <Canvas 
            content={canvasContent}
            onChange={setCanvasContent}
            onClose={() => setShowCanvas(false)}
            onSaveAsFile={handleSaveCanvasAsFile}
          />
      )}
    </div>
  );
}