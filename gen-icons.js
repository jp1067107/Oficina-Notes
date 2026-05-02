import fs from 'fs';
import sharp from 'sharp';

const svgCode = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#222" rx="100"/>
  <svg x="64" y="64" width="384" height="384" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <path d="M12 11h4"/>
    <path d="M12 16h4"/>
    <path d="M8 11h.01"/>
    <path d="M8 16h.01"/>
  </svg>
</svg>`;

fs.writeFileSync('public/icon.svg', svgCode);

async function generate() {
  await sharp(Buffer.from(svgCode))
    .resize(192, 192)
    .toFile('public/icon-192.png');
    
  await sharp(Buffer.from(svgCode))
    .resize(512, 512)
    .toFile('public/icon-512.png');
    
  console.log("Icons generated successfully!");
}

generate().catch(console.error);
