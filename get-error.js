import puppeteer from 'puppeteer';

(async () => {
  try {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    const bodyHTML = await page.evaluate(() => document.body.innerHTML);
    console.log('BODY LENGTH:', bodyHTML.length);
    
    await browser.close();
  } catch (err) {
    console.error('Puppeteer Script Error:', err);
  }
})();
