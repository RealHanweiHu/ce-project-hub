-- ============================================================
-- CE Project Hub - Complete Database Migration
-- Generated from schema.ts (the single source of truth)
-- Run this on a fresh empty database to set up all tables.
--
-- Usage:
--   mysql -h <host> -u <user> -p <db> < migration.sql
--
-- This file is the canonical migration for CE Project Hub.
-- It is composed of the following drizzle migration files:
--   0000_clever_the_hood.sql   (initial schema)
--   0001_freezing_scourge.sql  (activity_logs, project_files, member unique index)
--   0002_aspiring_human_fly.sql (changelog enums, varchar lengths)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Organizations (reserved for future multi-tenant support)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `organizations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(256) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `ownerId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `organizations_id` PRIMARY KEY(`id`),
  CONSTRAINT `organizations_slug_unique` UNIQUE(`slug`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `users` (
  `id` int AUTO_INCREMENT NOT NULL,
  `openId` varchar(64) NOT NULL,
  `username` varchar(64),
  `passwordHash` varchar(256),
  `name` text,
  `email` varchar(320),
  `loginMethod` varchar(64),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `canCreateProject` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `lastSignedIn` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `users_id` PRIMARY KEY(`id`),
  CONSTRAINT `users_openId_unique` UNIQUE(`openId`),
  CONSTRAINT `users_username_unique` UNIQUE(`username`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Projects
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `projects` (
  `id` varchar(32) NOT NULL,
  `name` varchar(256) NOT NULL,
  `projectNumber` varchar(64) NOT NULL DEFAULT '',
  `category` varchar(64) NOT NULL DEFAULT 'npd',
  `pmUserId` int,
  `risk` enum('low','medium','high') NOT NULL DEFAULT 'low',
  `currentPhase` varchar(32) NOT NULL DEFAULT 'concept',
  `progress` int NOT NULL DEFAULT 0,
  `startDate` varchar(32),
  `targetDate` varchar(32),
  `createdBy` int NOT NULL,
  `archived` boolean NOT NULL DEFAULT false,
  `orgId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Members
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_members` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `userId` int NOT NULL,
  `role` enum('owner','manager','pm','rd_hw','rd_sw','rd_mech','qa','scm','viewer') NOT NULL DEFAULT 'viewer',
  `jobTitle` varchar(64),
  `invitedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_members_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_project_member` UNIQUE(`projectId`,`userId`)
);
CREATE INDEX `idx_project_members_project` ON `project_members` (`projectId`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Phases
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_phases` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `phaseId` varchar(32) NOT NULL,
  `startDate` varchar(32),
  `endDate` varchar(32),
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_phases_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_project_phase` UNIQUE(`projectId`,`phaseId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Tasks
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `phaseId` varchar(32) NOT NULL,
  `taskId` varchar(32) NOT NULL,
  `completed` boolean NOT NULL DEFAULT false,
  `instructions` text,
  `visibleRoles` json DEFAULT NULL,
  `updatedBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_tasks_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_project_phase_task` UNIQUE(`projectId`,`phaseId`,`taskId`)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Issues
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_issues` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `phaseId` varchar(32) NOT NULL,
  `title` varchar(512) NOT NULL,
  `description` text,
  `severity` enum('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
  `status` enum('open','in_progress','resolved','closed','wont_fix') NOT NULL DEFAULT 'open',
  `category` enum('hardware','software','mechanical','thermal','reliability','safety','performance','other') NOT NULL DEFAULT 'other',
  `owner` varchar(256),
  `reporter` varchar(256),
  `foundDate` varchar(32),
  `targetDate` varchar(32),
  `closedDate` varchar(32),
  `rootCause` text,
  `solution` text,
  `relatedTaskId` varchar(32),
  `creatorId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_issues_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_issues_project_phase_status_severity` ON `project_issues` (`projectId`,`phaseId`,`status`,`severity`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Gate Reviews
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_gate_reviews` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `phaseId` varchar(32) NOT NULL,
  `phaseName` varchar(256) NOT NULL DEFAULT '',
  `gateName` varchar(256) NOT NULL DEFAULT '',
  `reviewDate` varchar(32) NOT NULL,
  `participants` text,
  `decision` enum('approved','conditional','rejected') NOT NULL DEFAULT 'conditional',
  `conditions` text,
  `notes` text,
  `roundNumber` int NOT NULL DEFAULT 1,
  `createdBy` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_gate_reviews_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_gate_reviews_project_phase` ON `project_gate_reviews` (`projectId`,`phaseId`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Changelog
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_changelog` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `number` varchar(64) NOT NULL DEFAULT '',
  `type` enum('decision','tradeoff','eco','ecn','spec','cost','schedule','supplier','other') NOT NULL DEFAULT 'other',
  `title` varchar(512) NOT NULL,
  `description` text,
  `reason` text,
  `decisionMaker` varchar(256),
  `affectedPhases` json DEFAULT NULL,
  `status` enum('proposed','approved','rejected','implemented','cancelled') NOT NULL DEFAULT 'proposed',
  `costImpact` varchar(128),
  `scheduleImpact` varchar(128),
  `notes` text,
  `createdDate` varchar(32),
  `implementedDate` varchar(32),
  `creatorId` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `project_changelog_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_changelog_project_type_status` ON `project_changelog` (`projectId`,`type`,`status`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Project Files (object storage metadata)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `project_files` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `phaseId` varchar(32),
  `name` varchar(256) NOT NULL,
  `mimeType` varchar(128) NOT NULL DEFAULT 'application/octet-stream',
  `size` bigint NOT NULL DEFAULT 0,
  `storageKey` varchar(512) NOT NULL,
  `storageUrl` varchar(512) NOT NULL,
  `uploadedBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `project_files_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_project_files_project` ON `project_files` (`projectId`);
CREATE INDEX `idx_project_files_project_phase` ON `project_files` (`projectId`,`phaseId`);

-- ─────────────────────────────────────────────────────────────────────────────
-- Activity Logs (immutable audit trail)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE `activity_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `projectId` varchar(32) NOT NULL,
  `userId` int NOT NULL,
  `action` varchar(64) NOT NULL,
  `entityType` varchar(32),
  `entityId` varchar(64),
  `meta` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_activity_logs_project` ON `activity_logs` (`projectId`);
CREATE INDEX `idx_activity_logs_user` ON `activity_logs` (`userId`);
CREATE INDEX `idx_activity_logs_project_time` ON `activity_logs` (`projectId`,`createdAt`);
