import fs from 'fs';
import sharp from 'sharp';

const svgDesktop = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <rect width="1280" height="720" fill="#18181b"/>
  <rect x="40" y="40" width="1200" height="80" rx="16" fill="#27272a"/>
  <rect x="40" y="160" width="300" height="520" rx="16" fill="#27272a"/>
  <rect x="380" y="160" width="860" height="520" rx="16" fill="#27272a"/>
  
  <text x="80" y="90" font-family="sans-serif" font-size="32" fill="#fff" font-weight="bold">Oficina Notes</text>
  <rect x="1100" y="55" width="100" height="50" rx="8" fill="#22c55e"/>
</svg>`;

const svgMobile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280" width="720" height="1280">
  <rect width="720" height="1280" fill="#18181b"/>
  <rect x="40" y="40" width="640" height="100" rx="16" fill="#27272a"/>
  <rect x="40" y="180" width="640" height="200" rx="16" fill="#27272a"/>
  <rect x="40" y="420" width="640" height="800" rx="16" fill="#27272a"/>
  
  <text x="80" y="100" font-family="sans-serif" font-size="40" fill="#fff" font-weight="bold">Oficina</text>
</svg>`;

async function generate() {
  await sharp(Buffer.from(svgDesktop))
    .png()
    .toFile('public/screenshot-desktop.png');
    
  await sharp(Buffer.from(svgMobile))
    .png()
    .toFile('public/screenshot-mobile.png');
    
  console.log("Screenshots generated successfully!");
}

generate().catch(console.error);
