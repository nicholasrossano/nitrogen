export interface DrivePickerFile {
  id: string;
  name: string;
  mimeType: string;
}

// MIME types shown in the Picker — document formats only, no images/videos
const PICKER_SUPPORTED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/csv',
  'application/rtf',
].join(',');

export function openGooglePicker(
  accessToken: string,
  onSelect: (files: DrivePickerFile[]) => void,
  onCancel?: () => void,
): void {
  if (typeof window === 'undefined') return;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? '';

  const launchPicker = () => {
    // @ts-ignore — Google Picker API loaded via <script>
    window.gapi.load('picker', () => {
      // @ts-ignore
      const { google } = window;

      const view = new google.picker.DocsView()
        .setMimeTypes(PICKER_SUPPORTED_MIMES)
        .setMode(google.picker.DocsViewMode.LIST)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true);

      const picker = new google.picker.PickerBuilder()
        .setAppId(appId)
        .setOAuthToken(accessToken)
        .setDeveloperKey(apiKey)
        .addView(view)
        .setCallback((data: any) => {
          if (data.action === google.picker.Action.PICKED) {
            const docs: any[] = data[google.picker.Response.DOCUMENTS];
            onSelect(
              docs.map((d) => ({
                id: d[google.picker.Document.ID],
                name: d[google.picker.Document.NAME],
                mimeType: d[google.picker.Document.MIME_TYPE],
              })),
            );
          } else if (data.action === google.picker.Action.CANCEL) {
            onCancel?.();
          }
        })
        .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
        .build();

      picker.setVisible(true);
    });
  };

  // @ts-ignore
  if (window.gapi) {
    launchPicker();
  } else {
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.onload = launchPicker;
    document.body.appendChild(script);
  }
}
