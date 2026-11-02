import { Types } from 'mongoose';
import { z } from 'zod';
import { AppError } from '../lib/app-error.js';

/**
 * Keyset cursor for the FR-L1 library order: pinned first by pinnedAt, then createdAt, then
 * _id as the tie-breaker, all descending. The cursor is the last item's sort key. It is not
 * signed: it only narrows a query that is always filtered by the caller's own userId.
 */
export interface LibraryKey {
  isPinned: boolean;
  pinnedAt: Date | null;
  createdAt: Date;
  _id: Types.ObjectId;
}

const cursorSchema = z.strictObject({
  p: z.boolean(),
  pa: z.number().int().nullable(),
  c: z.number().int(),
  id: z.string().regex(/^[a-f\d]{24}$/),
});

export function encodeCursor(key: LibraryKey): string {
  const payload = {
    p: key.isPinned,
    pa: key.pinnedAt ? key.pinnedAt.getTime() : null,
    c: key.createdAt.getTime(),
    id: key._id.toHexString(),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): LibraryKey {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    raw = null;
  }
  const parsed = cursorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'cursor', message: 'Invalid cursor.' }]);
  }
  const { p, pa, c, id } = parsed.data;
  return {
    isPinned: p,
    pinnedAt: pa === null ? null : new Date(pa),
    createdAt: new Date(c),
    _id: new Types.ObjectId(id),
  };
}

export const LIBRARY_SORT = { isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 } as const;

/** The filter for "everything after `key`" in LIBRARY_SORT order. */
export function afterCursor(key: LibraryKey): Record<string, unknown> {
  const olderUnpinned = {
    isPinned: false,
    $or: [
      { createdAt: { $lt: key.createdAt } },
      { createdAt: key.createdAt, _id: { $lt: key._id } },
    ],
  };
  if (!key.isPinned) return olderUnpinned;
  return {
    $or: [
      { isPinned: true, pinnedAt: { $lt: key.pinnedAt } },
      { isPinned: true, pinnedAt: key.pinnedAt, createdAt: { $lt: key.createdAt } },
      { isPinned: true, pinnedAt: key.pinnedAt, createdAt: key.createdAt, _id: { $lt: key._id } },
      { isPinned: false },
    ],
  };
}
