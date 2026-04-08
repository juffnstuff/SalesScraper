#!/usr/bin/env node
/**
 * Seed user accounts for RubberForm Prospecting Engine.
 *
 * Usage:
 *   node scripts/seed_users.js              # Create default users (skip existing)
 *   node scripts/seed_users.js --reset      # Recreate all users with default passwords
 *   node scripts/seed_users.js --add <username> <password> <role> [repId]
 *
 * Default passwords are the username (e.g. "galen" / "galen").
 * Users should change their password on first login.
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const USERS_PATH = path.join(__dirname, '../config/users.json');
const REPS_PATH = path.join(__dirname, '../config/rep_profiles.json');
const SALT_ROUNDS = 10;

// Default user accounts
function getDefaultUsers() {
  const reps = JSON.parse(fs.readFileSync(REPS_PATH, 'utf8'));

  const users = [
    {
      username: 'jeff',
      password: 'admin',
      name: 'Jeff Robbins',
      email: 'jeff@rubberform.com',
      role: 'admin',
      repId: null
    }
  ];

  // Create a login for each real sales rep (skip house accounts)
  for (const rep of reps) {
    if (rep.id === 'rfst_house') continue;

    const username = rep.email.split('@')[0]; // galen, andrew, nickz, bradb, bill, jake
    users.push({
      username,
      password: username, // default password = username
      name: rep.name,
      email: rep.email,
      role: 'sales_rep',
      repId: rep.id
    });
  }

  return users;
}

async function seedUsers(reset = false) {
  let existing = [];
  if (!reset && fs.existsSync(USERS_PATH)) {
    existing = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
    console.log(`Found ${existing.length} existing users.`);
  }

  const existingUsernames = new Set(existing.map(u => u.username));
  const defaults = getDefaultUsers();
  let added = 0;

  for (const u of defaults) {
    if (!reset && existingUsernames.has(u.username)) {
      console.log(`  [skip] ${u.username} — already exists`);
      continue;
    }

    const hash = await bcrypt.hash(u.password, SALT_ROUNDS);
    const record = {
      username: u.username,
      passwordHash: hash,
      name: u.name,
      email: u.email,
      role: u.role,
      repId: u.repId,
      mustChangePassword: true,
      createdAt: new Date().toISOString()
    };

    if (reset) {
      // Replace if exists
      const idx = existing.findIndex(e => e.username === u.username);
      if (idx >= 0) {
        existing[idx] = record;
        console.log(`  [reset] ${u.username} (${u.role})`);
      } else {
        existing.push(record);
        console.log(`  [added] ${u.username} (${u.role})`);
      }
    } else {
      existing.push(record);
      console.log(`  [added] ${u.username} (${u.role})`);
    }
    added++;
  }

  fs.writeFileSync(USERS_PATH, JSON.stringify(existing, null, 2));
  console.log(`\nDone. ${added} users ${reset ? 'reset' : 'added'}. Total: ${existing.length} users.`);
  console.log(`Saved to: ${USERS_PATH}`);
  console.log('\nDefault passwords are the username (e.g. "galen" / "galen", "jeff" / "admin").');
  console.log('Users will be prompted to change their password on first login.');
}

async function addUser(username, password, role, repId) {
  let existing = [];
  if (fs.existsSync(USERS_PATH)) {
    existing = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8'));
  }

  if (existing.find(u => u.username === username)) {
    console.error(`User "${username}" already exists. Use --reset to overwrite.`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  existing.push({
    username,
    passwordHash: hash,
    name: username,
    email: `${username}@rubberform.com`,
    role: role || 'sales_rep',
    repId: repId || null,
    mustChangePassword: false,
    createdAt: new Date().toISOString()
  });

  fs.writeFileSync(USERS_PATH, JSON.stringify(existing, null, 2));
  console.log(`Added user "${username}" with role "${role}".`);
}

// CLI
const args = process.argv.slice(2);
if (args[0] === '--add') {
  if (args.length < 3) {
    console.error('Usage: node seed_users.js --add <username> <password> <role> [repId]');
    process.exit(1);
  }
  addUser(args[1], args[2], args[3], args[4]);
} else {
  seedUsers(args.includes('--reset'));
}
