import { useEffect, useMemo, useState } from "react";
import {
  boardPinReference,
  boardReferenceContacts,
  type PinBusReference,
  type PinReference,
} from "@unosim/avr-emulator/boards";
import { getBoard, type BoardId } from "@shared/boards";
import { Input } from "@/components/ui/input";
import { UnifiedScrollArea } from "@/components/ui/unified-scroll-area";

const COLUMNS = [
  "Pin",
  "Digital In",
  "Digital Out",
  "Analog In",
  "PWM Out",
  "Bus Connections",
  "Ext. IRQ",
  "Pin Change",
  "Timer",
];
const RESET_RESTRICTION =
  "RESET is reserved by the selected core/fuses. GPIO and pin-change use require changing the reset fuse; A0 has reset-voltage constraints.";
const PCINT_RESTRICTION =
  "Available through MCU registers; the pinned Arduino core helpers do not expose this pin.";

function busLabel(bus: PinBusReference): string {
  if (bus.interface === "serial") {
    const name =
      bus.peripheral === "software"
        ? "Software Serial"
        : `Serial${bus.serialPort || ""}`;
    return `${name} · ${bus.signal}`;
  }
  const prefix = bus.peripheral === "usi" ? "USI / " : "";
  const name = bus.interface === "i2c" ? "I²C" : "SPI";
  return `${prefix}${name}${bus.mode === "master" ? " (master)" : ""} · ${bus.signal}`;
}

function codeName(pin: PinReference): string | undefined {
  const { hardware } = pin;
  if (!hardware.label.startsWith("PB")) return undefined;
  return hardware.analogName
    ? `${hardware.pin} / ${hardware.analogName}`
    : String(hardware.pin);
}

function normalize(text: string): string {
  return text.toLowerCase().replaceAll("²", "2").trim();
}

function matchesPin(pin: PinReference, query: string): boolean {
  const { hardware } = pin;
  return normalize(
    [
      hardware.label,
      codeName(pin) ?? "",
      ...pin.buses.map(busLabel),
      hardware.port ? "Digital In Digital Out" : "",
      hardware.adcChannel === undefined ? "" : "Analog In",
      hardware.pwm
        ? `PWM Out Timer T${hardware.pwm.timer} ${hardware.pwm.channel}`
        : "",
      hardware.role === "reset" ? "RESET" : "",
      pin.externalInterrupt === undefined ? "" : "Ext. IRQ External Interrupt",
      pin.pinChange ? `Pin Change PCINT${pin.pinChange.index}` : "",
    ].join(" "),
  ).includes(query);
}

function Capability({ available }: Readonly<{ available: boolean }>) {
  return (
    <span
      className={available ? "text-status-success" : "text-muted-foreground"}
      aria-label={available ? "Available" : "Unavailable"}
    >
      {available ? "✓" : "—"}
    </span>
  );
}

function PinChangeCell({ pin }: Readonly<{ pin: PinReference }>) {
  const { hardware, pinChange } = pin;
  if (!pinChange) return <Capability available={false} />;
  let restriction: string | undefined;
  if (hardware.role === "reset") restriction = RESET_RESTRICTION;
  else if (!pinChange.coreSupported) restriction = PCINT_RESTRICTION;
  return (
    <span
      className={restriction ? "text-status-warning" : undefined}
      title={restriction}
    >
      PCINT{pinChange.index}
      {restriction ? " *" : ""}
    </span>
  );
}

function PinInfoRow({ pin }: Readonly<{ pin: PinReference }>) {
  const { hardware, buses } = pin;
  const code = codeName(pin);
  const gpio =
    hardware.role === "reset" ? (
      <span className="text-status-warning" title={RESET_RESTRICTION}>
        RESET *
      </span>
    ) : (
      <Capability available={hardware.port !== undefined} />
    );
  return (
    <tr className="group border-b border-border" data-pin={hardware.pin}>
      <td className="sticky left-0 z-10 bg-background px-3 py-1 text-left font-semibold border-r border-border group-hover:bg-muted">
        {hardware.label}{" "}
        {code && (
          <span className="block font-normal text-muted-foreground">
            Code: {code}
          </span>
        )}
      </td>
      <td className="px-3 py-1">{gpio}</td>
      <td className="px-3 py-1">{gpio}</td>
      <td className="px-3 py-1">
        {hardware.adcChannel === undefined ? (
          <Capability available={false} />
        ) : (
          <span
            title={hardware.role === "reset" ? RESET_RESTRICTION : undefined}
          >
            10 Bit{hardware.role === "reset" ? " *" : ""}
          </span>
        )}
      </td>
      <td className="px-3 py-1">
        {hardware.pwm ? "8 Bit" : <Capability available={false} />}
      </td>
      <td className="px-3 py-1 text-left">
        {buses.length ? (
          buses.map((bus) => (
            <div
              key={`${bus.interface}:${bus.serialPort ?? ""}:${bus.signal}`}
              title={
                bus.simulation === "not-modeled"
                  ? "Hardware capability; this peripheral is not simulated."
                  : "Serial peripheral modeled in browser mode; connected devices are not implied."
              }
            >
              {busLabel(bus)}
            </div>
          ))
        ) : (
          <Capability available={false} />
        )}
      </td>
      <td className="px-3 py-1">
        <span
          title={
            pin.externalInterrupt === undefined
              ? undefined
              : `digitalPinToInterrupt: ${pin.externalInterrupt}`
          }
        >
          <Capability available={pin.externalInterrupt !== undefined} />
        </span>
      </td>
      <td className="px-3 py-1">
        <PinChangeCell pin={pin} />
      </td>
      <td className="px-3 py-1">
        {hardware.pwm ? (
          `T${hardware.pwm.timer} / ${hardware.pwm.channel}`
        ) : (
          <Capability available={false} />
        )}
      </td>
    </tr>
  );
}

/** Board capabilities are a reference, never a snapshot of the sketch or runtime. */
export function PinInfos({ boardId }: Readonly<{ boardId: BoardId }>) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [boardId]);
  const pins = useMemo(() => boardPinReference(boardId), [boardId]);
  const contacts = useMemo(() => boardReferenceContacts(boardId), [boardId]);
  const normalized = normalize(query);
  const filteredPins = pins.filter((pin) => matchesPin(pin, normalized));
  const filteredContacts = contacts.filter((contact) =>
    normalize(`${contact.label} ${contact.description}`).includes(normalized),
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1">
        <span className="text-ui-xs text-muted-foreground">
          {getBoard(boardId).displayName} · {pins.length} signal pins
        </span>
        <Input
          type="search"
          aria-label="Search pins or functions"
          placeholder="Search pins or functions…"
          className="w-full sm:w-64"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <UnifiedScrollArea
        className="flex-1 min-h-0"
        orientation="both"
        scrollbarVisibility="always"
        viewportTestId="pin-infos-viewport"
      >
        <table
          aria-label="Pin capabilities"
          className="w-full min-w-[70rem] border-separate border-spacing-0 text-center text-ui-xs whitespace-nowrap"
        >
          <thead>
            <tr>
              {COLUMNS.map((column, index) => (
                <th
                  scope="col"
                  key={column}
                  className={`sticky top-0 border-b border-border bg-muted px-3 py-1 font-semibold text-foreground ${index === 0 ? "left-0 z-30 border-r text-left" : "z-20"}`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPins.map((pin) => (
              <PinInfoRow key={pin.hardware.pin} pin={pin} />
            ))}
          </tbody>
          <tbody aria-label="Reference contacts">
            {filteredContacts.map((contact) => (
              <tr key={contact.label}>
                <td
                  className="sticky left-0 z-10 border-r border-border bg-background px-3 py-1 text-left"
                  title={contact.description}
                >
                  {contact.label}{" "}
                  <span className="block max-w-40 truncate text-muted-foreground">
                    {contact.description}
                  </span>
                </td>
                {COLUMNS.slice(1).map((column) => (
                  <td className="px-3 py-1" key={column}>
                    <Capability available={false} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredPins.length && !filteredContacts.length && (
          <output className="block p-4 text-center text-ui-xs text-muted-foreground">
            No matching pins.
          </output>
        )}
      </UnifiedScrollArea>
      <div className="shrink-0 border-t border-border px-3 py-1 text-ui-xs text-muted-foreground">
        <p title="Restrictions are explained in the affected cell’s tooltip.">
          ✓ available · — unavailable · * restricted
        </p>
        <p>PWM: 8 Bit / 0–255 · Analog In: 10 Bit / 0–1023</p>
        <p title="Hardware capabilities are independent of simulation support; see the bus-cell tooltips. Shared bus roles cannot all be used at once.">
          Power/control contacts: reference only
        </p>
      </div>
    </div>
  );
}
