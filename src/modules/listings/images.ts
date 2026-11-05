import "server-only";
import sharp from "sharp";

import { AppError } from "@/lib/http/errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_LISTING = 10;
const MAX_DIMENSION = 2000;

export type SniffedType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Identify the format from the file's first bytes. The file name and the browser-declared
 * type are ignored: both are attacker-controlled.
 */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === "RIFF" &&
    String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
  contentType: "image/webp";
}

/**
 * Decode and re-encode to WebP. Re-encoding drops EXIF (including GPS) and any payload
 * appended to the file; the pixel limit stops decompression bombs before decoding.
 */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength > MAX_UPLOAD_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Images can be at most 5 MB.");
  if (!sniffImageType(input)) {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Upload a JPEG, PNG or WebP image.");
  }
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 40_000_000, failOn: "error", animated: false })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, bytes: info.size, contentType: "image/webp" };
  } catch {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "We could not read that image. Try another file.");
  }
}
