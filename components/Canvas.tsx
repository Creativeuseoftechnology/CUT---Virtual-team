import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { jsPDF } from 'jspdf';
import * as Diff from 'diff';
import { X, Copy, Check, Eye, Download, Save, ChevronDown, FileJson, FileType, FileText, Code, GitCommit, GitCompare, History, ArrowLeft, ArrowRight } from 'lucide-react';

interface CanvasProps {
  content: string;
  onChange: (newContent: string) => void;
  onClose: () => void;
  onSaveAsFile: (content: string) => void;
}

interface Version {
  timestamp: number;
  content: string;
  label: string;
}

export const Canvas: React.FC<CanvasProps> = ({ content, onChange, onClose, onSaveAsFile }) => {
  const [mode, setMode] = useState<'edit' | 'preview' | 'diff'>('preview');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  
  // Version Control State
  const [history, setHistory] = useState<Version[]>([]);
  const [currentVersionIndex, setCurrentVersionIndex] = useState<number>(-1);

  const menuRef = useRef<HTMLDivElement>(null);

  // Detect content type
  const isHTML = content.trim().startsWith('<!DOCTYPE html') || content.trim().startsWith('<html');

  // Initialize History with initial content or update when content prop changes from outside (Agents)
  useEffect(() => {
    if (content && (history.length === 0 || content !== history[history.length - 1].content)) {
        const newVersion: Version = {
            timestamp: Date.now(),
            content: content,
            label: history.length === 0 ? 'Initial Draft' : `Version ${history.length + 1}`
        };
        const newHistory = [...history, newVersion];
        setHistory(newHistory);
        setCurrentVersionIndex(newHistory.length - 1);
    }
  }, [content]);

  // Handle version selection
  const handleRestoreVersion = (index: number) => {
    setCurrentVersionIndex(index);
    // Notify parent of change without triggering a new history entry immediately (handled by useEffect logic but we want to view it first)
    // Actually, we should just update the view here, and if they 'save' or edit, it becomes a new branch/version.
    // For simplicity, restore updates the main content.
    onChange(history[index].content);
    setShowHistory(false);
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setShowDownloadMenu(false);
  };

  const handleDownloadMD = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    downloadFile(blob, `artifact-${new Date().toISOString().slice(0,10)}.md`);
  };

  const handleDownloadTXT = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    downloadFile(blob, `artifact-${new Date().toISOString().slice(0,10)}.txt`);
  };

  const handleDownloadHTML = () => {
    const blob = new Blob([content], { type: 'text/html' });
    downloadFile(blob, `artifact-${new Date().toISOString().slice(0,10)}.html`);
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(content, 180);
    let y = 20;
    const pageHeight = 280;
    splitText.forEach((line: string) => {
        if (y > pageHeight) {
            doc.addPage();
            y = 20;
        }
        doc.text(line, 15, y);
        y += 7;
    });
    doc.save(`artifact-${new Date().toISOString().slice(0,10)}.pdf`);
    setShowDownloadMenu(false);
  };

  const handleSaveAsFile = () => {
    onSaveAsFile(content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // --- Diff Rendering Logic ---
  const renderDiff = () => {
    if (history.length < 2 || currentVersionIndex === 0) {
        return <div className="p-8 text-center text-slate-400">No previous version to compare against.</div>;
    }

    const oldText = history[currentVersionIndex - 1].content;
    const newText = history[currentVersionIndex].content;
    const diff = Diff.diffLines(oldText, newText);

    return (
        <div className="p-4 font-mono text-xs overflow-auto h-full bg-slate-50">
            {diff.map((part, index) => {
                const color = part.added ? 'bg-green-100 text-green-800 border-l-2 border-green-500' :
                              part.removed ? 'bg-red-100 text-red-800 border-l-2 border-red-500 line-through opacity-70' :
                              'text-slate-500';
                return (
                    <span key={index} className={`block whitespace-pre-wrap py-0.5 px-2 ${color}`}>
                        {part.value}
                    </span>
                );
            })}
        </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 shadow-xl w-full md:w-[600px] lg:w-[900px] transition-all duration-300 z-20">
      
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-lg text-[#575756]">
                {isHTML ? 'Interactive Artifact' : 'Canvas'}
            </h2>
            
            {/* View Toggle */}
            <div className="flex bg-slate-200/50 rounded-lg p-1">
                <button
                    onClick={() => setMode('edit')}
                    className={`p-1.5 rounded-md transition-all flex items-center gap-1 ${mode === 'edit' ? 'bg-white shadow text-[#ec7b5d]' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Code View"
                >
                    <Code size={14} /> <span className="text-[10px] font-bold">Code</span>
                </button>
                <button
                    onClick={() => setMode('preview')}
                    className={`p-1.5 rounded-md transition-all flex items-center gap-1 ${mode === 'preview' ? 'bg-white shadow text-[#ec7b5d]' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Visual Preview"
                >
                    <Eye size={14} /> <span className="text-[10px] font-bold">Preview</span>
                </button>
                <button
                    onClick={() => setMode('diff')}
                    className={`p-1.5 rounded-md transition-all flex items-center gap-1 ${mode === 'diff' ? 'bg-white shadow text-[#ec7b5d]' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Compare with Previous"
                >
                    <GitCompare size={14} /> <span className="text-[10px] font-bold">Diff</span>
                </button>
            </div>
        </div>

        <div className="flex items-center gap-2">
            
            {/* History Control */}
            <div className="relative">
                <button 
                    onClick={() => setShowHistory(!showHistory)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wide transition-all
                    ${history.length > 1 ? 'border-[#ec7b5d] text-[#ec7b5d] bg-orange-50 hover:bg-orange-100' : 'border-slate-200 text-slate-400'}`}
                >
                    <History size={12} />
                    {currentVersionIndex >= 0 ? `V${currentVersionIndex + 1}` : 'V1'}
                    <ChevronDown size={10} />
                </button>
                
                {showHistory && (
                    <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-30 max-h-64 overflow-y-auto">
                        <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-50">Version History</div>
                        {history.map((v, i) => (
                            <button
                                key={i}
                                onClick={() => handleRestoreVersion(i)}
                                className={`w-full text-left px-4 py-2 text-xs flex items-center justify-between hover:bg-slate-50 ${i === currentVersionIndex ? 'bg-orange-50 text-[#ec7b5d]' : 'text-slate-600'}`}
                            >
                                <span className="font-semibold">{v.label}</span>
                                <span className="text-[10px] opacity-60">{new Date(v.timestamp).toLocaleTimeString()}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="w-px h-6 bg-slate-200 mx-1"></div>

            {/* Actions */}
            <button 
                onClick={handleSaveAsFile}
                className="p-2 text-slate-400 hover:text-[#ec7b5d] hover:bg-orange-50 rounded-lg transition-colors relative"
                title="Save as Project File"
            >
                {saved ? <Check size={18} className="text-green-500" /> : <Save size={18} />}
            </button>
            
            {/* Download Dropdown */}
            <div className="relative" ref={menuRef}>
                <button 
                    onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${showDownloadMenu ? 'bg-orange-50 text-[#ec7b5d]' : 'text-slate-400 hover:text-[#ec7b5d] hover:bg-orange-50'}`}
                    title="Download Options"
                >
                    <Download size={18} />
                    <ChevronDown size={12} />
                </button>

                {showDownloadMenu && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                        {!isHTML && (
                            <>
                            <button onClick={handleDownloadMD} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                                <FileJson size={14} className="text-[#ec7b5d]" /> Markdown (.md)
                            </button>
                            <button onClick={handleDownloadPDF} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                                <FileType size={14} className="text-[#ec7b5d]" /> PDF (.pdf)
                            </button>
                            </>
                        )}
                        <button onClick={handleDownloadHTML} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileText size={14} className="text-[#ec7b5d]" /> HTML (.html)
                        </button>
                        <button onClick={handleDownloadTXT} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileType size={14} className="text-[#ec7b5d]" /> Source Code (.txt)
                        </button>
                    </div>
                )}
            </div>

            <button 
                onClick={handleCopy}
                className="p-2 text-slate-400 hover:text-[#ec7b5d] hover:bg-orange-50 rounded-lg transition-colors relative"
                title="Copy to Clipboard"
            >
                {copied ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            <button 
                onClick={onClose}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Close Canvas"
            >
                <X size={18} />
            </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative bg-white">
        
        {/* EDIT MODE */}
        {mode === 'edit' && (
            <textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-full p-8 resize-none focus:outline-none font-mono text-sm leading-relaxed text-slate-600 bg-[#fafafa]"
                placeholder="Start typing or copy content from the chat..."
                spellCheck={false}
            />
        )}

        {/* PREVIEW MODE */}
        {mode === 'preview' && (
            <div className="h-full w-full">
                 {isHTML ? (
                     <iframe 
                        srcDoc={content}
                        title="Interactive Preview"
                        className="w-full h-full border-0 bg-white"
                        sandbox="allow-scripts allow-popups allow-modals"
                     />
                 ) : (
                     <div className="h-full overflow-y-auto p-8 prose prose-slate prose-sm max-w-none scrollbar-thin">
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                                // Custom renderers to match app style
                                h1: ({node, ...props}) => <h1 className="font-display font-bold text-2xl mb-4 text-[#575756]" {...props} />,
                                h2: ({node, ...props}) => <h2 className="font-display font-bold text-xl mt-6 mb-3 text-[#575756]" {...props} />,
                                h3: ({node, ...props}) => <h3 className="font-display font-semibold text-lg mt-4 mb-2 text-[#575756]" {...props} />,
                                p: ({node, ...props}) => <p className="mb-4 leading-relaxed text-slate-600" {...props} />,
                                ul: ({node, ...props}) => <ul className="list-disc list-outside ml-4 mb-4 space-y-1" {...props} />,
                                ol: ({node, ...props}) => <ol className="list-decimal list-outside ml-4 mb-4 space-y-1" {...props} />,
                                blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-[#ec7b5d]/30 pl-4 italic text-slate-500 my-4" {...props} />,
                                code: ({node, ...props}) => <code className="bg-slate-100 text-[#ec7b5d] px-1 py-0.5 rounded text-xs font-mono" {...props} />,
                                pre: ({node, ...props}) => <pre className="bg-slate-800 text-slate-200 p-4 rounded-lg overflow-x-auto text-xs font-mono my-4" {...props} />,
                                a: ({node, ...props}) => <a className="text-[#ec7b5d] hover:underline" {...props} />,
                            }}
                        >
                            {content || "*Canvas is empty. Open a message from the chat to edit it here.*"}
                        </ReactMarkdown>
                     </div>
                 )}
            </div>
        )}

        {/* DIFF MODE */}
        {mode === 'diff' && renderDiff()}
        
      </div>
      
      {/* Footer Status */}
      <div className="h-8 bg-white border-t border-slate-100 flex items-center justify-between px-6">
         <span className="text-[10px] text-slate-400 font-mono flex items-center gap-2">
             <GitCommit size={10} /> {history.length} Versions
         </span>
         <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
             {mode === 'edit' && 'Editing'}
             {mode === 'preview' && (isHTML ? 'Interactive Preview' : 'Markdown Preview')}
             {mode === 'diff' && 'Difference View'}
         </span>
      </div>
    </div>
  );
};