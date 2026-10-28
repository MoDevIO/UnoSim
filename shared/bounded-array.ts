import { z } from "zod";

/**
 * An array schema that checks the length limit before it validates any element.
 *
 * `z.array(item).max(n)` of Zod 3 reports an array that is too long and then still validates every
 * element: a 1 MiB request body of invalid elements gave 500 000 to 700 000 issues, 180 to 460 MiB of
 * heap and up to a second of blocked event loop (GHSA-mrhx-c7xc-m3w5 describes the same pattern for
 * Zod 4). Here the length check comes first and ends the validation, so an oversized array costs one
 * issue, the same `too_big` issue with the same message and path as before.
 *
 * Use it for every array whose content comes from a request, a repository or any other source that
 * is not this code. The minimum is checked as before, after the elements (a short array is cheap).
 */
export function boundedArray<T extends z.ZodType>(element: T, max: number, min?: number) {
  const array = min === undefined ? z.array(element).max(max) : z.array(element).min(min).max(max);
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (!Array.isArray(value) || value.length <= max) return;
      // Fatal: the validation of the whole input ends here, so a refinement around the array never
      // sees the unchecked elements (the issue carries `continue: false`, nothing else differs).
      ctx.addIssue({ code: "too_big", origin: "array", maximum: max, inclusive: true, continue: false });
    })
    .pipe(array);
}
