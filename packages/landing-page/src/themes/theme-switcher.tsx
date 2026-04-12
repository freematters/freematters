import { type Theme, useTheme } from "./theme-provider";

const THEMES: { id: Theme; title: string; dot: string }[] = [
  { id: "noir", title: "Noir", dot: "#D4622A" },
  {
    id: "aurora",
    title: "Aurora",
    dot: "linear-gradient(135deg,#00CDD5,#C8A96A,#8B7AE8)",
  },
  { id: "light", title: "Light", dot: "#F2F0EB" },
  { id: "mono", title: "Mono", dot: "linear-gradient(135deg,#0A0A0A,#EFEFEF)" },
  {
    id: "glass",
    title: "Glass",
    dot: "linear-gradient(135deg,rgba(200,169,106,0.4),rgba(255,255,255,0.2))",
  },
  { id: "paper", title: "Paper", dot: "#F5F0E4" },
];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="fixed top-5 right-3 z-[1000] flex gap-1 items-center rounded-full px-1.5 py-1 md:top-4 md:right-4 md:gap-1.5 md:px-2 md:py-1.5"
      style={{
        background:
          theme === "light"
            ? "rgba(255,255,255,0.7)"
            : theme === "paper"
              ? "rgba(245,240,228,0.8)"
              : "rgba(0,0,0,0.25)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${
          theme === "light"
            ? "rgba(0,0,0,0.1)"
            : theme === "paper"
              ? "#C8BCAA"
              : "rgba(255,255,255,0.08)"
        }`,
      }}
    >
      {THEMES.map((t) => (
        <button
          type="button"
          key={t.id}
          title={t.title}
          onClick={() => setTheme(t.id)}
          className="w-5 h-5 rounded-full p-0 flex items-center justify-center cursor-pointer"
          style={{
            background: "none",
            border: `2px solid ${
              theme === t.id
                ? theme === "light" || theme === "paper"
                  ? "rgba(0,0,0,0.5)"
                  : "rgba(255,255,255,0.7)"
                : "transparent"
            }`,
            transition: "border-color 0.2s",
          }}
        >
          <span
            className="w-3 h-3 rounded-full block"
            style={{
              background: t.dot,
              border:
                t.id === "light"
                  ? "1px solid #C8C0B4"
                  : t.id === "paper"
                    ? "1px solid #C8BCAA"
                    : "none",
            }}
          />
        </button>
      ))}
    </div>
  );
}
