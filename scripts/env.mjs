import { readFileSync } from 'node:fs';

// .env 파일 값을 셸 환경변수보다 우선한다. 셸에 남은 ANTHROPIC_BASE_URL이 Continuum 주소를 덮어쓴 적이 있어서다.
// 기존 로컬 .env의 ANTHROPIC_* 이름도 CONTINUUM_*으로 받아준다.
export function loadEnv(file = '.env') {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trimStart().startsWith('#')) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  values.CONTINUUM_API_KEY ||= values.ANTHROPIC_AUTH_TOKEN;
  values.CONTINUUM_BASE_URL ||= values.ANTHROPIC_BASE_URL;
  values.CONTINUUM_MODEL ||= values.ANTHROPIC_MODEL;
  return { ...process.env, ...Object.fromEntries(Object.entries(values).filter(([, v]) => v)) };
}
