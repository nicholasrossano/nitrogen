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

export const SUPPORTED_EXTENSIONS = '.pdf,.docx,.xlsx,.xls';

/** Filter a file list down to supported types only */
export function filterSupportedFiles(files: File[]): {
  accepted: File[];
  rejected: string[];
} {
  const accepted: File[] = [];
  const rejected: string[] = [];

  for (const f of files) {
    if (SUPPORTED_MIME_TYPES.has(f.type)) {
      accepted.push(f);
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
