import { app } from 'electron';
process.env.REPROCASE_APP_ROOT = app.getAppPath();
await import('./dist/main.mjs');
