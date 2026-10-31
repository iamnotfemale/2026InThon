import { createHash, createHmac, randomInt } from 'node:crypto';
import { get, put, del } from '@vercel/blob';
import { sealToken, openToken } from './cloud-auth.mjs';
import { createCloudState } from './cloud-state.mjs';

export const normalizeHandle = value => {
  const handle = typeof value === 'string' ? value.trim().replace(/^@/, '').toLowerCase() : '';
  return /^[a-z0-9_](?:[a-z0-9._]{0,28}[a-z0-9_])?$/.test(handle) ? handle : null;
};
export const verificationCode = text => typeof text === 'string' && /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6}$/.test(text.trim().toUpperCase())
  ? text.trim().toUpperCase() : null;
const hash = text => createHash('sha256').update(text).digest('hex');
const TTL = 10 * 60000;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => {
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (!verificationCode(code));
  return code;
};

export function createInstagramLink({ secret, issueLinkToken, getBlob = get, putBlob = put, deleteBlob = del,
  claim = createCloudState().claimPath, now = Date.now, generateCode = newCode }) {
  const codePath = code => 'dm/link-codes/codes/' + createHmac('sha256', secret).update(code).digest('hex');
  const userPath = uid => {
    if (!/^[a-f0-9-]{36}$/i.test(uid ?? '')) throw new Error('Invalid user');
    return 'dm/link-codes/users/' + hash(uid);
  };
  const read = async path => {
    const blob = await getBlob(path + '.json', { access: 'private', useCache: false });
    return blob?.stream ? openToken(await new Response(blob.stream).json(), secret) : null;
  };
  const save = (path, data, overwrite = false) => putBlob(path + '.json', JSON.stringify(sealToken(data, secret)),
    { access: 'private', addRandomSuffix: false, allowOverwrite: overwrite, contentType: 'application/json' });
  return {
    async issue(uid, value) {
      const username = normalizeHandle(value);
      if (!username) throw Object.assign(new Error('올바른 Instagram 아이디를 입력해 주세요.'), { status: 400 });
      const path = userPath(uid); const previous = await read(path);
      if (previous?.username === username && previous.expires > now()) return { code: previous.code, username, expires: previous.expires };
      if (!await claim(`${path}/issue-${Math.floor(now() / 30000)}.json`)) {
        throw Object.assign(new Error('잠시 후 인증번호를 다시 요청해 주세요.'), { status: 429 });
      }
      let pending;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateCode();
        if (!verificationCode(code)) throw new Error('Invalid generated code');
        const key = codePath(code);
        if (!await claim(key + '/reserved.json')) continue;
        pending = { uid, username, code, key, created: now(), expires: now() + TTL };
        await save(key, pending); break;
      }
      if (!pending) throw new Error('Code allocation unavailable');
      await save(path, pending, true);
      return { code: pending.code, username, expires: pending.expires };
    },
    async verify(text, sender, lookupUsername) {
      const code = verificationCode(text);
      if (!code) return null;
      if (!/^\d{1,32}$/.test(sender)) throw new Error('Invalid sender');
      let allowed = false;
      const minute = `dm/link-codes/attempts/${hash(sender)}/${Math.floor(now() / 60000)}`;
      for (let slot = 0; slot < 5; slot++) if (await claim(`${minute}/${slot}.json`)) { allowed = true; break; }
      if (!allowed) return '확인 요청이 많아요. 1분 후 다시 보내 주세요.';
      const key = codePath(code); const pending = await read(key);
      if (!pending || pending.expires <= now()) return '인증번호가 만료됐거나 올바르지 않아요. 가입 화면에서 새 번호를 받아 주세요.';
      const current = await read(userPath(pending.uid));
      if (current?.key !== key) return '새로 발급된 인증번호를 보내 주세요.';
      const verified = await read(key + '/verified');
      if (verified) return '이미 확인한 인증번호예요. 가입 화면으로 돌아가 주세요.';
      // Never trust a handle typed in the DM or a previously cached database handle.
      const username = normalizeHandle(await lookupUsername(sender));
      if (!username) return 'Instagram 아이디를 확인하지 못했어요. 잠시 후 같은 번호를 다시 보내 주세요.';
      if (username !== pending.username) return '가입 화면에 입력한 Instagram 아이디와 보낸 계정이 달라요. 입력한 계정에서 보내 주세요.';
      if (pending.expires <= now()) return '인증번호가 만료됐어요. 가입 화면에서 새 번호를 받아 주세요.';
      if (!await claim(key + '/verify.json')) return '인증을 확인하고 있어요. 가입 화면에서 결과를 확인해 주세요.';
      try {
        const token = await issueLinkToken({ igsid: sender, username });
        await save(key + '/verified', { token, igsid: sender, username });
      } catch (error) {
        await deleteBlob(key + '/verify.json'); throw error;
      }
      return 'Instagram 계정을 확인했어요! 가입 화면으로 돌아가면 연결이 완료돼요.';
    },
    async status(uid) {
      const pending = await read(userPath(uid));
      if (!pending) return { status: 'none' };
      if (pending.expires <= now()) return { status: 'expired' };
      const verified = await read(pending.key + '/verified');
      return verified ? { status: 'verified', ...verified } : {
        status: 'pending', code: pending.code, username: pending.username, expires: pending.expires,
      };
    },
  };
}

export function createSenderHandleLookup({ loadAccessToken, loadProfileToken, fetchImpl = fetch,
  graph = 'https://graph.facebook.com/v26.0', botId = '17841414630453998' }) {
  return async sender => {
    const token = await loadAccessToken();
    const request = async (url, accessToken) => {
      const r = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + accessToken },
        redirect: 'error', signal: AbortSignal.timeout(10000) });
      return r.ok ? r.json() : null;
    };
    try {
      const profileToken = loadProfileToken ? (await loadProfileToken()).token : token;
      const profile = await request(`${graph}/${sender}?fields=username`, profileToken);
      if (profile?.id === sender && normalizeHandle(profile.username)) return profile.username;
    } catch { /* Conversation participants are also Meta-verified, tied to this exact sender ID. */ }
    let after;
    // shortcut: bound fallback scans to 500 conversations; use a sender-filtered lookup at larger scale.
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({ platform: 'instagram', fields: 'participants', limit: '100', ...(after ? { after } : {}) });
      const conversations = await request(`${graph}/${botId}/conversations?${params}`, token);
      const participant = conversations?.data?.flatMap(c => c.participants?.data ?? []).find(p => p.id === sender);
      if (normalizeHandle(participant?.username)) return participant.username;
      after = conversations?.paging?.cursors?.after;
      if (!after || !conversations?.paging?.next) break;
    }
    return null;
  };
}
