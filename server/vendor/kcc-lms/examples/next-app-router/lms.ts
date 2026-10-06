/**
 * One context per request.
 *
 * The ports are configuration and are built once; the viewer is not, and
 * that distinction is the whole reason this is a function. A context cached
 * in a module-level variable is a viewer that leaks from one request into the
 * next, and that bug reads other people's coursework.
 */
import { cache } from 'react';
import { asViewer, lmsContext, mysqlStore, type LmsPorts } from '@kcc/lms';
import { db } from '@/db';
import { getCurrentUser } from '@/lib/auth';

/*
 * The store is built once. Swap `mysqlStore` for `postgresStore` and nothing
 * else in the application changes — every rule in the module is above this
 * line.
 *
 * On MySQL the handle's connection must be in UTC (`timezone: 'Z'` for
 * mysql2), or every instant comes back shifted by the server's offset and a
 * course release date opens hours early.
 */
const store = mysqlStore({ db });

const ports: LmsPorts = {
  storage: {
    async signedUrl(objectKey, expiresInSeconds) {
      // Your S3/R2/GCS signer, or your own authenticated route.
      return `/api/files/${encodeURIComponent(objectKey)}?ttl=${expiresInSeconds}`;
    },
  },
  video: {
    async playback(videoRef) {
      // A signed token for Stream/Mux, or a plain URL if you serve files.
      return { token: await signPlaybackToken(videoRef) };
    },
  },
  notifier: {
    notify(event) {
      // Fire and forget. Throwing here is safe — the module swallows it
      // rather than rolling back the write that raised it.
      void enqueue(event);
    },
  },
};

/**
 * `cache` dedupes this within a single request, which matters because several
 * server components on one page will each ask for it.
 */
export const lms = cache(async () => {
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in.');
  return lmsContext({ store, viewer: asViewer(user.id, user.role), ports });
});
