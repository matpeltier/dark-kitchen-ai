import factoryConfig from "./config.json" with { type: "json" };

export default {
  providers: factoryConfig.providers,
  default: factoryConfig.agents.implementer,
};
