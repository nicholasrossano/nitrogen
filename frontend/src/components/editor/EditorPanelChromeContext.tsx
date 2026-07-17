'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

export interface EditorPanelChrome {
  title: string;
  titleEditable?: boolean;
  onSaveTitle?: (title: string) => void | Promise<void>;
  titleSaving?: boolean;
  suffix?: string | null;
  actions?: ReactNode;
}

interface EditorPanelChromeContextValue {
  setChrome: (chrome: EditorPanelChrome | null) => void;
}

const EditorPanelChromeContext = createContext<EditorPanelChromeContextValue | null>(null);

export function EditorPanelChromeProvider({
  children,
  onChromeChange,
}: {
  children: ReactNode;
  onChromeChange: (chrome: EditorPanelChrome | null) => void;
}) {
  const value = useMemo(
    () => ({ setChrome: onChromeChange }),
    [onChromeChange],
  );

  return (
    <EditorPanelChromeContext.Provider value={value}>
      {children}
    </EditorPanelChromeContext.Provider>
  );
}

/** True when rendered under a float/panel host that can show chrome actions. */
export function useHasEditorPanelChromeHost(): boolean {
  return useContext(EditorPanelChromeContext) != null;
}

/** Register float-header chrome. Host must ignore no-op updates (see FloatLayer). */
export function useRegisterEditorPanelChrome(chrome: EditorPanelChrome | null) {
  const context = useContext(EditorPanelChromeContext);
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;

  useLayoutEffect(() => {
    if (!context) return;
    context.setChrome(chromeRef.current);
  });

  useEffect(() => {
    if (!context) return undefined;
    return () => {
      context.setChrome(null);
    };
  }, [context]);
}
