CREATE TABLE `projects` (
	`id` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`projectNumber` varchar(64) NOT NULL DEFAULT '',
	`category` varchar(16) NOT NULL DEFAULT 'npd',
	`pm` varchar(128) NOT NULL DEFAULT '',
	`risk` varchar(16) NOT NULL DEFAULT 'low',
	`currentPhase` varchar(32) NOT NULL DEFAULT 'concept',
	`progress` int NOT NULL DEFAULT 0,
	`startDate` varchar(32),
	`targetDate` varchar(32),
	`data` json NOT NULL,
	`createdBy` int NOT NULL,
	`archived` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
