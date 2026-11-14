// Read-through cache: every list/get call that succeeds is kept on the phone, and is
// returned when there's no coverage. Cleared on sign-out.
import type { Api } from '../api/types';
import { kvDel, kvGet, kvKeys, kvSet } from './kv';
import { isNetworkError } from './net';

const PREFIX = 'cache:';
const SKIP = new Set(['getSession', 'demoAccounts', 'fileUrl']);

export function withOfflineCache(api: Api): Api {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      if (prop === 'signOut') {
        return async (...args: unknown[]) => {
          await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          await clearOfflineCache();
        };
      }
      if (SKIP.has(prop) || !/^(list|get|my)/.test(prop)) return value.bind(target);
      return async (...args: unknown[]) => {
        const key = `${PREFIX}${prop}:${JSON.stringify(args)}`;
        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          void kvSet(key, result);
          return result;
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          const cached = await kvGet(key);
          if (cached !== undefined) return cached;
          throw new Error("You're offline and this hasn't been opened on this phone yet. It will load when you have coverage.");
        }
      };
    },
  });
}

export async function clearOfflineCache() {
  for (const k of await kvKeys(PREFIX)) await kvDel(k);
}
