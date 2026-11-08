import type { Metadata } from "next";
import { ProfileSettings } from "@/components/settings/profile-settings";
import { SettingsHeading } from "@/components/settings/section";

export const metadata: Metadata = { title: "Profile · Settings · Homestorm" };

export default function ProfilePage() {
  return (
    <>
      <SettingsHeading
        title="Profile"
        description="Your name, the email you sign in with, and your password."
      />
      <ProfileSettings />
    </>
  );
}
