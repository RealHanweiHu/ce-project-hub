ALTER TABLE `project_tasks` ADD `assigneeUserId` int;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `dueDate` date;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `status` enum('todo','in_progress','blocked','done') DEFAULT 'todo' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `priority` enum('low','medium','high','critical') DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `project_tasks` ADD `completedAt` timestamp;