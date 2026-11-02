import { z } from 'zod';
import { USER_ROLES } from '../domain.js';
import { resourceSchema } from './resource.js';

/**
 * GET /account/export (FR-D1). Strict, so a contract test fails if a secret field (password
 * hash, verification token, session data) is ever added to the export.
 */
export const accountExportSchema = z.strictObject({
  format: z.literal('linkpocket-export'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  account: z.strictObject({
    id: z.string(),
    email: z.string(),
    name: z.string().nullable(),
    role: z.enum(USER_ROLES),
    emailVerifiedAt: z.iso.datetime().nullable(),
    privacyPolicyAcceptedAt: z.iso.datetime(),
    createdAt: z.iso.datetime(),
    lastLoginAt: z.iso.datetime().nullable(),
    lastActiveAt: z.iso.datetime().nullable(),
  }),
  resources: z.array(resourceSchema),
});

export type AccountExport = z.output<typeof accountExportSchema>;
