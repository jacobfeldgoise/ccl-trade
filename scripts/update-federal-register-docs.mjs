#!/usr/bin/env node
import { fileURLToPath } from 'url';
import {
  getFederalRegisterStoragePath,
  updateFederalRegisterDocuments,
} from '../server/federal-register.js';

const __filename = fileURLToPath(import.meta.url);

async function main() {
  console.log('Refreshing Federal Register metadata…');
  const result = await updateFederalRegisterDocuments({
    onProgress: (message) => console.log(message),
  });
  const location = getFederalRegisterStoragePath();
  console.log(
    `Fetched ${result.documentCount} document${result.documentCount === 1 ? '' : 's'} and stored them at ${location}`
  );
  if (result.generatedAt) {
    console.log(`Generated at ${result.generatedAt}`);
  }
}

if (process.argv[1] === __filename) {
  main().catch((error) => {
    console.error('Failed to update Federal Register document list:', error);
    process.exitCode = 1;
  });
}
