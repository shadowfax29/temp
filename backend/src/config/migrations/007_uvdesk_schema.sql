-- The UVdesk ticketing tables, exactly as they are in the live system (structure only, from dump-sdesk-202611181210.sql).
-- Created in foreign-key order. The data comes in later from a data-only dump.

CREATE TABLE IF NOT EXISTS `uv_support_group` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `user_view` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_support_team` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket_priority` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `color_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_FFA6CF8677153098` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket_status` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `color_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_128B1D3A77153098` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket_type` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_3E0B313677153098` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_user` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proxy_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `password` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `verification_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timezone` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timeformat` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_E8D39F61E7927C74` (`email`),
  UNIQUE KEY `UNIQ_E8D39F61DB26A4E` (`proxy_id`),
  UNIQUE KEY `UNIQ_E8D39F61E821C39F` (`verification_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket` (
  `id` int NOT NULL AUTO_INCREMENT,
  `status_id` int DEFAULT NULL,
  `priority_id` int DEFAULT NULL,
  `type_id` int DEFAULT NULL,
  `customer_id` int DEFAULT NULL,
  `agent_id` int DEFAULT NULL,
  `group_id` int DEFAULT NULL,
  `source` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `mailbox_email` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subject` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `reference_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_new` tinyint(1) NOT NULL DEFAULT '1',
  `is_replied` tinyint(1) NOT NULL DEFAULT '0',
  `is_reply_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `is_starred` tinyint(1) NOT NULL DEFAULT '0',
  `is_trashed` tinyint(1) NOT NULL DEFAULT '0',
  `is_agent_viewed` tinyint(1) NOT NULL DEFAULT '0',
  `is_customer_viewed` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `subGroup_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_C5FD9F7D6BF700BD` (`status_id`),
  KEY `IDX_C5FD9F7D497B19F9` (`priority_id`),
  KEY `IDX_C5FD9F7DC54C8C93` (`type_id`),
  KEY `IDX_C5FD9F7D9395C3F3` (`customer_id`),
  KEY `IDX_C5FD9F7D3414710B` (`agent_id`),
  KEY `IDX_C5FD9F7DFE54D947` (`group_id`),
  KEY `IDX_C5FD9F7DCB20698` (`subGroup_id`),
  CONSTRAINT `FK_C5FD9F7D3414710B` FOREIGN KEY (`agent_id`) REFERENCES `uv_user` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_C5FD9F7D497B19F9` FOREIGN KEY (`priority_id`) REFERENCES `uv_ticket_priority` (`id`),
  CONSTRAINT `FK_C5FD9F7D6BF700BD` FOREIGN KEY (`status_id`) REFERENCES `uv_ticket_status` (`id`),
  CONSTRAINT `FK_C5FD9F7D9395C3F3` FOREIGN KEY (`customer_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_C5FD9F7DC54C8C93` FOREIGN KEY (`type_id`) REFERENCES `uv_ticket_type` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_C5FD9F7DCB20698` FOREIGN KEY (`subGroup_id`) REFERENCES `uv_support_team` (`id`) ON DELETE SET NULL,
  CONSTRAINT `FK_C5FD9F7DFE54D947` FOREIGN KEY (`group_id`) REFERENCES `uv_support_group` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `agent_activity` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agent_id` int NOT NULL,
  `ticket_id` int NOT NULL,
  `agent_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customer_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `thread_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_9AA510CE3414710B` (`agent_id`),
  KEY `IDX_9AA510CE700047D2` (`ticket_id`),
  CONSTRAINT `FK_9AA510CE3414710B` FOREIGN KEY (`agent_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_9AA510CE700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcement` (
  `id` int NOT NULL AUTO_INCREMENT,
  `group_id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `promo_text` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `promo_tag` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `tag_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_text` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `link_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_4DB9D91CFE54D947` (`group_id`),
  CONSTRAINT `FK_4DB9D91CFE54D947` FOREIGN KEY (`group_id`) REFERENCES `uv_support_group` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `migration_versions` (
  `version` varchar(14) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `executed_at` datetime NOT NULL COMMENT '(DC2Type:datetime_immutable)',
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `recaptcha` (
  `id` int NOT NULL AUTO_INCREMENT,
  `site_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `secret_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_support_role` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_2AF5A72177153098` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_user_instance` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `source` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `skype_id` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_number` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `designation` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signature` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `profile_image_path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '0',
  `is_verified` tinyint(1) NOT NULL DEFAULT '0',
  `is_starred` tinyint(1) NOT NULL DEFAULT '0',
  `ticket_access_level` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `supportRole_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_B1744733A76ED395` (`user_id`),
  KEY `IDX_B174473368771C43` (`supportRole_id`),
  CONSTRAINT `FK_B174473368771C43` FOREIGN KEY (`supportRole_id`) REFERENCES `uv_support_role` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_B1744733A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_admin_support_groups` (
  `adminUserInstanceId` int NOT NULL,
  `supportGroupId` int NOT NULL,
  PRIMARY KEY (`adminUserInstanceId`,`supportGroupId`),
  KEY `IDX_215FF93837B7A2F1` (`adminUserInstanceId`),
  KEY `IDX_215FF93853F5B65F` (`supportGroupId`),
  CONSTRAINT `FK_215FF93837B7A2F1` FOREIGN KEY (`adminUserInstanceId`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_215FF93853F5B65F` FOREIGN KEY (`supportGroupId`) REFERENCES `uv_support_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_api_access_credentials` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_on` datetime NOT NULL,
  `is_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `is_expired` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `IDX_31DBD20EA76ED395` (`user_id`),
  CONSTRAINT `FK_31DBD20EA76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `meta_description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `keywords` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `viewed` int DEFAULT NULL,
  `status` int DEFAULT '0',
  `date_added` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  `stared` int DEFAULT NULL,
  `meta_title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `search_idx` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article_category` (
  `id` int NOT NULL AUTO_INCREMENT,
  `article_id` int NOT NULL,
  `category_id` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article_feedback` (
  `id` int NOT NULL AUTO_INCREMENT,
  `article_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `is_helpful` tinyint(1) NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_BCB7F9147294869C` (`article_id`),
  KEY `IDX_BCB7F914A76ED395` (`user_id`),
  CONSTRAINT `FK_BCB7F9147294869C` FOREIGN KEY (`article_id`) REFERENCES `uv_article` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_BCB7F914A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `article_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_added` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article_tags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `article_id` int NOT NULL,
  `tag_id` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_article_view_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `article_id` int DEFAULT NULL,
  `viewed_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_8F76FF11A76ED395` (`user_id`),
  KEY `IDX_8F76FF117294869C` (`article_id`),
  CONSTRAINT `FK_8F76FF117294869C` FOREIGN KEY (`article_id`) REFERENCES `uv_article` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_8F76FF11A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_email_templates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_predefined` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `IDX_784A0D85A76ED395` (`user_id`),
  CONSTRAINT `FK_784A0D85A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_lead_support_teams` (
  `leadUserInstanceId` int NOT NULL,
  `supportTeamId` int NOT NULL,
  PRIMARY KEY (`leadUserInstanceId`,`supportTeamId`),
  KEY `IDX_8B5F844DD397BD7C` (`leadUserInstanceId`),
  KEY `IDX_8B5F844DA77C7023` (`supportTeamId`),
  CONSTRAINT `FK_8B5F844DA77C7023` FOREIGN KEY (`supportTeamId`) REFERENCES `uv_support_team` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_8B5F844DD397BD7C` FOREIGN KEY (`leadUserInstanceId`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_prepared_responses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'public',
  `actions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '(DC2Type:array)',
  `status` tinyint(1) DEFAULT '1',
  `date_added` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_8AB5F066A76ED395` (`user_id`),
  CONSTRAINT `FK_8AB5F066A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user_instance` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_prepared_response_support_groups` (
  `group_id` int NOT NULL,
  `savedReply_id` int NOT NULL,
  PRIMARY KEY (`savedReply_id`,`group_id`),
  KEY `IDX_A22590198D3102C3` (`savedReply_id`),
  KEY `IDX_A2259019FE54D947` (`group_id`),
  CONSTRAINT `FK_A22590198D3102C3` FOREIGN KEY (`savedReply_id`) REFERENCES `uv_prepared_responses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_A2259019FE54D947` FOREIGN KEY (`group_id`) REFERENCES `uv_support_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_prepared_response_support_teams` (
  `subgroup_id` int NOT NULL,
  `savedReply_id` int NOT NULL,
  PRIMARY KEY (`savedReply_id`,`subgroup_id`),
  KEY `IDX_B6897DEB8D3102C3` (`savedReply_id`),
  KEY `IDX_B6897DEBF5C464CE` (`subgroup_id`),
  CONSTRAINT `FK_B6897DEB8D3102C3` FOREIGN KEY (`savedReply_id`) REFERENCES `uv_prepared_responses` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_B6897DEBF5C464CE` FOREIGN KEY (`subgroup_id`) REFERENCES `uv_support_team` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_related_articles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `article_id` int NOT NULL,
  `related_article_id` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_saved_filters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `filtering` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `route` varchar(190) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `date_added` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_E1BFBAF7A76ED395` (`user_id`),
  CONSTRAINT `FK_E1BFBAF7A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_saved_replies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `template_id` int DEFAULT NULL,
  `is_predefind` tinyint(1) DEFAULT '1',
  `message_inline` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `template_for` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_39C8BA50A76ED395` (`user_id`),
  CONSTRAINT `FK_39C8BA50A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_saved_replies_groups` (
  `group_id` int NOT NULL,
  `savedReply_id` int NOT NULL,
  PRIMARY KEY (`savedReply_id`,`group_id`),
  KEY `IDX_C59C13668D3102C3` (`savedReply_id`),
  KEY `IDX_C59C1366FE54D947` (`group_id`),
  CONSTRAINT `FK_C59C13668D3102C3` FOREIGN KEY (`savedReply_id`) REFERENCES `uv_saved_replies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_C59C1366FE54D947` FOREIGN KEY (`group_id`) REFERENCES `uv_support_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_saved_replies_teams` (
  `subgroup_id` int NOT NULL,
  `savedReply_id` int NOT NULL,
  PRIMARY KEY (`savedReply_id`,`subgroup_id`),
  KEY `IDX_D240CE708D3102C3` (`savedReply_id`),
  KEY `IDX_D240CE70F5C464CE` (`subgroup_id`),
  CONSTRAINT `FK_D240CE708D3102C3` FOREIGN KEY (`savedReply_id`) REFERENCES `uv_saved_replies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_D240CE70F5C464CE` FOREIGN KEY (`subgroup_id`) REFERENCES `uv_support_team` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_solution_category` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int DEFAULT '1',
  `sorting` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'ascending',
  `date_added` datetime NOT NULL,
  `status` int DEFAULT '0',
  `date_updated` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_solution_category_mapping` (
  `id` int NOT NULL AUTO_INCREMENT,
  `solution_id` int NOT NULL,
  `category_id` int NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_solutions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `visibility` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '5',
  `date_added` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  `solution_image` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_support_groups_teams` (
  `supportGroup_id` int NOT NULL,
  `supportTeam_id` int NOT NULL,
  PRIMARY KEY (`supportGroup_id`,`supportTeam_id`),
  KEY `IDX_761A315DCE5F5290` (`supportGroup_id`),
  KEY `IDX_761A315D9718E641` (`supportTeam_id`),
  CONSTRAINT `FK_761A315D9718E641` FOREIGN KEY (`supportTeam_id`) REFERENCES `uv_support_team` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_761A315DCE5F5290` FOREIGN KEY (`supportGroup_id`) REFERENCES `uv_support_group` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_support_label` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `color_code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_EFD454DDA76ED395` (`user_id`),
  CONSTRAINT `FK_EFD454DDA76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_support_privilege` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `privileges` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_tag` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_thread` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `source` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_id` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `thread_type` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `cc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `bcc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `reply_to` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `delivery_status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_locked` tinyint(1) NOT NULL DEFAULT '0',
  `is_bookmarked` tinyint(1) NOT NULL DEFAULT '0',
  `message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `agent_viewed_at` datetime DEFAULT NULL,
  `customer_viewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_637D7E5D700047D2` (`ticket_id`),
  KEY `IDX_637D7E5DA76ED395` (`user_id`),
  CONSTRAINT `FK_637D7E5D700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_637D7E5DA76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket_attachments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `thread_id` int DEFAULT NULL,
  `name` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `path` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `content_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size` int DEFAULT NULL,
  `content_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `file_system` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_FE918C8EE2904019` (`thread_id`),
  CONSTRAINT `FK_FE918C8EE2904019` FOREIGN KEY (`thread_id`) REFERENCES `uv_thread` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_ticket_rating` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ticket_id` int DEFAULT NULL,
  `user_id` int DEFAULT NULL,
  `stars` int NOT NULL DEFAULT '0',
  `feedback` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_B1025E04700047D2` (`ticket_id`),
  KEY `IDX_B1025E04A76ED395` (`user_id`),
  CONSTRAINT `FK_B1025E04700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_B1025E04A76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_tickets_collaborators` (
  `ticket_id` int NOT NULL,
  `user_id` int NOT NULL,
  PRIMARY KEY (`ticket_id`,`user_id`),
  KEY `IDX_20764CBA700047D2` (`ticket_id`),
  KEY `IDX_20764CBAA76ED395` (`user_id`),
  CONSTRAINT `FK_20764CBA700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_20764CBAA76ED395` FOREIGN KEY (`user_id`) REFERENCES `uv_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_tickets_labels` (
  `ticket_id` int NOT NULL,
  `label_id` int NOT NULL,
  PRIMARY KEY (`ticket_id`,`label_id`),
  KEY `IDX_305F9C0E700047D2` (`ticket_id`),
  KEY `IDX_305F9C0E33B92F39` (`label_id`),
  CONSTRAINT `FK_305F9C0E33B92F39` FOREIGN KEY (`label_id`) REFERENCES `uv_support_label` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_305F9C0E700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_tickets_tags` (
  `ticket_id` int NOT NULL,
  `tag_id` int NOT NULL,
  PRIMARY KEY (`ticket_id`,`tag_id`),
  KEY `IDX_CF4DF9E3700047D2` (`ticket_id`),
  KEY `IDX_CF4DF9E3BAD26311` (`tag_id`),
  CONSTRAINT `FK_CF4DF9E3700047D2` FOREIGN KEY (`ticket_id`) REFERENCES `uv_ticket` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_CF4DF9E3BAD26311` FOREIGN KEY (`tag_id`) REFERENCES `uv_tag` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_user_support_groups` (
  `userInstanceId` int NOT NULL,
  `supportGroupId` int NOT NULL,
  PRIMARY KEY (`userInstanceId`,`supportGroupId`),
  KEY `IDX_B6CD76C28B414560` (`userInstanceId`),
  KEY `IDX_B6CD76C253F5B65F` (`supportGroupId`),
  CONSTRAINT `FK_B6CD76C253F5B65F` FOREIGN KEY (`supportGroupId`) REFERENCES `uv_support_group` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_B6CD76C28B414560` FOREIGN KEY (`userInstanceId`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_user_support_privileges` (
  `userInstanceId` int NOT NULL,
  `supportPrivilegeId` int NOT NULL,
  PRIMARY KEY (`userInstanceId`,`supportPrivilegeId`),
  KEY `IDX_9550EDB28B414560` (`userInstanceId`),
  KEY `IDX_9550EDB289C60B89` (`supportPrivilegeId`),
  CONSTRAINT `FK_9550EDB289C60B89` FOREIGN KEY (`supportPrivilegeId`) REFERENCES `uv_support_privilege` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_9550EDB28B414560` FOREIGN KEY (`userInstanceId`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_user_support_teams` (
  `userInstanceId` int NOT NULL,
  `supportTeamId` int NOT NULL,
  PRIMARY KEY (`userInstanceId`,`supportTeamId`),
  KEY `IDX_5F33E9F78B414560` (`userInstanceId`),
  KEY `IDX_5F33E9F7A77C7023` (`supportTeamId`),
  CONSTRAINT `FK_5F33E9F78B414560` FOREIGN KEY (`userInstanceId`) REFERENCES `uv_user_instance` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_5F33E9F7A77C7023` FOREIGN KEY (`supportTeamId`) REFERENCES `uv_support_team` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_website` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `logo` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `theme_color` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `favicon` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `timezone` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `timeformat` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `UNIQ_2656FF0677153098` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_website_knowledgebase` (
  `id` int NOT NULL AUTO_INCREMENT,
  `website` int DEFAULT NULL,
  `status` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `brand_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `page_background_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `header_background_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `article_text_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ticket_create_option` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `site_description` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta_description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `meta_keywords` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `homepage_content` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `white_list` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `black_list` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  `broadcast_message` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `disable_customer_login` tinyint(1) NOT NULL,
  `script` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `custom_css` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) NOT NULL,
  `header_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `footer_links` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '(DC2Type:array)',
  `banner_background_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_hover_color` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `login_required_to_create` tinyint(1) DEFAULT NULL,
  `remove_customer_login_button` int DEFAULT '0',
  `remove_branding_content` int DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `IDX_DFF10F0B476F5DE7` (`website`),
  CONSTRAINT `FK_DFF10F0B476F5DE7` FOREIGN KEY (`website`) REFERENCES `uv_website` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_workflow` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `conditions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '(DC2Type:array)',
  `actions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '(DC2Type:array)',
  `sort_order` int DEFAULT NULL,
  `is_predefind` tinyint(1) NOT NULL DEFAULT '1',
  `status` tinyint(1) NOT NULL DEFAULT '1',
  `date_added` datetime NOT NULL,
  `date_updated` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `uv_workflow_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_id` int DEFAULT NULL,
  `event_id` int NOT NULL,
  `event` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_6AEB02A92C7C2CBA` (`workflow_id`),
  CONSTRAINT `FK_6AEB02A92C7C2CBA` FOREIGN KEY (`workflow_id`) REFERENCES `uv_workflow` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
