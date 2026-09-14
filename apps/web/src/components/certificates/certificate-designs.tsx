import type { ComponentType } from "react";
import { DiwanCertificate, LaylCertificate } from "./designs/classic";
import { AndalusCertificate, MihrabCertificate, NoorCertificate } from "./designs/heritage";
import { BustanCertificate, NujoomCertificate } from "./designs/kids";
import { ManaraCertificate, SafaCertificate } from "./designs/modern";
import type { CertificateRenderProps } from "./kit";

export { CERT_HEIGHT, CERT_WIDTH, type CertificateRenderProps, type CertLang } from "./kit";

/**
 * The certificate design catalogue.
 *
 * `number` is what an academy's saved template row points at, so it is permanent: a new design takes
 * the next number, and the API's `CertificateTemplateController::DESIGNS` must list it too. The
 * designs themselves live in `designs/`, grouped by family; the shared drawing kit is `kit.tsx`.
 */

export type DesignCategory = "heritage" | "classic" | "modern" | "kids";

export interface CertificateDesign {
  number: number;
  /** Stable handle for translations (`certificates.designs.<key>`) and tests. */
  key: string;
  category: DesignCategory;
  /** Whether the accent prints on a dark ground — decides which swatches the editor offers. */
  ground: "light" | "dark";
  component: ComponentType<CertificateRenderProps>;
}

export const CERTIFICATE_DESIGNS: readonly CertificateDesign[] = [
  { number: 1, key: "noor", category: "heritage", ground: "dark", component: NoorCertificate },
  { number: 2, key: "andalus", category: "heritage", ground: "light", component: AndalusCertificate },
  { number: 3, key: "mihrab", category: "heritage", ground: "light", component: MihrabCertificate },
  { number: 4, key: "diwan", category: "classic", ground: "light", component: DiwanCertificate },
  { number: 5, key: "layl", category: "classic", ground: "dark", component: LaylCertificate },
  { number: 6, key: "safa", category: "modern", ground: "light", component: SafaCertificate },
  { number: 7, key: "manara", category: "modern", ground: "light", component: ManaraCertificate },
  { number: 8, key: "bustan", category: "kids", ground: "light", component: BustanCertificate },
  { number: 9, key: "nujoom", category: "kids", ground: "dark", component: NujoomCertificate },
];

export const DESIGN_CATEGORIES: readonly DesignCategory[] = ["heritage", "classic", "modern", "kids"];

export function designByNumber(number: number): CertificateDesign {
  return CERTIFICATE_DESIGNS.find((d) => d.number === number) ?? (CERTIFICATE_DESIGNS[0] as CertificateDesign);
}

/** Render the design matching a template number. */
export function CertificatePreview({
  templateNumber,
  ...props
}: CertificateRenderProps & { templateNumber: number }) {
  const Design = designByNumber(templateNumber).component;
  return <Design {...props} />;
}
