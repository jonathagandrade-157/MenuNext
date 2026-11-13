"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { markNavigatedInStore } from "@/lib/storeNavigation";

/** Marca (por aba) que o cliente já trocou de página dentro desta loja — ver lib/storeNavigation.ts. */
export function StoreNavigationTracker({ slug }: { slug: string }) {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    if (pathname !== first.current) markNavigatedInStore(slug);
  }, [pathname, slug]);
  return null;
}
