import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { yamlLines } from "../../data/workflow-states";

interface Props {
  activeState: string | null;
}

export function YamlPanel({ activeState }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (activeState === null) {
      container.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const target = container.querySelector<HTMLElement>(
      `[data-state="${activeState}"]`,
    );
    if (target) {
      container.scrollTo({
        top: target.offsetTop - container.offsetTop,
        behavior: "smooth",
      });
    }
  }, [activeState]);

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg2)]">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-[14px] py-[9px]">
        <span className="inline-block size-[10px] rounded-full bg-[#FF5F57]" />
        <span className="inline-block size-[10px] rounded-full bg-[#FEBC2E]" />
        <span className="inline-block size-[10px] rounded-full bg-[#28C840]" />
        <span className="ml-1.5 text-[11px] font-mono text-muted-foreground opacity-70">
          workflow.yaml
        </span>
      </div>

      {/* YAML lines */}
      <div
        ref={scrollRef}
        className={cn(
          "max-h-[200px] overflow-y-auto py-[10px]",
          "font-mono text-xs leading-[1.8]",
        )}
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "var(--border) transparent",
        }}
      >
        {yamlLines.map((line, i) => {
          let opacity: number | undefined;
          if (activeState !== null && line.state !== null) {
            opacity = line.state === activeState ? 1 : 0.22;
          }

          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static yaml lines never reorder
              key={i}
              data-state={line.state ?? undefined}
              className="flex whitespace-pre transition-opacity duration-300"
              style={{ opacity }}
            >
              <span
                className={cn(
                  "w-[30px] shrink-0 select-none pr-2 text-right",
                  "text-[11px] text-muted-foreground opacity-40",
                )}
              >
                {i + 1}
              </span>
              <span
                className="flex-1 pr-[10px]"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: static syntax-highlighted HTML
                dangerouslySetInnerHTML={{ __html: line.text }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
