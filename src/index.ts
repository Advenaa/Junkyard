import { loadConfig } from './config.js';

const config = loadConfig();
console.log(`podders v2 loaded — port ${config.port}`);
