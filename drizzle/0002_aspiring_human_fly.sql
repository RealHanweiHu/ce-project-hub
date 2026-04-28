ALTER TABLE `project_changelog` MODIFY COLUMN `number` varchar(64) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `title` varchar(512) NOT NULL;--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `decisionMaker` varchar(256);--> statement-breakpoint
ALTER TABLE `project_changelog` MODIFY COLUMN `status` enum('proposed','approved','rejected','implemented','cancelled') NOT NULL DEFAULT 'proposed';--> statement-breakpoint
ALTER TABLE `project_gate_reviews` MODIFY COLUMN `phaseName` varchar(256) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `project_gate_reviews` MODIFY COLUMN `gateName` varchar(256) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `title` varchar(512) NOT NULL;--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `owner` varchar(256);--> statement-breakpoint
ALTER TABLE `project_issues` MODIFY COLUMN `reporter` varchar(256);