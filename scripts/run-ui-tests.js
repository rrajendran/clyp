// Runs every test/ui/*.test.js with Node's built-in test runner.
//
// `node --test "test/ui/*.test.js"` only works on Node 21+ (glob support), and
// shell globs are not expanded on Windows. Listing the files ourselves works on
// every Node version and OS that CI uses.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test', 'ui');
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error(`No UI tests found in ${dir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
