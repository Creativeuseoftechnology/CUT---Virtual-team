import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { jsPDF } from 'jspdf';
import { X, Copy, Check, Eye, PenTool, Download, Save, ChevronDown, FileJson, FileType, FileText } from 'lucide-react';

interface CanvasProps {
  content: string;
  onChange: (newContent: string) => void;
  onClose: () => void;
  onSaveAsFile: (content: string) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ content, onChange, onClose, onSaveAsFile }) => {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    downloadFile(blob, `report-${new Date().toISOString().slice(0,10)}.md`);
  };

  const handleDownloadTXT = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    downloadFile(blob, `report-${new Date().toISOString().slice(0,10)}.txt`);
  };

  const handleDownloadHTML = () => {
    // Simple HTML wrapper
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Report Export</title>
      <style>body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 20px; }</style>
    </head>
    <body>
      <pre style="white-space: pre-wrap; font-family: sans-serif;">${content}</pre>
      <!-- Note: For full markdown rendering in HTML export, we'd need a parser library here, keeping it simple as pre-wrap for now or raw content -->
    </body>
    </html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    downloadFile(blob, `report-${new Date().toISOString().slice(0,10)}.html`);
  };

  const handleDownloadPDF = () => {
    const doc = new jsPDF();
    const splitText = doc.splitTextToSize(content, 180); // 180mm width (A4 is 210mm)
    
    let y = 20;
    // Simple text dump to PDF (doesn't support rich markdown styling perfectly but gets text out)
    // Add page logic
    const pageHeight = 280;
    
    splitText.forEach((line: string) => {
        if (y > pageHeight) {
            doc.addPage();
            y = 20;
        }
        doc.text(line, 15, y);
        y += 7;
    });

    doc.save(`report-${new Date().toISOString().slice(0,10)}.pdf`);
    setShowDownloadMenu(false);
  };

  const handleSaveAsFile = () => {
    onSaveAsFile(content);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 shadow-xl w-full md:w-[600px] lg:w-[700px] transition-all duration-300 z-20">
      
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 bg-slate-50/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
            <h2 className="font-display font-bold text-lg text-[#575756]">Canvas</h2>
            <div className="flex bg-slate-200/50 rounded-lg p-1">
                <button
                    onClick={() => setMode('edit')}
                    className={`p-1.5 rounded-md transition-all ${mode === 'edit' ? 'bg-white shadow text-[#ec7b5d]' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Edit Mode"
                >
                    <PenTool size={14} />
                </button>
                <button
                    onClick={() => setMode('preview')}
                    className={`p-1.5 rounded-md transition-all ${mode === 'preview' ? 'bg-white shadow text-[#ec7b5d]' : 'text-slate-400 hover:text-slate-600'}`}
                    title="Preview Mode"
                >
                    <Eye size={14} />
                </button>
            </div>
        </div>

        <div className="flex items-center gap-2">
            <button 
                onClick={handleSaveAsFile}
                className="p-2 text-slate-400 hover:text-[#ec7b5d] hover:bg-orange-50 rounded-lg transition-colors relative"
                title="Save as Project File (Available to Agents)"
            >
                {saved ? <Check size={18} className="text-green-500" /> : <Save size={18} />}
            </button>
            <div className="w-px h-6 bg-slate-200 mx-1"></div>
            
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
                        <button onClick={handleDownloadMD} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileJson size={14} className="text-[#ec7b5d]" /> Markdown (.md)
                        </button>
                        <button onClick={handleDownloadPDF} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileType size={14} className="text-[#ec7b5d]" /> PDF (.pdf)
                        </button>
                        <button onClick={handleDownloadHTML} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileText size={14} className="text-[#ec7b5d]" /> HTML (.html)
                        </button>
                        <button onClick={handleDownloadTXT} className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 flex items-center gap-2">
                            <FileType size={14} className="text-[#ec7b5d]" /> Plain Text (.txt)
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
        {mode === 'edit' ? (
            <textarea
                value={content}
                onChange={(e) => onChange(e.target.value)}
                className="w-full h-full p-8 resize-none focus:outline-none font-mono text-sm leading-relaxed text-slate-600 bg-[#fafafa]"
                placeholder="Start typing or copy content from the chat..."
                spellCheck={false}
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
      
      {/* Footer Status */}
      <div className="h-8 bg-white border-t border-slate-100 flex items-center justify-between px-6">
         <span className="text-[10px] text-slate-400 font-mono">
             {content.length} characters • {content.split(/\s+/).filter(Boolean).length} words
         </span>
         <span className="text-[10px] text-slate-400">
             {mode === 'edit' ? 'Markdown Editor' : 'Visual Preview'}
         </span>
      </div>
    </div>
  );
};