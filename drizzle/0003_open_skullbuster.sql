ALTER TABLE `project_phases` ADD CONSTRAINT `uniq_project_phase` UNIQUE(`projectId`,`phaseId`);--> statement-breakpoint
ALTER TABLE `project_tasks` ADD CONSTRAINT `uniq_project_phase_task` UNIQUE(`projectId`,`phaseId`,`taskId`);--> statement-breakpoint
CREATE INDEX `idx_changelog_project_type_status` ON `project_changelog` (`projectId`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_gate_reviews_project_phase` ON `project_gate_reviews` (`projectId`,`phaseId`);--> statement-breakpoint
CREATE INDEX `idx_issues_project_phase_status_severity` ON `project_issues` (`projectId`,`phaseId`,`status`,`severity`);