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
--> statement-breakpoint
CREATE TABLE `project_changelog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`number` varchar(32) NOT NULL DEFAULT '',
	`type` enum('decision','tradeoff','eco','ecn','spec','cost','schedule','supplier','other') NOT NULL DEFAULT 'other',
	`title` varchar(256) NOT NULL,
	`description` text,
	`reason` text,
	`decisionMaker` varchar(128),
	`affectedPhases` json DEFAULT ('[]'),
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
--> statement-breakpoint
CREATE TABLE `project_gate_reviews` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`phaseId` varchar(32) NOT NULL,
	`phaseName` varchar(64) NOT NULL DEFAULT '',
	`gateName` varchar(128) NOT NULL DEFAULT '',
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
--> statement-breakpoint
CREATE TABLE `project_issues` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`phaseId` varchar(32) NOT NULL,
	`title` varchar(256) NOT NULL,
	`description` text,
	`severity` enum('P0','P1','P2','P3') NOT NULL DEFAULT 'P2',
	`status` enum('open','in_progress','resolved','closed','wont_fix') NOT NULL DEFAULT 'open',
	`category` enum('hardware','software','mechanical','thermal','reliability','safety','performance','other') NOT NULL DEFAULT 'other',
	`owner` varchar(128),
	`reporter` varchar(128),
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `project_phases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`phaseId` varchar(32) NOT NULL,
	`startDate` varchar(32),
	`endDate` varchar(32),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_phases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `project_tasks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`projectId` varchar(32) NOT NULL,
	`phaseId` varchar(32) NOT NULL,
	`taskId` varchar(32) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`instructions` text,
	`visibleRoles` json DEFAULT ('[]'),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `project_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(32) NOT NULL,
	`name` varchar(256) NOT NULL,
	`projectNumber` varchar(64) NOT NULL DEFAULT '',
	`category` varchar(64) NOT NULL DEFAULT 'npd',
	`pmUserId` int,
	`pmName` varchar(128) NOT NULL DEFAULT '',
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
--> statement-breakpoint
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
