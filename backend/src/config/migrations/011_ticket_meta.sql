-- What this tool records about a ticket that UVdesk's ticket row has no place for: when it was first answered, opened, resolved and closed, and the resolution note.
CREATE TABLE IF NOT EXISTS ticket_meta (
  ticket_id        INT      NOT NULL PRIMARY KEY,
  first_response_at DATETIME NULL,
  first_opened_at  DATETIME NULL,
  resolved_at      DATETIME NULL,
  closed_at        DATETIME NULL,
  resolution_note  TEXT     NULL,
  CONSTRAINT fk_ticket_meta_ticket FOREIGN KEY (ticket_id) REFERENCES uv_ticket (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
