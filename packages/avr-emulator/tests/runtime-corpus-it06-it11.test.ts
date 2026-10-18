import { describe } from "vitest";
import { SKIP_CORPUS, shardSuite } from "./corpus-suite";

describe.skipIf(SKIP_CORPUS)("runtime reference corpus: it06-it11", shardSuite("it06-it11"));
