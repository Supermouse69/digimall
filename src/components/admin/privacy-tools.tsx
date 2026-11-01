"use client";

import { useState } from "react";
import { useAuth, useDocumentInfo } from "@payloadcms/ui";

// Super-admin privacy tools on a user's page (CLAUDE.md §9 Data Privacy Act):
// download the user's data, or erase the account (orders are kept, anonymized). Both are logged.
export const PrivacyTools = () => {
  const { user } = useAuth();
  const { id, data } = useDocumentInfo() as { id?: string | number; data?: { email?: string; deletedAt?: string | null } };
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if ((user as { role?: string } | null)?.role !== "super-admin" || !id) return null;
  if (data?.deletedAt) return <p style={{ fontSize: 13 }}>This account was erased (privacy request).</p>;

  const erase = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/users/${id}/privacy-erase`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: confirm }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; chatsDeleted?: number; filesDeleted?: number; ordersAnonymized?: number };
      if (!res.ok) setMessage(json.error ?? "Couldn't erase this account.");
      else {
        setMessage(`Erased. Chats deleted: ${json.chatsDeleted}, files deleted: ${json.filesDeleted}, orders anonymized: ${json.ordersAnonymized}. Reload the page.`);
        setConfirm("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
      <strong>Privacy requests</strong>
      <a href={`/api/users/${id}/privacy-export`} style={{ textDecoration: "underline" }}>
        Download this user&apos;s data (JSON)
      </a>
      <details>
        <summary style={{ cursor: "pointer", color: "#b91c1c" }}>Erase this account…</summary>
        <p style={{ fontSize: 13 }}>
          Deletes their chats (except reported ones), private files and push subscriptions. Orders are kept but anonymized.
          The account can never log in again. This can&apos;t be undone.
        </p>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          Type their email to confirm: <code>{data?.email}</code>
          <input value={confirm} onChange={(event) => setConfirm(event.target.value)} style={{ padding: 6 }} />
        </label>
        <button
          type="button"
          disabled={busy || confirm.trim().toLowerCase() !== (data?.email ?? "").toLowerCase()}
          onClick={erase}
          style={{ marginTop: 8, padding: "6px 12px", background: "#b91c1c", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}
        >
          {busy ? "Erasing…" : "Erase account"}
        </button>
      </details>
      {message && <p style={{ fontSize: 13 }}>{message}</p>}
    </div>
  );
};

export default PrivacyTools;
