/**
 * src/historyManager.js
 * ──────────────────────
 * Tracks which recruiter emails have already been contacted.
 * Saves to sent-history.json so it persists across runs.
 */

const fs   = require('fs');
const path = require('path');

const HISTORY_FILE = path.resolve('./sent-history.json');

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch(e) {}
  return {}; // { "email": "2026-05-15T07:00:00Z" }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function alreadySent(email, history) {
  const candidate = process.env.CANDIDATE_NAME || 'default';
  const key = `${candidate.toLowerCase()}:${email.toLowerCase()}`;
  return !!history[key];
}

function markSent(email, history) {
  const candidate = process.env.CANDIDATE_NAME || 'default';
  const key = `${candidate.toLowerCase()}:${email.toLowerCase()}`;
  history[key] = new Date().toISOString();
  saveHistory(history);
}

function printHistory(history) {
  const entries = Object.entries(history);
  if (entries.length === 0) {
    console.log('No emails sent yet.');
    return;
  }
  console.log(`\n📋 Previously contacted recruiters (${entries.length}):`);
  entries.forEach(([email, date]) => {
    console.log(`   ${email}  →  ${new Date(date).toLocaleString()}`);
  });
}

module.exports = { loadHistory, saveHistory, alreadySent, markSent, printHistory };
