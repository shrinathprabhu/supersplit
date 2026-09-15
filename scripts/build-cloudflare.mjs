import { cp, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('../dist/', import.meta.url);
const publicEntries = [
  'index.html',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'sw.js',
  '_headers',
  'assets',
  'css',
  'js',
  'vendor',
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of publicEntries) {
  await cp(new URL(entry, root), new URL(entry, output), { recursive: true });
}

console.log(`Prepared ${publicEntries.length} public entries in dist/ for Cloudflare Workers.`);
