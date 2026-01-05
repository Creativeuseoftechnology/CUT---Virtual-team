import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import { ProjectFile } from '../types';

// PDF.js import handling for esm.sh/browser environment
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// Configure PDF.js worker
if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;
}

const DB_NAME = 'CUT_VirtualTeam_DB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

// --- IndexedDB Helpers ---

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveFileToDB = async (file: ProjectFile, content: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put({ ...file, content });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getFileContentFromDB = async (id: string): Promise<string | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result?.content || null);
    request.onerror = () => reject(request.error);
  });
};

export const deleteFileFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearDB = async (): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
};

// --- NEW: Search Capability (Client-Side RAG) ---

interface SearchResult {
    fileId: string;
    fileName: string;
    excerpt: string;
    score: number;
}

export const searchFiles = async (query: string, availableFiles: ProjectFile[]): Promise<string> => {
    // Basic normalization
    const terms = query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 2);
    
    if (terms.length === 0) return "Query too short to search.";

    const results: SearchResult[] = [];

    // Iterate through all available files
    for (const file of availableFiles) {
        const content = await getFileContentFromDB(file.id);
        if (!content) continue;

        // Smart Chunking: Overlapping windows
        // Window size 1000 chars, overlap 200 chars to avoid cutting sentences context
        const chunkSize = 1000;
        const overlap = 200;
        
        for (let i = 0; i < content.length; i += (chunkSize - overlap)) {
            const chunk = content.substring(i, i + chunkSize);
            const lowerChunk = chunk.toLowerCase();
            
            // Scoring Logic: Count term occurrences
            let score = 0;
            let foundTerms = 0;
            
            terms.forEach(term => {
                if (lowerChunk.includes(term)) {
                    // Simple count
                    const count = lowerChunk.split(term).length - 1;
                    score += count;
                    foundTerms++;
                }
            });

            // Boost score if multiple DIFFERENT terms are found (better match)
            if (foundTerms > 1) score = score * 1.5;

            if (score > 0) {
                results.push({
                    fileId: file.id,
                    fileName: file.name,
                    excerpt: chunk.replace(/\s+/g, ' ').trim(), // Clean up newlines
                    score: score
                });
            }
        }
    }

    // Sort by Score desc
    results.sort((a, b) => b.score - a.score);

    // Take top 5 most relevant chunks
    const topResults = results.slice(0, 5);

    if (topResults.length === 0) return "No directly relevant information found in the project files for these keywords.";

    // Format for the AI
    return `FOUND ${topResults.length} RELEVANT SECTIONS FROM KNOWLEDGE BASE:\n\n` + topResults.map((r, index) => 
        `--- RESULT ${index + 1} (Score: ${r.score}) ---\n[SOURCE FILE: "${r.fileName}"]\n"${r.excerpt}..."`
    ).join('\n\n');
};


// --- File Parsers ---

const parsePDF = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    try {
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = `[METADATA]: PDF Document with ${pdf.numPages} pages.\n\n`;
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += `--- PAGE ${i} ---\n${pageText}\n\n`;
        }
        return fullText;
    } catch (e) {
        console.error("PDF Parse Error", e);
        return "Error parsing PDF file.";
    }
};

const parseExcel = (arrayBuffer: ArrayBuffer): string => {
    try {
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const sheetNames = workbook.SheetNames;
        
        // COMPRESSED JSON STRATEGY
        // We create a "Dense Matrix" (Array of Arrays) instead of Array of Objects.
        // This is significantly more token-efficient for LLMs and allows Cipher to easily map to Chart.js.

        let fullText = `[METADATA]: EXCEL DATASET (Structured)\n`;
        fullText += `Format: JSON_MATRIX (Array of Arrays). Row 0 contains Headers.\n`;
        fullText += `Sheets: ${sheetNames.join(', ')}\n`;
        fullText += `==========================================\n\n`;

        sheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            // header: 1 produces [["ColA", "ColB"], [1, 2], [3, 4]]
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
            
            if (jsonData.length > 0) {
                fullText += `=== DATASET: "${sheetName}" ===\n`;
                fullText += `[Type: JSON_MATRIX]\n`;
                // We stringify the matrix. This is very dense and token efficient.
                fullText += JSON.stringify(jsonData);
                fullText += `\n=== END DATASET: "${sheetName}" ===\n\n`;
            }
        });
        return fullText;
    } catch (e) {
        console.error("Excel Parse Error", e);
        return "Error parsing Excel file.";
    }
};

const parseWord = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    try {
        const result = await mammoth.extractRawText({ arrayBuffer });
        return `[METADATA]: Word Document (DOCX)\n\n${result.value}`;
    } catch (e) {
        console.error("Word Parse Error", e);
        return "Error parsing Word Document.";
    }
};

// Generic Text Parser
const parseTextFile = (arrayBuffer: ArrayBuffer, typeLabel: string = "TEXT"): string => {
    try {
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(arrayBuffer);
        return `[METADATA]: ${typeLabel} FILE\n\n${text}`;
    } catch (e) {
        return `Error reading text file: ${e}`;
    }
};

export const processFile = async (file: File): Promise<{ content: string; type: string }> => {
    const arrayBuffer = await file.arrayBuffer();
    const extension = file.name.split('.').pop()?.toLowerCase() || 'txt';
    let content = "";
    
    if (extension === 'pdf') {
        content = await parsePDF(arrayBuffer);
    } 
    else if (['xlsx', 'xls', 'ods'].includes(extension)) {
        content = parseExcel(arrayBuffer);
    } 
    else if (['docx'].includes(extension)) {
        content = await parseWord(arrayBuffer);
    } 
    else if (['ics', 'ical', 'ifb'].includes(extension)) {
        content = parseTextFile(arrayBuffer, "CALENDAR/ICAL");
    }
    else if (['csv', 'tsv'].includes(extension)) {
        // Use Excel parser logic (dense matrix) for CSVs too if we wanted, 
        // but for now text parser is fine unless we strictly want matrix.
        // Let's keep CSV as text for simplicity unless specifically requested.
        content = parseTextFile(arrayBuffer, "CSV DATA");
    }
    else if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(extension)) {
        content = parseTextFile(arrayBuffer, "STRUCTURED DATA");
    }
    else if (['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'html', 'css', 'sql', 'sh', 'bat', 'md', 'txt', 'log', 'env'].includes(extension)) {
        content = parseTextFile(arrayBuffer, "SOURCE CODE / TEXT");
    }
    else {
        try {
            content = parseTextFile(arrayBuffer, "UNKNOWN FILE TYPE (ATTEMPTING TEXT READ)");
        } catch (e) {
            content = "Error: File format not supported and text extraction failed.";
        }
    }

    return { content, type: extension };
};