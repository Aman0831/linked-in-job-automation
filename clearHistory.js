#!/usr/bin/env node
/**
 * clearHistory.js
 * ───────────────
 * Interactive tool to clear sent history for a specific candidate,
 * all candidates, or view current history.
 *
 * Usage:
 *   node clearHistory.js
 */

const fs   = require('fs');
const path = require('path');
const readline = require('readline');

const HISTORY_FILE = path.resolve('./sent-history.json');

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch(e) {}
  return {};
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function getCandidates(history) {
  const candidates = new Set();
  Object.keys(history).forEach(key => {
    const parts = key.split(':');
    if (parts.length >= 2) candidates.add(parts[0]);
  });
  return [...candidates];
}

function printHistory(history) {
  const candidates = getCandidates(history);
  if (candidates.length === 0) {
    console.log('\n📭 History is empty.\n');
    return;
  }
  console.log('\n📋 Current History:\n');
  candidates.forEach(candidate => {
    const entries = Object.entries(history).filter(([k]) => k.startsWith(candidate + ':'));
    console.log(`  👤 ${candidate.toUpperCase()} — ${entries.length} recruiter(s) contacted`);
    entries.forEach(([key, date]) => {
      const email = key.split(':').slice(1).join(':');
      console.log(`     • ${email}  →  ${new Date(date).toLocaleString()}`);
    });
    console.log();
  });
}

function clearCandidate(name, history) {
  const prefix = name.toLowerCase() + ':';
  const before = Object.keys(history).length;
  Object.keys(history).forEach(key => {
    if (key.startsWith(prefix)) delete history[key];
  });
  const after = Object.keys(history).length;
  saveHistory(history);
  console.log(`\n✅ Cleared ${before - after} entries for "${name}"\n`);
}

function clearAll(history) {
  saveHistory({});
  console.log('\n✅ Cleared ALL history\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────
const history = loadHistory();
const candidates = getCandidates(history);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log('\n══════════════════════════════════');
  console.log('   📬 Sent History Manager');
  console.log('══════════════════════════════════');

  console.log('\nWhat would you like to do?');
  console.log('  1. View history');
  console.log('  2. Clear history for a specific candidate');
  console.log('  3. Clear ALL history');
  console.log('  4. Exit\n');

  const choice = await ask('Enter choice (1/2/3/4): ');

  if (choice.trim() === '1') {
    printHistory(history);

  } else if (choice.trim() === '2') {
    if (candidates.length === 0) {
      console.log('\n📭 No history found.\n');
    } else {
      console.log('\nCandidates in history:');
      candidates.forEach((c, i) => {
        const count = Object.keys(history).filter(k => k.startsWith(c + ':')).length;
        console.log(`  ${i + 1}. ${c} (${count} entries)`);
      });
      const pick = await ask('\nEnter candidate name exactly as shown above: ');
      const found = candidates.find(c => c.toLowerCase() === pick.trim().toLowerCase());
      if (found) {
        clearCandidate(found, history);
      } else {
        console.log(`\n❌ Candidate "${pick.trim()}" not found in history.\n`);
      }
    }

  } else if (choice.trim() === '3') {
    const confirm = await ask('\n⚠️  Are you sure you want to clear ALL history? (yes/no): ');
    if (confirm.trim().toLowerCase() === 'yes') {
      clearAll(history);
    } else {
      console.log('\nCancelled.\n');
    }

  } else {
    console.log('\nExiting.\n');
  }

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });
