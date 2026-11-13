// Builds the app in demo mode and inlines JS + CSS into one HTML file, for sharing a
// clickable preview (e.g. as a hosted page) without a server or Supabase.
// Usage: node scripts/build-preview.mjs [outFile]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'dist-preview.html');
const outDir = join(root, 'dist-preview');

execSync(`npx vite build --outDir ${outDir} --emptyOutDir`, {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, VITE_MEMORY_ROUTER: '1', VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');

// Page fragment (the host wraps it in its own <html>/<head>/<body> skeleton).
const html = `<title>Access &amp; Site Services</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(favicon)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${css}
:root{color-scheme:light}
body{background:#eef1f6;color:#13213f;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px}
</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(out, html);
console.log(`Wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
