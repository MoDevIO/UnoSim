/** A flash image, ELF file or serialized image that cannot be used. */
export class ImageError extends Error {
  override readonly name = "ImageError";
}
