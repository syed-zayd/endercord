import { runBot } from './server.js';
runBot().catch(error => { console.error(error.message); process.exitCode = 1; });
