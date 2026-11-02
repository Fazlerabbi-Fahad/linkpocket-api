import { describe, expect, it } from 'vitest';
import { hasMongoOperatorKeys, isAuditActorId, isObjectIdHex } from './domain.js';
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  ERROR_STATUS,
  buildErrorResponse,
  errorResponseSchema,
} from './errors.js';

describe('hasMongoOperatorKeys (NFR-S6)', () => {
  it.each([
    [{ email: { $ne: null } }, true],
    [{ $where: 'sleep(1000)' }, true],
    [{ tags: [{ $gt: '' }] }, true],
    [{ a: { b: { c: { $regex: '.*' } } } }, true],
    [{ email: 'a@b.co', tags: ['x', 'y'], price: '$5' }, false],
    ['$plain string values are fine', false],
    [null, false],
    [42, false],
  ])('%j -> %s', (value, expected) => {
    expect(hasMongoOperatorKeys(value)).toBe(expected);
  });

  it('treats extremely deep nesting as hostile', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 40; i += 1) {
      const next: Record<string, unknown> = {};
      deep.a = next;
      deep = next;
    }
    expect(hasMongoOperatorKeys(root)).toBe(true);
  });
});

describe('ids', () => {
  it('recognizes ObjectId hex strings and the system actor (clarification 3)', () => {
    expect(isObjectIdHex('65f0c0ffee0000000000abcd')).toBe(true);
    expect(isObjectIdHex('65f0c0ffee')).toBe(false);
    expect(isAuditActorId('system')).toBe(true);
    expect(isAuditActorId('65f0c0ffee0000000000abcd')).toBe(true);
    expect(isAuditActorId('admin@example.com')).toBe(false);
  });
});

describe('error contract (Section 6, NFR-S8)', () => {
  it('every code has a status and a generic message', () => {
    for (const code of Object.values(ERROR_CODES)) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });

  it('builds the documented envelope, with fields only when present', () => {
    const plain = buildErrorResponse('NOT_FOUND', 'req-1');
    expect(plain).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'req-1' },
    });
    expect(errorResponseSchema.parse(plain)).toEqual(plain);

    const withFields = buildErrorResponse('VALIDATION_FAILED', 'req-2', [
      { path: 'url', message: 'Enter a valid URL.' },
    ]);
    expect(withFields.error.fields).toHaveLength(1);
    expect(buildErrorResponse('VALIDATION_FAILED', 'req-3', []).error).not.toHaveProperty('fields');
  });

  it('uses 404 for not-found so other users resources look absent (FR-R6)', () => {
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
  });
});
