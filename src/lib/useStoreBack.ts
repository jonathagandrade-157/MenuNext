"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { readNavigatedInStore, shouldUseHistoryBack } from "./storeNavigation";

/** Volta uma página dentro da loja; se o cliente chegou direto (link externo), vai para o cardápio. */
export function useStoreBack(slug: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    if (shouldUseHistoryBack({ navigatedInStore: readNavigatedInStore(slug), historyLength: window.history.length })) {
      router.back();
    } else {
      router.push(`/loja/${slug}`);
    }
  }, [router, slug]);
}
