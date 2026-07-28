import "@fontsource-variable/manrope";
import "@fontsource-variable/newsreader";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frameo — Media, beautifully organized",
  description: "Una libreria privata per organizzare, elaborare e vedere foto e video."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
