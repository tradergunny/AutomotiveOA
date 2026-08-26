// Client-side photo downscale (M2 brief §5, reused by M3 finding photos):
// camera shots are multi-MB; resize before upload to stay well inside the
// action body limit. EXIF is dropped, orientation is baked in.

const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export async function downscalePhoto(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob) throw new Error("toBlob returned null");
    return blob;
  } catch {
    // Undecodable in this browser (rare formats): send the original and let
    // the server's type/size caps decide.
    return file;
  }
}
