const logger = require('./logger');

const ROLES = ['JAVA DEVELOPER', 'BUSINESS ANALYST', 'PROJECT MANAGER', 'DATA ANALYST'];

async function searchJobPosts(browser, { maxResults = 50 }, cookies) {
  const roleQuery = ROLES.map(r => `"${r}"`).join(' OR ');
  const fullQuery = `(${roleQuery}) "C2C"`;
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(fullQuery)}&datePosted=past-24h&sortBy=date_posted`;

  logger.info(`Search query: ${fullQuery}`);

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
  if (cookies?.length) await page.setCookie(...cookies);
  page.on('dialog', async d => { try { await d.dismiss(); } catch(e){} });

  logger.info('Navigating to search page...');
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch(e) {
    logger.warn(`Navigation warning: ${e.message} — continuing anyway`);
  }

  logger.info(`Landed on: ${page.url()}`);
  await sleep(6000);

  logger.info('Scrolling to load posts...');
  for (let i = 0; i < 6; i++) {
    try { await page.evaluate(() => window.scrollBy(0, 800)); } catch(e) { break; }
    await sleep(1200);
  }
  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch(e) {}
  await sleep(3000);

  logger.info('Extracting posts...');

  let posts = [];
  try {
    posts = await page.evaluate((maxResults) => {
      const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

      const selectors = [
        '.search-results__list li',
        'li.reusable-search__result-container',
        '.reusable-search__result-container',
        '[data-chameleon-result-urn]',
        '.occludable-update',
        '.feed-shared-update-v2',
        'li[class*="result"]',
        '[class*="search-result"]',
      ];

      let cards = [];
      for (const sel of selectors) {
        const found = Array.from(document.querySelectorAll(sel));
        if (found.length > 0) { cards = found; break; }
      }

      if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll('div,li,article'))
          .filter(el => {
            const t = el.innerText || '';
            return t.length > 100 && t.length < 5000 && t.includes('C2C');
          });
      }

      return cards.slice(0, maxResults).map(card => {
        try {
          const btn = card.querySelector('[class*="see-more"],[class*="inline-show-more"]');
          if (btn) btn.click();
        } catch(e) {}

        const fullDescription = card.innerText?.trim() || '';
        if (fullDescription.length < 30) return null;
        const lines = fullDescription.split('\n').map(l => l.trim()).filter(Boolean);

        // ── Poster name — try every possible selector ─────────────────────
        const nameCandidates = [
          // Standard feed selectors
          card.querySelector('.update-components-actor__name span[aria-hidden="true"]'),
          card.querySelector('.update-components-actor__name'),
          card.querySelector('[class*="actor__name"] span[aria-hidden="true"]'),
          card.querySelector('[class*="actor__name"]'),
          // Profile link text
          card.querySelector('a[href*="/in/"] span[aria-hidden="true"]'),
          card.querySelector('a[href*="/in/"]'),
          // Any bold/strong inside actor area
          card.querySelector('[class*="actor"] strong'),
          card.querySelector('[class*="actor"] b'),
          // Fallback: first anchor with /in/ in href
          ...Array.from(card.querySelectorAll('a[href*="/in/"]')),
        ].filter(Boolean);

        // Pick first candidate that has real text
        let posterName = '';
        for (const el of nameCandidates) {
          const text = el.innerText?.trim() || el.textContent?.trim() || '';
          // Clean up — remove connection degree badges like "• 3rd+"
          const cleaned = text.replace(/•\s*(1st|2nd|3rd)\+?/g, '').trim();
          if (cleaned.length > 1 && cleaned.length < 80) {
            posterName = cleaned;
            break;
          }
        }

        // Last resort — extract name from profile URL
        if (!posterName) {
          const profileEl = card.querySelector('a[href*="/in/"]');
          if (profileEl?.href) {
            const match = profileEl.href.match(/\/in\/([^/?]+)/);
            if (match) {
              // Convert "john-doe-123" → "John Doe"
              posterName = match[1]
                .replace(/-\d+$/, '')        // remove trailing ID numbers
                .split('-')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            }
          }
        }

        // Still nothing — use email username or "Hiring Manager"
        if (!posterName) {
          const emails = fullDescription.match(EMAIL_REGEX) || [];
          if (emails[0]) {
            // "john.smith@company.com" → "John Smith"
            const username = emails[0].split('@')[0].toLowerCase();
            const genericNames = ['info','hr','careers','jobs','recruitment','hiring','admin','contact','hello','support','noreply','no-reply'];
            if (genericNames.includes(username)) {
              posterName = 'Hiring Team';
            } else {
              posterName = username
                .replace(/[._]/g, ' ')
                .split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');
            }
          } else {
            posterName = 'Hiring Manager';
          }
        }

        // ── Poster title ──────────────────────────────────────────────────
        const posterTitleEl =
          card.querySelector('[class*="actor__description"]') ||
          card.querySelector('[class*="actor__subtitle"]');
        const posterTitle = posterTitleEl?.innerText?.trim() || '';

        // ── Profile URL ───────────────────────────────────────────────────
        const profileEl  = card.querySelector('a[href*="/in/"]');
        const profileUrl = profileEl?.href || '';

        // ── Post URL ──────────────────────────────────────────────────────
        const postLinkEl =
          card.querySelector('a[href*="/posts/"]') ||
          card.querySelector('a[href*="activity"]') ||
          card.querySelector('a[href*="ugcPost"]') ||
          card.querySelector('a[href*="feed/update"]');
        const postUrl = postLinkEl?.href || '';

        // ── Timestamp ─────────────────────────────────────────────────────
        const timeEl     = card.querySelector('time');
        const postedAt   = timeEl?.innerText?.trim() || '';
        const postedDate = timeEl?.getAttribute('datetime') || '';

        // ── Email ─────────────────────────────────────────────────────────
        const emails         = fullDescription.match(EMAIL_REGEX) || [];
        const recruiterEmail = emails[0] || null;

        // ── Job title — skip UI noise ─────────────────────────────────────
        const jobTitle = lines.find(l =>
          l.length > 15 &&
          !l.match(/^(Like|Comment|Repost|Send|Follow|Connect|\d+\s*(repost|like|comment))/i) &&
          !l.includes('3rd+') && !l.includes('2nd+') && !l.includes('1st+') &&
          !l.includes('ago') && !l.match(/^\d+$/)
        ) || lines[0] || '(No title)';

        return {
          jobTitle,
          fullDescription,
          title:          fullDescription.slice(0, 120).replace(/\n+/g, ' '),
          posterName,
          posterTitle,
          profileUrl,
          recruiterEmail,
          postUrl,
          postedAt,
          postedDate,
        };
      }).filter(Boolean);

    }, maxResults);

  } catch(e) {
    logger.warn(`Extraction error: ${e.message}`);
    try {
      const state = await page.evaluate(() => ({
        url:  location.href,
        text: document.body.innerText.slice(0, 400),
      }));
      logger.info(`URL: ${state.url}`);
      logger.info(`Page: ${state.text.replace(/\n/g,' ').slice(0,300)}`);
    } catch(e2) {}
  }

  posts = posts.map(p => ({ ...p, searchRole: detectRole(p.fullDescription) }));

  logger.info(`\n📊 Results:`);
  ROLES.forEach(r => logger.info(`   ${r}: ${posts.filter(p => p.searchRole === r).length}`));
  logger.info(`   Total: ${posts.length}\n`);
  posts.forEach((p, i) =>
    logger.info(`  ${i+1}. [${p.searchRole}] "${p.posterName}" — "${p.jobTitle.slice(0,40)}" | email: ${p.recruiterEmail || 'none'}`)
  );

  await page.close().catch(() => {});
  return posts;
}

function detectRole(text) {
  const t = text.toUpperCase();
  if (t.includes('JAVA'))             return 'JAVA DEVELOPER';
  if (t.includes('BUSINESS ANALYST')) return 'BUSINESS ANALYST';
  if (t.includes('PROJECT MANAGER'))  return 'PROJECT MANAGER';
  if (t.includes('DATA ANALYST'))     return 'DATA ANALYST';
  return 'GENERAL';
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = { searchJobPosts };
