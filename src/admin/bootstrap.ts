import { emailSchema } from '../shared/index.js';
import { UserModel } from '../db/models/index.js';
import type { Logger } from '../lib/logger.js';

export type BootstrapResult = 'promoted' | 'already_admin' | 'not_found';

/**
 * SRS 2.3: the first admin is made by this script, never by signup. The person signs up and
 * verifies like anyone else (FR-AD10); the script then sets role "admin" on that account.
 * It never creates accounts or handles passwords, and running it again changes nothing.
 * Sessions pick up the role, and the 24-hour admin cap, on their next request (FR-A8).
 */
export async function bootstrapAdmin(rawEmail: string, logger: Logger): Promise<BootstrapResult> {
  const email = emailSchema.parse(rawEmail);
  const user = await UserModel.findOne({ email }, { role: 1 }).lean();
  if (!user) {
    logger.warn({ job: 'admin_bootstrap' }, 'no account with that email; sign up first');
    return 'not_found';
  }
  if (user.role === 'admin') {
    logger.info({ job: 'admin_bootstrap', userId: user._id.toHexString() }, 'already admin');
    return 'already_admin';
  }
  await UserModel.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  logger.info({ job: 'admin_bootstrap', userId: user._id.toHexString() }, 'promoted to admin');
  return 'promoted';
}
