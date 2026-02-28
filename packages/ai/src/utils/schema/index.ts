export { adaptSchemaForStrict } from "./adapt";
export {
	type SchemaCompatibilityProvider,
	type SchemaCompatibilityResult,
	type SchemaCompatibilityViolation,
	type StrictSchemaEnforcementResult,
	validateSchemaCompatibility,
	validateStrictSchemaEnforcement,
} from "./compatibility";
export { areJsonValuesEqual, mergeCompatibleEnumSchemas, mergePropertySchemas } from "./equality";
export {
	CLOUD_CODE_ASSIST_SHARED_SCHEMA_KEYS,
	CLOUD_CODE_ASSIST_TYPE_SPECIFIC_KEYS,
	NON_STRUCTURAL_SCHEMA_KEYS,
	UNSUPPORTED_SCHEMA_FIELDS,
} from "./fields";
export { copySchemaWithout, prepareSchemaForCCA, stripResidualCombiners } from "./normalize-cca";
export {
	sanitizeSchemaForCCA,
	sanitizeSchemaForGoogle,
	sanitizeSchemaForMCP,
} from "./sanitize-google";
export {
	enforceStrictSchema,
	NO_STRICT,
	StringEnum,
	sanitizeSchemaForStrictMode,
	tryEnforceStrictSchema,
} from "./strict-mode";
export { isJsonObject, type JsonObject } from "./types";
