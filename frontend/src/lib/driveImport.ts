import { openGooglePicker } from '@/lib/googlePicker';
import type { DriveLinkedFile } from '@/lib/api';

interface ImportFromDriveViaPickerArgs {
  initiativeId: string;
  driveConnected: boolean;
  connectDrive: (initiativeId: string) => Promise<void>;
  getDriveAccessToken: () => Promise<string>;
  importFromDrive: (initiativeId: string, fileIds: string[]) => Promise<DriveLinkedFile[]>;
}

interface ImportFromDriveViaPickerResult {
  importedCount: number;
}

export async function importFromDriveViaPicker({
  initiativeId,
  driveConnected,
  connectDrive,
  getDriveAccessToken,
  importFromDrive,
}: ImportFromDriveViaPickerArgs): Promise<ImportFromDriveViaPickerResult> {
  if (!driveConnected) {
    await connectDrive(initiativeId);
    return { importedCount: 0 };
  }

  const accessToken = await getDriveAccessToken();
  return new Promise<ImportFromDriveViaPickerResult>((resolve, reject) => {
    openGooglePicker(
      accessToken,
      async (files) => {
        if (files.length === 0) {
          resolve({ importedCount: 0 });
          return;
        }
        try {
          const imported = await importFromDrive(
            initiativeId,
            files.map((file) => file.id),
          );
          resolve({ importedCount: imported.length });
        } catch (err) {
          reject(err);
        }
      },
      () => resolve({ importedCount: 0 }),
    );
  });
}
