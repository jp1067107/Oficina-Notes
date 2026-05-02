import https from 'https';
import fs from 'fs';
import sharp from 'sharp';

const url = 'https://cdn-icons-png.flaticon.com/512/25/25231.png';

https.get(url, function(response) {
  const data = [];
  response.on('data', (chunk) => data.push(chunk));
  response.on('end', async () => {
    const buffer = Buffer.concat(data);
    
    await sharp(buffer)
      .resize(192, 192)
      .toFile('public/icon-192.png');
      
    await sharp(buffer)
      .resize(512, 512)
      .toFile('public/icon-512.png');
      
    console.log('Icons resized and saved successfully.');
  });
});
