-- A person given a temporary password must choose their own before they can use the tool.
ALTER TABLE Users ADD COLUMN MustChangePassword TINYINT(1) NOT NULL DEFAULT 0;
