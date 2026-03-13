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
