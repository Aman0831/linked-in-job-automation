const puppeteer = require('puppeteer');
const logger    = require('./logger');

const LINKEDIN_LOGIN_URL = 'https://www.linkedin.com/login';

async function loginToLinkedIn() {
  const email    = process.env.LINKEDIN_EMAIL;
  const password = process.env.LINKEDIN_PASSWORD;

  if (!email || !password) throw new Error('LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in config/.env');

  logger.info('Launching browser...');
  const browser = await puppeteer.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

  logger.info('Navigating to LinkedIn login page...');
  await page.goto(LINKEDIN_LOGIN_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  // Wait for page to fully settle
  await sleep(3000);
  await page.keyboard.press('Escape');
  await sleep(1000);

  // Type directly using JavaScript — bypasses click/focus issues
  logger.info('Filling in credentials...');
  await page.evaluate((emailVal, passVal) => {
    // Find email field
    const emailField =
      document.querySelector('#username') ||
      document.querySelector('input[name="session_key"]') ||
      document.querySelector('input[autocomplete="username"]') ||
      document.querySelector('input[type="email"]') ||
      Array.from(document.querySelectorAll('input[type="text"]')).find(i =>
        i.placeholder?.toLowerCase().includes('email') ||
        i.placeholder?.toLowerCase().includes('phone')
      );

    // Find password field
    const passField =
      document.querySelector('#password') ||
      document.querySelector('input[name="session_password"]') ||
      document.querySelector('input[type="password"]');

    if (!emailField) throw new Error('Email field not found');
    if (!passField)  throw new Error('Password field not found');

    // Use native input setter to properly trigger React/Vue listeners
    const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    nativeInputSetter.call(emailField, emailVal);
    emailField.dispatchEvent(new Event('input',  { bubbles: true }));
    emailField.dispatchEvent(new Event('change', { bubbles: true }));

    nativeInputSetter.call(passField, passVal);
    passField.dispatchEvent(new Event('input',  { bubbles: true }));
    passField.dispatchEvent(new Event('change', { bubbles: true }));

  }, email, password);

  await sleep(1000);

  // Click submit button
  logger.info('Submitting login form...');
  await page.evaluate(() => {
    const btn =
      document.querySelector('[data-litms-control-urn="login-submit"]') ||
      document.querySelector('button[type="submit"]') ||
      document.querySelector('.btn__primary--large') ||
      Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent?.toLowerCase().includes('sign in')
      );
    if (!btn) throw new Error('Submit button not found');
    btn.click();
  });

  await sleep(3000);

  // Poll every 2s until we reach the feed (up to 3 minutes)
  logger.info('Waiting for login to complete...');
  const success = await waitForLogin(page, 180);
  if (!success) throw new Error('Login timed out after 3 minutes.');

  logger.info('✅ LinkedIn login successful!');
  return { page, browserInstance: browser };
}

async function waitForLogin(page, timeoutSeconds) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutSeconds * 1000) {
    try {
      const url = page.url();
      if (url.includes('feed') || url.includes('mynetwork') || url.includes('linkedin.com/in/')) {
        return true;
      }
      if (url.includes('checkpoint') || url.includes('challenge') || url.includes('verification')) {
        logger.warn('⚠️  Verification needed — please complete it in the browser window.');
      }
    } catch (e) { /* page navigating, keep waiting */ }
    await sleep(2000);
  }
  return false;
}

const rand  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = { loginToLinkedIn };
