import https from 'https';
import fs from 'fs';

const url = 'https://cdn-icons-png.flaticon.com/512/25/25231.png';

const file192 = fs.createWriteStream('public/icon-192.png');
const file512 = fs.createWriteStream('public/icon-512.png');

https.get(url, function(response) {
  response.pipe(file192);
});

https.get(url, function(response) {
  response.pipe(file512);
});
