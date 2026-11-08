import type { Metadata } from "next";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { SettingsHeading } from "@/components/settings/section";

export const metadata: Metadata = { title: "Appearance · Settings · Homestorm" };

export default function AppearancePage() {
  return (
    <>
      <SettingsHeading
        title="Appearance"
        description="How homestorm looks in this browser. Other devices keep their own."
      />
      <AppearanceSettings />
    </>
  );
}
