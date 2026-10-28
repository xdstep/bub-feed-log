// Bub Feed Log settings.
// This file ends up public on GitHub, so nothing in it is secret. The Firebase values only say which
// project to talk to. Families' logs are encrypted on their phones, and the database rules you paste
// into Firebase decide who can read even the scrambled copies.
// While the PASTE_ values are still here the app runs in demo mode (saved on one phone only).
window.BUB_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyAUJozhOxzv3HAQMRCFEFxyqPgIrN1yHHw',
    authDomain: 'bub-feed-log-2f267.firebaseapp.com',
    projectId: 'bub-feed-log-2f267',
    storageBucket: 'bub-feed-log-2f267.firebasestorage.app',
    messagingSenderId: '96440128216',
    appId: '1:96440128216:web:1dd77fc3cddff2979abdad'
  },

  // Your first name. Friends see "Jas runs this copy of the app" when they sign up.
  hostName: 'Jas',

  // App Check: the reCAPTCHA Enterprise site key (starts with 6L). Empty until setup step 18.
  appCheckKey: 'https://recaptchaenterprise.googleapis.com/v1/projects/project-31679adc-38ee-44e0-8b3/assessments?key=API_KEY',

  // Optional: Google Drive backups. A Web client ID ending in .apps.googleusercontent.com
  googleClientId: ''
};
