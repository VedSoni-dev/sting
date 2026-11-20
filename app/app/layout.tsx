import type { Metadata } from "next";
import { StudioProvider } from "@/kit/react/studio";
import "./war.css";

export const metadata: Metadata = { title: "War room" };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StudioProvider>{children}</StudioProvider>;
}
