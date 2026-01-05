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
        
        // CRITICAL UPDATE: Provide a clear summary of all tabs first so the Agent knows what exists.
        let fullText = `[METADATA]: EXCEL WORKBOOK SUMMARY\n`;
        fullText += `Total Sheets: ${sheetNames.length}\n`;
        fullText += `Sheet Names: ${sheetNames.join(', ')}\n`;
        fullText += `==========================================\n\n`;

        sheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            // Sheet_to_csv is robust for LLMs as it preserves row structure
            const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
            
            fullText += `=== START OF SHEET: "${sheetName}" ===\n`;
            fullText += `[Context: Data from tab named '${sheetName}']\n`;
            fullText += csv;
            fullText += `\n=== END OF SHEET: "${sheetName}" ===\n\n`;
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

// Generic Text Parser (for Code, Logs, iCal, CSV, JSON, XML, etc.)
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
    // Get extension and handle edge cases (like .tar.gz) - simplistic approach here
    const extension = file.name.split('.').pop()?.toLowerCase() || 'txt';

    let content = "";
    
    // --- ROUTING LOGIC ---
    
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
        // Explicit handling for Calendar files
        content = parseTextFile(arrayBuffer, "CALENDAR/ICAL");
    }
    else if (['csv', 'tsv'].includes(extension)) {
        // Parse CSV specifically to label it
        content = parseTextFile(arrayBuffer, "CSV DATA");
    }
    else if (['json', 'xml', 'yaml', 'yml', 'toml'].includes(extension)) {
        content = parseTextFile(arrayBuffer, "STRUCTURED DATA");
    }
    else if (['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'php', 'html', 'css', 'sql', 'sh', 'bat', 'md', 'txt', 'log', 'env'].includes(extension)) {
        content = parseTextFile(arrayBuffer, "SOURCE CODE / TEXT");
    }
    else {
        // FALLBACK: Try to read EVERYTHING else as text. 
        // This covers unknown code types, config files, etc.
        // If it's a binary image or executable, it might look garbage, but better than rejecting it.
        try {
            content = parseTextFile(arrayBuffer, "UNKNOWN FILE TYPE (ATTEMPTING TEXT READ)");
        } catch (e) {
            content = "Error: File format not supported and text extraction failed.";
        }
    }

    return { content, type: extension };
};