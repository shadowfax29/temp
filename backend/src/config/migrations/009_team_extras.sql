-- Teams are UVdesk's uv_support_team (members: uv_user_support_teams, leads: uv_lead_support_teams).
-- What this tool adds for each team and each member sits beside them.
CREATE TABLE IF NOT EXISTS team_settings (
  team_id           INT         NOT NULL PRIMARY KEY,
  assignment_method VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
  max_open          INT         NOT NULL DEFAULT 8,
  CONSTRAINT fk_team_settings_team FOREIGN KEY (team_id) REFERENCES uv_support_team (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS team_member_settings (
  team_id   INT         NOT NULL,
  user_id   INT         NOT NULL,
  privilege VARCHAR(12) NOT NULL DEFAULT 'BASIC',
  skills    TEXT        NULL,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_member_settings_team FOREIGN KEY (team_id) REFERENCES uv_support_team (id) ON DELETE CASCADE,
  CONSTRAINT fk_member_settings_user FOREIGN KEY (user_id) REFERENCES uv_user (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every imported team starts with the defaults (changed on the Teams page)
INSERT IGNORE INTO team_settings (team_id) SELECT id FROM uv_support_team;
