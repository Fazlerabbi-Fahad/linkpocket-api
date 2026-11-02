import { z } from 'zod';
import { PAGINATION, RESOURCE_LIMITS } from '../constants.js';
import { hostnameOf, normalizeUrl, type UrlRejection } from '../url.js';

const URL_MESSAGES: Record<UrlRejection, string> = {
  empty: 'Enter a URL.',
  too_long: `URLs can be at most ${RESOURCE_LIMITS.urlMax} characters.`,
  unsupported_scheme: 'Only http and https links can be saved.',
  malformed: 'Enter a valid URL.',
};

/** FR-U1 to FR-U3: the same rule runs in the browser form and at the API boundary. */
export const resourceUrlSchema = z.string().transform((value, ctx) => {
  const result = normalizeUrl(value);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', message: URL_MESSAGES[result.reason] });
    return z.NEVER;
  }
  return result.url;
});

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Tags cannot be empty.')
  .max(RESOURCE_LIMITS.tagMax, `Tags can be at most ${RESOURCE_LIMITS.tagMax} characters.`);

/** FR-R1: up to 10 lowercase tags. Duplicates (after lowercasing) are collapsed. */
export const tagsSchema = z
  .array(tagSchema)
  .max(RESOURCE_LIMITS.tagsMax, `Use at most ${RESOURCE_LIMITS.tagsMax} tags.`)
  .transform((tags) => [...new Set(tags)]);

/** Shared with the web save and edit forms (FR-U3). */
export const titleInputSchema = z
  .string()
  .trim()
  .max(RESOURCE_LIMITS.titleMax, `Titles can be at most ${RESOURCE_LIMITS.titleMax} characters.`);

export const noteSchema = z
  .string()
  .max(RESOURCE_LIMITS.noteMax, `Notes can be at most ${RESOURCE_LIMITS.noteMax} characters.`);

/** POST /resources. FR-R2: a blank or missing title becomes the URL hostname. */
export const createResourceSchema = z
  .strictObject({
    url: resourceUrlSchema,
    title: titleInputSchema.optional(),
    note: noteSchema.optional(),
    tags: tagsSchema.default([]),
  })
  .transform(({ title, ...rest }) => ({
    ...rest,
    title: title && title !== '' ? title : hostnameOf(rest.url),
  }));

/**
 * PATCH /resources/:id (FR-R3, FR-C1). A blank title is passed through as "" and the API
 * replaces it with the hostname of the resulting URL, which may be the stored one.
 * The client never sends pinnedAt or userId (NFR-S4); the server sets pinnedAt.
 */
export const updateResourceSchema = z
  .strictObject({
    url: resourceUrlSchema.optional(),
    title: titleInputSchema.optional(),
    note: noteSchema.optional(),
    tags: tagsSchema.optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Nothing to update.',
  });

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/** GET /resources query string (FR-L2 to FR-L5). Repeated `tag` params combine with AND. */
export const listResourcesQuerySchema = z.strictObject({
  q: z.string().trim().max(200).optional(),
  tag: z
    .union([tagSchema, z.array(tagSchema).max(RESOURCE_LIMITS.tagsMax)])
    .transform((value) => [...new Set(Array.isArray(value) ? value : [value])])
    .optional(),
  pinned: booleanQuery.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.libraryPageSize)
    .default(PAGINATION.libraryPageSize),
});

export const resourceSchema = z.strictObject({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  pinnedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const resourceListSchema = z.strictObject({
  items: z.array(resourceSchema),
  nextCursor: z.string().nullable(),
});

/** FR-R7: duplicates are saved, and the response says so. */
export const createResourceResponseSchema = z.strictObject({
  resource: resourceSchema,
  duplicate: z.boolean(),
});

export type CreateResourceInput = z.input<typeof createResourceSchema>;
export type CreateResourceBody = z.output<typeof createResourceSchema>;
export type UpdateResourceBody = z.output<typeof updateResourceSchema>;
export type ListResourcesQuery = z.output<typeof listResourcesQuerySchema>;
export type ResourceDto = z.output<typeof resourceSchema>;
export type ResourceList = z.output<typeof resourceListSchema>;
