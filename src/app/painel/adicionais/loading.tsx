import { LoadingState } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="h-6 w-64 animate-pulse rounded bg-surface-subdued" />
      <div className="h-10 w-full max-w-sm animate-pulse rounded-xl bg-surface-subdued" />
      <LoadingState rows={4} />
    </div>
  );
}
