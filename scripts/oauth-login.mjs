import { loginOpenAICodex } from '@mariozechner/pi-ai/oauth';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const creds = await loginOpenAICodex({
  onAuth: ({ url }) => {
    console.log('\nOpening browser...');
    try { execSync(`open "${url}"`); } catch { console.log('Open manually:', url); }
  },
  onPrompt: ({ message }) => {
    process.stdout.write(message + ' ');
    return new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once('data', d => resolve(d.toString().trim()));
    });
  },
});

const out = JSON.stringify(creds, null, 2);
writeFileSync('.oauth-codex.json', out);
console.log('\nSaved to .oauth-codex.json');
console.log('Now run:');
console.log('  scp .oauth-codex.json root@77.90.51.87:/root/podders/.oauth-codex.json');
