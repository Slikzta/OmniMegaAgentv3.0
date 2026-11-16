import { Capacitor, registerPlugin } from '@capacitor/core';
import { addDebugLog } from './debugLogStore';

interface BackupFilePluginInterface {
  exportBackupFile(options: {
    fileName: string;
    content: string;
  }): Promise<{
    ok: boolean;
    cancelled?: boolean;
    mode?: 'saved' | 'shared';
    fileName?: string;
    savedPath?: string;
  }>;
  pickBackupFile(): Promise<{
    ok: boolean;
    cancelled?: boolean;
    fileName?: string;
    jsonText?: string;
  }>;
}

const BackupFileNative = registerPlugin<BackupFilePluginInterface>('BackupFile');

export function formatOmniBackupFilename(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `omni-backup-${year}-${month}-${day}.json`;
}

export function isZipArchiveBytes(bytes: Uint8Array, fileName?: string): boolean {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return true;
  }
  return Boolean(fileName && fileName.toLowerCase().trim().endsWith('.zip'));
}

async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('ZIP decompression is not supported in this runtime.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  await writer.write(copy);
  await writer.close();

  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function extractBackupJsonFromBytes(
  bytes: Uint8Array,
  fileName?: string,
): Promise<string> {
  if (!isZipArchiveBytes(bytes, fileName)) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate End of Central Directory (0x06054b50) within last 64KB + 22 bytes
  const minOffset = Math.max(0, bytes.length - 65557);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Invalid or corrupted ZIP backup archive.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  if (cdOffset >= bytes.length) {
    throw new Error('Invalid ZIP central directory.');
  }

  const utf8 = new TextDecoder('utf-8');
  let cursor = cdOffset;
  let firstJsonCandidate: string | null = null;

  for (let idx = 0; idx < totalEntries && cursor + 46 <= bytes.length; idx++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      break;
    }
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const entryName = utf8.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    if (
      !entryName ||
      entryName.endsWith('/') ||
      entryName.startsWith('__MACOSX/') ||
      !entryName.toLowerCase().endsWith('.json')
    ) {
      continue;
    }

    if (localHeaderOffset + 30 > bytes.length || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error('Invalid ZIP entry header.');
    }
    const lhNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lhExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lhNameLen + lhExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) {
      throw new Error('Truncated ZIP backup entry.');
    }

    const compressedSlice = bytes.subarray(dataStart, dataEnd);
    let rawEntryBytes: Uint8Array;
    if (method === 0) {
      rawEntryBytes = compressedSlice;
    } else if (method === 8) {
      rawEntryBytes = await inflateRawBytes(compressedSlice);
    } else {
      throw new Error(`Unsupported ZIP compression method (${method}) for ${entryName}.`);
    }

    const text = utf8.decode(rawEntryBytes).trim();
    if (!text) continue;
    const lowerName = entryName.toLowerCase();
    if (
      lowerName.includes('backup') ||
      (text.startsWith('{') &&
        (text.includes('"settingsV3"') || text.includes('"summaries"') || text.includes('"sessions"')))
    ) {
      return text;
    }
    if (!firstJsonCandidate) {
      firstJsonCandidate = text;
    }
  }

  if (firstJsonCandidate) {
    return firstJsonCandidate;
  }
  throw new Error('ZIP file does not contain a valid backup .json file.');
}

export interface ExportBackupOutcome {
  ok: boolean;
  cancelled?: boolean;
  mode: 'saved' | 'shared' | 'downloaded';
  fileName: string;
  savedPath: string;
}

export async function exportBackupWithDialog(jsonText: string): Promise<ExportBackupOutcome> {
  const fileName = formatOmniBackupFilename();

  if (Capacitor.isNativePlatform()) {
    const res = await BackupFileNative.exportBackupFile({
      fileName,
      content: jsonText,
    });
    if (!res.ok || res.cancelled) {
      return {
        ok: false,
        cancelled: true,
        mode: 'saved',
        fileName,
        savedPath: '',
      };
    }
    const mode = res.mode === 'shared' ? 'shared' : 'saved';
    const savedPath = mode === 'shared' ? 'shared' : res.savedPath || res.fileName || fileName;
    addDebugLog(
      'Export:Saved',
      `[Export:Saved] file=${res.fileName || fileName} mode=${mode} location=${savedPath}`,
    );
    return {
      ok: true,
      mode,
      fileName: res.fileName || fileName,
      savedPath,
    };
  }

  const pickerFn = typeof window !== 'undefined' ? (window as any).showSaveFilePicker : undefined;
  if (typeof pickerFn === 'function') {
    try {
      const handle = await pickerFn({
        suggestedName: fileName,
        types: [
          {
            description: 'Omni Backup JSON',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonText);
      await writable.close();
      const savedPath = handle?.name || fileName;
      addDebugLog('Export:Saved', `[Export:Saved] file=${fileName} mode=saved location=${savedPath}`);
      return {
        ok: true,
        mode: 'saved',
        fileName,
        savedPath,
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return {
          ok: false,
          cancelled: true,
          mode: 'saved',
          fileName,
          savedPath: '',
        };
      }
      // Fall through to browser download fallback
    }
  }

  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  addDebugLog('Export:Saved', `[Export:Saved] file=${fileName} mode=downloaded location=${fileName}`);
  return {
    ok: true,
    mode: 'downloaded',
    fileName,
    savedPath: fileName,
  };
}

export async function pickNativeBackupFile(): Promise<{
  ok: boolean;
  cancelled?: boolean;
  fileName?: string;
  jsonText?: string;
}> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false };
  }
  return await BackupFileNative.pickBackupFile();
}
