import { resolve } from "node:path";
import { PROJECT_ROOT } from "../.pi/extensions/pi-polza/env.ts";

/** Directory Pi stores this project's sessions in (slug derived from the project path). */
const slug = PROJECT_ROOT.split(":").join("-").split("\\").join("-").split("/").join("-");

export const SESSION_DIR = resolve(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  ".pi",
  "agent",
  "sessions",
  `--${slug}--`,
);
