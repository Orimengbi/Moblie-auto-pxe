"use client";

import { useEffect, useState } from "react";

/** 启用的用户名，选负责人用。 */
export function useUserNames(enabled = true): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    void fetch("/api/users/names")
      .then((response) => response.json())
      .then((list: unknown) => setNames(Array.isArray(list) ? list : []))
      .catch(() => undefined);
  }, [enabled]);
  return names;
}
