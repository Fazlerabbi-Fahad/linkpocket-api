import {
  hostnameOf,
  type CreateResourceBody,
  type ListResourcesQuery,
  type ResourceDto,
  type ResourceList,
  type UpdateResourceBody,
} from '../shared/index.js';
import { Types } from 'mongoose';
import { ResourceModel, type Resource } from '../db/models/index.js';
import { AppError } from '../lib/app-error.js';
import type { Clock } from '../lib/clock.js';
import { LIBRARY_SORT, afterCursor, decodeCursor, encodeCursor } from './cursor.js';

type StoredResource = Resource & { _id: Types.ObjectId };

export function toResourceDto(resource: StoredResource): ResourceDto {
  return {
    id: resource._id.toHexString(),
    url: resource.url,
    title: resource.title,
    note: resource.note,
    tags: resource.tags,
    isPinned: resource.isPinned,
    pinnedAt: resource.pinnedAt ? resource.pinnedAt.toISOString() : null,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
  };
}

/**
 * The WHATWG form, used only to compare URLs for the duplicate warning (FR-R7), so that
 * "example.com", "https://Example.com" and "https://example.com/" count as the same link.
 * The stored URL stays exactly as typed (OQ-17).
 */
export function comparableUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resource CRUD (FR-R1 to FR-R7, FR-L1 to FR-L5). Every method takes the owner's id from the
 * authenticated session, and every query filters by it (NFR-S4). A resource that exists but
 * belongs to someone else is indistinguishable from one that does not exist (FR-R6).
 */
export class ResourceService {
  constructor(private readonly clock: Clock) {}

  /** Malformed ids are "not found" too, so probing ids reveals nothing (FR-R6, AC-8). */
  private idFilter(ownerId: Types.ObjectId, id: string) {
    if (!/^[a-f\d]{24}$/i.test(id)) throw new AppError('NOT_FOUND');
    return { _id: new Types.ObjectId(id), userId: ownerId };
  }

  private async isDuplicate(ownerId: Types.ObjectId, url: string): Promise<boolean> {
    const target = comparableUrl(url);
    // OQ-8: scanned through the userId index; a user has at most a few thousand resources.
    for await (const { url: saved } of ResourceModel.find({ userId: ownerId }, { url: 1, _id: 0 })
      .lean<{ url: string }>()
      .cursor()) {
      if (saved === url || comparableUrl(saved) === target) return true;
    }
    return false;
  }

  /** FR-R1, FR-R2, FR-R7: duplicates are saved and flagged. */
  async create(
    ownerId: Types.ObjectId,
    body: CreateResourceBody,
  ): Promise<{ resource: ResourceDto; duplicate: boolean }> {
    const duplicate = await this.isDuplicate(ownerId, body.url);
    const created = await ResourceModel.create({ ...body, userId: ownerId });
    return { resource: toResourceDto(created.toObject()), duplicate };
  }

  async get(ownerId: Types.ObjectId, id: string): Promise<ResourceDto> {
    const resource = await ResourceModel.findOne(this.idFilter(ownerId, id)).lean<StoredResource>();
    if (!resource) throw new AppError('NOT_FOUND');
    return toResourceDto(resource);
  }

  /** FR-R3, FR-C1: the server sets pinnedAt when pinning and clears it when unpinning. */
  async update(
    ownerId: Types.ObjectId,
    id: string,
    body: UpdateResourceBody,
  ): Promise<ResourceDto> {
    const resource = await ResourceModel.findOne(this.idFilter(ownerId, id));
    if (!resource) throw new AppError('NOT_FOUND');

    if (body.url !== undefined) resource.url = body.url;
    if (body.note !== undefined) resource.note = body.note;
    if (body.tags !== undefined) resource.tags = body.tags;
    if (body.title !== undefined) {
      resource.title = body.title === '' ? hostnameOf(resource.url) : body.title; // FR-R2
    }
    if (body.isPinned !== undefined && body.isPinned !== resource.isPinned) {
      resource.isPinned = body.isPinned;
      resource.pinnedAt = body.isPinned ? this.clock.now() : null;
    }
    await resource.save();
    return toResourceDto(resource.toObject());
  }

  /** FR-R4: permanent. The confirmation prompt is the web app's (Phase 8). */
  async delete(ownerId: Types.ObjectId, id: string): Promise<void> {
    const { deletedCount } = await ResourceModel.deleteOne(this.idFilter(ownerId, id));
    if (deletedCount === 0) throw new AppError('NOT_FOUND');
  }

  /**
   * FR-L1 to FR-L5. Search is a case-insensitive substring match on title, URL, note and
   * tags (OQ-6), limited to the caller's resources. Tags combine with AND.
   */
  async list(ownerId: Types.ObjectId, query: ListResourcesQuery): Promise<ResourceList> {
    const conditions: Record<string, unknown>[] = [{ userId: ownerId }];
    if (query.tag && query.tag.length > 0) conditions.push({ tags: { $all: query.tag } });
    if (query.pinned !== undefined) conditions.push({ isPinned: query.pinned });
    if (query.q) {
      const pattern = new RegExp(escapeRegex(query.q), 'i');
      conditions.push({
        $or: [{ title: pattern }, { url: pattern }, { note: pattern }, { tags: pattern }],
      });
    }
    if (query.cursor) conditions.push(afterCursor(decodeCursor(query.cursor)));

    const page = await ResourceModel.find({ $and: conditions })
      .sort(LIBRARY_SORT)
      .limit(query.limit + 1)
      .lean<StoredResource[]>();
    const items = page.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(toResourceDto),
      nextCursor: page.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  /** Every resource of one user, in library order (FR-D1 export). */
  async all(ownerId: Types.ObjectId): Promise<ResourceDto[]> {
    const resources = await ResourceModel.find({ userId: ownerId })
      .sort(LIBRARY_SORT)
      .lean<StoredResource[]>();
    return resources.map(toResourceDto);
  }
}
