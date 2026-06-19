CREATE TABLE "calendar_exceptions" (
	"date" date PRIMARY KEY NOT NULL,
	"type" varchar(16) NOT NULL,
	"name" varchar(128) DEFAULT '' NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
