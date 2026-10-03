import type { Metadata } from "next";
import { DownloadCenter } from "@/components/download-center";

export const metadata: Metadata = {
  title: "Download center — Frameo",
  description: "Scarica video da Telegram e importali nella libreria Frameo."
};

export default function DownloadsPage() {
  return <DownloadCenter />;
}
