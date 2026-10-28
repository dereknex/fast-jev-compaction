import { cpSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// The plugin bundles core's sources, so it carries core's version. Claude Code
// caches an installed plugin by version, so a stale version here means a merged
// fix never reaches an installed plugin. Changesets ignores
// `fast-jev-claude-code`, so a change that touches only the hook must also
// carry a changeset for `@dereknex/jev-compaction` to move this version.
const version = JSON.parse(
  readFileSync(resolve(root, 'packages/core/package.json'), 'utf8'),
).version;

const stamp = (file, apply) => {
  const path = resolve(root, file);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  apply(json);
  const next = `${JSON.stringify(json, null, 2)}\n`;
  if (readFileSync(path, 'utf8') === next) return;
  writeFileSync(path, next);
  console.log(`✓ ${file} -> ${version}`);
};

// The release action reads a changelog for every package whose version changes.
const changelog = readFileSync(resolve(root, 'packages/core/CHANGELOG.md'), 'utf8');
writeFileSync(
  resolve(root, 'packages/claude-code/CHANGELOG.md'),
  changelog.replace('# @dereknex/jev-compaction', '# fast-jev-claude-code'),
);

stamp('packages/claude-code/package.json', (json) => {
  json.version = version;
});
stamp('packages/claude-code/.claude-plugin/plugin.json', (json) => {
  json.version = version;
});
stamp('.claude-plugin/marketplace.json', (json) => {
  json.plugins[0].version = version;
});
