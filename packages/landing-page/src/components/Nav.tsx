import { cn } from "@/lib/utils";

export function Nav() {
  return (
    <nav
      className={cn(
        "sticky top-0 z-50 backdrop-blur-sm",
        "border-b border-[var(--border)]",
      )}
    >
      <div
        className={cn(
          "mx-auto flex items-center justify-between",
          "max-w-[1280px] px-10 py-[26px]",
        )}
      >
        <span
          className={cn(
            "text-xl italic font-semibold",
            "font-heading text-foreground",
          )}
        >
          FreeFlow
        </span>
        <div className="flex items-center gap-8">
          <a
            href="/docs"
            className={cn(
              "text-sm font-body transition-opacity",
              "text-muted-foreground hover:opacity-100",
            )}
          >
            Docs
          </a>
          <a
            href="https://github.com/freematters/freematters"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-sm font-body transition-opacity",
              "text-muted-foreground hover:opacity-100",
            )}
          >
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}
