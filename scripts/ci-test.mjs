import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const testDirectory = fileURLToPath(new URL('../tests/', import.meta.url));
const testFiles = readdirSync(testDirectory)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const exitCode = result.status ?? 1;
if (exitCode !== 0) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const failedTests = output
    .split(/\r?\n/)
    .filter((line) => /^\s*not ok\s+\d+\s+-\s+/.test(line));
  const details = [
    `Test process exit code: ${exitCode}`,
    ...(result.signal ? [`Test process signal: ${result.signal}`] : []),
    ...(result.error ? [`Test process could not start: ${result.error.message}`] : []),
    ...(failedTests.length > 0 ? ['Failed tests:', ...failedTests] : []),
    'Final test output:',
    output.split(/\r?\n/).slice(-100).join('\n'),
  ].join('\n').slice(-8000);

  if (process.env.GITHUB_ACTIONS === 'true') {
    const escaped = details
      .replaceAll('%', '%25')
      .replaceAll('\r', '%0D')
      .replaceAll('\n', '%0A');
    process.stderr.write(`::error title=Node test failure details::${escaped}\n`);
  } else {
    process.stderr.write(`\nNode test failure details:\n${details}\n`);
  }
}

process.exitCode = exitCode;
