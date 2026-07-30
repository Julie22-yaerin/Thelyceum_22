/**
 * A minimal in-memory stand-in for the slice of Firestore this codebase uses.
 *
 * Why it exists: without it, nothing server-side works until someone has a
 * GCP project — which means the product cannot be run, demoed or tested by a
 * new developer, and an MVP nobody can start is not an MVP. With it, the
 * whole system (roster, tasks, MCP, evidence graph) runs out of the box.
 *
 * What it is NOT: durable. Data lives in the process and dies with it, and it
 * is per-instance, so two servers do not see each other's writes. That is why
 * `getDb()` refuses to hand this out in production — see firestore.ts.
 *
 * Supported surface, matching how server/db/* actually calls Firestore:
 *   collection(name).doc(id?)          → get / set(merge) / update
 *   collection(name).where(...).orderBy(...).limit(n).get()
 *   runTransaction(fn)                  → tx.get / tx.set / tx.update
 *   FieldValue.increment sentinels in update()/set()
 */

interface StoredDoc {
  data: Record<string, unknown>;
}

/** Detects a FieldValue.increment(n) sentinel without importing firebase-admin. */
function incrementAmount(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown> & { constructor?: { name?: string } };
  if (typeof v.operand === "number") return v.operand;
  // Our own tests use a plain marker; support it so the fake and the test
  // double behave identically.
  if (typeof v.__increment__ === "number") return v.__increment__;
  return null;
}

function applyUpdate(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const inc = incrementAmount(value);
    if (inc !== null) {
      merged[key] = (typeof merged[key] === "number" ? (merged[key] as number) : 0) + inc;
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

class MemoryQuery {
  constructor(private rows: StoredDoc[]) {}

  where(field: string, op: string, value: unknown): MemoryQuery {
    const rows = this.rows.filter((r) => {
      const actual = r.data[field];
      switch (op) {
        case "==":
          return actual === value;
        case "!=":
          return actual !== value;
        case ">":
          return (actual as number) > (value as number);
        case ">=":
          return (actual as number) >= (value as number);
        case "<":
          return (actual as number) < (value as number);
        case "<=":
          return (actual as number) <= (value as number);
        case "in":
          return Array.isArray(value) && value.includes(actual);
        case "array-contains":
          return Array.isArray(actual) && actual.includes(value);
        default:
          throw new Error(`memoryFirestore: unsupported operator "${op}"`);
      }
    });
    return new MemoryQuery(rows);
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): MemoryQuery {
    const sorted = [...this.rows].sort((a, b) => {
      const av = a.data[field] as number | string;
      const bv = b.data[field] as number | string;
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return dir === "desc" ? -cmp : cmp;
    });
    return new MemoryQuery(sorted);
  }

  limit(n: number): MemoryQuery {
    return new MemoryQuery(this.rows.slice(0, n));
  }

  async get() {
    return {
      empty: this.rows.length === 0,
      size: this.rows.length,
      docs: this.rows.map((r) => ({
        id: String(r.data.id ?? ""),
        exists: true,
        data: () => ({ ...r.data }),
      })),
    };
  }
}

class MemoryCollection {
  private store = new Map<string, StoredDoc>();
  private autoId = 0;

  doc(id?: string) {
    // Firestore's generated ids are opaque; ours only need to be unique and
    // sortable enough for tests.
    const docId =
      id ?? `mem${(++this.autoId).toString(36).padStart(6, "0")}${Date.now().toString(36)}`;
    const store = this.store;
    return {
      id: docId,
      get: async () => {
        const doc = store.get(docId);
        return {
          id: docId,
          exists: !!doc,
          data: () => (doc ? { ...doc.data } : undefined),
        };
      },
      set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        const existing = store.get(docId);
        store.set(docId, {
          data: opts?.merge ? applyUpdate(existing?.data, data) : { ...data },
        });
      },
      update: async (data: Record<string, unknown>) => {
        const existing = store.get(docId);
        store.set(docId, { data: applyUpdate(existing?.data, data) });
      },
      delete: async () => {
        store.delete(docId);
      },
    };
  }

  where(field: string, op: string, value: unknown): MemoryQuery {
    return new MemoryQuery(Array.from(this.store.values())).where(field, op, value);
  }

  orderBy(field: string, dir: "asc" | "desc" = "asc"): MemoryQuery {
    return new MemoryQuery(Array.from(this.store.values())).orderBy(field, dir);
  }

  async get() {
    return new MemoryQuery(Array.from(this.store.values())).get();
  }
}

export class MemoryFirestore {
  private collections = new Map<string, MemoryCollection>();

  collection(name: string): MemoryCollection {
    let c = this.collections.get(name);
    if (!c) {
      c = new MemoryCollection();
      this.collections.set(name, c);
    }
    return c;
  }

  /**
   * Runs the body immediately. There is no isolation and no retry: this is a
   * single-threaded process, so the read-modify-write inside a transaction
   * cannot interleave with another one. Callers relying on Firestore's
   * contention retries get the same *result* here, just without the
   * concurrency guarantee — which is fine because there is no concurrency.
   */
  async runTransaction<T>(fn: (tx: MemoryTransaction) => Promise<T>): Promise<T> {
    return fn({
      get: (ref) => ref.get(),
      set: (ref, data, opts) => {
        void ref.set(data, opts);
      },
      update: (ref, data) => {
        void ref.update(data);
      },
      delete: (ref) => {
        void ref.delete();
      },
    });
  }
}

type DocRef = ReturnType<MemoryCollection["doc"]>;

export interface MemoryTransaction {
  get: (ref: DocRef) => Promise<{ id: string; exists: boolean; data: () => unknown }>;
  set: (ref: DocRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => void;
  update: (ref: DocRef, data: Record<string, unknown>) => void;
  delete: (ref: DocRef) => void;
}
