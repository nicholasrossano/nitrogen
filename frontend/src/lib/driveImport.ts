import { openGooglePicker } from '@/lib/googlePicker';
import type { DriveImportResult } from '@/lib/api';

interface ImportFromDriveViaPickerArgs {
  projectId: string;
  driveConnected: boolean;
  connectDrive: (projectId: string) => Promise<void>;
  getDriveAccessToken: () => Promise<string>;
  importFromDrive: (projectId: string, fileIds: string[]) => Promise<DriveImportResult>;
}

interface ImportFromDriveViaPickerResult {
  importedCount: number;
  errorCount: number;
  firstError: string | null;
}

export async function importFromDriveViaPicker({
  projectId,
  driveConnected,
  connectDrive,
  getDriveAccessToken,
  importFromDrive,
}: ImportFromDriveViaPickerArgs): Promise<ImportFromDriveViaPickerResult> {
  if (!driveConnected) {
    await connectDrive(projectId);
    return { importedCount: 0, errorCount: 0, firstError: null };
  }

  const accessToken = await getDriveAccessToken();
  return new Promise<ImportFromDriveViaPickerResult>((resolve, reject) => {
    openGooglePicker(
      accessToken,
      async (files) => {
        if (files.length === 0) {
          resolve({ importedCount: 0, errorCount: 0, firstError: null });
          return;
        }
        try {
          const result = await importFromDrive(
            projectId,
            files.map((file) => file.id),
          );
          resolve({
            importedCount: result.imported.length,
            errorCount: result.errors.length,
            firstError: result.errors[0]?.error ?? null,
          });
        } catch (err) {
          reject(err);
        }
      },
      () => resolve({ importedCount: 0, errorCount: 0, firstError: null }),
    );
  });
}
