import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("Pesan masuk dari Fonnte:", body);

    const sender = body.sender; // nomor WA pengirim
    const name = body.name || "Kak";
    const text = (body.text || body.message || "").trim().toLowerCase();

    let reply = "Halo! Pesan kamu sudah kami terima ✅";

    if (text === "halo" || text === "hi") {
      reply = `Halo ${name}, apa kabar? 👋`;
    } else if (text === "menu") {
      reply = `📌 Menu:\n1. Ketik "halo"\n2. Ketik "menu"`;
    }

    // kirim balasan lewat API Send
    await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: process.env.FONNTE_API_TOKEN!, // tanpa "Bearer"
      },
      body: JSON.stringify({
        target: sender,
        message: reply,
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error di webhook Fonnte:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
