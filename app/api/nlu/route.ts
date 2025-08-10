
import { NextResponse } from "next/server";

// Tipe data untuk output dari NLU
export interface NluResult {
  intent: "CREATE_TASK" | "READ_TASKS" | "UPDATE_TASK" | "DELETE_TASK" | "UNKNOWN";
  entities: {
    [key: string]: any;
  };
  originalMessage: string;
}

// Fungsi untuk mengekstrak judul dari pesan
function extractContent(message: string, keywords: string[]): string {
  for (const keyword of keywords) {
    if (message.toLowerCase().startsWith(keyword.toLowerCase())) {
      return message.substring(keyword.length).trim();
    }
  }
  return "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.message as string;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const lowerCaseMessage = message.toLowerCase();
    let result: NluResult = {
      intent: "UNKNOWN",
      entities: {},
      originalMessage: message,
    };

    // Logika deteksi intent berbasis kata kunci
    if (lowerCaseMessage.startsWith("tambah tugas") || lowerCaseMessage.startsWith("buatkan tugas")) {
      result.intent = "CREATE_TASK";
      result.entities.title = extractContent(message, ["tambah tugas", "buatkan tugas"]);
    } else if (lowerCaseMessage.startsWith("lihat tugas") || lowerCaseMessage.startsWith("apa saja tugasku")) {
      result.intent = "READ_TASKS";
    } else if (lowerCaseMessage.startsWith("hapus tugas") || lowerCaseMessage.startsWith("selesaikan tugas")) {
      result.intent = "DELETE_TASK";
      result.entities.title = extractContent(message, ["hapus tugas", "selesaikan tugas"]);
    } else if (lowerCaseMessage.startsWith("ubah tugas")) {
      result.intent = "UPDATE_TASK";
      // Untuk update, kita perlu logika lebih kompleks nanti
      result.entities.title = extractContent(message, ["ubah tugas"]);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error("Error in NLU service:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
