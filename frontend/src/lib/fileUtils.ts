/**
 * Recursively collect all File objects from a FileSystemEntry.
 * readEntries() returns at most 100 items per call, so we loop until exhausted.
 */
async function collectFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve([f]),
        () => resolve([]),
      );
    });
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const allEntries: FileSystemEntry[] = [];

    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      allEntries.push(...batch);
    } while (batch.length > 0);

    const nested = await Promise.all(allEntries.map(collectFiles));
    return nested.flat();
  }

  return [];
}

/**
 * Extract all files from a drop event, including files inside dropped folders.
 * Falls back to dataTransfer.files when the Entry API is unavailable.
 */
export async function extractFilesFromDrop(
  dataTransfer: DataTransfer,
): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);

  if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
    const entries = items
      .map((item) => item.webkitGetAsEntry())
      .filter((e): e is FileSystemEntry => e !== null);

    const nested = await Promise.all(entries.map(collectFiles));
    return nested.flat();
  }

  return Array.from(dataTransfer.files);
}

/** Supported MIME types for document uploads */
export const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const EXTENSION_TO_MIME_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

export const SUPPORTED_FILE_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.xlsx',
  '.xls',
]);

export const SUPPORTED_EXTENSIONS = '.pdf,.docx,.xlsx,.xls';

function hasSupportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const ext of SUPPORTED_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function getSupportedExtension(filename: string): string | null {
  const lower = filename.toLowerCase();
  for (const ext of SUPPORTED_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext;
  }
  return null;
}

function normalizeSupportedFile(file: File): File {
  if (SUPPORTED_MIME_TYPES.has(file.type)) return file;

  const ext = getSupportedExtension(file.name);
  if (!ext) return file;

  const inferredType = EXTENSION_TO_MIME_TYPE[ext];
  if (!inferredType || file.type === inferredType) return file;

  return new File([file], file.name, { type: inferredType });
}

/** Filter a file list down to supported types only */
export function filterSupportedFiles(files: File[]): {
  accepted: File[];
  rejected: string[];
} {
  const accepted: File[] = [];
  const rejected: string[] = [];

  for (const f of files) {
    // Folder uploads often produce files with empty or inconsistent MIME types,
    // so fall back to extension checks for the document formats we actually support.
    if (SUPPORTED_MIME_TYPES.has(f.type) || hasSupportedExtension(f.name)) {
      accepted.push(normalizeSupportedFile(f));
    } else {
      rejected.push(f.name);
    }
  }

  return { accepted, rejected };
}

/**
 * Generate a unique filename by appending " (1)", " (2)", etc. to the stem.
 * Follows the macOS Finder convention: "report (1).pdf".
 */
export function deduplicateFilename(
  name: string,
  existingNames: string[],
): string {
  const lower = existingNames.map((n) => n.toLowerCase());
  if (!lower.includes(name.toLowerCase())) return name;

  const dotIdx = name.lastIndexOf('.');
  const stem = dotIdx > 0 ? name.slice(0, dotIdx) : name;
  const ext = dotIdx > 0 ? name.slice(dotIdx) : '';

  let counter = 1;
  let candidate: string;
  do {
    candidate = `${stem} (${counter})${ext}`;
    counter++;
  } while (lower.includes(candidate.toLowerCase()));

  return candidate;
}

export interface DuplicateCheckResult {
  file: File;
  isDuplicate: boolean;
  newName: string;
}

/**
 * Check a batch of files against existing names and compute deduplicated
 * names for any collisions. Also avoids collisions *within* the batch itself.
 */
export function checkDuplicates(
  files: File[],
  existingNames: string[],
): DuplicateCheckResult[] {
  const taken = existingNames.map((n) => n.toLowerCase());
  const results: DuplicateCheckResult[] = [];

  for (const file of files) {
    const isDuplicate = taken.includes(file.name.toLowerCase());
    const newName = deduplicateFilename(file.name, taken.map((n) => n));
    taken.push(newName.toLowerCase());
    results.push({ file, isDuplicate, newName });
  }

  return results;
}

/**
 * Default concurrency for client-side uploads. Four is the sweet spot for
 * small-to-medium files over a typical broadband connection — enough to hide
 * per-request latency, low enough to avoid browser/network queueing.
 */
export const DEFAULT_UPLOAD_CONCURRENCY = 4;

/**
 * Run an async worker over each item with a bounded number of concurrent
 * workers. Order of completion is not preserved, but the worker receives the
 * item's original index so callers can correlate results back to the input.
 *
 * Kept intentionally tiny — we don't need p-limit's full feature set.
 */
export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });

  await Promise.all(runners);
}
