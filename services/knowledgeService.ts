import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';
import { ProjectFile } from '../types';

// PDF.js import handling for esm.sh/browser environment
// The wildcard import might result in a module namespace where the actual library is in 'default'
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
        // Use the resolved pdfjs instance
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += `[Page ${i}]\n${pageText}\n\n`;
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
        let fullText = "";
        workbook.SheetNames.forEach(sheetName => {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            fullText += `[Sheet: ${sheetName}]\n${csv}\n\n`;
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
        return result.value;
    } catch (e) {
        console.error("Word Parse Error", e);
        return "Error parsing Word Document.";
    }
};

export const processFile = async (file: File): Promise<{ content: string; type: string }> => {
    const arrayBuffer = await file.arrayBuffer();
    const extension = file.name.split('.').pop()?.toLowerCase();

    let content = "";
    
    if (extension === 'pdf') {
        content = await parsePDF(arrayBuffer);
    } else if (extension === 'xlsx' || extension === 'xls' || extension === 'csv') {
        content = parseExcel(arrayBuffer);
    } else if (extension === 'docx') {
        content = await parseWord(arrayBuffer);
    } else {
        // Fallback for text files
        const decoder = new TextDecoder('utf-8');
        content = decoder.decode(arrayBuffer);
    }

    return { content, type: extension || 'txt' };
};