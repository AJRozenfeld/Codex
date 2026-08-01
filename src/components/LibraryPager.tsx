import Link from "next/link";

// Search box + pager for the Platform Library tables (2026-07-31): the SRD
// sets run 300-600 rows, which overwhelmed both reader and browser as one
// table. Plain GET navigation - no client state, links carry q & page.
export function LibraryPager({ path, q, page, totalPages, totalCount }: {
  path: string;
  q: string;
  page: number;
  totalPages: number;
  totalCount: number;
}) {
  const href = (p: number) => `${path}?${q ? `q=${encodeURIComponent(q)}&` : ""}page=${p}`;
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3">
      <form action={path} method="get" className="flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className="rounded-lg bg-void border border-gold/30 px-3 py-1.5 text-sm text-parchment placeholder:text-parchment/40 focus:outline-none focus:border-gold/70 w-56"
        />
        <button type="submit" className="rounded-full border border-gold/40 text-gold px-4 py-1.5 text-sm hover:bg-gold/10">Search</button>
        {q && <Link href={path} className="text-xs text-parchment/50 hover:text-gold">clear</Link>}
      </form>
      <span className="text-xs text-parchment/50 ml-auto">
        {totalCount} entr{totalCount === 1 ? "y" : "ies"}{totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
      </span>
      {totalPages > 1 && (
        <span className="inline-flex items-center gap-2 text-sm">
          {page > 1 ? <Link href={href(page - 1)} className="text-gold hover:underline">&larr; Prev</Link> : <span className="text-parchment/30">&larr; Prev</span>}
          {page < totalPages ? <Link href={href(page + 1)} className="text-gold hover:underline">Next &rarr;</Link> : <span className="text-parchment/30">Next &rarr;</span>}
        </span>
      )}
    </div>
  );
}

export const LIBRARY_PAGE_SIZE = 50;

export function paginateLibrary<T extends { name: string }>(rows: T[], q: string, pageRaw: string | undefined): {
  pageRows: T[];
  page: number;
  totalPages: number;
  totalCount: number;
} {
  const needle = q.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows;
  const totalPages = Math.max(1, Math.ceil(filtered.length / LIBRARY_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(pageRaw) || 1), totalPages);
  return {
    pageRows: filtered.slice((page - 1) * LIBRARY_PAGE_SIZE, page * LIBRARY_PAGE_SIZE),
    page,
    totalPages,
    totalCount: filtered.length,
  };
}
