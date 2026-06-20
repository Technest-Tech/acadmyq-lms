import QRCode from 'qrcode'

/** Render the raw QR string Baileys emits into a PNG data URL the admin panel can <img src>. */
export function qrToDataUrl(qr: string): Promise<string> {
  return QRCode.toDataURL(qr, { errorCorrectionLevel: 'M', margin: 2, scale: 6 })
}
