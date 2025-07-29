// components/email-template.tsx
import React from "react";

// Props diperbarui untuk menerima foto profil dan URL tugas
interface ReminderProps {
  firstName?: string;
  profilePictureUrl?: string; // <-- URL foto profil pengguna
  title: string;
  deadline: string;
  description?: string;
  taskUrl?: string; // <-- URL untuk tombol "Lihat Tugas"
}

export function ReminderTemplate({
  firstName = "User",
  profilePictureUrl,
  title,
  deadline,
  description,
  taskUrl = "#", // Default URL jika tidak disediakan
}: ReminderProps) {
  const formatDeadline = (dateString: string) => {
    try {
      const date = new Date(dateString); // Format sedikit disederhanakan agar lebih rapi
      return date.toLocaleString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return dateString;
    }
  };

  const containerBackgroundColor = "#ffffff";
  const primaryColor = "#F0FFFD";
  const accentColor = "#3b82f6";
  const textColor = "#374151";
  const lightTextColor = "#6b7280";

  return (
    <div style={{ padding: "20px 0" }}>
           {" "}
      <div
        style={{
          fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
          maxWidth: "600px",
          margin: "0 auto",
          backgroundColor: containerBackgroundColor,
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}
      >
                {/* Bagian Header dengan Logo */}       {" "}
        <div
          style={{
            textAlign: "center",
            padding: "25px",
            backgroundColor: accentColor,
          }}
        >
                   {" "}
          <img // GANTI DENGAN URL PUBLIK LOGO ANDA DARI SUPABASE STORAGE
            src="https://nvmhlimiuyxalekhvuej.supabase.co/storage/v1/object/public/listku//listkuu.png"
            alt="ListKu Logo"
            style={{ width: "120px", height: "auto" }}
          />
                 {" "}
        </div>
               {" "}
        <div style={{ padding: "30px" }}>
                    {/* Bagian Profil Pengguna */}         {" "}
          {profilePictureUrl && (
            <img // URL foto profil akan di-pass sebagai props
              src={profilePictureUrl}
              alt="Profile Picture"
              style={{
                width: "60px",
                height: "60px",
                borderRadius: "50%",
                objectFit: "cover",
                marginBottom: "15px",
              }}
            />
          )}
                   {" "}
          <h1
            style={{ color: textColor, margin: "0 0 20px 0", fontSize: "22px" }}
          >
                        Halo {firstName}, ini pengingat untuk tugas Anda:      
               {" "}
          </h1>
                    {/* Detail Tugas */}         {" "}
          <div
            style={{
              padding: "20px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              backgroundColor: "#f9fafb",
            }}
          >
                       {" "}
            <h2
              style={{
                color: primaryColor,
                margin: "0 0 10px 0",
                fontSize: "20px",
              }}
            >
                            {title}           {" "}
            </h2>
                       {" "}
            <p style={{ color: lightTextColor, margin: "0 0 15px 0" }}>
                            <strong>⏰ Deadline:</strong>{" "}
              {formatDeadline(deadline)}           {" "}
            </p>
                       {" "}
            {description && (
              <p
                style={{
                  color: textColor,
                  margin: "0",
                  paddingTop: "15px",
                  borderTop: "1px dashed #d1d5db",
                  lineHeight: "1.6",
                }}
              >
                                {description}             {" "}
              </p>
            )}
                     {" "}
          </div>
                    {/* Tombol Call to Action */}         {" "}
          <div style={{ textAlign: "center", marginTop: "30px" }}>
                       {" "}
            <a
              href={`https://listku.my.id/dashboard`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "12px 25px",
                backgroundColor: accentColor,
                color: "white",
                textDecoration: "none",
                borderRadius: "6px",
                fontWeight: "bold",
              }}
            >
                            Lihat Tugas di Aplikasi            {" "}
            </a>
                     {" "}
          </div>
                 {" "}
        </div>
                {/* Footer */}       {" "}
        <div
          style={{
            textAlign: "center",
            padding: "20px",
            borderTop: "1px solid #e5e7eb",
          }}
        >
                   {" "}
          <p style={{ color: lightTextColor, fontSize: "12px", margin: "0" }}>
                        Email ini dikirim secara otomatis oleh{" "}
            <strong>ListKu</strong>.          {" "}
          </p>
                 {" "}
        </div>
             {" "}
      </div>
         {" "}
    </div>
  );
}
