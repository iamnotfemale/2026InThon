import { put, head } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

export function createCloudState(putBlob = put, headBlob = head) {
  const save = (path, value) => putBlob(path, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json',
  });
  async function claimPath(path) {
    try { await save(path, { at: new Date().toISOString() }); return true; }
    catch (error) {
      // An existing reservation also covers a write whose acknowledgement was lost.
      try { await headBlob(path); return false; }
      catch { throw error; }
    }
  }
  return {
    claimPath,
    record: receipt => save(`dm/receipts/${randomUUID()}.json`, receipt),
    async reserveReply(key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid reply key');
      return claimPath(`dm/replies/${key}/sending.json`);
    },
    replyRecord: ({ key, status, at }) => save(`dm/replies/${key}/${status}.json`, { at }),
  };
}
