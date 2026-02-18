#!/usr/bin/env node
/**
 * Check which Supabase environment is currently linked
 * Usage: node scripts/check-db-env.js
 */

const fs = require('fs');
const path = require('path');

const envConfigPath = path.join(__dirname, '..', '.claude', 'db-environments.json');
const currentRefPath = path.join(__dirname, '..', 'supabase', '.temp', 'project-ref');

try {
  const envConfig = JSON.parse(fs.readFileSync(envConfigPath, 'utf8'));
  const currentRef = fs.readFileSync(currentRefPath, 'utf8').trim();

  console.log('\n🔍 Current Supabase Environment Check\n');
  console.log('━'.repeat(50));

  let envName = 'UNKNOWN';
  let envDetails = null;

  for (const [name, details] of Object.entries(envConfig.supabase)) {
    if (details.project_ref === currentRef) {
      envName = name.toUpperCase();
      envDetails = details;
      break;
    }
  }

  if (envDetails) {
    console.log(`\n✅ Currently Linked: ${envName}`);
    console.log(`   Project Ref: ${envDetails.project_ref}`);
    console.log(`   URL: ${envDetails.url}`);
    console.log(`   Description: ${envDetails.description}`);
  } else {
    console.log(`\n⚠️  Currently Linked: ${currentRef}`);
    console.log(`   This project ref is not recognized!`);
    console.log(`   Check .claude/db-environments.json for valid refs.`);
  }

  console.log('\n━'.repeat(50));
  console.log('\n📋 Available Environments:\n');

  for (const [name, details] of Object.entries(envConfig.supabase)) {
    const isCurrent = details.project_ref === currentRef;
    const marker = isCurrent ? '→' : ' ';
    console.log(`${marker} ${name.toUpperCase()}`);
    console.log(`  Project Ref: ${details.project_ref}`);
    console.log(`  URL: ${details.url}\n`);
  }

  if (envName === 'PRODUCTION') {
    console.log('⚠️  WARNING: You are linked to PRODUCTION!');
    console.log('   Make sure you intend to modify the production database.\n');
  }

  console.log('To switch environments:');
  console.log('  npx supabase link --project-ref <project-ref>\n');

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
