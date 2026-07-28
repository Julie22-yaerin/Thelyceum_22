import { useEffect, useState } from "react";

/*
 * Supabase connectivity smoke test — equivalent to the Next.js App Router
 * snippet (`app/notes/page.tsx` + `@/utils/supabase/server`), adapted to
 * this app's actual stack: a Vite/wouter SPA with an Express backend, not
 * Next.js. There's no server component here, so the query runs in
 * server/index.ts (GET /api/notes, using the Supabase service role key —
 * server-only) and this page just renders whatever it returns.
 */

export default function Notes() {
  const [notes, setNotes] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setNotes(data.notes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Request failed"));
  }, []);

  if (error) return <pre>Error: {error}</pre>;
  return <pre>{JSON.stringify(notes, null, 2)}</pre>;
}
