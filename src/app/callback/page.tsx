"use client";

import { Suspense, use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Search = Record<string, string | string[] | undefined>;

function StatusCard({ message }: { message: string }) {
  return (
    <main className="flex h-dvh w-screen items-center justify-center bg-[#04050c] p-6">
      <div className="rounded-xl border border-white/10 bg-slate-950/60 px-6 py-5 text-center backdrop-blur-md">
        <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-violet-300/80">
          Music Universe
        </p>
        <p className="mt-2 text-sm text-slate-300" data-testid="callback-status">
          {message}
        </p>
      </div>
    </main>
  );
}

function CallbackHandler({ searchParams }: { searchParams: Promise<Search> }) {
  const params = use(searchParams);
  const router = useRouter();
  const [status, setStatus] = useState("Completing Spotify sign-in…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      const { validateCallback, takeVerifier, exchangeCode, saveTokens, clearPkce } =
        await import("@/lib/spotify/auth");

      const result = validateCallback({
        code: params.code,
        state: Array.isArray(params.state) ? params.state[0] : params.state,
        error: params.error,
      });

      if (result.kind !== "ok") {
        setStatus(
          result.kind === "denied"
            ? "Spotify sign-in was cancelled."
            : result.reason,
        );
        sessionStorage.setItem(
          "mu:spotify-error",
          result.kind === "denied" ? "Sign-in was cancelled." : result.reason,
        );
        setTimeout(() => router.replace("/"), 1400);
        return;
      }

      const verifier = takeVerifier();
      if (!verifier) {
        setStatus("Login session expired. Please connect again.");
        sessionStorage.setItem(
          "mu:spotify-error",
          "Login session expired. Please connect again.",
        );
        setTimeout(() => router.replace("/"), 1400);
        return;
      }

      try {
        const tokens = await exchangeCode(result.code.code, verifier);
        saveTokens(tokens);
        router.replace("/");
      } catch (error) {
        clearPkce();
        const message =
          error instanceof Error ? error.message : "Sign-in failed.";
        setStatus(message);
        sessionStorage.setItem("mu:spotify-error", message);
        setTimeout(() => router.replace("/"), 1600);
      }
    })();
  }, [params, router]);

  return <StatusCard message={status} />;
}

export default function CallbackPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  return (
    <Suspense fallback={<StatusCard message="Completing Spotify sign-in…" />}>
      <CallbackHandler searchParams={searchParams} />
    </Suspense>
  );
}
