import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('syncs the bundled sources, version, and release changelog', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-claude-'));
  try {
    for (const dir of ['scripts', 'packages/core/src', 'packages/claude-code/.claude-plugin', '.claude-plugin']) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    cpSync(resolve('scripts/sync-claude.js'), join(root, 'scripts/sync-claude.js'));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    writeFileSync(join(root, 'packages/core/package.json'), '{"version":"1.2.3"}');
    writeFileSync(join(root, 'packages/core/src/index.ts'), 'export const core = true;');
    writeFileSync(join(root, 'packages/core/CHANGELOG.md'), '# @dereknex/jev-compaction\n\n## 1.2.3\n\n- Fix\n');
    writeFileSync(join(root, 'packages/claude-code/package.json'), '{"version":"1.2.2"}');
    writeFileSync(join(root, 'packages/claude-code/.claude-plugin/plugin.json'), '{"version":"1.2.2"}');
    writeFileSync(join(root, '.claude-plugin/marketplace.json'), '{"plugins":[{"version":"1.2.2"}]}');

    execFileSync(process.execPath, [join(root, 'scripts/sync-claude.js')]);

    expect(readFileSync(join(root, 'packages/claude-code/src/index.ts'), 'utf8')).toBe('export const core = true;');
    expect(readFileSync(join(root, 'packages/claude-code/CHANGELOG.md'), 'utf8'))
      .toBe('# fast-jev-claude-code\n\n## 1.2.3\n\n- Fix\n');
    for (const file of ['packages/claude-code/package.json', 'packages/claude-code/.claude-plugin/plugin.json']) {
      expect(JSON.parse(readFileSync(join(root, file), 'utf8')).version).toBe('1.2.3');
    }
    expect(JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].version).toBe('1.2.3');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
