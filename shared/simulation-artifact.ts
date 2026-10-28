import { z } from "zod";
import {
  BOARD_MCU, IO_FUNCTION_SYMBOLS, MCU_FLASH_BYTES, MEMORY_SYMBOLS, SIMULATION_IMAGE_FORMAT_VERSION, type SimulationImage,
} from "@unosim/avr-emulator/image";
import { BOARD_IDS, type BoardId, boardIdSchema } from "./boards";

/**
 * The field `artifact` of a successful `POST /api/compile` (plan E5, P2.5):
 * the flash image of the package (`SimulationImage`: used flash range as
 * Base64, board, SHA-256, symbols) plus the id of the build identity (E15).
 */
export type SimulationArtifact = SimulationImage & { readonly buildId: string };

const HEX_64 = /^[0-9a-f]{64}$/;
/** Highest address of the ELF data space the symbol table may name (packages/avr-emulator image). */
const MAX_DATA_ADDRESS = 0x10000;

/** Base64 length of `bytes` bytes. */
const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4;

/** Largest artifact of any catalog board: the full flash of the biggest MCU as Base64. */
export const MAX_ARTIFACT_BASE64_CHARS = Math.max(...BOARD_IDS.map((id) => base64Length(MCU_FLASH_BYTES[BOARD_MCU[id]])));

const symbolTable = <K extends string>(keys: readonly K[], limit: number) =>
  z.object(Object.fromEntries(keys.map((key) => [key, z.number().int().min(0).lt(limit).optional()])) as Record<K, z.ZodOptional<z.ZodNumber>>).strict();

export const simulationArtifactSchema = z
  .object({
    formatVersion: z.literal(SIMULATION_IMAGE_FORMAT_VERSION),
    board: boardIdSchema,
    flashBase64: z.string().min(1).max(MAX_ARTIFACT_BASE64_CHARS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
    flashBytes: z.number().int().min(1),
    sha256: z.string().regex(HEX_64),
    symbols: z.object({
      functions: symbolTable(IO_FUNCTION_SYMBOLS, MCU_FLASH_BYTES.atmega2560),
      data: symbolTable(MEMORY_SYMBOLS, MAX_DATA_ADDRESS),
    }).strict(),
    buildId: z.string().regex(HEX_64),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    const capacity = MCU_FLASH_BYTES[BOARD_MCU[artifact.board as BoardId]];
    if (artifact.flashBytes > capacity) {
      ctx.addIssue({ code: "custom", path: ["flashBytes"], message: "flashBytes exceeds the flash of the board's MCU" });
    }
    if (artifact.flashBase64.length !== base64Length(artifact.flashBytes)) {
      ctx.addIssue({ code: "custom", path: ["flashBase64"], message: "flashBase64 does not match flashBytes" });
    }
  });

/** Validates an artifact from an untrusted source (sidecar file, REST response); undefined when it is not one. */
export function parseSimulationArtifact(value: unknown): SimulationArtifact | undefined {
  const parsed = simulationArtifactSchema.safeParse(value);
  return parsed.success ? (parsed.data as SimulationArtifact) : undefined;
}
