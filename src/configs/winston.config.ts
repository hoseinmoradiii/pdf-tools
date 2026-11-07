import * as winston from "winston";

winston.addColors({
  error: "red",
  warn: "yellow",
  info: "green",
});

winston.format.colorize({ all: true });

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp()),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const extra = Object.keys(meta).length
            ? ` ${JSON.stringify(meta)}`
            : "";

          return `${timestamp} [${level}]: ${message}${extra}`;
        }),
      ),
    }),
  ],
});
