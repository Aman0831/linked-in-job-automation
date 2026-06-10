const logger = require('./logger');

// ── Read keywords dynamically from .env ──────────────────────────────────
// Add SEARCH_KEYWORD_1, SEARCH_KEYWORD_2, SEARCH_KEYWORD_3 ... in .env
function getRolesFromEnv() {
  const roles = [];
  let i = 1;
  while (process.env[`SEARCH_KEYWORD_${i}`]) {
    roles.push(process.env[`SEARCH_KEYWORD_${i}`].trim().toUpperCase());
    i++;
  }
  return roles.length > 0 ? roles : ['MARKETING ANALYTICS LEAD'];
}

const ROLES = getRolesFromEnv();

async function searchJobPosts(browser, { maxResults = 50 }, cookies) {
  const roleQuery = ROLES.map(r => r).join(' OR ');
  const fullQuery = `(${roleQuery})`;
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(fullQuery)}&datePosted=past-24h&sortBy=date_posted&geoUrn=%5B%22103644278%22%5D`;

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
  for (let i = 0; i < 40; i++) {
    try { await page.evaluate(() => window.scrollBy(0, 800)); } catch(e) { break; }
    await sleep(1000);
  }
  try { await page.evaluate(() => window.scrollTo(0, 0)); } catch(e) {}
  await sleep(3000);

  logger.info('Extracting posts...');
  let posts = [];

  try {
    posts = await page.evaluate((maxResults) => {
      const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

      // ── New selector strategy: find by structure not class names ──────────
      // LinkedIn posts always contain action buttons (Like, Comment, Repost, Send)
      // Find all elements that contain these action buttons — those are post cards

      let cards = [];

      // Strategy 1: find elements containing Like + Comment + Repost buttons
      const allElements = Array.from(document.querySelectorAll('li, div, article'));
      // Find smallest elements that contain Like+Comment+Repost
      const candidates = allElements.filter(el => {
        const text = el.innerText || '';
        return (
          text.includes('Like') &&
          text.includes('Comment') &&
          (text.includes('Repost') || text.includes('Send')) &&
          text.length > 100 &&
          text.length < 8000
        );
      });
      // Keep only the smallest (most specific) elements — not parent wrappers
      cards = candidates.filter(el => {
        return !candidates.some(other => other !== el && el.contains(other));
      });

      // Strategy 2: fallback — find by data-view-name attribute
      if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll('[data-view-name]'))
          .filter(el => {
            const t = el.innerText || '';
            return t.length > 100 && t.length < 8000;
          });
      }

      // Strategy 3: last resort — find any li with enough text
      if (cards.length === 0) {
        cards = Array.from(document.querySelectorAll('li'))
          .filter(el => {
            const t = el.innerText || '';
            return t.length > 150 && t.length < 8000 &&
              !t.includes('vjs-') && !t.includes('menu-item');
          });
      }

      // Remove duplicates (same text content)
      const seen = new Set();
      cards = cards.filter(el => {
        const key = (el.innerText || '').slice(0, 100);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      cards = cards.slice(0, maxResults);
      // cards found:  (logger not available in browser context)

      return cards.map(card => {
        // Expand see more
        try {
          const btns = card.querySelectorAll('button');
          btns.forEach(btn => {
            if (btn.innerText?.includes('more') || btn.innerText?.includes('See more')) {
              btn.click();
            }
          });
        } catch(e) {}

        const fullDescription = card.innerText?.trim() || '';
        if (fullDescription.length < 50) return null;

        const lines = fullDescription.split('\n')
          .map(l => l.trim())
          .filter(Boolean);

        // ── Poster name ───────────────────────────────────────────────────
        // Find the anchor tag linking to a LinkedIn profile
        const profileLinks = Array.from(card.querySelectorAll('a[href*="/in/"]'));
        let posterName = '';
        let profileUrl = '';

        for (const link of profileLinks) {
          const text = (link.innerText || link.textContent || '').trim();
          const cleaned = text.replace(/•\s*(1st|2nd|3rd)\+?/gi, '').trim();
          if (cleaned.length > 1 && cleaned.length < 80 && !cleaned.includes('http')) {
            posterName = cleaned;
            profileUrl = link.href;
            break;
          }
        }

        // Fallback: extract from URL slug
        if (!posterName && profileLinks.length > 0) {
          const match = profileLinks[0].href.match(/\/in\/([^/?]+)/);
          if (match) {
            posterName = match[1]
              .replace(/-\d+$/, '')
              .split('-')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
            profileUrl = profileLinks[0].href;
          }
        }

        // Fallback: email username
        if (!posterName) {
          const emails = fullDescription.match(EMAIL_REGEX) || [];
          if (emails[0]) {
            const username = emails[0].split('@')[0].toLowerCase();
            const generic = ['info','hr','careers','jobs','recruitment','hiring','admin','contact','hello','support'];
            posterName = generic.includes(username) ? 'Hiring Team' :
              username.replace(/[._]/g,' ').split(' ')
                .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          } else {
            posterName = 'Hiring Manager';
          }
        }

        // Capitalize
        posterName = posterName.split(' ')
          .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(' ');

        // ── Poster title ──────────────────────────────────────────────────
        // Usually the line right after the poster name in the post header
        let posterTitle = '';
        const nameIdx = lines.findIndex(l =>
          l.toLowerCase().includes(posterName.toLowerCase().split(' ')[0])
        );
        if (nameIdx >= 0 && nameIdx + 1 < lines.length) {
          const nextLine = lines[nameIdx + 1];
          if (nextLine.length < 100 && !nextLine.includes('@') &&
              !nextLine.match(/^\d/) && !nextLine.includes('Like')) {
            posterTitle = nextLine;
          }
        }

        // ── Post URL ──────────────────────────────────────────────────────
        const allLinks = Array.from(card.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => h && h.startsWith('http'));

        const postUrl =
          allLinks.find(h => h.includes('/posts/')) ||
          allLinks.find(h => h.includes('ugcPost')) ||
          allLinks.find(h => h.includes('activity') && h.includes('linkedin')) ||
          allLinks.find(h => h.includes('feed/update')) ||
          allLinks.find(h =>
            h.includes('linkedin.com') &&
            !h.includes('/in/') &&
            !h.includes('/company/') &&
            !h.includes('/school/') &&
            !h.includes('linkedin.com/search') &&
            !h.includes('linkedin.com/feed?')
          ) || '';

        // ── Timestamp ─────────────────────────────────────────────────────
        const timeEl     = card.querySelector('time');
        const postedAt   = timeEl?.innerText?.trim() || '';
        const postedDate = timeEl?.getAttribute('datetime') || '';

        // ── Email ─────────────────────────────────────────────────────────
        const emails         = fullDescription.match(EMAIL_REGEX) || [];
        const recruiterEmail = emails[0] || null;

        // ── Job title ─────────────────────────────────────────────────────
        const skipWords = ['like','comment','repost','send','follow','connect','ago','just now','3rd','2nd','1st'];
        const jobTitle = lines.find(l =>
          l.length > 15 &&
          !skipWords.some(w => l.toLowerCase().startsWith(w)) &&
          !l.match(/^\d+$/) &&
          !l.includes('•')
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
    logger.info(`  ${i+1}. [${p.searchRole}] "${p.posterName}" — "${p.jobTitle.slice(0,40)}" | email: ${p.recruiterEmail || 'none'} | url: ${p.postUrl ? '✅' : '❌'}`)
  );

  await page.close().catch(() => {});
  return posts;
}

function detectRole(text) {
  const t = text.toUpperCase();
  // Check each role from .env in order — longest match first
  const sorted = [...ROLES].sort((a, b) => b.length - a.length);
  for (const role of sorted) {
    if (t.includes(role)) return role;
  }
  return 'GENERAL';
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = { searchJobPosts };
