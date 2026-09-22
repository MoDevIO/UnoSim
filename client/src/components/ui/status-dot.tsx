import { cn } from "@/lib/utils";
import {
  getStatusBackgroundClass,
  type ApplicationStatus,
} from "@/lib/status-semantics";

interface StatusDotProps {
  readonly status: ApplicationStatus;
  readonly label: string;
  readonly pulse?: boolean;
}

/** Passive, labeled status marker for compact textual status rows. */
export function StatusDot({ status, label, pulse = false }: StatusDotProps) {
  return (
    <span
      title={label}
      className={cn(
        "inline-flex h-2 w-2 shrink-0 rounded-full cursor-default",
        getStatusBackgroundClass(status),
        pulse && "animate-pulse",
      )}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}
