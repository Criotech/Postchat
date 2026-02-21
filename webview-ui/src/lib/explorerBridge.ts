import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren
} from "react";
import type { ExecutionResult } from "../components/RequestResult";
import type { ParsedEndpoint } from "../types/spec";

export type BridgeEvent =
  | { type: "askAboutEndpoint"; endpoint: ParsedEndpoint }
  | { type: "runEndpoint"; endpoint: ParsedEndpoint }
  | { type: "executionStarted"; endpointId: string }
  | { type: "executionComplete"; endpointId: string; result: ExecutionResult }
  | { type: "executionError"; endpointId: string; error: string }
  | { type: "highlightEndpoint"; endpointId: string }
  | { type: "switchToChat" }
  | { type: "switchToExplorer" };

type BridgeHandler = (event: BridgeEvent) => void;

type BridgeState = {
  listeners: Map<number, BridgeHandler>;
};

type BridgeAction =
  | { type: "subscribe"; id: number; handler: BridgeHandler }
  | { type: "unsubscribe"; id: number };

type BridgeContextValue = {
  emit: (event: BridgeEvent) => void;
  subscribe: (handler: BridgeHandler) => () => void;
};

const BridgeContext = createContext<BridgeContextValue | null>(null);
let nextListenerId = 1;

function bridgeReducer(state: BridgeState, action: BridgeAction): BridgeState {
  switch (action.type) {
    case "subscribe": {
      const listeners = new Map(state.listeners);
      listeners.set(action.id, action.handler);
      return { listeners };
    }
    case "unsubscribe": {
      if (!state.listeners.has(action.id)) {
        return state;
      }
      const listeners = new Map(state.listeners);
      listeners.delete(action.id);
      return { listeners };
    }
    default:
      return state;
  }
}

export function BridgeProvider({ children }: PropsWithChildren): JSX.Element {
  const [state, dispatch] = useReducer(bridgeReducer, { listeners: new Map<number, BridgeHandler>() });
  const listenersRef = useRef(state.listeners);
  listenersRef.current = state.listeners;

  const emit = useCallback(
    (event: BridgeEvent) => {
      for (const handler of listenersRef.current.values()) {
        handler(event);
      }
    },
    []
  );

  const subscribe = useCallback((handler: BridgeHandler) => {
    const id = nextListenerId;
    nextListenerId += 1;
    dispatch({ type: "subscribe", id, handler });

    return () => {
      dispatch({ type: "unsubscribe", id });
    };
  }, []);

  const contextValue = useMemo(
    () => ({ emit, subscribe }),
    [emit, subscribe]
  );

  return createElement(BridgeContext.Provider, { value: contextValue }, children);
}

export function useBridge(): BridgeContextValue {
  const context = useContext(BridgeContext);
  if (!context) {
    throw new Error("useBridge must be used within a BridgeProvider");
  }
  return context;
}
