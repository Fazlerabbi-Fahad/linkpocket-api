/**
 * NFR-P5, NFR-P6, AC-19: seeds verified load-test accounts, each with a full library, so k6
 * (load/k6/resources.js) can log in and work the resource endpoints. Staging only: refuses
 * APP_ENV=production. Accounts use the reserved `.invalid` domain, so no email can ever be
 * sent to them. Re-running tops up what is missing; `--clean` removes everything it created.
 *
 *   LOAD_TEST_PASSWORD=... pnpm load:seed            (from apps/api, against MONGODB_URI)
 *   pnpm load:seed --clean
 */
import { loadConfig } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db/connection.js';
import { AuthSessionModel, ResourceModel, UserModel } from '../src/db/models/index.js';
import { PasswordHasher } from '../src/auth/password-hasher.js';

export const LOAD_EMAIL_DOMAIN = 'loadtest.invalid';
export const SEARCH_WORDS = ['design', 'kitchen', 'travel', 'typescript', 'garden', 'finance'];
const TAGS = ['reading', 'work', 'later', 'recipes', 'tools', 'ideas'];

export function loadEmail(index: number): string {
  return `load-${String(index).padStart(4, '0')}@${LOAD_EMAIL_DOMAIN}`;
}

/** A deterministic library: varied hosts, titles containing SEARCH_WORDS, a few tags. */
export function libraryFor(userId: unknown, count: number, now: Date) {
  return Array.from({ length: count }, (_, i) => {
    const word = SEARCH_WORDS[i % SEARCH_WORDS.length] ?? 'misc';
    const createdAt = new Date(now.getTime() - i * 60_000);
    return {
      userId,
      url: `https://site-${i % 40}.example/${word}/${i}`,
      title: `${word} notes ${i}`,
      note: i % 3 === 0 ? `Saved while reading about ${word}.` : '',
      tags: [TAGS[i % TAGS.length] ?? 'misc', ...(i % 5 === 0 ? ['pinned-later'] : [])],
      isPinned: i % 50 === 0,
      pinnedAt: i % 50 === 0 ? createdAt : null,
      createdAt,
      updatedAt: createdAt,
    };
  });
}

export async function seedLoadUsers(options: {
  users: number;
  resourcesPerUser: number;
  passwordHash: string;
  now: Date;
}): Promise<{ usersCreated: number; resourcesCreated: number }> {
  let usersCreated = 0;
  let resourcesCreated = 0;
  for (let n = 1; n <= options.users; n += 1) {
    const email = loadEmail(n);
    const result = await UserModel.updateOne(
      { email },
      {
        $setOnInsert: {
          email,
          passwordHash: options.passwordHash,
          role: 'user',
          status: 'active',
          sessionVersion: 0,
          emailVerifiedAt: options.now,
          privacyPolicyAcceptedAt: options.now,
          createdAt: options.now,
        },
      },
      { upsert: true },
    );
    usersCreated += result.upsertedCount;
    const user = await UserModel.findOne({ email }, { _id: 1 }).lean();
    if (!user) continue;
    const have = await ResourceModel.countDocuments({ userId: user._id });
    const missing = options.resourcesPerUser - have;
    if (missing > 0) {
      await ResourceModel.insertMany(libraryFor(user._id, missing, options.now), {
        ordered: false,
      });
      resourcesCreated += missing;
    }
  }
  return { usersCreated, resourcesCreated };
}

export async function cleanLoadUsers(): Promise<number> {
  const pattern = new RegExp(`@${LOAD_EMAIL_DOMAIN.replace('.', '\\.')}$`);
  const users = await UserModel.find({ email: pattern }, { _id: 1 }).lean();
  const ids = users.map((u) => u._id);
  await ResourceModel.deleteMany({ userId: { $in: ids } });
  await AuthSessionModel.deleteMany({ userId: { $in: ids } });
  await UserModel.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: use the real environment.
  }
  const config = loadConfig();
  if (config.appEnv === 'production') {
    throw new Error('Refusing to seed load-test accounts with APP_ENV=production.');
  }
  await connectDb(config.mongoUri);
  try {
    if (process.argv.includes('--clean')) {
      console.log(`removed ${await cleanLoadUsers()} load-test accounts`);
      return;
    }
    const password = process.env.LOAD_TEST_PASSWORD ?? '';
    if (password.length < 12) throw new Error('Set LOAD_TEST_PASSWORD (12+ characters).');
    const result = await seedLoadUsers({
      users: Number(process.env.LOAD_USERS ?? 200),
      resourcesPerUser: Number(process.env.LOAD_RESOURCES ?? 500),
      passwordHash: await new PasswordHasher(config.passwordHash).hash(password),
      now: new Date(),
    });
    console.log(
      `created ${result.usersCreated} accounts and ${result.resourcesCreated} links (domain ${LOAD_EMAIL_DOMAIN})`,
    );
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1]?.endsWith('load-seed.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'load seed failed');
    process.exit(1);
  });
}
