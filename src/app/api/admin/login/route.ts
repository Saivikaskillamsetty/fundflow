// Exchange the admin passphrase for a session cookie.
import { NextResponse } from "next/server";
import { adminConfigured, clearCookie, sessionCookie, verifyPassword } from "@/lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json(
      { error: "ADMIN_PASSWORD is not set on this deployment, so the admin area is closed." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  if (!body?.password || !verifyPassword(body.password)) {
    // Deliberately vague: a wrong passphrase and an absent one look the same.
    return NextResponse.json({ error: "Incorrect passphrase" }, { status: 401 });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "set-cookie": sessionCookie() } },
  );
}

/** Sign out. */
export async function DELETE() {
  return NextResponse.json({ ok: true }, { headers: { "set-cookie": clearCookie() } });
}
