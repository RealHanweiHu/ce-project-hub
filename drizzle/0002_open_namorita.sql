CREATE TABLE `project_members` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('owner','manager','pm','rd_hw','rd_sw','rd_mech','qa','scm','viewer') NOT NULL DEFAULT 'viewer',
	`jobTitle` varchar(64),
	`invitedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_members_id` PRIMARY KEY(`id`)
);
