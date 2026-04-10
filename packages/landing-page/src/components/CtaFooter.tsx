import { cn } from "@/lib/utils";

export function CtaFooter() {
  return (
    <footer className="flex flex-col items-center gap-10 py-28">
      {/* CTA */}
      <div className="flex flex-col items-center gap-8">
        <h2
          className={cn(
            "text-3xl text-center leading-snug",
            "font-heading text-foreground max-w-[520px]",
          )}
        >
          Zero config. One YAML file. Full agent control.
        </h2>

        {/* Terminal install command */}
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-6 py-3",
            "bg-[var(--bg2)] border border-[var(--border)]",
          )}
        >
          <span className="font-mono text-[13px] text-muted-foreground">
            $
          </span>
          <span className="font-mono text-[13px] text-foreground">
            npx freeflow init
          </span>
        </div>
      </div>

      {/* Tagline */}
      <p
        className={cn(
          "text-xs text-center font-body",
          "text-muted-foreground tracking-[0.02em]",
        )}
      >
        State machines for the age of agents.
      </p>
    </footer>
  );
}
