-- Two-step sign-in (a 6-digit code after the password) and a log of every sign-in attempt.
ALTER TABLE Users ADD COLUMN TwoFactor TINYINT(1) NULL DEFAULT NULL;

CREATE TABLE IF NOT EXISTS AppSetting (
  SettingKey   VARCHAR(64)  NOT NULL PRIMARY KEY,
  SettingValue VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO AppSetting (SettingKey, SettingValue) VALUES ('twoFactorDefault', 'on');

CREATE TABLE IF NOT EXISTS LoginChallenge (
  ChallengeID CHAR(36)    NOT NULL PRIMARY KEY,
  UserID      INT         NOT NULL,
  CodeHash    VARCHAR(100) NOT NULL,
  Attempts    INT         NOT NULL DEFAULT 0,
  ExpiresAt   DATETIME    NOT NULL,
  UsedAt      DATETIME    NULL,
  CreatedAt   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_challenge_user (UserID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS LoginLog (
  LogID     BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  UserID    INT          NULL,
  Email     VARCHAR(190) NOT NULL,
  Event     VARCHAR(24)  NOT NULL,
  Detail    VARCHAR(200) NULL,
  Ip        VARCHAR(64)  NULL,
  UserAgent VARCHAR(255) NULL,
  CreatedAt DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_loginlog_time (CreatedAt),
  KEY idx_loginlog_user (UserID, CreatedAt),
  KEY idx_loginlog_email (Email, CreatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
