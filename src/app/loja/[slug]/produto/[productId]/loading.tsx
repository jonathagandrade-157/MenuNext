export default function Loading() {
  return (
    <div className="animate-pulse pb-28">
      <div className="h-14 w-full bg-surface-card" />
      <div className="aspect-square w-full bg-surface-subdued" />
      <div className="space-y-3 px-3.5 py-4">
        <div className="h-5 w-2/3 rounded bg-surface-subdued" />
        <div className="h-4 w-full rounded bg-surface-subdued" />
        <div className="h-6 w-24 rounded bg-surface-subdued" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 w-full rounded-xl bg-surface-subdued" />
        ))}
      </div>
    </div>
  );
}
