// app/api/nlu/route.ts
import { NextResponse } from "next/server";
import { parseTextWithGemini } from "@/lib/gemini/client";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const message = String(body.message ?? "");
    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const parsed = await parseTextWithGemini(message);

    if (!parsed) {
      // fallback non-destructive
      return NextResponse.json({
        action: "none",
        title: "",
        description: null,
        deadline: null,
        reminder_days: 1,
        remind_method: "whatsapp",
        target_contact: null,
      });
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("NLU error:", e);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
