#!/usr/bin/env node
// Mirrors this folder to the PUBLIC repo github.com/itsbenraymond/gbp-local-seo-mcp.
// AI-OS stays the source of truth; the mirror has its own fresh history, so no
// AI-OS commit history ever goes public. Only files git tracks here are copied.
//
//   node tools/publish-mirror.mjs "commit message"
//
// Run after every deploy (and rebuild the README first: node tools/build-readme.mjs).
// MCPpedia's maintenance score counts commits in the last 7/30/90 days.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'itsbenraymond/gbp-local-seo-mcp';
const dir = path.join(pkg, '.build', 'public-mirror');
const msg = process.argv[2] || 'Sync from source';
const git = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

if (!fs.existsSync(path.join(pkg, 'README.md'))) throw new Error('README.md missing: run node tools/build-readme.mjs first');
const tracked = git(['ls-files', '.'], pkg).split('\n').filter(Boolean);
const files = [...new Set([...tracked, 'README.md'])];

// Never publish anything that looks like a secret.
const BAD = /(^|\/)(\.env|\.dev\.vars|key\.pem)$|\.pem$/;
for (const f of files) if (BAD.test(f)) throw new Error(`refusing to publish ${f}`);

if (!fs.existsSync(path.join(dir, '.git'))) {
  fs.mkdirSync(dir, { recursive: true });
  try { git(['clone', `https://github.com/${REPO}.git`, dir], pkg); }
  catch { git(['init', '-b', 'main']); git(['remote', 'add', 'origin', `https://github.com/${REPO}.git`]); }
}
try { git(['pull', '--ff-only', 'origin', 'main']); } catch { /* empty remote on first run */ }

// Replace the tree: delete what is no longer tracked, copy what is.
for (const f of git(['ls-files']).split('\n').filter(Boolean)) if (!files.includes(f)) fs.rmSync(path.join(dir, f), { force: true });
for (const f of files) {
  const to = path.join(dir, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(pkg, f), to);
}

git(['add', '-A']);
if (!git(['status', '--porcelain'])) { console.log('mirror already up to date'); process.exit(0); }
git(['-c', 'user.name=Kangaroo Growth', '-c', 'user.email=admin@kangaroogrowth.com.au', 'commit', '-m', msg]);
git(['push', '-u', 'origin', 'main']);
console.log(`pushed to https://github.com/${REPO}: ${git(['log', '--oneline', '-1'])}`);
