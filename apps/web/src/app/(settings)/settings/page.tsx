import { redirect } from "next/navigation";

/** Bare /settings opens the first tab. */
export default function SettingsIndex() {
  redirect("/settings/profile");
}
