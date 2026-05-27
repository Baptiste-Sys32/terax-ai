import { cn } from "@/lib/utils";

export function CodexLogo({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-950 ring-1 ring-white/10",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <img
        src="/codex_dark.svg"
        alt=""
        className="block size-[68%]"
        draggable={false}
      />
    </span>
  );
}
