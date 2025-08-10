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
      return NextResponse.json({ error: "Unable to parse" }, { status: 422 });
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
