// Bub Feed Log settings.
// This file ends up public on GitHub, so nothing in it is secret. The Firebase values only say which
// project to talk to. Families' logs are encrypted on their phones, and the database rules you paste
// into Firebase decide who can read even the scrambled copies.
// While the PASTE_ values are still here the app runs in demo mode (saved on one phone only).
window.BUB_CONFIG = {
  // Setup step 2: paste the values Firebase shows you (Project settings > Your apps > SDK setup and configuration > Config).
  firebase: {
    apiKey: 'PASTE_API_KEY',
    authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
    projectId: 'PASTE_PROJECT_ID',
    storageBucket: 'PASTE_PROJECT_ID.firebasestorage.app',
    messagingSenderId: 'PASTE_SENDER_ID',
    appId: 'PASTE_APP_ID'
  },

  // Your first name. Friends see "Jas runs this copy of the app" when they sign up,
  // and "ask Jas for a code" when starting their own log.
  hostName: 'Jas',

  // Setup step 8 (strongly recommended): App Check. The reCAPTCHA Enterprise *site key* (a long string
  // starting with 6L). It proves requests come from your app on your web address, not a script elsewhere.
  // Leave it empty until you've done step 8; the app works without it.
  appCheckKey: '',

  // Optional, setup step 12: Google Drive backups. A Web client ID ending in .apps.googleusercontent.com
  googleClientId: ''
};
