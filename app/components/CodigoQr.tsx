"use client";
import { QRCodeSVG } from "qrcode.react";

export function CodigoQr({ valor }: { valor: string }) {
  return <div style={{ background: "#fff", padding: 12, width: "fit-content", borderRadius: 8 }}><QRCodeSVG value={valor} size={200} marginSize={0} /></div>;
}
