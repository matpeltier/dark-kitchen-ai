import { readFileSync } from "node:fs";
import path from "node:path";

const configPath = process.env.FACTORY_CONFIG_PATH
  ?? (process.cwd().endsWith(path.sep + ".factory")
    ? path.join(process.cwd(), "config.json")
    : path.join(process.cwd(), ".factory", "config.json"));
const factoryConfig = JSON.parse(readFileSync(configPath, "utf8"));

export default {
  providers: factoryConfig.providers,
  default: factoryConfig.agents.implementer,
};
