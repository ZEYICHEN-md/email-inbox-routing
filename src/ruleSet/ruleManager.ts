/**
 * Rule Management Interface (RuleManager).
 *
 * CRUD over the Routing_Rule_Set with write-time validation and timestamp
 * versioning for cutover semantics, per the design notes's "Rule Management Interface"
 * section. This module is pure data management: it never invokes or alters
 * Email_Classifier logic (Req 16.1).
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5
 */
import type { Category, RuleBehavior, RuleEntry, Timestamp } from "../types/index.js";
import { seedRuleEntries } from "./seedData.js";

/** A validation failure returned when a write is rejected. */
export interface ValidationError {
  code: "INVALID_EMAIL_FORMAT" | "EMPTY_FORWARD_RECIPIENTS" | "NOT_FOUND";
  message: string;
}

/** A minimal Result type for write operations. */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * A single versioned change to a category's mapping.
 * `entry === null` is a deletion tombstone effective from `effectiveFrom`.
 */
interface Version {
  effectiveFrom: Timestamp;
  entry: RuleEntry | null;
}

/**
 * Validates a single recipient string against a pragmatic RFC-5322-style
 * `local-part@domain` shape: non-empty local part and domain, the domain
 * containing at least one dot-separated label (a TLD), and no whitespace.
 */
export function isValidEmailFormat(recipient: string): boolean {
  if (typeof recipient !== "string") return false;
  const trimmed = recipient.trim();
  if (trimmed.length === 0) return false;
  // No internal whitespace allowed.
  if (/\s/.test(trimmed)) return false;
  const atIndex = trimmed.indexOf("@");
  // Exactly one "@", with non-empty local part and domain.
  if (atIndex <= 0) return false;
  if (trimmed.indexOf("@", atIndex + 1) !== -1) return false;
  const localPart = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (localPart.length === 0 || domain.length === 0) return false;
  // Domain must have at least one dot-separated TLD, and no empty labels.
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;
  return true;
}

/**
 * RuleManager: maintains the versioned Routing_Rule_Set and enforces write-time
 * validation. Construct with the seed rule set by default, or an explicit
 * initial set for testing.
 */
export class RuleManager {
  /** Per-category ordered list of versions (ascending by effectiveFrom). */
  private readonly versions = new Map<Category, Version[]>();

  /** Clock used to stamp `effectiveFrom` when not explicitly provided. */
  private readonly now: () => Timestamp;

  constructor(options?: { initialEntries?: RuleEntry[]; now?: () => Timestamp }) {
    this.now = options?.now ?? (() => Date.now());
    const initial = options?.initialEntries ?? seedRuleEntries();
    for (const entry of initial) {
      const list = this.versions.get(entry.category) ?? [];
      list.push({
        effectiveFrom: entry.effectiveFrom,
        entry: { ...entry, recipients: [...entry.recipients] },
      });
      this.versions.set(entry.category, list);
    }
    // Keep each category's version list sorted ascending by effectiveFrom.
    for (const list of this.versions.values()) {
      list.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    }
  }

  /**
   * Resolves the currently-active entry for a category as of `asOf`, i.e. the
   * latest version whose `effectiveFrom <= asOf`. Returns `null` if the category
   * has no version in effect at that time (never created, or deleted).
   */
  private resolveActive(category: Category, asOf: Timestamp): RuleEntry | null {
    const list = this.versions.get(category);
    if (!list || list.length === 0) return null;
    let active: Version | null = null;
    for (const v of list) {
      if (v.effectiveFrom <= asOf) {
        active = v;
      } else {
        break; // list is sorted ascending; no later version qualifies
      }
    }
    return active?.entry ?? null;
  }

  /**
   * Adds or updates the recipient mapping for a category.
   *
   * Validation (write-time, per Req 16.2/16.3):
   *  - every recipient must be a valid email address format, else reject and
   *    keep the prior mapping unchanged (Req 16.2);
   *  - for FORWARD-behavior categories the resulting recipient set must be
   *    non-empty, else reject and keep the prior mapping unchanged (Req 16.3).
   *
   * On success a new version is appended with `effectiveFrom = effectiveFrom`
   * (defaulting to the manager's clock), so that `getActiveRuleSet(asOf)`
   * resolves the mapping in effect at any given timestamp (Req 16.4/16.5).
   *
   * Behavior resolution: an existing category keeps its current behavior; a
   * brand-new category defaults to FORWARD (a recipient mapping is being added).
   */
  addOrUpdateMapping(
    category: Category,
    recipients: string[],
    effectiveFrom?: Timestamp,
  ): Result<void, ValidationError> {
    const stampTime = effectiveFrom ?? this.now();
    const prior = this.resolveActive(category, stampTime);
    const behavior: RuleBehavior = prior?.behavior ?? "FORWARD";

    // Req 16.2: reject invalid email formats without side effects.
    for (const recipient of recipients) {
      if (!isValidEmailFormat(recipient)) {
        return err<ValidationError>({
          code: "INVALID_EMAIL_FORMAT",
          message: `Recipient "${recipient}" is not a valid email address format; mapping unchanged.`,
        });
      }
    }

    // Req 16.3: a FORWARD category must retain at least one recipient.
    if (behavior === "FORWARD" && recipients.length === 0) {
      return err<ValidationError>({
        code: "EMPTY_FORWARD_RECIPIENTS",
        message: `Category "${category}" is a forward category and requires at least one recipient; mapping unchanged.`,
      });
    }

    const newEntry: RuleEntry = {
      category,
      behavior,
      recipients: [...recipients],
      ...(prior?.guidanceNote !== undefined ? { guidanceNote: prior.guidanceNote } : {}),
      effectiveFrom: stampTime,
    };
    this.appendVersion(category, { effectiveFrom: stampTime, entry: newEntry });
    return ok(undefined);
  }

  /**
   * Deletes a category's mapping by appending a deletion tombstone effective
   * from `effectiveFrom` (defaulting to the manager's clock). Historical
   * resolutions before that timestamp are unaffected (Req 16.5). Returns
   * NOT_FOUND if the category has no active mapping at the deletion time.
   */
  deleteMapping(category: Category, effectiveFrom?: Timestamp): Result<void, ValidationError> {
    const stampTime = effectiveFrom ?? this.now();
    const prior = this.resolveActive(category, stampTime);
    if (prior === null) {
      return err<ValidationError>({
        code: "NOT_FOUND",
        message: `Category "${category}" has no active mapping to delete.`,
      });
    }
    this.appendVersion(category, { effectiveFrom: stampTime, entry: null });
    return ok(undefined);
  }

  /**
   * Returns the full set of rule entries in effect as of `asOf` — for each
   * category, the latest version whose `effectiveFrom <= asOf`, excluding any
   * category whose active version at that time is a deletion tombstone.
   *
   * Resolution as-of a fixed timestamp is stable regardless of later updates,
   * because later versions have a strictly greater `effectiveFrom` and are
   * ignored (Req 16.4/16.5).
   */
  getActiveRuleSet(asOf: Timestamp): RuleEntry[] {
    const result: RuleEntry[] = [];
    for (const category of this.versions.keys()) {
      const active = this.resolveActive(category, asOf);
      if (active !== null) {
        result.push({ ...active, recipients: [...active.recipients] });
      }
    }
    // Deterministic ordering by category for stable output.
    result.sort((a, b) => a.category.localeCompare(b.category));
    return result;
  }

  private appendVersion(category: Category, version: Version): void {
    const list = this.versions.get(category) ?? [];
    list.push(version);
    list.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
    this.versions.set(category, list);
  }
}
