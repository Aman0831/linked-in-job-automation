require('dotenv').config({ path: './config/.env' });

const { loginToLinkedIn }       = require('./src/linkedinLogin');
const { searchJobPosts }        = require('./src/jobSearcher');
const { sendApplicationEmails } = require('./src/gmailSender');
const { loadHistory, alreadySent, markSent, printHistory } = require('./src/historyManager');
const logger                    = require('./src/logger');

async function main() {
  logger.info('🚀 LinkedIn Job Automation Started');
  logger.info('🔍 Searching: JAVA DEV | BUSINESS ANALYST | PROJECT MANAGER | DATA ANALYST — all C2C');

  // Load history of already-contacted recruiters
  const history = loadHistory();
  printHistory(history);

  let browser;
  try {
    logger.info('\n── STEP 1: Logging into LinkedIn ──');
    const { page, browserInstance } = await loginToLinkedIn();
    browser = browserInstance;

    const cookies = await page.cookies();
    logger.info(`Session cookies captured: ${cookies.length}`);
    await page.close();

    logger.info('\n── STEP 2: Searching Job Posts (last 24 hrs) ──');
    let jobPosts = await searchJobPosts(browser, { maxResults: 50 }, cookies);

    if (jobPosts.length === 0) {
      logger.warn('No matching job posts found.');
      await browser.close();
      return;
    }

    // ── Deduplicate + skip already contacted ─────────────────────────────
    const seen    = new Set();
    const fresh   = [];
    const skipped = [];

    for (const post of jobPosts) {
      if (!post.recruiterEmail) continue;

      const email = post.recruiterEmail.toLowerCase();

      if (seen.has(email)) continue; // duplicate in this run
      seen.add(email);

      if (alreadySent(email, history)) {
        skipped.push(email);
        continue; // already emailed before
      }

      fresh.push(post);
    }

    logger.info(`\n📊 Email Summary:`);
    logger.info(`   Total posts scraped  : ${jobPosts.length}`);
    logger.info(`   Unique recruiters    : ${seen.size}`);
    logger.info(`   Already contacted    : ${skipped.length} — SKIPPED`);
    logger.info(`   New — will email now : ${fresh.length}`);

    if (skipped.length > 0) {
      logger.info(`   Skipped: ${skipped.join(', ')}`);
    }

    if (fresh.length === 0) {
      logger.warn('\nAll recruiters already contacted. Nothing new to send today!');
      logger.warn('Run again tomorrow when new posts appear.');
      await browser.close();
      return;
    }

    logger.info('\n── STEP 3 & 4: Tailoring Resume + Sending Emails ──');

    // Pass markSent callback so history updates after each successful send
    const results = await sendApplicationEmails(fresh, (email) => markSent(email, history));

    const sent   = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    logger.info(`\n✅ Emails sent: ${sent}  |  ❌ Failed: ${failed}`);

    await browser.close();
    logger.info('\n🏁 Automation Complete!');
  } catch (err) {
    logger.error(`Fatal error: ${err.message}`);
    if (browser) await browser.close();
    process.exit(1);
  }
}

main();
