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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `status` enum('proposed','approved','rejected','implemented') NOT NULL DEFAULT 'proposed';--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `uniq_project_member` UNIQUE(`projectId`,`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_logs_project` ON `activity_logs` (`projectId`);--> statement-breakpoint
CREATE INDEX `idx_activity_logs_user` ON `activity_logs` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_logs_project_time` ON `activity_logs` (`projectId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_project_files_project` ON `project_files` (`projectId`);--> statement-breakpoint
CREATE INDEX `idx_project_files_project_phase` ON `project_files` (`projectId`,`phaseId`);--> statement-breakpoint
CREATE INDEX `idx_project_members_project` ON `project_members` (`projectId`);--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `pmName`;