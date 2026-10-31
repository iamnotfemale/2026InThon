import { put, head } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

export function createCloudState(putBlob = put, headBlob = head) {
  const save = (path, value) => putBlob(path, JSON.stringify(value), {
    access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json',
  });
  return {
    record: receipt => save(`dm/receipts/${randomUUID()}.json`, receipt),
    async reserveReply(key) {
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid reply key');
      try {
        await save(`dm/replies/${key}/sending.json`, { at: new Date().toISOString() });
        return true;
      } catch (error) {
        // An existing reservation also covers a write whose acknowledgement was lost.
        try { await headBlob(`dm/replies/${key}/sending.json`); return false; }
        catch { throw error; }
      }
    },
    replyRecord: ({ key, status, at }) => save(`dm/replies/${key}/${status}.json`, { at }),
  };
}
