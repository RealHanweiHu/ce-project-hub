CREATE TABLE `comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`targetType` enum('task','issue','change','file','gate_review') NOT NULL,
	`targetId` int NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`authorId` int NOT NULL,
	`content` text NOT NULL,
	`mentionedUserIds` json DEFAULT ('[]'),
	`parentId` int,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(64) NOT NULL,
	`title` varchar(256) NOT NULL,
	`body` text,
	`projectId` varchar(32),
	`link` varchar(512),
	`isRead` boolean NOT NULL DEFAULT false,
	`meta` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `phase_deliverables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`phaseId` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`fileCategory` enum('prd','bom','drawing','test_report','certification','trial_report','specification','manual','other') NOT NULL DEFAULT 'other',
	`isMandatory` boolean NOT NULL DEFAULT true,
	`fileId` int,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `phase_deliverables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_bom` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`bomVersion` varchar(16) NOT NULL DEFAULT 'A',
	`partNumber` varchar(64) NOT NULL,
	`partName` varchar(256) NOT NULL,
	`itemType` enum('component','sub_assembly','raw_material','packaging','consumable') NOT NULL DEFAULT 'component',
	`quantity` int NOT NULL DEFAULT 1,
	`unit` varchar(16) NOT NULL DEFAULT 'pcs',
	`supplier` varchar(256),
	`supplierPartNumber` varchar(128),
	`unitCost` varchar(32),
	`currency` varchar(8) NOT NULL DEFAULT 'CNY',
	`leadTimeDays` int,
	`isCritical` boolean NOT NULL DEFAULT false,
	`alternatePartIds` json DEFAULT ('[]'),
	`specification` text,
	`relatedChangeId` int,
	`createdBy` int,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_bom_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `type` enum('decision','tradeoff','eco','ecn','ecr','spec','cost','schedule','supplier','other') NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `status` enum('open','contained','root_caused','correcting','verifying','closed','wont_fix') NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE `project_tasks` MODIFY COLUMN `status` enum('todo','in_progress','blocked','done','cancelled') NOT NULL DEFAULT 'todo';--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `oldValues` json;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `newValues` json;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `source` varchar(32) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD `requestId` varchar(64);--> statement-breakpoint
ALTER TABLE `project_changelog` ADD `affectedBomItemIds` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `project_changelog` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `project_files` ADD `version` varchar(16) DEFAULT '1.0' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD `isLatest` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD `previousVersionId` int;--> statement-breakpoint
ALTER TABLE `project_files` ADD `contentHash` varchar(64);--> statement-breakpoint
ALTER TABLE `project_files` ADD `category` enum('prd','bom','drawing','test_report','certification','trial_report','specification','manual','other') DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD `approvalStatus` enum('draft','pending_review','approved','rejected','obsolete') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_files` ADD `approvedBy` int;--> statement-breakpoint
ALTER TABLE `project_files` ADD `approvedAt` timestamp;--> statement-breakpoint
ALTER TABLE `project_files` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `project_gate_reviews` ADD `deliverableChecks` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `project_issues` ADD `issueNumber` varchar(32);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `ownerUserId` int;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `responsibleDept` varchar(128);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `containmentAction` text;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `containmentDate` varchar(32);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `containmentVerified` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `rootCauseMethod` varchar(64);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `correctiveAction` text;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `correctiveActionDate` varchar(32);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `verificationResult` text;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `verificationDate` varchar(32);--> statement-breakpoint
ALTER TABLE `project_issues` ADD `verifiedBy` int;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `closedBy` int;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `preventiveAction` text;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `recurrenceCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_issues` ADD `relatedIssueIds` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `project_issues` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `collaboratorUserIds` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `riskLevel` enum('none','low','medium','high','critical') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `approvalStatus` enum('not_required','pending','approved','rejected') DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `predecessorTaskIds` json DEFAULT ('[]');--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `delayReason` text;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `completionEvidence` text;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `deletedAt` timestamp;--> statement-breakpoint
ALTER TABLE `projects` ADD `deletedAt` timestamp;--> statement-breakpoint
CREATE INDEX `idx_comments_target` ON `comments` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `idx_comments_project` ON `comments` (`projectId`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`userId`,`isRead`);--> statement-breakpoint
CREATE INDEX `idx_deliverables_project_phase` ON `phase_deliverables` (`projectId`,`phaseId`);--> statement-breakpoint
CREATE INDEX `idx_bom_project` ON `project_bom` (`projectId`);--> statement-breakpoint
CREATE INDEX `idx_bom_part_number` ON `project_bom` (`projectId`,`partNumber`);--> statement-breakpoint
CREATE INDEX `idx_activity_logs_entity` ON `activity_logs` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `idx_project_files_prev_version` ON `project_files` (`previousVersionId`);--> statement-breakpoint
CREATE INDEX `idx_issues_owner` ON `project_issues` (`ownerUserId`);--> statement-breakpoint
CREATE INDEX `idx_tasks_project_status` ON `project_tasks` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_assignee` ON `project_tasks` (`assigneeUserId`);