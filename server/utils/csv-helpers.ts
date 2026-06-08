import fs from 'fs';
import { writeDurableFileSync } from '../storage/durable-fs.js';

export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function atomicWriteCsv(csvPath: string, content: string): void {
  writeDurableFileSync(csvPath, content);
}
