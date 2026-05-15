const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  console.log('Opening LinkedIn...');
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait 5 seconds then take a screenshot
  await new Promise(r => setTimeout(r, 5000));
  await page.screenshot({ path: 'debug-screenshot.png' });

  // Print what's on the page
  const url     = page.url();
  const title   = await page.title();
  const hasUser = await page.$('#username') !== null;
  const hasPass = await page.$('#password') !== null;

  console.log('URL:             ', url);
  console.log('Page title:      ', title);
  console.log('#username found: ', hasUser);
  console.log('#password found: ', hasPass);

  // Print all input fields found
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input')).map(i => ({
      id: i.id, name: i.name, type: i.type, placeholder: i.placeholder
    }))
  );
  console.log('Input fields on page:', JSON.stringify(inputs, null, 2));

  await browser.close();
})();
