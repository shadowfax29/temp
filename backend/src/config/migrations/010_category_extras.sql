-- Categories are UVdesk's uv_ticket_type. The skill a category needs (used by teams that give tickets out by skill) is kept beside it.
CREATE TABLE IF NOT EXISTS type_settings (
  type_id INT         NOT NULL PRIMARY KEY,
  skill   VARCHAR(60) NULL,
  CONSTRAINT fk_type_settings_type FOREIGN KEY (type_id) REFERENCES uv_ticket_type (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
