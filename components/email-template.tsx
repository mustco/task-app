// components/email-template.tsx
import React from "react";

interface ReminderProps {
  firstName?: string;
  title: string;
  deadline: string;
  description?: string;
}

export function ReminderTemplate({
  firstName = "User",
  title,
  deadline,
  description,
}: ReminderProps) {
  const formatDeadline = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString("id-ID", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return dateString; // Fallback jika format tanggal tidak valid
    }
  };

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        maxWidth: "600px",
        margin: "0 auto",
        padding: "20px",
        backgroundColor: "#f9f9f9",
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: "30px",
          borderRadius: "8px",
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        }}
      >
        <div
          style={{
            borderLeft: "4px solid #3b82f6",
            paddingLeft: "20px",
            marginBottom: "20px",
          }}
        >
          <h1
            style={{
              color: "#1e40af",
              margin: "0 0 10px 0",
              fontSize: "24px",
            }}
          >
            📅 Task Reminder
          </h1>
          <p
            style={{
              color: "#6b7280",
              margin: "0",
              fontSize: "14px",
            }}
          >
            Halo {firstName}, jangan lupa tugas penting ini!
          </p>
        </div>

        <div
          style={{
            backgroundColor: "#fef3c7",
            padding: "20px",
            borderRadius: "6px",
            border: "1px solid #f59e0b",
            marginBottom: "20px",
          }}
        >
          <h2
            style={{
              color: "#92400e",
              margin: "0 0 10px 0",
              fontSize: "18px",
            }}
          >
            {title}
          </h2>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            <span
              style={{
                color: "#dc2626",
                fontWeight: "bold",
                marginRight: "8px",
              }}
            >
              ⏰ Deadline:
            </span>
            <span style={{ color: "#374151" }}>{formatDeadline(deadline)}</span>
          </div>

          {description && (
            <div
              style={{
                marginTop: "15px",
                padding: "15px",
                backgroundColor: "white",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
              }}
            >
              <p
                style={{
                  margin: "0",
                  color: "#374151",
                  lineHeight: "1.5",
                }}
              >
                {description}
              </p>
            </div>
          )}
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: "30px",
            paddingTop: "20px",
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <p
            style={{
              color: "#6b7280",
              fontSize: "12px",
              margin: "0",
            }}
          >
            Email ini dikirim secara otomatis oleh sistem pengingat tugas Anda.
          </p>
        </div>
      </div>
    </div>
  );
}
