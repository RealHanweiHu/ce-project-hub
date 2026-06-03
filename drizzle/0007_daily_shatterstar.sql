ALTER TABLE `project_changelog` MODIFY COLUMN `costImpact` varchar(256);--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `scheduleImpact` varchar(256);--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `createdAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `updatedAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `relatedTaskId` varchar(64);--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `createdAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `updatedAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_phases` MODIFY COLUMN `createdAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_phases` MODIFY COLUMN `updatedAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_tasks` MODIFY COLUMN `createdAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `project_tasks` MODIFY COLUMN `updatedAt` datetime NOT NULL DEFAULT '1970-01-01 00:00:00.000';--> statement-breakpoint
ALTER TABLE `projects` MODIFY COLUMN `risk` varchar(16) NOT NULL DEFAULT 'low';