'use strict';
// Bundles the whole game into one double-clickable HTML file.
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const r = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src', 'relatives.js')],
  bundle: true, minify: true, write: false, format: 'iife', target: ['es2020'], logLevel: 'error',
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = fs.readFileSync(path.join(__dirname, 'src', 'style.css'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'src', 'theme.css'), 'utf8');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sHeeSh</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;0,700;1,500&family=Cinzel:wght@700;900&family=Pirata+One&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>${js}</script>
</body>
</html>
`;
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
const out = path.join(__dirname, 'dist', 'sHeeSh.html');
fs.writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} kB`);

// Installable web-app copy: same page plus manifest, icons and a service worker, in pwa/.
const pwaHead = `<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#ff3fa4">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="icon" type="image/png" href="favicon.png">`;
const pwaTail = `<script>if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');</script>`;
const pwaHtml = html.replace('<title>sHeeSh</title>', `<title>sHeeSh</title>\n${pwaHead}`).replace('</body>', `${pwaTail}\n</body>`);
fs.mkdirSync(path.join(__dirname, 'pwa'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'pwa', 'index.html'), pwaHtml);
console.log(`${path.join(__dirname, 'pwa', 'index.html')}  ${(pwaHtml.length / 1024).toFixed(0)} kB`);
