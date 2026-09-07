import { randomUUID } from "node:crypto";
import { config } from "../config";

export type SimulationReservation = Readonly<{
  id: string;
  subject: string;
}>;

export type AdmissionResult =
  | { admitted: true; reservation: SimulationReservation }
  | { admitted: false; reason: "identity" | "capacity" };

/**
 * Process-local admission control. reserve() and release() mutate synchronously,
 * so each decision is atomic within Node's event loop. Reservation IDs make a
 * delayed release from an old run harmless.
 */
export class SimulationAdmissionController {
  private readonly reservationsBySubject = new Map<string, SimulationReservation>();
  private readonly reservationsById = new Map<string, SimulationReservation>();
  private capacityRejectedTotal = 0;
  private identityRejectedTotal = 0;

  constructor(private readonly maxReservations = config.server.simulationAdmissionMax) {}

  reserve(subject: string): AdmissionResult {
    if (this.reservationsBySubject.has(subject)) {
      this.identityRejectedTotal++;
      return { admitted: false, reason: "identity" };
    }
    if (this.reservationsById.size >= this.maxReservations) {
      this.capacityRejectedTotal++;
      return { admitted: false, reason: "capacity" };
    }

    const reservation = Object.freeze({ id: randomUUID(), subject });
    this.reservationsBySubject.set(subject, reservation);
    this.reservationsById.set(reservation.id, reservation);
    return { admitted: true, reservation };
  }

  release(reservation: SimulationReservation): boolean {
    const current = this.reservationsById.get(reservation.id);
    if (current !== reservation) return false;
    if (this.reservationsBySubject.get(reservation.subject) !== reservation) {
      return false;
    }
    this.reservationsById.delete(reservation.id);
    this.reservationsBySubject.delete(reservation.subject);
    return true;
  }

  getStats() {
    return {
      active: this.reservationsById.size,
      max: this.maxReservations,
      capacityRejectedTotal: this.capacityRejectedTotal,
      identityRejectedTotal: this.identityRejectedTotal,
    };
  }
}

let instance: SimulationAdmissionController | null = null;

export function getSimulationAdmissionController(): SimulationAdmissionController {
  instance ??= new SimulationAdmissionController();
  return instance;
}
