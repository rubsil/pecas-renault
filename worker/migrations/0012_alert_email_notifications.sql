-- ============================================================
-- Migração 0012: notificação de alertas por email
-- ============================================================
--
-- pref_alert_notifications: preferência do concessionário, ligada
-- por defeito (1). Se desligada, nunca recebe email quando um dos
-- seus alertas ficar satisfeito -- continua a poder ver isso no
-- dashboard (badge, "Ver peça"), só não recebe email.
--
-- alert_notifications_sent: regista qual peça já gerou notificação
-- para qual alerta -- evita duplicados quando a mesma peça continua
-- ativa (o cron/verificação corre periodicamente), mas permite
-- notificar de novo se uma peça DIFERENTE aparecer depois (ex: a
-- primeira foi vendida, surge uma segunda peça igual).

ALTER TABLE dealers ADD COLUMN pref_alert_notifications INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS alert_notifications_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES reference_alerts(id),
  listing_id INTEGER NOT NULL REFERENCES parts_listings(id),
  sent_at TEXT DEFAULT (datetime('now')),
  UNIQUE(alert_id, listing_id)
);

CREATE INDEX IF NOT EXISTS idx_alert_notif_alert ON alert_notifications_sent(alert_id);
