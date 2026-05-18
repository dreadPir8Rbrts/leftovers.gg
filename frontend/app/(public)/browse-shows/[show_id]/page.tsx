"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getShow, getShowAttendees, type CardShow, type ShowAttendee } from "@/lib/api";

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex flex-col sm:flex-row sm:gap-4">
      <span className="text-muted-foreground text-sm w-32 shrink-0">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function AttendeeList({ attendees, emptyLabel }: { attendees: ShowAttendee[]; emptyLabel: string }) {
  if (attendees.length === 0) {
    return <p className="px-4 py-3 text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="divide-y">
      {attendees.map((a) => (
        <li key={a.profile_id} className="flex items-center gap-3 px-4 py-3">
          {a.avatar_url ? (
            <Image src={a.avatar_url} alt={a.display_name ?? "Attendee"} width={32} height={32} className="w-8 h-8 rounded-full object-cover border flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted border flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{a.display_name ?? "Unknown"}</p>
            {a.bio && <p className="text-xs text-muted-foreground truncate">{a.bio}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function BrowseShowDetailPage() {
  const params = useParams<{ show_id: string }>();
  const [show, setShow] = useState<CardShow | null>(null);
  const [attendees, setAttendees] = useState<ShowAttendee[]>([]);
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.show_id) return;

    Promise.all([getShow(params.show_id), getShowAttendees(params.show_id)])
      .then(([fetchedShow, fetchedAttendees]) => {
        setShow(fetchedShow);
        setAttendees(fetchedAttendees);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [params.show_id]);

  if (loading) return <div className="p-6 text-muted-foreground text-sm">Loading...</div>;

  if (error || !show) {
    return (
      <div className="p-6">
        <p className="text-destructive text-sm mb-4">{error ?? "Show not found."}</p>
        <Link href="/browse-shows" className="text-sm underline">← Back to card shows</Link>
      </div>
    );
  }

  const dateLabel =
    show.date_end && show.date_end !== show.date_start
      ? `${formatDate(show.date_start)} – ${formatDate(show.date_end)}`
      : formatDate(show.date_start);

  const locationParts = [show.venue_name, show.address, show.city, show.state].filter(Boolean).join(", ");
  const vendorAttendees = attendees.filter((a) => a.role === "vendor");
  const collectorAttendees = attendees.filter((a) => a.role === "collector");

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Link href="/browse-shows" className="text-sm text-muted-foreground hover:underline">
        ← Back to card shows
      </Link>

      {show.poster_url && (
        <div className="mt-4 rounded-lg overflow-hidden max-h-80 flex items-center justify-center bg-muted relative">
          <Image src={show.poster_url} alt={show.name} fill unoptimized sizes="100vw" className="object-contain" />
        </div>
      )}

      <div className="mt-5 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-bold leading-snug">{show.name}</h1>
        <Link href="/signup" className="shrink-0 text-sm font-medium px-4 py-2 rounded-md border border-border hover:bg-muted transition-colors">
          Sign in to register
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <DetailRow label="Date" value={dateLabel} />
        {show.time_range && <DetailRow label="Time" value={show.time_range} />}
        {locationParts && <DetailRow label="Location" value={locationParts} />}
        <DetailRow label="Ticket price" value={show.ticket_price} />
        <DetailRow label="Table price" value={show.table_price} />
        <DetailRow label="Organizer" value={show.organizer_name} />
      </div>

      {show.description && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold mb-2">About this show</h2>
          <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">{show.description}</p>
        </div>
      )}

      <div className="mt-6 border rounded-lg overflow-hidden">
        <button
          onClick={() => setAttendeesOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted transition-colors"
        >
          <span>
            Attending
            {attendees.length > 0 && (
              <span className="font-normal text-muted-foreground ml-1">
                ({vendorAttendees.length} vendor{vendorAttendees.length !== 1 ? "s" : ""}, {collectorAttendees.length} collector{collectorAttendees.length !== 1 ? "s" : ""})
              </span>
            )}
          </span>
          <span className="text-muted-foreground">{attendeesOpen ? "▲" : "▼"}</span>
        </button>
        {attendeesOpen && (
          <div className="border-t divide-y">
            <div>
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vendors</p>
              <AttendeeList attendees={vendorAttendees} emptyLabel="No vendors registered yet." />
            </div>
            <div>
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Collectors</p>
              <AttendeeList attendees={collectorAttendees} emptyLabel="No collectors registered yet." />
            </div>
          </div>
        )}
      </div>

      {show.source_url && (
        <div className="mt-6">
          <a href={show.source_url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
            View on OnTreasure →
          </a>
        </div>
      )}
    </div>
  );
}
