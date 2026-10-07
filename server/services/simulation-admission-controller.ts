import { randomUUID } from "node:crypto";
import { config } from "../config";

export type SimulationReservation = Readonly<{
  id: string;
  subject: string;
}>;

export type AdmissionResult =
  | { admitted: true; reservation: SimulationReservation }
  | { admitted: false; reason: "identity" | "capacity" };

export const DEFAULT_MAX_SIMULATIONS_PER_SUBJECT = 5;

/**
 * Process-local admission control. reserve() and release() mutate synchronously,
 * so each decision is atomic within Node's event loop. Reservation IDs make a
 * delayed release from an old run harmless.
 */
export class SimulationAdmissionController {
  private readonly reservationsBySubject = new Map<string, Set<SimulationReservation>>();
  private readonly reservationsById = new Map<string, SimulationReservation>();
  private capacityRejectedTotal = 0;
  private identityRejectedTotal = 0;

  constructor(
    private readonly maxReservations = config.capacity.admissionMax,
    private readonly maxReservationsPerSubject = DEFAULT_MAX_SIMULATIONS_PER_SUBJECT,
  ) {}

  reserve(subject: string): AdmissionResult {
    const subjectReservations = this.reservationsBySubject.get(subject);
    if ((subjectReservations?.size ?? 0) >= this.maxReservationsPerSubject) {
      this.identityRejectedTotal++;
      return { admitted: false, reason: "identity" };
    }
    if (this.reservationsById.size >= this.maxReservations) {
      this.capacityRejectedTotal++;
      return { admitted: false, reason: "capacity" };
    }

    const reservation = Object.freeze({ id: randomUUID(), subject });
    const reservations = subjectReservations ?? new Set<SimulationReservation>();
    reservations.add(reservation);
    this.reservationsBySubject.set(subject, reservations);
    this.reservationsById.set(reservation.id, reservation);
    return { admitted: true, reservation };
  }

  release(reservation: SimulationReservation): boolean {
    const current = this.reservationsById.get(reservation.id);
    if (current !== reservation) return false;
    const subjectReservations = this.reservationsBySubject.get(reservation.subject);
    if (!subjectReservations?.has(reservation)) return false;

    this.reservationsById.delete(reservation.id);
    subjectReservations.delete(reservation);
    if (subjectReservations.size === 0) this.reservationsBySubject.delete(reservation.subject);
    return true;
  }

  getStats() {
    return {
      active: this.reservationsById.size,
      max: this.maxReservations,
      maxPerSubject: this.maxReservationsPerSubject,
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
