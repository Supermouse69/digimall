import type { Payload } from "payload";

import { adminQueues, attentionTotal, recentAudit, type QueueItem } from "@/modules/admin-desk/server/queues";

// Super-admin "Admin desk" on the Payload dashboard (CLAUDE.md §14 Phase 8): what's waiting for
// you, with links to the filtered lists where you act (every change there is audit-logged).
// Server component: runs only on the server, shows nothing to sellers.
// Inline styles: the admin panel doesn't load the site's Tailwind CSS.

const TONE: Record<QueueItem["tone"], { border: string; badge: string }> = {
  urgent: { border: "#dc2626", badge: "#dc2626" },
  todo: { border: "#111111", badge: "#111111" },
  setup: { border: "#a3a3a3", badge: "#737373" },
};

const QUICK_LINKS = [
  ["Stores", "/admin/collections/tenants"],
  ["Riders", "/admin/collections/rider-profiles"],
  ["Invites", "/admin/collections/invites"],
  ["Reports", "/admin/collections/reports"],
  ["Store orders", "/admin/collections/store-orders"],
  ["Orders", "/admin/collections/orders"],
  ["Fares", "/admin/collections/fares"],
  ["Categories", "/admin/collections/categories"],
  ["Legal pages", "/admin/collections/legal-pages"],
  ["Audit log", "/admin/collections/audit-logs"],
  ["Settings", "/admin/globals/settings"],
] as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const AdminDesk = async ({ payload, user }: { payload: Payload; user?: { role?: string } | null }) => {
  if (user?.role !== "super-admin") return null;
  const [items, audit] = await Promise.all([adminQueues({ payload }), recentAudit({ payload })]);
  const total = attentionTotal(items);
  // Setup items count as "to do" when missing (0 fares) or present (placeholders, stores without hours)
  const needsSetup = (item: QueueItem) => (item.key === "fares-missing" ? item.count === 0 : item.count > 0);
  const cards = items.filter((item) => (item.tone === "setup" ? needsSetup(item) : item.count > 0));
  const calm = items.filter((item) => item.tone !== "setup" && item.count === 0);

  return (
    <section style={{ marginBottom: 32, fontFamily: "inherit" }}>
      <h2 style={{ fontSize: 22, margin: "0 0 4px" }}>Admin desk</h2>
      <p style={{ margin: "0 0 16px", color: "#555" }}>
        {total === 0 ? "Nothing is waiting for you right now. 🎉" : `${total} thing${total === 1 ? "" : "s"} waiting for you.`}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {cards.map((item) => (
            <a
              key={item.key}
              href={item.href}
              style={{ display: "flex", flexDirection: "column", gap: 6, padding: 14, borderRadius: 8, border: `2px solid ${TONE[item.tone].border}`, background: "var(--theme-elevation-0, #fff)", textDecoration: "none", color: "inherit" }}
            >
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <strong style={{ fontSize: 15 }}>{item.title}</strong>
                <span style={{ minWidth: 28, textAlign: "center", padding: "2px 8px", borderRadius: 12, background: TONE[item.tone].badge, color: "#fff", fontWeight: 700 }}>
                  {item.count}
                </span>
              </span>
              <span style={{ fontSize: 13, color: "#555" }}>{item.hint}</span>
              <span style={{ fontSize: 13, textDecoration: "underline" }}>Open the list →</span>
            </a>
        ))}
      </div>
      {calm.length > 0 && (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "#666" }}>All clear: {calm.map((item) => item.title).join(" · ")}</p>
      )}

      <h3 style={{ fontSize: 16, margin: "24px 0 8px" }}>Quick links</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {QUICK_LINKS.map(([label, href]) => (
          <a key={href} href={href} style={{ padding: "6px 12px", border: "1px solid #ccc", borderRadius: 16, textDecoration: "none", color: "inherit", fontSize: 14 }}>
            {label}
          </a>
        ))}
      </div>

      <h3 style={{ fontSize: 16, margin: "24px 0 8px" }}>Latest in the audit log</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {audit.map((entry) => (
            <tr key={entry.id} style={{ borderTop: "1px solid #e5e5e5" }}>
              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{when(entry.at)}</td>
              <td style={{ padding: "6px 8px" }}>
                <a href={`/admin/collections/audit-logs/${entry.id}`} style={{ color: "inherit" }}>{entry.action}</a>
              </td>
              <td style={{ padding: "6px 8px", color: "#555" }}>{entry.actor}</td>
              <td style={{ padding: "6px 8px", color: "#555" }}>{entry.target}</td>
            </tr>
          ))}
          {audit.length === 0 && (
            <tr>
              <td style={{ padding: 8, color: "#666" }}>No entries yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
};

export default AdminDesk;
