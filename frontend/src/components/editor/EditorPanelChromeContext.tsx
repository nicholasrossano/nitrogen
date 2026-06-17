'use client';

import {
  createContext,
  useContext,
  useEffect,
  type DependencyList,
  type ReactNode,
} from 'react';

export interface EditorPanelChrome {
  title: string;
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
  return (
    <EditorPanelChromeContext.Provider value={{ setChrome: onChromeChange }}>
      {children}
    </EditorPanelChromeContext.Provider>
  );
}

export function useRegisterEditorPanelChrome(
  chrome: EditorPanelChrome | null,
  deps: DependencyList,
) {
  const context = useContext(EditorPanelChromeContext);

  useEffect(() => {
    if (!context) return undefined;
    context.setChrome(chrome);
    return () => {
      context.setChrome(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
