import fs from 'fs';
import path from 'path';

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
  const dir = path.dirname(csvPath);
  ensureDir(dir);
  const tmp = `${csvPath}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, csvPath);
}
