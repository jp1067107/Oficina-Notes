import puppeteer from 'puppeteer';
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000');
  await new Promise(r => setTimeout(r, 2000));
  const text = await page.evaluate(() => document.body.innerText);
  console.log('TEXT:', text);
  await browser.close();
})();
