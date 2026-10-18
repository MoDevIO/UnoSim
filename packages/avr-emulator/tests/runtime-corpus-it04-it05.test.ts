import { describe } from "vitest";
import { SKIP_CORPUS, shardSuite } from "./corpus-suite";

describe.skipIf(SKIP_CORPUS)("runtime reference corpus: it04-it05", shardSuite("it04-it05"));
