export default function Loading() {
  return (
    <div className="animate-pulse pb-24">
      <div className="h-40 w-full bg-surface-subdued" />
      <div className="px-4">
        <div className="-mt-10 h-20 w-20 rounded-2xl border-2 border-white bg-surface-subdued" />
        <div className="mt-3 h-5 w-40 rounded bg-surface-subdued" />
        <div className="mt-2 h-3 w-24 rounded bg-surface-subdued" />
      </div>
      <div className="mt-6 space-y-3 px-3.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 w-full rounded-2xl bg-surface-subdued" />
        ))}
      </div>
    </div>
  );
}
