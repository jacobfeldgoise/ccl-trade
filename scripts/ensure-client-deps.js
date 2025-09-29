const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = join(__dirname, '..');
const clientDir = join(rootDir, 'client');
const nodeModulesDir = join(clientDir, 'node_modules');
const dependencies = ['dompurify', '@types/dompurify'];

const missing = dependencies.filter((dep) => {
  const pkgPath = join(nodeModulesDir, dep, 'package.json');
  return !existsSync(pkgPath);
});

if (missing.length === 0) {
  return;
}

console.log(`Installing client dependencies: ${missing.join(', ')}`);
execSync('npm install --prefix client', { stdio: 'inherit' });
