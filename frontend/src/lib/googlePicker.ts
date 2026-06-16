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
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.apple.pages',
  'application/x-iwork-pages-sffpages',
  'application/vnd.apple.iwork.pages.sffpages',
  'application/vnd.apple.keynote',
  'application/x-iwork-keynote-sffkey',
  'application/vnd.apple.iwork.keynote.sffkey',
  'application/vnd.apple.numbers',
  'application/x-iwork-numbers-sffnumbers',
  'application/vnd.apple.iwork.numbers.sffnumbers',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
].join(',');

let gapiScriptPromise: Promise<void> | null = null;
let pickerApiPromise: Promise<void> | null = null;

function loadGoogleApiScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Picker is only available in the browser.'));
  }

  // @ts-ignore
  if (window.gapi) return Promise.resolve();
  if (gapiScriptPromise) return gapiScriptPromise;

  gapiScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById('google-api-script') as HTMLScriptElement | null;
    if (existingScript) {
      // If the script is already loaded, resolve immediately instead of
      // waiting for a load event that has already fired.
      // @ts-ignore
      if (window.gapi || existingScript.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Failed to load Google API script.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-api-script';
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Google API script.'));
    document.body.appendChild(script);
  }).catch((err) => {
    gapiScriptPromise = null;
    throw err;
  });

  return gapiScriptPromise;
}

function loadPickerApi(): Promise<void> {
  if (pickerApiPromise) return pickerApiPromise;

  pickerApiPromise = loadGoogleApiScript()
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          try {
            // @ts-ignore
            window.gapi.load('picker', {
              callback: () => resolve(),
              onerror: () => reject(new Error('Failed to load Google Picker API.')),
            });
          } catch (err) {
            reject(err instanceof Error ? err : new Error('Failed to initialize Google Picker API.'));
          }
        }),
    )
    .catch((err) => {
      pickerApiPromise = null;
      throw err;
    });

  return pickerApiPromise;
}

export function warmGooglePicker(): void {
  if (typeof window === 'undefined') return;
  void loadPickerApi();
}

export function openGooglePicker(
  accessToken: string,
  onSelect: (files: DrivePickerFile[]) => void,
  onCancel?: () => void,
): void {
  if (typeof window === 'undefined') return;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? '';
  const appId = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? '';

  void loadPickerApi()
    .then(() => {
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
        .setOrigin(window.location.origin)
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
    })
    .catch((err) => {
      console.error('Could not initialize Google Picker:', err);
      onCancel?.();
    });
}
