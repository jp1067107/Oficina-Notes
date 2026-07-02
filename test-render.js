import fs from 'fs';
const appHtml = fs.readFileSync('index.html', 'utf-8');
console.log(appHtml);
