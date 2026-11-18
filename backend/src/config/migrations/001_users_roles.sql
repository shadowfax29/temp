-- The tool's own people and roles. (Table and column names are kept as they were in Taskly so the ticketing queries did not need rewriting.)
CREATE TABLE IF NOT EXISTS AMRole (
  RoleID          INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  RoleName        VARCHAR(80)  NOT NULL,
  RoleDescription VARCHAR(255) NULL,
  RolePrivileges  TEXT         NULL,
  RoleStatus      TINYINT(1)   NOT NULL DEFAULT 1,
  IsRoleArchived  TINYINT(1)   NOT NULL DEFAULT 0,
  UserType        VARCHAR(20)  NULL,
  UNIQUE KEY uq_role_name (RoleName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS Users (
  UserID         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  UserName       VARCHAR(120) NOT NULL,
  UserEmail      VARCHAR(190) NOT NULL,
  PasswordHash   VARCHAR(100) NOT NULL,
  RoleID         INT          NOT NULL,
  UserStatus     TINYINT(1)   NOT NULL DEFAULT 1,
  IsUserArchived TINYINT(1)   NOT NULL DEFAULT 0,
  CreatedAt      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (UserEmail),
  CONSTRAINT fk_user_role FOREIGN KEY (RoleID) REFERENCES AMRole (RoleID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Starting roles. The admin can edit them or add more.
INSERT IGNORE INTO AMRole (RoleName, RoleDescription, UserType, RolePrivileges) VALUES
 ('Admin', 'Sets up roles, users, teams and ticket categories; sees everything', 'SUPER_ADMIN', NULL),
 ('Team Lead', 'Assigns and hands off tickets of the teams they are on', NULL,
  '{"ticketing":["read"],"tkt_new":["read","create"],"tkt_my":["read","create","update"],"tkt_inbox":["read","update"],"tkt_report":["read"]}'),
 ('Agent', 'Works the tickets of the teams they are on', NULL,
  '{"ticketing":["read"],"tkt_new":["read","create"],"tkt_my":["read","create","update"],"tkt_inbox":["read","update"]}'),
 ('Requester', 'Raises tickets and follows their own', NULL,
  '{"ticketing":["read"],"tkt_new":["read","create"],"tkt_my":["read","create","update"]}');
