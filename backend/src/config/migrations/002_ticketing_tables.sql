-- Ticketing tables (final state).

CREATE TABLE IF NOT EXISTS `tkt_category` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `prefix` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `owner_user_id` int DEFAULT NULL,
  `default_team_id` int DEFAULT NULL,
  `next_no` int NOT NULL DEFAULT '1000',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tkt_category_name` (`name`),
  UNIQUE KEY `uq_tkt_category_prefix` (`prefix`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_subcategory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `default_team_id` int DEFAULT NULL,
  `skill` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tkt_sub_name` (`category_id`,`name`),
  CONSTRAINT `fk_tkt_sub_cat` FOREIGN KEY (`category_id`) REFERENCES `tkt_category` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_field` (
  `id` int NOT NULL AUTO_INCREMENT,
  `subcategory_id` int NOT NULL,
  `field_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `field_type` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TEXT',
  `options` text COLLATE utf8mb4_unicode_ci,
  `required` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tkt_field_key` (`subcategory_id`,`field_key`),
  CONSTRAINT `fk_tkt_field_sub` FOREIGN KEY (`subcategory_id`) REFERENCES `tkt_subcategory` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_team` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lead_user_id` int DEFAULT NULL,
  `assignment_method` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANUAL',
  `max_open` int NOT NULL DEFAULT '8',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_assigned_user_id` int DEFAULT NULL,
  `department_id` int DEFAULT NULL,
  `lead_locked` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tkt_team_name` (`name`),
  UNIQUE KEY `uq_tkt_team_department` (`department_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_team_member` (
  `team_id` int NOT NULL,
  `user_id` int NOT NULL,
  `privilege` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BASIC',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `added_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `skills` text COLLATE utf8mb4_unicode_ci,
  `away` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANUAL',
  `excluded` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`team_id`,`user_id`),
  KEY `idx_tkt_member_user` (`user_id`),
  CONSTRAINT `fk_tkt_member_team` FOREIGN KEY (`team_id`) REFERENCES `tkt_team` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_category_team` (
  `category_id` int NOT NULL,
  `team_id` int NOT NULL,
  PRIMARY KEY (`category_id`,`team_id`),
  KEY `fk_tkt_ct_team` (`team_id`),
  CONSTRAINT `fk_tkt_ct_cat` FOREIGN KEY (`category_id`) REFERENCES `tkt_category` (`id`),
  CONSTRAINT `fk_tkt_ct_team` FOREIGN KEY (`team_id`) REFERENCES `tkt_team` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_route_rule` (
  `id` int NOT NULL AUTO_INCREMENT,
  `category_id` int NOT NULL,
  `position` int NOT NULL DEFAULT '0',
  `name` varchar(160) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conditions` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `team_id` int NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_tkt_rule_category` (`category_id`,`position`),
  KEY `fk_tkt_rule_team` (`team_id`),
  CONSTRAINT `fk_tkt_rule_cat` FOREIGN KEY (`category_id`) REFERENCES `tkt_category` (`id`),
  CONSTRAINT `fk_tkt_rule_team` FOREIGN KEY (`team_id`) REFERENCES `tkt_team` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_ticket` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category_id` int NOT NULL,
  `subcategory_id` int NOT NULL,
  `team_id` int DEFAULT NULL,
  `requester_id` int NOT NULL,
  `assignee_id` int DEFAULT NULL,
  `subject` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `priority` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MEDIUM',
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `field_values` text COLLATE utf8mb4_unicode_ci,
  `source` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'WEB',
  `first_opened_at` datetime(3) DEFAULT NULL,
  `first_response_at` datetime(3) DEFAULT NULL,
  `resolved_at` datetime(3) DEFAULT NULL,
  `closed_at` datetime(3) DEFAULT NULL,
  `resolution_note` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tkt_ticket_key` (`ticket_key`),
  KEY `idx_tkt_ticket_requester` (`requester_id`,`status`),
  KEY `idx_tkt_ticket_assignee` (`assignee_id`,`status`),
  KEY `idx_tkt_ticket_team` (`team_id`,`status`),
  KEY `idx_tkt_ticket_category` (`category_id`,`status`),
  KEY `fk_tkt_ticket_sub` (`subcategory_id`),
  CONSTRAINT `fk_tkt_ticket_cat` FOREIGN KEY (`category_id`) REFERENCES `tkt_category` (`id`),
  CONSTRAINT `fk_tkt_ticket_sub` FOREIGN KEY (`subcategory_id`) REFERENCES `tkt_subcategory` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_message` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `author_id` int DEFAULT NULL,
  `kind` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_tkt_message_ticket` (`ticket_id`,`id`),
  CONSTRAINT `fk_tkt_message_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tkt_ticket` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_event` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `event_type` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_kind` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USER',
  `actor_user_id` int DEFAULT NULL,
  `impersonated_by` int DEFAULT NULL,
  `old_value` text COLLATE utf8mb4_unicode_ci,
  `new_value` text COLLATE utf8mb4_unicode_ci,
  `details` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category_id` int DEFAULT NULL,
  `team_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `rule_id` int DEFAULT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `prev_hash` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hash` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tkt_event_ticket` (`ticket_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_period` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `team_id` int DEFAULT NULL,
  `assignee_id` int DEFAULT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `started_at` datetime(3) NOT NULL,
  `ended_at` datetime(3) DEFAULT NULL,
  `ended_because` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tkt_period_ticket` (`ticket_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_watcher` (
  `ticket_id` bigint NOT NULL,
  `user_id` int NOT NULL,
  `added_by` int DEFAULT NULL,
  `reason` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `added_at` datetime(3) NOT NULL,
  PRIMARY KEY (`ticket_id`,`user_id`),
  KEY `idx_tkt_watcher_user` (`user_id`),
  CONSTRAINT `fk_tkt_watcher_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tkt_ticket` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tkt_attachment` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `ticket_id` bigint NOT NULL,
  `message_id` bigint DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stored_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size` bigint NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tkt_attachment_ticket` (`ticket_id`),
  KEY `idx_tkt_attachment_message` (`message_id`),
  CONSTRAINT `fk_tkt_attachment_ticket` FOREIGN KEY (`ticket_id`) REFERENCES `tkt_ticket` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

