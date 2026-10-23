"use client";

import { useUniverse } from "@/state/universe-context";
import { SPOTIFY_SCOPES } from "@/lib/spotify/scopes";
import Image from "next/image";
import { BTN, BTN_DANGER, BTN_PRIMARY, LABEL, PANEL } from "./panel";

export function ConnectionPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { connection, connect, disconnect, refreshSpotify } = useUniverse();
  if (!open) return null;

  const configured =
    typeof process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID === "string" &&
    process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Spotify connection"
      data-testid="connection-panel"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`${PANEL} flex max-h-[88vh] w-full max-w-md flex-col gap-4 overflow-y-auto p-5`}>
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-slate-50">Spotify</h2>
          <button type="button" className={BTN} onClick={onClose} data-testid="close-connection">
            ✕
          </button>
        </div>

        {!configured && (
          <>
            <p className="text-xs leading-relaxed text-slate-300">
              Spotify Web API access is not configured in this environment. You can
              still explore the demo universe or import your Extended Streaming
              History below.
            </p>
            <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/25 p-3 text-[11px] leading-relaxed text-slate-400">
              <p>
                <span className={LABEL}>If you want to enable it</span>
              </p>
              <p>
                Create an app at{" "}
                <span className="text-cyan-300">developer.spotify.com</span>. Add the
                exact redirect URI for your origin (e.g.{" "}
                <code className="text-violet-300">http://127.0.0.1:3000/callback</code>)
                — Spotify rejects <code>localhost</code>. Set{" "}
                <code className="text-violet-300">NEXT_PUBLIC_SPOTIFY_CLIENT_ID</code>{" "}
                in <code className="text-violet-300">.env.local</code>{" "}
                (<code className="text-violet-300">SPOTIFY_CLIENT_SECRET</code> is
                optional for PKCE).
              </p>
              <p>
                <span className="text-slate-300">Availability notes:</span> New apps may
                be in Development Mode (limited authorized users; the account owner may
                need Premium depending on Spotify&apos;s current rules), and the Web API
                can be unavailable for Free accounts or in some regions — a disabled or
                restricted option in the dashboard doesn&apos;t mean this app is broken.
                API rankings never replace measured listening history.
              </p>
            </div>
            <p className="text-[11px] text-slate-500">
              No credentials are stored in this panel; tokens are only used if you
              connect and are kept in this tab&apos;s session storage.
            </p>
          </>
        )}

        {configured && connection.status === "disconnected" && (
          <>
            <p className="text-xs leading-relaxed text-slate-300">
              Connect to enrich your universe with Spotify data. Tokens stay in
              this browser tab&apos;s session storage and are never sent anywhere
              except Spotify&apos;s own endpoints.
            </p>
            <div className="flex flex-col gap-1.5 rounded-lg border border-white/10 bg-black/25 p-3">
              {SPOTIFY_SCOPES.map(({ scope, reason }) => (
                <p key={scope} className="text-[11px] text-slate-400">
                  <span className={LABEL}>{scope}</span>
                  <br />
                  {reason}
                </p>
              ))}
            </div>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={() => void connect()}
              data-testid="connect-spotify"
            >
              Connect Spotify
            </button>
          </>
        )}

        {(connection.status === "redirecting" || connection.status === "connecting") && (
          <p className="py-6 text-center text-sm text-slate-300" data-testid="connection-busy">
            {connection.status === "redirecting"
              ? "Redirecting to Spotify…"
              : "Verifying connection…"}
          </p>
        )}

        {connection.status === "error" && (
          <>
            <p
              className="rounded-lg border border-rose-400/25 bg-rose-500/10 p-3 text-xs text-rose-100"
              data-testid="connection-error"
            >
              {connection.error ?? "Something went wrong."}
            </p>
            <button type="button" className={BTN_PRIMARY} onClick={() => void connect()}>
              Try again
            </button>
          </>
        )}

        {connection.status === "connected" && connection.profile && (
          <>
            <div className="flex items-center gap-3">
              {connection.profile.imageUrl ? (
                <Image
                  src={connection.profile.imageUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="rounded-full border border-white/15"
                  unoptimized
                />
              ) : (
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-400 text-sm font-bold text-white">
                  {connection.profile.displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-slate-100">
                  {connection.profile.displayName}
                </p>
                <p className="text-[11px] text-slate-500">@{connection.profile.id}</p>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-400">
              Top artists/tracks and recent plays were read once per refresh.
              Listening totals always come from measured records — API data never
              inflates them. Saved tracks and albums were intentionally not
              requested.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={BTN}
                onClick={() => void refreshSpotify()}
                data-testid="refresh-spotify"
              >
                Refresh data
              </button>
              <button
                type="button"
                className={BTN_DANGER}
                onClick={() => {
                  disconnect();
                  onClose();
                }}
                data-testid="disconnect-spotify"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
