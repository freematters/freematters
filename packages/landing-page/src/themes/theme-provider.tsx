import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "noir" | "aurora" | "light" | "mono" | "glass" | "paper";

const STORAGE_KEY = "fflow-theme";
const DEFAULT_THEME: Theme = "noir";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return DEFAULT_THEME;
    return (localStorage.getItem(STORAGE_KEY) as Theme) || DEFAULT_THEME;
  });

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.documentElement.dataset.theme = t;
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
