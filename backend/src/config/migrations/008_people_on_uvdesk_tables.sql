-- People now live in the UVdesk tables (uv_user + uv_user_instance). What the tool adds for each person is kept in user_access:
-- the tool role (permissions), whether a sign-in code is asked for, and whether a temporary password must still be replaced.
CREATE TABLE IF NOT EXISTS user_access (
  user_id              INT        NOT NULL PRIMARY KEY,
  role_id              INT        NOT NULL,
  two_factor           TINYINT(1) NULL DEFAULT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES uv_user (id) ON DELETE CASCADE,
  CONSTRAINT fk_access_role FOREIGN KEY (role_id) REFERENCES AMRole (RoleID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anyone already created in the tool moves across (with the same email, password and settings)
INSERT INTO uv_user (email, password, first_name, last_name, is_enabled)
  SELECT u.UserEmail, u.PasswordHash, u.UserName, NULL, u.UserStatus FROM Users u WHERE u.UserEmail NOT IN (SELECT email FROM uv_user WHERE email IS NOT NULL);

INSERT INTO uv_user_instance (user_id, source, created_at, updated_at, is_active, is_verified, supportRole_id)
  SELECT n.id, 'website', NOW(), NOW(), 1, 1, IF(r.UserType IN ('SUPER_ADMIN', 'ADMIN'), 1, IF(r.RoleName = 'Requester', 4, 3))
  FROM Users u JOIN uv_user n ON n.email = u.UserEmail JOIN AMRole r ON r.RoleID = u.RoleID
  WHERE NOT EXISTS (SELECT 1 FROM uv_user_instance i WHERE i.user_id = n.id);

INSERT INTO user_access (user_id, role_id, two_factor, must_change_password)
  SELECT n.id, u.RoleID, u.TwoFactor, u.MustChangePassword FROM Users u JOIN uv_user n ON n.email = u.UserEmail;

-- The sign-in log keeps pointing at the same person
UPDATE LoginLog l JOIN Users o ON o.UserID = l.UserID JOIN uv_user n ON n.email = o.UserEmail SET l.UserID = n.id;
UPDATE LoginChallenge c JOIN Users o ON o.UserID = c.UserID JOIN uv_user n ON n.email = o.UserEmail SET c.UserID = n.id;

-- Imported people get a tool role from what they were in UVdesk:
--   Account Owner or Administrator -> Admin;  Agent holding the Managers privilege set -> Team Lead;  other Agents -> Agent;  Customers -> Requester.
-- Only people with an active instance get access; the rest stay in the data (their tickets keep pointing at them) but cannot sign in.
-- A person with no password cannot sign in until an admin sends them a temporary one.
INSERT INTO user_access (user_id, role_id, must_change_password)
  SELECT x.id, x.role_id, IF(x.has_password, 0, 1) FROM (
    SELECT u.id, (u.password IS NOT NULL) AS has_password,
      CASE
        WHEN EXISTS (SELECT 1 FROM uv_user_instance i WHERE i.user_id = u.id AND i.is_active = 1 AND i.supportRole_id IN (1, 2))
          THEN (SELECT RoleID FROM AMRole WHERE UserType = 'SUPER_ADMIN' LIMIT 1)
        WHEN EXISTS (SELECT 1 FROM uv_user_instance i JOIN uv_user_support_privileges p ON p.userInstanceId = i.id WHERE i.user_id = u.id AND i.is_active = 1 AND i.supportRole_id = 3 AND p.supportPrivilegeId = 3)
          THEN (SELECT RoleID FROM AMRole WHERE RoleName = 'Team Lead' LIMIT 1)
        WHEN EXISTS (SELECT 1 FROM uv_user_instance i WHERE i.user_id = u.id AND i.is_active = 1 AND i.supportRole_id = 3)
          THEN (SELECT RoleID FROM AMRole WHERE RoleName = 'Agent' LIMIT 1)
        WHEN EXISTS (SELECT 1 FROM uv_user_instance i WHERE i.user_id = u.id AND i.is_active = 1 AND i.supportRole_id = 4)
          THEN (SELECT RoleID FROM AMRole WHERE RoleName = 'Requester' LIMIT 1)
        ELSE NULL
      END AS role_id
    FROM uv_user u WHERE u.id NOT IN (SELECT user_id FROM user_access)
  ) x WHERE x.role_id IS NOT NULL;

DROP TABLE IF EXISTS Users;

-- The ticket queries still say "Users": it is now a view over the UVdesk people plus user_access
CREATE VIEW Users AS
  SELECT u.id AS UserID, TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS UserName, u.email AS UserEmail, u.password AS PasswordHash,
         a.role_id AS RoleID, IF(u.is_enabled = 1 AND a.user_id IS NOT NULL, 1, 0) AS UserStatus, 0 AS IsUserArchived,
         a.two_factor AS TwoFactor, COALESCE(a.must_change_password, 0) AS MustChangePassword
  FROM uv_user u LEFT JOIN user_access a ON a.user_id = u.id;
