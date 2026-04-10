import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

function InjectAnimation() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="inline-block size-2 rounded-full bg-[var(--accent)]"
            style={{
              opacity: 0.15,
              animation: `dotLight 2.5s ${i * 0.5}s infinite`,
            }}
          />
        ))}
      </div>
      <span
        className="font-mono text-[11px] text-[var(--accent)] tracking-[0.05em]"
        style={{ animation: "reminderFlash 2.5s 2s infinite" }}
      >
        [State Prompt Injected]
      </span>
    </div>
  );
}

interface StepCardProps {
  icon: string;
  title: string;
  subtitle: string;
  details: string[];
  highlight?: boolean;
  visual?: React.ReactNode;
}

function StepCard({
  icon,
  title,
  subtitle,
  details,
  highlight,
  visual,
}: StepCardProps) {
  return (
    <Card
      className={cn(
        "gap-5 p-8 shadow-none",
        highlight ? "border-[var(--accent)]" : "border-[var(--border)]",
      )}
    >
      <div className="flex items-center gap-4">
        <span className="text-[28px] leading-none">{icon}</span>
        <div>
          <span className="block text-lg font-semibold font-heading text-foreground">
            {title}
          </span>
          <span className="text-sm font-body text-muted-foreground">
            {subtitle}
          </span>
        </div>
      </div>
      {visual && <div className="flex justify-center">{visual}</div>}
      <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground list-none pl-0">
        {details.map((d) => (
          <li key={d} className="flex gap-2">
            <span className="shrink-0 text-[var(--accent)]">&middot;</span>
            {d}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function HowItWorks() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-[1280px] px-10">
        <div className="mb-16 flex flex-col items-center gap-3">
          <span className="text-xs uppercase tracking-widest font-mono text-[var(--accent)]">
            Mechanism
          </span>
          <h2 className="text-4xl text-center font-heading text-foreground">
            Prompt injection via hooks
          </h2>
          <p className="mt-1 max-w-[560px] text-center text-sm text-muted-foreground">
            Natural language prompts drift. FreeFlow injects state-scoped
            context into the agent's conversation at fixed intervals,
            keeping it on a deterministic path.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-6">
          <StepCard
            icon="&#9998;"
            title="State-scoped prompts"
            subtitle="Each state defines exactly what the agent sees"
            details={[
              "prompt \u2014 what to do in this state",
              "todos \u2014 checklist items to complete before transitioning",
              "transitions \u2014 the only legal exits from this state",
              "Agent context is scoped to one state \u2014 no pollution, no drift",
            ]}
          />
          <StepCard
            icon="&#9889;"
            title="Hook-based injection"
            subtitle="PostToolUse hook re-injects state context every 5 tool calls"
            highlight
            visual={<InjectAnimation />}
            details={[
              "Hook fires automatically \u2014 zero manual intervention",
              "Injects current prompt, todos, and allowed transitions",
              "Progressive reinforcement \u2014 agent cannot drift from instructions",
            ]}
          />
          <StepCard
            icon="&#10004;"
            title="Deterministic transitions"
            subtitle="CLI validates every state change against the YAML FSM"
            details={[
              "fflow goto rejects illegal transitions at runtime",
              "YAML definition is the single source of truth",
              "Agents follow deterministic paths \u2014 no guessing, no drift",
            ]}
          />
        </div>
      </div>
    </section>
  );
}
