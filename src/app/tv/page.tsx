import type { Metadata } from "next";
import { TvGallery } from "@/components/tv-gallery";
import "./tv.css";

export const metadata: Metadata = {
  title: "Frameo TV — Galleria",
  description: "Foto e video, da sfogliare con il telecomando."
};

export default function TvPage() {
  return <TvGallery />;
}
