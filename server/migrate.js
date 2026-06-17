#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

console.log('Running prisma db push...');
try {
    execSync('npx prisma db push --accept-data-loss', {
        stdio: 'inherit',
        cwd: path.resolve(__dirname),
        env: { ...process.env },
    });
    console.log('Schema pushed.');
} catch (err) {
    console.error('Schema push failed:', err.message);
    process.exit(1);
}
