export type ApplicationStatus =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "busy"
  | "idle"
  | "unknown";

interface StatusColorDefinition {
  readonly textClass: string;
  readonly hoverTextClass: string;
  readonly backgroundClass: string;
  readonly color: string;
}

const mutedStatusColor: StatusColorDefinition = {
  textClass: "text-muted-foreground",
  hoverTextClass: "hover:text-muted-foreground",
  backgroundClass: "bg-muted-foreground",
  color: "var(--muted-foreground)",
};

/** Shared semantic colors for application and system status. */
export const STATUS_COLORS: Record<ApplicationStatus, StatusColorDefinition> = {
  success: {
    textClass: "text-status-success",
    hoverTextClass: "hover:text-status-success",
    backgroundClass: "bg-status-success",
    color: "var(--color-status-success)",
  },
  error: {
    textClass: "text-status-error",
    hoverTextClass: "hover:text-status-error",
    backgroundClass: "bg-status-error",
    color: "var(--color-status-error)",
  },
  warning: {
    textClass: "text-status-warning",
    hoverTextClass: "hover:text-status-warning",
    backgroundClass: "bg-status-warning",
    color: "var(--color-status-warning)",
  },
  info: {
    textClass: "text-accent-cyan",
    hoverTextClass: "hover:text-accent-cyan",
    backgroundClass: "bg-accent-cyan",
    color: "var(--color-accent-cyan)",
  },
  busy: {
    textClass: "text-accent-cyan",
    hoverTextClass: "hover:text-accent-cyan",
    backgroundClass: "bg-accent-cyan",
    color: "var(--color-accent-cyan)",
  },
  idle: mutedStatusColor,
  unknown: mutedStatusColor,
};

export function getStatusTextClass(status: ApplicationStatus): string {
  return STATUS_COLORS[status].textClass;
}

export function getStatusBackgroundClass(status: ApplicationStatus): string {
  return STATUS_COLORS[status].backgroundClass;
}

export function getStatusHoverTextClass(status: ApplicationStatus): string {
  return STATUS_COLORS[status].hoverTextClass;
}

export function getStatusColor(status: ApplicationStatus): string {
  return STATUS_COLORS[status].color;
}

/** Maps the parser's existing numeric severity values to shared status tones. */
export function getSeverityStatus(severity: number): ApplicationStatus {
  switch (severity) {
    case 1: return "info";
    case 2: return "warning";
    case 3: return "error";
    default: return "unknown";
  }
}

/** Chooses the highest parser severity already present, or idle when empty. */
export function getHighestSeverityStatus(severities: readonly number[]): ApplicationStatus {
  if (severities.includes(3)) return "error";
  if (severities.includes(2)) return "warning";
  if (severities.includes(1)) return "info";
  return severities.length === 0 ? "idle" : "unknown";
}
