// Which browser this is, and the steps to install the app or allow the microphone in it.
// Browsers move their menus around between versions, so each has a second route too.

export function browserFrom(ua, { touchMac = false, brave = false } = {}) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchMac);
  const android = /Android/.test(ua);
  // Apps that open links in their own built-in browser (these can't record or install).
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\//.test(ua) || (android && /; wv\)/.test(ua))) return 'inapp';
  if (ios) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/FxiOS|EdgiOS/.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (android) {
    if (brave) return 'android-brave'; // Brave says it's Chrome; navigator.brave gives it away
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox/.test(ua)) return 'android-firefox';
    if (/EdgA/.test(ua)) return 'android-edge';
    return 'android-chrome';
  }
  if (/Firefox/.test(ua)) return 'desktop-firefox';
  if (/Edg\//.test(ua)) return 'desktop-edge';
  if (brave) return 'desktop-brave';
  if (/Chrome|Chromium/.test(ua)) return 'desktop-chrome';
  if (/Safari/.test(ua)) return 'mac-safari';
  return 'desktop-chrome';
}

export const browser = () => browserFrom(navigator.userAgent, { touchMac: navigator.maxTouchPoints > 1, brave: !!navigator.brave });

export const NAMES = {
  inapp: 'a browser inside another app',
  'ios-safari': 'Safari on iPhone / iPad',
  'ios-chrome': 'Chrome on iPhone / iPad',
  'ios-other': 'a browser on iPhone / iPad',
  samsung: 'Samsung Internet',
  'android-firefox': 'Firefox on Android',
  'android-edge': 'Edge on Android',
  'android-chrome': 'Chrome on Android',
  'android-brave': 'Brave on Android',
  'desktop-brave': 'Brave',
  'desktop-firefox': 'Firefox',
  'desktop-edge': 'Edge',
  'desktop-chrome': 'Chrome',
  'mac-safari': 'Safari on a Mac',
};

const OPEN_IN_BROWSER = [
  'This page opened inside another app (WhatsApp, Instagram, Facebook…), which can’t record or install apps.',
  'Tap that app’s ⋮ or ⋯ menu (or the share button) and choose Open in browser / Open in Chrome / Open in Safari.',
];

// Android itself has to let the browser use the microphone, as well as the browser letting the site.
const androidApp = (app) => `Still not working? Open your phone’s Settings → Apps → ${app} → Permissions → Microphone, and choose “Allow only while using the app”.`;

export const INSTALL = {
  inapp: OPEN_IN_BROWSER,
  'ios-safari': ['Tap the Share button (a square with an arrow, at the bottom or top of the screen; on newer iPhones it may be under ⋯).', 'Scroll down and tap Add to Home Screen, then Add.'],
  'ios-chrome': ['Tap the Share button in the address bar (a square with an arrow).', 'Tap Add to Home Screen, then Add. (If it isn’t there, open this page in Safari and do it there.)'],
  'ios-other': ['Open this page in Safari.', 'Tap Share → Add to Home Screen → Add.'],
  samsung: ['Tap the ☰ menu (bottom right).', 'Tap Add page to → Home screen (on some versions: Add to → Home screen, or an Install icon appears in the address bar).'],
  'android-firefox': ['Tap ⋮ (top or bottom right).', 'Tap Add app to Home screen (or Install).'],
  'android-edge': ['Tap ⋯ at the bottom.', 'Tap Add to phone (or Install app).'],
  'android-chrome': ['Tap ⋮ at the top right.', 'Tap Install app. If you only see Add to Home screen, tap that, then choose Install.'],
  'android-brave': ['Tap ⋮ (top or bottom right).', 'Tap Add to Home screen (or Install app), then Install / Add.'],
  'desktop-brave': ['Click the install icon at the right of the address bar, or ≡ → Save and share → Install page as app.'],
  'desktop-firefox': ['Firefox on a computer can’t install web apps, but Loopsy works fine in this tab. To install it, open it in Chrome or Edge.'],
  'desktop-edge': ['Click the app icon at the right of the address bar, or open ⋯ → Apps → Install this site as an app.'],
  'desktop-chrome': ['Click the install icon at the right of the address bar (a screen with an arrow), or open ⋮ → Cast, save and share → Install page as app.'],
  'mac-safari': ['In the menu bar choose File → Add to Dock.'],
};

export const MIC_UNBLOCK = {
  inapp: OPEN_IN_BROWSER,
  'ios-safari': ['Tap aA (or the page icon) in the address bar → Website Settings → Microphone → Allow.', 'Or open the Settings app → Apps → Safari → Microphone → Ask or Allow.', 'Installed on your home screen? Close Loopsy fully (swipe it away) and open it again.'],
  'ios-chrome': ['Open the iPhone Settings app → Apps → Chrome, and switch Microphone on.', 'Then come back and tap Try again.'],
  'ios-other': ['Open the iPhone Settings app → Apps → (your browser), and switch Microphone on.', 'Or open Loopsy in Safari.'],
  samsung: ['Tap the padlock (or ⓘ) in the address bar → Permissions → Microphone → Allow.', 'Or ☰ → Settings → Sites and downloads → Site permissions → Microphone, find this site and allow it.', androidApp('Samsung Internet')],
  'android-firefox': ['Tap the padlock in the address bar → Microphone → Allow (or Clear permissions and try again).', 'Or ⋮ → Settings → Site permissions → Microphone.', androidApp('Firefox')],
  'android-edge': ['Tap the padlock in the address bar → Permissions → Microphone → Allow.', androidApp('Edge')],
  'android-chrome': [
    'Tap the icon just left of the web address (sliders, a padlock or ⓘ) → Permissions → Microphone → Allow. (On some versions you tap Microphone directly, or Reset permissions.)',
    'Or tap ⋮ → Settings → Site settings → Microphone, tap this site under Blocked, and choose Allow.',
    'Installed it? Hold the Loopsy icon → App info → Permissions → Microphone → Allow.',
    androidApp('Chrome'),
  ],
  'android-brave': [
    'Tap the Brave lion icon in the address bar and turn Shields DOWN for this site (Shields can stop websites using the microphone).',
    'Tap ⋮ → Settings → Site settings → Microphone. Make sure it’s set to ask first, and that this site isn’t under Blocked (tap it → Allow).',
    'Or tap the icon left of the web address → Permissions → Microphone → Allow.',
    androidApp('Brave'),
  ],
  'desktop-brave': ['Click the Brave lion icon and turn Shields down for this site.', 'Click the icon left of the web address → Microphone → Allow, then reload.'],
  'desktop-firefox': ['Click the microphone or padlock icon in the address bar and remove the block (or choose Allow).', 'Then try again; Firefox will ask once more.'],
  'desktop-edge': ['Click the padlock left of the web address → Permissions for this site → Microphone → Allow.', 'Then reload the page.'],
  'desktop-chrome': ['Click the icon left of the web address (sliders or a padlock) → Microphone → Allow (or Site settings → Microphone → Allow).', 'Then reload the page.'],
  'mac-safari': ['In the menu bar choose Safari → Settings → Websites → Microphone, and set this site to Allow.', 'Also check System Settings → Privacy & Security → Microphone → Safari is on.'],
};
