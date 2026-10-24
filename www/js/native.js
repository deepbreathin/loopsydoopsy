// Bridges to Android when running inside the Capacitor app; harmless no-ops in a browser.
import { Capacitor, registerPlugin } from '../vendor/capacitor-core.js';

export const isNative = Capacitor.isNativePlatform();

const App = registerPlugin('App');
const Filesystem = registerPlugin('Filesystem');
const Share = registerPlugin('Share');

// Android back button. `handler` returns true if it dealt with it (e.g. closed a sheet);
// otherwise the app goes to the background rather than quitting mid-jam.
export function onBackButton(handler) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp();
  });
}

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

// Opens Android's share sheet (WhatsApp, Drive, Files, …) for one or more files.
export async function shareFiles(files, title) {
  const uris = [];
  for (const { blob, name } of files) {
    const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: 'CACHE' });
    uris.push(uri);
  }
  await Share.share({ title, files: uris, dialogTitle: title });
}

