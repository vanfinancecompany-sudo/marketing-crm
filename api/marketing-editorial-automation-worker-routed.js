import {withCronHealth} from "../lib/cronHealthTelemetry.js";
import handler from "./marketing-editorial-automation-worker.js";
import { applyAiOperationModelOverride } from "../lib/priorityAiModelPolicy.js";

applyAiOperationModelOverride(process.env, "editorial_automation");

export default withCronHealth("/api/marketing-editorial-automation-worker-routed", handler);
