"use client";

import { useParams } from "next/navigation";
import { MeetingRoom } from "@/components/meeting/meeting-room";

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  return <MeetingRoom key={id} id={id} />;
}
