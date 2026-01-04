import React from 'react';
import { Message, AgentRole, Agent } from '../types';
import { PanelRightOpen } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  agents: Record<AgentRole, Agent>;
  onAddToCanvas?: (content: string) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, agents, onAddToCanvas }) => {
  const agent = agents[message.senderId];
  const isUser = message.senderId === AgentRole.USER;
  const isSystemMsg = message.type === 'plan' || message.type === 'delegation';

  // Different styles for different message types (Light Theme)
  let borderColor = 'border-slate-100';
  let bgColor = 'bg-white';
  let textColor = 'text-[#575756]';
  
  if (isUser) {
    bgColor = 'bg-[#ec7b5d]'; // Brand Orange
    textColor = 'text-white';
    borderColor = 'border-[#ec7b5d]';
  } else if (message.type === 'plan') {
    bgColor = 'bg-slate-50';
    borderColor = 'border-slate-200';
  } else if (message.type === 'delegation') {
    bgColor = 'bg-orange-50';
    borderColor = 'border-orange-100';
  } else if (message.type === 'result') {
    bgColor = 'bg-green-50';
    borderColor = 'border-green-100';
  } else if (message.type === 'final') {
    bgColor = 'bg-white';
    borderColor = 'border-[#ec7b5d]'; 
  }

  // Parse for Images in the markdown (e.g., ![Alt](data:image...))
  const renderContent = (content: string) => {
    // Regex to find markdown images with base64 data
    const imgRegex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^\)]+)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = imgRegex.exec(content)) !== null) {
      // Add text before image
      if (match.index > lastIndex) {
        parts.push(
            <span key={`text-${lastIndex}`}>
                {content.substring(lastIndex, match.index)}
            </span>
        );
      }
      
      // Add Image
      parts.push(
        <div key={`img-${match.index}`} className="my-3 rounded-lg overflow-hidden shadow-sm border border-slate-100">
           <img 
             src={match[2]} 
             alt={match[1] || 'Generated Image'} 
             className="max-w-full h-auto object-cover" 
           />
        </div>
      );
      
      lastIndex = imgRegex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(
        <span key={`text-end`}>
            {content.substring(lastIndex)}
        </span>
      );
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div className={`flex w-full mb-8 group ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
        
        {/* Avatar */}
        <div className={`
          flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm text-white mt-1 shadow-sm
          ${agent.color}
        `}>
          {agent.avatar}
        </div>

        {/* Content Box */}
        <div className={`flex flex-col gap-1 min-w-0 ${isUser ? 'items-end' : 'items-start'}`}>
          <div className="flex items-center gap-2 px-1">
            <span className={`text-sm font-display font-bold ${isUser ? 'text-[#575756]' : 'text-[#575756]'}`}>
              {agent.name}
            </span>
            {!isUser && (
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold bg-slate-100 px-2 py-0.5 rounded-full">
                {message.type}
              </span>
            )}
            <span className="text-[9px] text-slate-300 font-mono bg-slate-50 px-1 rounded">
               {agent.model}
            </span>
            
            {/* Canvas Action (Only for non-user, result/final messages) */}
            {!isUser && !isSystemMsg && onAddToCanvas && (
                 <button 
                    onClick={() => onAddToCanvas(message.content)}
                    className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-[#ec7b5d]"
                    title="Open in Canvas"
                 >
                    <PanelRightOpen size={14} />
                 </button>
            )}
          </div>
          
          <div className={`
            rounded-3xl p-5 border shadow-sm leading-relaxed
            ${borderColor} ${bgColor} ${textColor}
            ${isUser ? 'rounded-tr-none shadow-[#ec7b5d]/20' : 'rounded-tl-none'}
          `}>
             <div className="whitespace-pre-wrap font-normal text-[15px]">
                {renderContent(message.content)}
             </div>
          </div>
          
          <span className="text-[10px] text-slate-400 px-2">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
};