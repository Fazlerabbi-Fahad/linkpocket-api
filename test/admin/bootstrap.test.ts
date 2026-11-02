import { describe, expect, it } from 'vitest';
import { bootstrapAdmin } from '../../src/admin/bootstrap.js';
import { UserModel } from '../../src/db/models/index.js';
import { createLogger } from '../../src/lib/logger.js';
import { useMigratedDb } from '../migrated-db.js';
import { STRONG_PASSWORD, createHarness, loggedInClient, uniqueEmail } from '../harness.js';

/** SRS 2.3: the first admin comes from the bootstrap script, never from signup. */
describe('admin bootstrap', () => {
  useMigratedDb();
  const { app } = createHarness();
  const logger = createLogger('silent');

  it('promotes an existing account once, then reports it as already admin', async () => {
    const email = uniqueEmail('first-admin');
    const client = await loggedInClient(app, email);
    expect((await client.send('get', '/api/v1/admin/stats')).status).toBe(403);

    expect(await bootstrapAdmin(` ${email.toUpperCase()} `, logger)).toBe('promoted');
    expect((await UserModel.findOne({ email }).lean())?.role).toBe('admin');
    // The existing session picks up the role on its next request.
    expect((await client.send('get', '/api/v1/admin/stats')).status).toBe(200);

    expect(await bootstrapAdmin(email, logger)).toBe('already_admin');
  });

  it('never creates an account', async () => {
    const email = uniqueEmail('nobody');
    expect(await bootstrapAdmin(email, logger)).toBe('not_found');
    expect(await UserModel.countDocuments({ email })).toBe(0);
  });

  it('rejects a malformed address', async () => {
    await expect(bootstrapAdmin('not-an-email', logger)).rejects.toThrow();
  });

  it('signup cannot create an admin', async () => {
    const email = uniqueEmail('sneaky');
    const client = await loggedInClient(app, email, STRONG_PASSWORD);
    const res = await client.signup(uniqueEmail('sneaky2'), STRONG_PASSWORD, { role: 'admin' });
    expect(res.status).toBe(400);
    expect((await UserModel.findOne({ email }).lean())?.role).toBe('user');
  });
});
