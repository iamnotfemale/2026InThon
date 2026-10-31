import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

// DPAPI binds the encrypted file to this Windows user on this PC.
function dpapi(value, decrypt = false) {
  const script = 'Add-Type -AssemblyName System.Security; ' + (decrypt
    ? '[Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([Console]::In.ReadToEnd()),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'
    : '[Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String([Console]::In.ReadToEnd()),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: decrypt ? value : Buffer.from(value, 'utf8').toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (result.status !== 0 || !result.stdout) throw new Error('Windows credential encryption failed');
  return decrypt ? Buffer.from(result.stdout.trim(), 'base64').toString('utf8') : result.stdout.trim();
}

export function readSecrets(file) {
  try { return JSON.parse(dpapi(readFileSync(file, 'utf8'), true)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function writeSecrets(file, value) {
  writeFileSync(`${file}.tmp`, dpapi(JSON.stringify(value)), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
