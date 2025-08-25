// app/api/admin/statistics/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getDetailedStatistics } from "@/lib/actions/statistics";

export async function GET(request: NextRequest) {
  try {
    const stats = await getDetailedStatistics();
    return NextResponse.json(stats);
  } catch (error: any) {
    console.error("Error fetching admin statistics:", error);
    
    if (error.message === "Not authenticated") {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    
    if (error.message === "Not authorized") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }
    
    return NextResponse.json(
      { error: "Failed to fetch statistics" },
      { status: 500 }
    );
  }
}