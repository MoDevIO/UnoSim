import { describe } from "vitest";
import { SKIP_CORPUS, shardSuite } from "./corpus-suite";

describe.skipIf(SKIP_CORPUS)("runtime reference corpus: it01-it03", shardSuite("it01-it03"));
