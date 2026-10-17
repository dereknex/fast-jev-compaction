import { cpSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcCore = resolve(root, 'packages/core/src');
const destClaude = resolve(root, 'packages/claude-code/src');

if (existsSync(destClaude)) {
  rmSync(destClaude, { recursive: true, force: true });
}
cpSync(srcCore, destClaude, { recursive: true });
console.log('✓ Synced packages/core/src -> packages/claude-code/src');
