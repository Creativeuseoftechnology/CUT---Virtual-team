import React, { useState, useRef } from 'react';
import { Agent, AgentRole } from '../types';
import { Database, Plus, Settings, Upload, Save, X, FileText } from 'lucide-react';

interface AgentCardProps {
  agent: Agent;
  isActive: boolean;
  isWorking: boolean;
  onAddKnowledge: (agentId: AgentRole, knowledge: string) => void;
  onUpdatePrompt: (agentId: AgentRole, prompt: string) => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ agent, isActive, isWorking, onAddKnowledge, onUpdatePrompt }) => {
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newKnowledge, setNewKnowledge] = useState('');
  const [promptDraft, setPromptDraft] = useState(agent.systemPrompt);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Don't show user in the sidebar
  if (agent.id === AgentRole.USER) return null;

  const handleAddKnowledge = (e: React.FormEvent) => {
    e.preventDefault();
    if (newKnowledge.trim()) {
      onAddKnowledge(agent.id, newKnowledge.trim());
      setNewKnowledge('');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        // Add content as a "Fact" but labeled as a file
        const knowledgeEntry = `[FILE: ${file.name}]\n${text.substring(0, 15000)}`; // Limit character count for context window safety
        onAddKnowledge(agent.id, knowledgeEntry);
      }
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSavePrompt = () => {
    onUpdatePrompt(agent.id, promptDraft);
    setShowSettings(false);
  };

  const toggleSettings = () => {
    if (!showSettings) {
        // Reset draft to current real prompt when opening
        setPromptDraft(agent.systemPrompt);
        setShowKnowledge(false); // Close other drawer
    }
    setShowSettings(!showSettings);
  };

  const toggleKnowledge = () => {
    if (!showKnowledge) {
        setShowSettings(false); // Close other drawer
    }
    setShowKnowledge(!showKnowledge);
  };

  return (
    <div 
      className={`
        relative p-4 rounded-2xl border transition-all duration-300 mb-3
        ${isActive 
          ? `bg-white shadow-md border-[#ec7b5d]/30` 
          : 'bg-transparent border-transparent hover:bg-slate-100'}
      `}
    >
      <div className="flex items-center gap-3">
        <div className={`
          w-10 h-10 rounded-full flex items-center justify-center text-xl shadow-sm transition-all flex-shrink-0
          ${agent.color} text-white
          ${isWorking ? 'animate-pulse scale-110' : ''}
        `}>
          {agent.avatar}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className={`font-display font-bold text-sm truncate ${isActive ? 'text-[#ec7b5d]' : 'text-[#575756]'}`}>
              {agent.name}
            </h3>
            
            <div className="flex gap-1">
                {/* Knowledge Toggle */}
                <button 
                onClick={toggleKnowledge}
                className={`p-1.5 rounded transition-colors ${showKnowledge ? 'bg-[#ec7b5d]/10 text-[#ec7b5d]' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'}`}
                title="View Knowledge Base"
                >
                <Database size={14} />
                </button>
                {/* Settings Toggle */}
                <button 
                onClick={toggleSettings}
                className={`p-1.5 rounded transition-colors ${showSettings ? 'bg-[#ec7b5d]/10 text-[#ec7b5d]' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-600'}`}
                title="Edit System Prompt"
                >
                <Settings size={14} />
                </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 truncate font-medium">{agent.role}</p>
        </div>
      </div>
      
      {/* Description (Hidden if any drawer is open to save space) */}
      {!showKnowledge && !showSettings && (
        <p className={`mt-2 text-xs leading-relaxed line-clamp-2 ${isActive ? 'text-slate-600' : 'text-slate-400'}`}>
          {agent.description}
        </p>
      )}

      {/* --- KNOWLEDGE BASE DRAWER --- */}
      {showKnowledge && (
        <div className="mt-3 pt-3 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
           <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
             <Database size={10} /> Knowledge Base
           </h4>
           
           <ul className="space-y-2 mb-3 max-h-40 overflow-y-auto pr-1 scrollbar-thin">
             {agent.knowledgeBase.length > 0 ? (
               agent.knowledgeBase.map((k, i) => {
                 const isFile = k.startsWith('[FILE:');
                 return (
                    <li key={i} className={`text-[10px] leading-snug text-slate-600 bg-slate-50 p-2 rounded border border-slate-100 ${isFile ? 'border-l-2 border-l-[#ec7b5d]' : ''}`}>
                         {isFile ? (
                             <div className="flex items-center gap-1 font-semibold text-[#ec7b5d] mb-1">
                                 <FileText size={10} />
                                 {k.split('\n')[0].replace('[FILE:', '').replace(']', '')}
                             </div>
                         ) : null}
                         <div className="line-clamp-3 opacity-80">
                             {isFile ? k.split('\n').slice(1).join(' ') : k}
                         </div>
                    </li>
                 )
               })
             ) : (
               <li className="text-[10px] text-slate-400 italic">No specific knowledge yet.</li>
             )}
           </ul>

           {/* Add Knowledge Input */}
           <div className="flex items-center gap-1">
             {/* Hidden File Input */}
             <input 
                type="file" 
                ref={fileInputRef}
                className="hidden"
                // Removed restrictions to allow *all* text types
                onChange={handleFileUpload}
             />
             <button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded border border-slate-200 text-slate-500 hover:text-[#ec7b5d] hover:border-[#ec7b5d] transition-colors bg-white"
                title="Upload Text File"
             >
                <Upload size={12} />
             </button>

             <form onSubmit={handleAddKnowledge} className="flex-1 flex gap-1">
                <input 
                    type="text" 
                    value={newKnowledge}
                    onChange={(e) => setNewKnowledge(e.target.value)}
                    placeholder="Add fact..."
                    className="flex-1 text-[10px] p-1.5 rounded border border-slate-200 focus:outline-none focus:border-[#ec7b5d]"
                />
                <button 
                    type="submit"
                    disabled={!newKnowledge.trim()}
                    className="bg-[#ec7b5d] text-white p-1.5 rounded hover:bg-[#d96a4c] disabled:opacity-50"
                >
                <Plus size={12} />
                </button>
             </form>
           </div>
        </div>
      )}

      {/* --- SETTINGS DRAWER (System Prompt) --- */}
      {showSettings && (
        <div className="mt-3 pt-3 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-200">
           <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
             <Settings size={10} /> System Prompt
           </h4>
           
           <textarea 
             className="w-full text-[10px] p-2 bg-slate-50 border border-slate-200 rounded min-h-[120px] focus:outline-none focus:border-[#ec7b5d] font-mono leading-relaxed"
             value={promptDraft}
             onChange={(e) => setPromptDraft(e.target.value)}
           />

           <div className="flex justify-end gap-2 mt-2">
              <button 
                onClick={toggleSettings}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button 
                onClick={handleSavePrompt}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-[#ec7b5d] text-white hover:bg-[#d96a4c]"
              >
                <Save size={10} /> Save
              </button>
           </div>
        </div>
      )}

      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-[#ec7b5d] rounded-r-full"></div>
      )}
    </div>
  );
};