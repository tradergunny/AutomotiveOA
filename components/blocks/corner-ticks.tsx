/**
 * The signature corner-tick decorator (DESIGN.md): 2px border-primary brackets
 * on the four corners of a key card. Host element must be `relative`.
 * Lifted from the founder's reference artifact (docs/design/reference/features-10.tsx).
 */
export function CornerTicks() {
  return (
    <>
      <span aria-hidden className="border-primary absolute -left-px -top-px block size-2 border-l-2 border-t-2" />
      <span aria-hidden className="border-primary absolute -right-px -top-px block size-2 border-r-2 border-t-2" />
      <span aria-hidden className="border-primary absolute -bottom-px -left-px block size-2 border-b-2 border-l-2" />
      <span aria-hidden className="border-primary absolute -bottom-px -right-px block size-2 border-b-2 border-r-2" />
    </>
  );
}
