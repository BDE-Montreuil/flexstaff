import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flexstaff · Équipe Flex Suite",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2A1B5E",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // La CSP de src/proxy.ts change de nonce à chaque requête : les pages doivent être rendues à la demande
  await connection();
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
