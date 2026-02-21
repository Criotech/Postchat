import { useCallback, useEffect } from "react";
import type { BridgeEvent } from "../lib/explorerBridge";
import { useBridge } from "../lib/explorerBridge";

export function useBridgeListener(
  handler: (event: BridgeEvent) => void,
  dependencies: ReadonlyArray<unknown> = []
): void {
  const { subscribe } = useBridge();
  const memoizedHandler = useCallback(handler, dependencies);

  useEffect(() => {
    return subscribe(memoizedHandler);
  }, [memoizedHandler, subscribe]);
}
