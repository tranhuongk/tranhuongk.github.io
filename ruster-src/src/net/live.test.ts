// Live check against the real ID server and a real peer; skipped unless RUSTER_LIVE_ID is set:
//   RUSTER_LIVE_ID=156993080 npx vitest run src/net/live.test.ts
// RUSTER_LIVE_PASSWORD (optional) also exercises the login.
// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { RustSession, type SessionEvents } from './session';
import { DEFAULT_SERVER } from './rendezvous';

const id = process.env.RUSTER_LIVE_ID;

describe.skipIf(!id)('live RustDesk peer', () => {
  test('reaches the password prompt (and the first video frame with a password)', async () => {
    const log: string[] = [];
    let session!: RustSession;
    const password = process.env.RUSTER_LIVE_PASSWORD;
    const outcome = await new Promise<string>((resolve) => {
      const events: SessionEvents = {
        status: (t) => log.push(t),
        needPassword: (reason) => resolve(password ? `password rejected: ${reason}` : 'needPassword'),
        ready: (p) => log.push(`ready ${p.width}x${p.height} ${p.platform}`),
        video: (f) => resolve(`video ${f.length} frame(s), key=${f[0]?.key}, ${f[0]?.data.length} bytes`),
        closed: (e) => resolve(`closed: ${e?.kind} ${e?.message}`),
      };
      session = new RustSession({ peerId: id!, server: DEFAULT_SERVER, password, events });
      void session.run();
      setTimeout(() => resolve('timeout'), 25_000);
    });
    session.close();
    console.log(log.join('\n'), '\n=>', outcome);
    expect(outcome).toMatch(password ? /^video/ : /^needPassword$/);
  }, 40_000);
});
