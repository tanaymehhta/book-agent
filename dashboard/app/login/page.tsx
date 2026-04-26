type SearchParams = { next?: string; error?: string };

export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const next = searchParams.next ?? '/kanban';
  const hasError = searchParams.error === '1';

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="fade-up w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="flex items-baseline justify-center gap-2">
            <h1 className="text-[28px] font-[600] tracking-[-0.015em] text-ink">
              Lookout Booking
            </h1>
            <span className="font-display italic text-[22px] text-accent/90 leading-none">
              &amp;
            </span>
            <span className="text-[14px] text-ink-3 pb-[2px]">the taproom desk</span>
          </div>
          <p className="mt-2 font-display italic text-[15px] text-ink-3">
            sign in to continue.
          </p>
        </div>

        <form
          method="POST"
          action="/api/login"
          className="space-y-4 rounded-2xl border border-line-strong bg-paper-2/70 p-6 shadow-sm"
        >
          <input type="hidden" name="next" value={next} />

          <label className="block">
            <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              Password
            </span>
            <input
              type="password"
              name="password"
              required
              autoFocus
              autoComplete="current-password"
              className="w-full rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink outline-none transition focus:border-ink/30 focus:ring-2 focus:ring-accent-soft/60"
            />
          </label>

          {hasError && (
            <div className="rounded-md border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px] text-accent-deep">
              That password didn&rsquo;t match. Try again.
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded-full bg-ink px-4 py-2 text-[14px] font-[500] text-paper transition hover:bg-ink-2"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
